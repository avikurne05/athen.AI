import { Memory, MemoryMetadata, incrementMemoryUsage } from './db';
import { AIAction } from './gemini';

// Alias dictionary mapping target routines/habits to query tokens
export const ALIAS_MAP: Record<string, string[]> = {
  gym: ['gym', 'workout', 'exercise', 'lifting', 'fitness', 'run', 'running', 'yoga', 'gym_routine'],
  dsa: ['dsa', 'coding', 'leetcode', 'codeforces', 'programming', 'algorithms', 'dsa_practice'],
  sleep: ['sleep', 'bed', 'rest', 'bedtime', 'sleep_schedule'],
  study: ['study', 'reading', 'learn', 'learning', 'book', 'books'],
  work: ['work', 'job', 'office', 'meeting', 'tasks', 'writing']
};

export const DEFAULT_ROUTINES: Record<string, { time?: string; duration?: number }> = {
  gym: { time: '17:00', duration: 60 },
  dsa: { time: '19:00', duration: 120 },
  sleep: { time: '23:00', duration: 480 },
  wake: { time: '07:00' }
};

export interface MemoryMatch {
  memory: Memory;
  confidence: number;
}

/**
 * Standardizes title and matches it against our ALIAS_MAP.
 * Returns the mapped category key (e.g. 'gym') if a match is found.
 */
export function getAliasCategory(title: string): string | null {
  const cleanTitle = title.toLowerCase().trim();
  if (!cleanTitle) return null;

  // Split title into words
  const words = cleanTitle.replace(/[^a-z0-9\s]/gi, '').split(/\s+/);

  for (const [category, aliases] of Object.entries(ALIAS_MAP)) {
    // Check if the title is directly equal or contains any of the aliases as a word
    const match = aliases.some(alias => 
      cleanTitle === alias || words.includes(alias)
    );
    if (match) return category;
  }
  return null;
}

/**
 * Retrieves memories relevant to the user query/action title based on confidence scoring.
 * Score Formula: score = 0.6 * aliasMatch + 0.2 * keyMatch + 0.2 * categoryMatch
 * Filters matches below 0.7 confidence threshold.
 */
export function retrieveRelevantMemories(title: string, memories: Memory[]): MemoryMatch[] {
  if (!title || !memories) return [];
  const cleanTitle = title.toLowerCase().trim();
  const queryCategory = getAliasCategory(cleanTitle);
  const titleWords = cleanTitle.replace(/[^a-z0-9\s]/gi, '').split(/\s+/).filter(w => w.length > 1);

  const matches: MemoryMatch[] = [];

  for (const memory of memories) {
    if (memory.key.startsWith('onboarding_answer_')) {
      continue;
    }

    const memoryKeyClean = memory.key.toLowerCase().replace(/_/g, ' ');
    const memoryDescClean = memory.description.toLowerCase();

    // 1. Alias Match (0.6)
    let aliasMatch = 0;
    if (queryCategory) {
      const memoryHasQueryCategory = memory.key.includes(queryCategory) || memoryDescClean.includes(queryCategory);
      // Check if memory has aliases of the matched category
      const aliases = ALIAS_MAP[queryCategory] || [];
      const hasAliasWord = aliases.some(alias => 
        memoryKeyClean.includes(alias) || memoryDescClean.includes(alias)
      );

      if (memoryHasQueryCategory || hasAliasWord) {
        aliasMatch = 1.0;
      }
    }

    // 2. Key Match (0.2)
    let keyMatch = 0;
    if (memory.key.includes(cleanTitle) || cleanTitle.includes(memory.key)) {
      keyMatch = 1.0;
    } else {
      // Check word overlap
      const hasWordOverlap = titleWords.some(word => 
        memoryKeyClean.split(/\s+/).includes(word)
      );
      if (hasWordOverlap) {
        keyMatch = 0.8;
      }
    }

    // 3. Category Match (0.2)
    let categoryMatch = 0;
    if (memory.category === 'routine' || memory.category === 'habit') {
      categoryMatch = 1.0;
    } else if (memory.category === 'preference' || memory.category === 'constraint') {
      categoryMatch = 0.8;
    } else if (memory.category === 'goal') {
      categoryMatch = 0.5;
    } else if (memory.category === 'temporary') {
      categoryMatch = 0.3;
    }

    // Compute base score
    let score = 0.6 * aliasMatch + 0.2 * keyMatch + 0.2 * categoryMatch;

    // Pin boost
    if (memory.pinned === 1) {
      score = Math.min(1.0, score + 0.1);
    }

    if (score >= 0.7) {
      matches.push({ memory, confidence: score });
    }
  }

  // Sort: Confidence (descending), Pinned status, Usage Count (descending), Last Used (descending)
  return matches.sort((a, b) => {
    if (Math.abs(a.confidence - b.confidence) > 0.01) {
      return b.confidence - a.confidence;
    }
    const aPinned = a.memory.pinned ?? 0;
    const bPinned = b.memory.pinned ?? 0;
    if (aPinned !== bPinned) return bPinned - aPinned;

    const aUsage = a.memory.usage_count ?? 0;
    const bUsage = b.memory.usage_count ?? 0;
    if (aUsage !== bUsage) return bUsage - aUsage;

    const aTime = a.memory.last_used_at ? new Date(a.memory.last_used_at).getTime() : 0;
    const bTime = b.memory.last_used_at ? new Date(b.memory.last_used_at).getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Extracted regex-based parser to read time and duration from memory descriptions.
 */
export function extractTimeAndDurationFromDescription(description: string): MemoryMetadata {
  const result: MemoryMetadata = {};
  if (!description) return result;

  const text = description.toLowerCase();

  // 1. Time extraction
  // Matches "5 PM", "5:30 PM", "9 AM", etc.
  const timeRegex1 = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
  // Matches "17:00", "09:30"
  const timeRegex2 = /\b(\d{1,2}):(\d{2})\b/;

  const match1 = text.match(timeRegex1);
  if (match1) {
    let hour = parseInt(match1[1], 10);
    const minute = match1[2] ? match1[2] : '00';
    const ampm = match1[3].toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    result.defaultTime = `${String(hour).padStart(2, '0')}:${minute}`;
  } else {
    const match2 = text.match(timeRegex2);
    if (match2) {
      const hour = parseInt(match2[1], 10);
      const minute = match2[2];
      if (hour >= 0 && hour < 24) {
        result.defaultTime = `${String(hour).padStart(2, '0')}:${minute}`;
      }
    }
  }

  // 2. Duration extraction
  // Matches "2 hours", "1.5 hrs", "30 mins", "45 minutes", "1 hour"
  const durationRegex = /\b(\d+(?:\.\d+)?)\s*(hour|hr|std|minute|min)s?\b/i;
  const matchDuration = text.match(durationRegex);
  if (matchDuration) {
    const value = parseFloat(matchDuration[1]);
    const unit = matchDuration[2].toLowerCase();
    if (unit.startsWith('hour') || unit.startsWith('hr') || unit.startsWith('std')) {
      result.duration = Math.round(value * 60);
    } else if (unit.startsWith('minute') || unit.startsWith('min')) {
      result.duration = Math.round(value);
    }
  }

  return result;
}

/**
 * Fallback mapping for hardcoded defaults
 */
export function getDefaultRoutineAttributes(title: string): { time?: string; duration?: number } | null {
  const cleanTitle = title.toLowerCase().trim();
  for (const key of Object.keys(DEFAULT_ROUTINES)) {
    if (cleanTitle.includes(key)) {
      return DEFAULT_ROUTINES[key];
    }
  }
  return null;
}

/**
 * Enrichment result returned by the Memory Application Engine
 */
export interface EnrichmentResult {
  actions: AIAction[];
  clarifications: string[];
}

/**
 * Memory Application Engine: Enriches intent actions from Gemini with high-confidence memories,
 * resolving ambiguity or missing times/durations deterministically.
 */
export async function enrichActionsWithMemories(
  actions: AIAction[],
  memories: Memory[]
): Promise<EnrichmentResult> {
  if (!actions) return { actions: [], clarifications: [] };

  const enrichedActions: AIAction[] = [];
  const clarifications: string[] = [];

  for (const action of actions) {
    // Only enrich CREATE or MOVE actions where time or duration might be missing
    if (action.type !== 'CREATE' && action.type !== 'MOVE') {
      enrichedActions.push(action);
      continue;
    }

    const title = action.title || '';
    if (!title) {
      enrichedActions.push(action);
      continue;
    }

    const relevant = retrieveRelevantMemories(title, memories);

    // Ambiguity Handling: check if top 2 matches are extremely close
    if (relevant.length >= 2) {
      const top1 = relevant[0];
      const top2 = relevant[1];
      if (Math.abs(top1.confidence - top2.confidence) < 0.15) {
        console.log(`[MemoryEngine] Detected ambiguity between "${top1.memory.key}" and "${top2.memory.key}" for action "${title}"`);
        clarifications.push(
          `I found multiple routines matching "${title}" (e.g. "${top1.memory.description}" or "${top2.memory.description}"). Which one did you mean?`
        );
        // Exclude this action from scheduling
        continue;
      }
    }

    const enriched = { ...action };

    let defaultTime: string | undefined;
    let duration: number | undefined;

    // Hierarchy 1: Stored Metadata
    if (relevant.length > 0) {
      const topMatch = relevant[0].memory;
      console.log(`[MemoryEngine] Match found: "${topMatch.key}" with confidence ${relevant[0].confidence}`);
      
      // Increment memory count asynchronously
      incrementMemoryUsage(topMatch.key).catch(e => 
        console.error('[MemoryEngine] Error incrementing usage:', e)
      );

      if (topMatch.metadata) {
        if (topMatch.metadata.defaultTime) defaultTime = topMatch.metadata.defaultTime;
        if (topMatch.metadata.duration) duration = topMatch.metadata.duration;
      }

      // Hierarchy 2: Regex extraction fallback
      if (!defaultTime || !duration) {
        const regexExtracted = extractTimeAndDurationFromDescription(topMatch.description);
        if (!defaultTime && regexExtracted.defaultTime) defaultTime = regexExtracted.defaultTime;
        if (!duration && regexExtracted.duration) duration = regexExtracted.duration;
      }
    }

    // Hierarchy 3: Fallback hardcoded defaults
    if (!defaultTime || !duration) {
      const defaults = getDefaultRoutineAttributes(title);
      if (defaults) {
        if (!defaultTime && defaults.time) defaultTime = defaults.time;
        if (!duration && defaults.duration) duration = defaults.duration;
      }
    }

    // Apply only if the user hasn't supplied explicit overrides
    if (defaultTime && !enriched.time) {
      enriched.time = defaultTime;
      console.log(`[MemoryEngine] Enriched action "${title}" with time: ${defaultTime}`);
    }
    if (duration && !enriched.duration) {
      enriched.duration = duration;
      console.log(`[MemoryEngine] Enriched action "${title}" with duration: ${duration} mins`);
    }

    enrichedActions.push(enriched);
  }

  return {
    actions: enrichedActions,
    clarifications
  };
}
