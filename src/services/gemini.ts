import { GoogleGenerativeAI, SchemaType, Schema } from '@google/generative-ai';
import { Task, Memory } from './db';
import { extractTimeConstraints } from './scheduler';
import {
  addLocalDays,
  formatLocalDate,
  formatLocalDateTimeWithOffset,
  getLocalTimeZone,
  oneMonthAgoSameLocalDay,
  startOfLocalDay
} from './time';

export const GEMINI_MODEL = 'gemini-2.5-flash';
export const PARSER_VERSION = 'v1';

export interface AIAction {
  type: 'CREATE' | 'MOVE' | 'DELETE' | 'COMPLETE' | 'ANALYZE';
  task_id?: string;
  title?: string;
  date?: string; // YYYY-MM-DD or relative like 'tomorrow'
  time?: string; // HH:mm format (only if explicitly specified by user)
  duration?: number; // minutes
  priority?: number; // 1-10
  category?: 'work' | 'study' | 'health' | 'personal' | 'social';
  needs_clarification?: boolean;
  clarification_question?: string;
  recurrence?: {
    frequency: 'DAILY' | 'WEEKLY' | 'WEEKDAYS' | 'WEEKENDS' | 'ONCE';
  };
}

export interface ParsedAIResponse {
  intent: 'CREATE_TASKS' | 'QUERY_SCHEDULE' | 'MODIFY_TASKS' | 'DELETE_TASKS' | 'COMPLETE_TASKS' | 'GENERAL_CHAT';
  confidence: number; // 0.0 to 1.0
  planning_mode: 'EXTRACT_ONLY' | 'AUTO_SCHEDULE_DAY';
  reply: string; // The conversational reply/answer to show the user
  clarifications: string[];
  actions: AIAction[];
  memory_updates?: {
    key: string;
    description: string;
    category: 'preference' | 'habit' | 'goal' | 'routine' | 'constraint' | 'temporary';
    confidence: number;
  }[];
}

const SYSTEM_INSTRUCTION = `
You are Athena's Parser AI (Version: v1).
Your sole job is to translate natural language user commands into structured intent data. You do NOT perform scheduling, ordering, slot calculation, or conflict resolution. The deterministic scheduler engine handles those.

You must output a single JSON object matching the requested schema.

Guidelines:
1. Intent Classification:
   Classify the primary user intent into one of:
   - "CREATE_TASKS": The user is asking to schedule/add one or more new tasks.
   - "QUERY_SCHEDULE": The user is asking to view, describe, list, or look up their schedule (e.g. "What's on my schedule today?").
   - "MODIFY_TASKS": The user wants to reschedule, move, or edit existing tasks (e.g. "Move gym to 7 PM").
   - "DELETE_TASKS": The user wants to remove/cancel tasks.
   - "COMPLETE_TASKS": The user wants to mark tasks as completed.
   - "GENERAL_CHAT": Casual conversation, analytical questions, productivity reflections (e.g. "How productive was I?").

2. Context Isolation (CRITICAL):
   - The user profile and memories provided in the context are STRICTLY READ-ONLY reference context.
   - They may help you infer defaults (like preferred slot, average task duration, or gym days) or map task names.
   - **NEVER** automatically schedule tasks from profile or memory information.
   - Only extract and schedule tasks that are EXPLICITLY requested in the latest user command. If a task was mentioned in the past or exists in memory but is absent from the latest command, ignore it for scheduling.

3. Multiple Task Extraction:
   - If the user lists multiple tasks in a single command, you MUST extract ALL of them. Return a separate CREATE action for each task in the "actions" array.

4. Planning Mode:
   - Set "planning_mode" to "AUTO_SCHEDULE_DAY" if the user uses trigger phrases like "plan my day", "schedule my day", "arrange my tasks", "fit these into today", or requests a comprehensive schedule for their day.
   - Otherwise, set it to "EXTRACT_ONLY".
   - In "AUTO_SCHEDULE_DAY" mode: DO NOT prescribe exact "time" values for tasks unless the user explicitly specified a time for that specific task (e.g., "Gym at 6 PM"). Leave the "time" field blank for tasks without explicit times so the scheduler can arrange them.

5. Confidence Score:
   - Estimate your confidence from 0.0 (low) to 1.0 (high) based on how clear the user's instructions are.
   - Vague or highly ambiguous requests (e.g., "Maybe gym later") should have a low confidence score (e.g., < 0.60).
   - Clear, explicit requests (e.g., "Gym at 6 PM") should have a high confidence score (e.g., > 0.90).

6. Task Categories:
   - Map each task to one of these categories: "work", "study", "health", "personal", "social".
   - Examples: Gym/Running -> health, LeetCode/DSA/Geomechanics -> study, ReeWise/Meeting/Office -> work, Call Mom/Dinner with friends -> social, Grocery/Laundry -> personal.

7. Ambiguity Detection (Task Level):
   - ONLY set "needs_clarification" to true if the task itself is extremely vague or completely unclear (e.g., "Maybe do something later" or "do some stuff").
   - Do NOT set "needs_clarification" to true simply because a duration or time is missing for a standard task (e.g., "Gym at 6", "Solve LeetCode", "Call mom" are NOT ambiguous; leave their duration blank and the scheduling engine will resolve it using defaults).

8. Recurrence Detection:
   - If the user specifies recurrence (e.g. "every day", "every Monday", "weekdays"), extract the frequency: "DAILY", "WEEKLY", "WEEKDAYS", "WEEKENDS", or "ONCE".

9. Conversational Reply:
   - Always formulate a friendly, natural language "reply". For QUERY_SCHEDULE or GENERAL_CHAT intents, this is where you provide the actual answer or reflection.

Time Disambiguation:
- Standard 12-hour AM/PM times (e.g. "6 PM" -> "18:00", "9 AM" -> "09:00"). If AM/PM is omitted, map to the most logical hour based on wake/sleep profile boundaries.
`;

const actionSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    type: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["CREATE", "MOVE", "DELETE", "COMPLETE", "ANALYZE"],
      description: "Type of action"
    },
    title: { type: SchemaType.STRING, description: "Title of the task" },
    date: { type: SchemaType.STRING, description: "YYYY-MM-DD or relative like 'tomorrow'" },
    time: { type: SchemaType.STRING, description: "HH:mm format. ONLY include if explicitly specified by user." },
    duration: { type: SchemaType.NUMBER, description: "Duration in minutes" },
    task_id: { type: SchemaType.STRING, description: "ID of the existing task (if modifying/deleting/completing)" },
    priority: { type: SchemaType.NUMBER, description: "Priority from 1 (lowest) to 10 (highest). Default to 5 if unspecified." },
    category: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["work", "study", "health", "personal", "social"],
      description: "Task category classification"
    },
    needs_clarification: { type: SchemaType.BOOLEAN, description: "Set true if duration or key details are ambiguous/missing" },
    clarification_question: { type: SchemaType.STRING, description: "Friendly question to ask the user to clarify this specific task" },
    recurrence: {
      type: SchemaType.OBJECT,
      properties: {
        frequency: {
          type: SchemaType.STRING,
          format: "enum",
          enum: ["DAILY", "WEEKLY", "WEEKDAYS", "WEEKENDS", "ONCE"]
        }
      },
      required: ["frequency"]
    }
  },
  required: ["type"]
};

const parsedAIResponseSchema: Schema = {
  type: SchemaType.OBJECT,
  properties: {
    intent: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["CREATE_TASKS", "QUERY_SCHEDULE", "MODIFY_TASKS", "DELETE_TASKS", "COMPLETE_TASKS", "GENERAL_CHAT"],
      description: "Primary user command intent"
    },
    confidence: { type: SchemaType.NUMBER, description: "Confidence score from 0.0 to 1.0" },
    planning_mode: {
      type: SchemaType.STRING,
      format: "enum",
      enum: ["EXTRACT_ONLY", "AUTO_SCHEDULE_DAY"],
      description: "Planning mode detected"
    },
    reply: { type: SchemaType.STRING, description: "Athena's conversational natural language response" },
    clarifications: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING },
      description: "Any overall ambiguities that prevent parsing the message"
    },
    actions: {
      type: SchemaType.ARRAY,
      items: actionSchema,
      description: "List of parsed actions"
    },
    memory_updates: {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          key: { type: SchemaType.STRING },
          description: { type: SchemaType.STRING },
          category: {
            type: SchemaType.STRING,
            format: "enum",
            enum: ["preference", "habit", "goal", "routine", "constraint", "temporary"]
          },
          confidence: { type: SchemaType.NUMBER }
        },
        required: ["key", "description", "category", "confidence"]
      }
    }
  },
  required: ["intent", "confidence", "planning_mode", "reply", "clarifications", "actions"]
};

/**
 * Verifies if the Gemini API key is valid.
 */
export async function verifyApiKey(key: string): Promise<boolean> {
  if (!key || key.trim() === "") return false;
  try {
    const genAI = new GoogleGenerativeAI(key);
    // Use GEMINI_MODEL as default
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Verify connection. Reply in one word.' }] }],
      generationConfig: { maxOutputTokens: 5 }
    });
    const text = result.response.text();
    return !!text && text.trim().length > 0;
  } catch (error) {
    console.error("Gemini API Key verification failed:", error);
    return false;
  }
}

/**
 * Sanitizes tasks before injecting into prompt to prevent malformed text/prompt pollution.
 */
function sanitizeTasksForPrompt(tasks: any[]): any[] {
  if (!tasks) return [];
  return tasks.map(t => {
    let cleanTitle = t.title || '';
    if (cleanTitle.length > 80) {
      cleanTitle = cleanTitle.substring(0, 80) + '...';
    }
    cleanTitle = cleanTitle.replace(/[\{\}\[\]\"\'\<\>\`]/g, '').trim();
    return {
      id: t.id,
      title: cleanTitle,
      planned_start: t.planned_start,
      planned_end: t.planned_end,
      status: t.status,
      priority: t.priority,
      local_start: formatLocalDateTimeWithOffset(new Date(t.planned_start)),
      local_end: formatLocalDateTimeWithOffset(new Date(t.planned_end))
    };
  });
}

export interface ScheduleContext {
  today: Task[];
  upcoming: Task[];
  recent: Task[];
  sameDayLastMonth: Task[];
}

export function buildScheduleContext(tasks: Task[], now = new Date()): ScheduleContext {
  const todayStart = startOfLocalDay(now);
  const tomorrowStart = addLocalDays(todayStart, 1);
  const upcomingEnd = addLocalDays(todayStart, 60);
  const recentStart = addLocalDays(todayStart, -60);
  const lastMonthDay = startOfLocalDay(oneMonthAgoSameLocalDay(now));
  const lastMonthDayEnd = addLocalDays(lastMonthDay, 1);
  const overlaps = (task: Task, start: Date, end: Date) => {
    const taskStart = new Date(task.planned_start);
    const taskEnd = new Date(task.planned_end);
    return taskStart < end && taskEnd >= start;
  };

  return {
    today: tasks.filter(task => overlaps(task, todayStart, tomorrowStart)),
    upcoming: tasks.filter(task => overlaps(task, tomorrowStart, upcomingEnd)).slice(0, 100),
    recent: tasks.filter(task => overlaps(task, recentStart, todayStart)).slice(-100),
    sameDayLastMonth: tasks.filter(task => overlaps(task, lastMonthDay, lastMonthDayEnd))
  };
}

/**
 * Sanitizes memories before injecting into prompt.
 */
function sanitizeMemoriesForPrompt(memories: any[]): any[] {
  if (!memories) return [];
  return memories.map(m => {
    let cleanDesc = m.description || '';
    if (cleanDesc.length > 500) {
      cleanDesc = cleanDesc.substring(0, 500) + '...';
    }
    cleanDesc = cleanDesc.replace(/[\{\}\[\]\"\'\<\>\`]/g, '').trim();
    return {
      key: m.key,
      description: cleanDesc,
      category: m.category
    };
  });
}

/**
 * Parses user input command to structured JSON operations.
 */
export async function parseUserCommand(
  apiKey: string,
  command: string,
  context: {
    tasks: Task[];
    freeSlots: { start: string; end: string; energy?: string }[];
    userName: string;
    memory: Memory[];
  }
): Promise<ParsedAIResponse> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION
  });

  const now = new Date();
  const { wakeTime, sleepTime } = extractTimeConstraints(context.memory);

  // Parse preferred gym time if available from memories
  let preferredGym = '18:00';
  const gymMemory = context.memory.find(m => m.description.toLowerCase().includes('gym'));
  if (gymMemory) {
    const gymMatch = gymMemory.description.match(/gym\s+(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (gymMatch) {
      let hour = parseInt(gymMatch[1], 10);
      const minute = gymMatch[2] ? gymMatch[2] : '00';
      const ampm = gymMatch[3]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      preferredGym = `${String(hour).padStart(2, '0')}:${minute}`;
    }
  }

  // Only pass today and tomorrow's tasks to reduce context overload
  const startOfToday = startOfLocalDay(now);
  const tomorrowStart = addLocalDays(startOfToday, 1);
  const endOfTomorrow = addLocalDays(startOfToday, 2);

  const todayTasks = context.tasks.filter(t => {
    const plannedStart = new Date(t.planned_start);
    return plannedStart >= startOfToday && plannedStart < tomorrowStart;
  });

  const tomorrowTasks = context.tasks.filter(t => {
    const plannedStart = new Date(t.planned_start);
    return plannedStart >= tomorrowStart && plannedStart < endOfTomorrow;
  });

  const cleanMemories = sanitizeMemoriesForPrompt(context.memory);

  // Form structured short-term context object exactly as specified in the spec
  const structuredContext = {
    current_time: formatLocalDateTimeWithOffset(now),
    user_profile: {
      wake: wakeTime,
      sleep: sleepTime,
      preferred_gym: preferredGym
    },
    today_tasks: sanitizeTasksForPrompt(todayTasks),
    tomorrow_tasks: sanitizeTasksForPrompt(tomorrowTasks),
    free_slots: context.freeSlots,
    relevant_memories: cleanMemories.map(m => m.description)
  };

  const prompt = `
BACKGROUND CONTEXT (Use strictly as read-only reference for timings, wake/sleep limits, and default durations. DO NOT create/schedule tasks from this):
${JSON.stringify(structuredContext, null, 2)}

TODAY'S USER COMMAND (This is the SOLE source of truth for creating, moving, deleting or completing tasks):
"${command.replace(/[\`]/g, "'")}"

Task:
Translate the user command into intent, confidence, planning_mode, reply, actions, and memory updates according to the system instruction.
Remember:
- Extract ALL tasks mentioned in the command as actions.
- Never invent scheduling times in AUTO_SCHEDULE_DAY mode.
- Avoid context contamination: do not schedule any task from context that is absent from today's command.
`;

  try {
    console.log('[DEBUG] Gemini Prompt:', prompt);
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: parsedAIResponseSchema
      }
    });
    let responseText = result.response.text().trim();
    
    // Strip markdown code block if generated
    if (responseText.startsWith("```")) {
      responseText = responseText.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(responseText) as ParsedAIResponse;
    console.log('[DEBUG] Gemini Raw Response:', responseText);
    console.log('[DEBUG] Gemini Parsed Actions:', JSON.stringify(parsed, null, 2));
    return parsed;
  } catch (error) {
    console.error("Error parsing user command with Gemini:", error);
    return {
      intent: 'GENERAL_CHAT',
      confidence: 0.5,
      planning_mode: 'EXTRACT_ONLY',
      reply: "I'm having trouble connecting to Gemini. Please try again.",
      clarifications: ["I'm having trouble connecting to Gemini. I will save this locally for now."],
      actions: []
    };
  }
}

/**
 * Onboarding Question conversational agent.
 */
export async function runConversationalOnboarding(
  apiKey: string,
  messageHistory: { role: 'user' | 'model'; parts: { text: string }[] }[],
  questionIndex: number,
  questionText: string
): Promise<{ reply: string; extractedInfo: { key: string; value: unknown; category: string; metadata?: any }[] }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `
You are Athena, conducting onboarding for the user. Ask the onboarding questions one at a time.
Current Question to focus on: "${questionText}" (Index: ${questionIndex})
Understand their response in Hindi, Hinglish, or English.
Always speak in friendly, calm English. Do not use slang (like "bestie", "slay", "💅") or bubbly/cute emojis.
ALWAYS format and refer to times in 12-hour format with AM/PM (e.g., "9:00 AM", "11:00 PM") in your replies. Never use 24-hour time format (such as 17:00 or 21:30) when communicating.

Your goal is to build the user's "About Me" profile — a living document of everything Athena needs to know.
From every response, extract ALL useful facts and write them as compact, structured, third-person descriptions.
Use stable, descriptive snake_case keys. Categorize each extracted memory into one of: "preference", "habit", "goal", "routine", "constraint".
For every memory, extract structured machine-readable metadata if applicable. The metadata can contain:
- "defaultTime": time in 24-hour format "HH:mm" (e.g. "17:00", "07:00")
- "duration": task duration in minutes as a number (e.g. 60, 120)
- "skipDays": array of days to skip (e.g. ["Sunday"])
- "energy": one of "high", "medium", "low"
- "preferredSlot": one of "morning", "afternoon", "evening"

Examples of good memory entries:
- { "key": "sleep_schedule", "value": "Wakes at 7 AM, sleeps by 11 PM", "category": "routine", "metadata": { "defaultTime": "23:00", "duration": 480 } }
- { "key": "gym_routine", "value": "Gym at 5 PM daily except Sundays", "category": "habit", "metadata": { "defaultTime": "17:00", "duration": 60, "skipDays": ["Sunday"] } }
- { "key": "productive_hours", "value": "Most productive between 9 AM and 12 PM", "category": "preference", "metadata": { "preferredSlot": "morning" } }
- { "key": "goals_2026", "value": "Crack DSA, build a SaaS product, stay consistent with gym", "category": "goal" }
- { "key": "lunch_break", "value": "Never schedule anything during 1 PM - 2 PM lunch break", "category": "constraint", "metadata": { "defaultTime": "13:00", "duration": 60 } }

If the response contains useful info, output a JSON format:
{
  "reply": "A warm, encouraging follow-up acknowledging their response and moving them to the next question, or wrapping up onboarding.",
  "extractedInfo": [
    { "key": "sleep_schedule", "value": "Wakes at 7 AM, sleeps by 11 PM", "category": "routine", "metadata": { "defaultTime": "23:00", "duration": 480 } },
    { "key": "gym_routine", "value": "Gym at 5 PM daily except Sundays", "category": "habit", "metadata": { "defaultTime": "17:00", "duration": 60, "skipDays": ["Sunday"] } }
  ]
}
If they haven't provided enough info, reply in JSON with:
{
  "reply": "Friendly follow-up asking for details on: ${questionText}"
}
    `
  });

  try {
    const chat = model.startChat({
      history: messageHistory
    });

    const result = await chat.sendMessage(`User responded: Let's extract values for "${questionText}". Respond ONLY in raw JSON.`);
    let text = result.response.text().trim();

    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    const parsed = JSON.parse(text);
    return {
      reply: parsed.reply,
      extractedInfo: Array.isArray(parsed.extractedInfo)
        ? parsed.extractedInfo
        : parsed.extractedInfo
          ? [parsed.extractedInfo]
          : []
    };
  } catch (error) {
    console.error("Error in conversational onboarding Gemini:", error);
    return {
      reply: `Got it. Let's move on to the next onboarding step.`,
      extractedInfo: []
    };
  }
}

/**
 * Night Flow daily summary generator.
 */
export async function generateNightSummary(
  apiKey: string,
  dayContext: {
    date: string;
    userName: string;
    tasks: any[];
  }
): Promise<{
  summary_text: string;
  completed_count: number;
  missed_count: number;
  carry_forward_count: number;
  suggestions: string[];
}> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION
  });

  const prompt = `
Generate a nightly review summary for ${dayContext.userName} for date ${dayContext.date}.
Today's Tasks: ${JSON.stringify(dayContext.tasks)}

Calculate stats and summarize the achievements. Be calm, practical, and highly encouraging.
Output ONLY a valid JSON string (no markdown code blocks, just raw JSON):
{
  "summary_text": "Markdown review. e.g. '# Nightly Reflection\\n* You did fantastic today in completing X!\\n* DSA took slightly longer than planned, we will adapt future times...'",
  "completed_count": 0,
  "missed_count": 0,
  "carry_forward_count": 0,
  "suggestions": ["suggestion 1", "suggestion 2"]
}
`;

  try {
    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    if (text.startsWith("```")) {
      text = text.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
    }

    return JSON.parse(text);
  } catch (error) {
    console.error("Error generating night summary:", error);
    return {
      summary_text: "## Reflection\nCompleted task review. Adaptive metrics could not be loaded.",
      completed_count: dayContext.tasks.filter(t => t.status === 'completed').length,
      missed_count: dayContext.tasks.filter(t => t.status === 'pending').length,
      carry_forward_count: dayContext.tasks.filter(t => t.status === 'skipped' || t.status === 'rescheduled').length,
      suggestions: ["Try scheduling less tasks in the late evening blocks."]
    };
  }
}

/**
 * Generates Weekly Insights based on task aggregates and daily summaries.
 */
export async function generateWeeklyInsights(
  apiKey: string,
  userName: string,
  analyticsData: {
    completionRate: number;
    gymStreak: number;
    delayAverage: number;
    learningAverages: any[];
    weeklySummaries: any[];
  }
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION
  });

  const prompt = `
Analyze the weekly task performance data for ${userName}:
Completion rate: ${analyticsData.completionRate}%
Gym streak: ${analyticsData.gymStreak} days
Average delay: ${analyticsData.delayAverage} minutes
Learning averages (est vs actual duration): ${JSON.stringify(analyticsData.learningAverages)}
Daily summaries history: ${JSON.stringify(analyticsData.weeklySummaries)}

Produce a weekly insights review (in markdown format). Highlight patterns, habits, focus windows, and clear constructive suggestions. Focus on adaptation and encouragement. Keep it concise.
`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Error generating weekly insights:", error);
    return "Unable to generate insights. Keep up your consistency and check back later.";
  }
}

/**
 * Generates historical insights using Gemini based on pre-computed statistical aggregates.
 */
export async function generateHistoricalInsights(
  apiKey: string,
  userName: string,
  stats: any
): Promise<string> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction: `
You are Athena, a highly capable scheduling secretary and productivity coach.
Analyze the user's pre-computed statistics for the past 30 days and provide structured, insightful feedback.
Be encouraging, practical, and highly strategic.
ALWAYS format and refer to times in 12-hour format with AM/PM (e.g., "9:00 AM", "11:00 PM") in your response. Never use 24-hour time format (such as 17:00 or 21:30) when communicating.

Structure your response in markdown:
# Historical Insights & Reflection
- A brief, encouraging overview of their performance.
- Key patterns observed (e.g., peak productivity hours, category focus).
- Concrete advice for improvements, focusing on their specific weaknesses (e.g., missed tasks, bedtime alignment).
    `
  });

  const prompt = `
User: ${userName}
Computed stats:
${JSON.stringify(stats, null, 2)}
`;

  try {
    const result = await model.generateContent(prompt);
    return result.response.text().trim();
  } catch (error) {
    console.error("Error generating historical insights:", error);
    return "Unable to generate insights at this time. Keep up your consistency and check back later!";
  }
}
