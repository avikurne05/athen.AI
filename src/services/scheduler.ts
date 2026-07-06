import { Task, saveTask, updateTaskStatus, Memory } from './db';
import { scheduleTaskNotification, cancelTaskNotification } from './localNotifications';
import { AIAction } from './gemini';
import * as Crypto from 'expo-crypto';
import { parseLocalDateTime } from './time';

export interface ProposedDraft {
  id: string;
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'SHIFT' | 'COMPLETE' | 'CARRY_FORWARD';
  task_title: string;
  original_start?: string;
  original_end?: string;
  proposed_start?: string;
  proposed_end?: string;
  task_id?: string;
  notification_id?: string;
  priority?: number;
  duration?: number;
  message?: string;
  category?: 'work' | 'study' | 'health' | 'personal' | 'social';
  created_by?: 'voice' | 'text' | 'auto_schedule' | null;
  source_transcript?: string | null;
  repeat?: string;
}

export interface FreeSlot {
  start: Date;
  end: Date;
}

function isOverlapping(s1: Date, e1: Date, s2: Date, e2: Date): boolean {
  return s1 < e2 && s2 < e1;
}

export function parseLocalISOString(isoStr: string): Date {
  return parseLocalDateTime(isoStr);
}

export function parseTimeRelativeToDate(dateRef: Date, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(dateRef);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

export function extractTimeConstraints(memories: Memory[]): { wakeTime: string; sleepTime: string } {
  let wakeTime = '07:00';
  let sleepTime = '23:00';
  const allText = memories.map(m => m.description).join('\n').toLowerCase();

  const wakePatterns = [
    /wake[s]?\s+(?:up\s+)?(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    /wake[s]?\s+(?:up\s+)?(?:at|around|by)\s+(\d{1,2}):(\d{2})/i,
    /morning\s+(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i
  ];
  for (const pattern of wakePatterns) {
    const match = allText.match(pattern);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = match[2] ? match[2] : '00';
      const ampm = match[3]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      wakeTime = `${String(hour).padStart(2, '0')}:${minute}`;
      break;
    }
  }

  const sleepPatterns = [
    /sleep[s]?\s+(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    /(?:bed|bedtime)\s+(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i,
    /sleep[s]?\s+(?:at|around|by)\s+(\d{1,2}):(\d{2})/i
  ];
  for (const pattern of sleepPatterns) {
    const match = allText.match(pattern);
    if (match) {
      let hour = parseInt(match[1], 10);
      const minute = match[2] ? match[2] : '00';
      const ampm = match[3]?.toLowerCase();
      if (ampm === 'pm' && hour < 12) hour += 12;
      if (ampm === 'am' && hour === 12) hour = 0;
      sleepTime = `${String(hour).padStart(2, '0')}:${minute}`;
      break;
    }
  }

  return { wakeTime, sleepTime };
}

export function scoreTask(task: Partial<Task>, daysRemaining: number = 0): number {
  const urgency = task.priority || 5;
  const priority = task.priority || 5;
  const streak = task.streak || 0;
  const flexibility = task.flexibility || 3;
  const deadlineWeight = Math.max(0, 10 - daysRemaining);
  return (urgency * 5) + (priority * 4) + (streak * 2) - flexibility + deadlineWeight;
}

export function calculateFreeSlots(tasks: Task[], dateRef: Date, wakeTime: string, sleepTime: string): FreeSlot[] {
  const dayWake = parseTimeRelativeToDate(dateRef, wakeTime);
  let daySleep = parseTimeRelativeToDate(dateRef, sleepTime);
  if (daySleep <= dayWake) daySleep.setDate(daySleep.getDate() + 1);

  const dayTasks = tasks
    .filter(t => t.status !== 'completed' && t.status !== 'skipped' && t.status !== 'cancelled')
    .map(t => ({ start: new Date(t.planned_start), end: new Date(t.planned_end) }))
    .filter(t => isOverlapping(t.start, t.end, dayWake, daySleep))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const slots: FreeSlot[] = [];
  let currentStart = dayWake;

  for (const t of dayTasks) {
    if (currentStart < t.start) {
      slots.push({ start: currentStart, end: t.start });
    }
    if (currentStart < t.end) {
      currentStart = t.end;
    }
  }
  if (currentStart < daySleep) {
    slots.push({ start: currentStart, end: daySleep });
  }

  return slots;
}

export interface PlanningContext {
  now: Date;
  wakeTime?: string;
  sleepTime?: string;
  existingTasks: Task[];
  preferredFocusDuration?: number; // minutes
  preferredBreakDuration?: number; // minutes
}

export interface SchedulingResult {
  drafts: ProposedDraft[];
  unscheduled: ProposedDraft[];
  isOverbooked: boolean;
  message?: string;
}

export async function proposeScheduleChanges(
  actions: AIAction[],
  context: PlanningContext,
  metadata?: {
    userName: string;
    sourceTranscript?: string;
    planningMode?: 'EXTRACT_ONLY' | 'AUTO_SCHEDULE_DAY';
  }
): Promise<SchedulingResult> {
  const drafts: ProposedDraft[] = [];
  const unscheduled: ProposedDraft[] = [];
  const now = context.now || new Date();
  
  const wakeTime = context.wakeTime || '07:00';
  const sleepTime = context.sleepTime || '23:00';

  const wakeDate = parseTimeRelativeToDate(now, wakeTime);
  let sleepDate = parseTimeRelativeToDate(now, sleepTime);
  if (sleepDate <= wakeDate) sleepDate.setDate(sleepDate.getDate() + 1);
  const totalWakingHours = (sleepDate.getTime() - wakeDate.getTime()) / (1000 * 60 * 60);

  let activeTasks = context.existingTasks.filter(t => 
    t.status !== 'completed' && t.status !== 'skipped' && t.status !== 'cancelled'
  );

  // 1. Process COMPLETE and DELETE actions first to free up slots
  for (const action of actions) {
    if (action.type === 'COMPLETE' || action.type === 'DELETE') {
      const existingTask = activeTasks.find(t => t.id === action.task_id || t.title.toLowerCase() === action.title?.toLowerCase());
      if (existingTask) {
        drafts.push({
          id: Crypto.randomUUID(),
          type: action.type,
          task_title: existingTask.title,
          task_id: existingTask.id,
          notification_id: existingTask.notification_id || undefined,
          message: action.type === 'COMPLETE' ? 'Marked complete.' : 'Deleted.'
        });
        activeTasks = activeTasks.filter(t => t.id !== existingTask.id);
      }
    }
  }

  // 2. Separate into Hard vs Soft constraint actions for CREATE / MOVE
  const scheduleActions = actions.filter(a => a.type === 'CREATE' || a.type === 'MOVE');
  const hardActions = scheduleActions.filter(a => !!a.time);
  const softActions = scheduleActions.filter(a => !a.time);

  // Sort hard actions chronologically by time
  hardActions.sort((a, b) => (a.time || '').localeCompare(b.time || ''));

  const sortedActions = [...hardActions, ...softActions];

  // 3. Task Splitting: Split soft constraints > 120 mins into chunks of focus duration
  const expandedActions: { action: AIAction; partNumber?: number; totalParts?: number }[] = [];
  const preferredFocus = context.preferredFocusDuration || 90;

  for (const action of sortedActions) {
    const isSoft = !action.time;
    const duration = action.duration || 60;
    if (action.type === 'CREATE' && isSoft && duration > 120) {
      let remaining = duration;
      const chunks: number[] = [];
      while (remaining > 0) {
        const chunk = Math.min(preferredFocus, remaining);
        chunks.push(chunk);
        remaining -= chunk;
      }
      chunks.forEach((chunk, index) => {
        expandedActions.push({
          action: {
            ...action,
            duration: chunk,
            title: `${action.title} (Part ${index + 1}/${chunks.length})`
          },
          partNumber: index + 1,
          totalParts: chunks.length
        });
      });
    } else {
      expandedActions.push({ action });
    }
  }

  // 4. Schedule each action deterministically
  let lastPartEndMap: Record<string, Date> = {}; // Tracks end times of split tasks
  const breakDurationMs = (context.preferredBreakDuration || 15) * 60 * 1000;

  for (const item of expandedActions) {
    const { action } = item;
    const isMove = action.type === 'MOVE';
    let existingTask = isMove ? activeTasks.find(t => t.id === action.task_id || t.title.toLowerCase() === action.title?.toLowerCase()) : undefined;

    if (isMove && existingTask) {
      activeTasks = activeTasks.filter(t => t.id !== existingTask.id);
    }

    const durationMinutes = action.duration || existingTask?.duration || 60;
    const durationMs = durationMinutes * 60 * 1000;

    let requestedStart = new Date(now);
    
    // Set date bounds
    if (action.date) {
      if (action.date.toLowerCase() === 'tomorrow') {
        requestedStart.setDate(requestedStart.getDate() + 1);
      } else if (action.date.toLowerCase() !== 'today') {
        const parsedDate = new Date(action.date);
        if (!Number.isNaN(parsedDate.getTime())) {
          requestedStart = parsedDate;
        }
      }
    }

    // Determine starting anchor time
    if (action.time) {
      requestedStart = parseTimeRelativeToDate(requestedStart, action.time);
    } else {
      // Soft constraint search starts from now or wakeDate
      const dayWake = parseTimeRelativeToDate(requestedStart, wakeTime);
      if (requestedStart < dayWake) requestedStart = dayWake;

      // If this is a split part > 1, start at least (previous part end + break duration)
      const baseTitle = action.title?.split(' (Part ')[0] || '';
      if (item.partNumber && item.partNumber > 1 && lastPartEndMap[baseTitle]) {
        const minStart = new Date(lastPartEndMap[baseTitle].getTime() + breakDurationMs);
        if (requestedStart < minStart) requestedStart = minStart;
      }
    }

    let finalStart = requestedStart;
    let finalEnd = new Date(finalStart.getTime() + durationMs);
    let placed = false;
    let message = '';

    while (!placed) {
      const conflict = activeTasks.find(t => isOverlapping(finalStart, finalEnd, new Date(t.planned_start), new Date(t.planned_end)));

      if (!conflict) {
        placed = true;
        break;
      }

      const isIncomingHard = !!action.time;
      const isExistingHard = conflict.fixed || false;

      if (isIncomingHard) {
        // Displace the conflicting task if it's soft
        activeTasks = activeTasks.filter(t => t.id !== conflict.id);
        drafts.push({
          id: Crypto.randomUUID(),
          type: 'CARRY_FORWARD',
          task_title: conflict.title,
          task_id: conflict.id,
          notification_id: conflict.notification_id || undefined,
          priority: conflict.priority,
          message: 'Shifted to tomorrow due to overlap with a fixed hard constraint.'
        });
        continue;
      }

      if (isExistingHard) {
        // Can't displace a hard constraint; move incoming task after the conflict
        finalStart = new Date(conflict.planned_end);
        finalEnd = new Date(finalStart.getTime() + durationMs);
        message = 'Moved to next available slot to avoid fixed events.';
        continue;
      }

      // Both are soft: Compare priority scores
      const incomingScore = scoreTask({ priority: action.priority || 5 });
      const existingScore = scoreTask(conflict);

      if (incomingScore > existingScore) {
        // Displace lower priority task
        activeTasks = activeTasks.filter(t => t.id !== conflict.id);
        drafts.push({
          id: Crypto.randomUUID(),
          type: 'CARRY_FORWARD',
          task_title: conflict.title,
          task_id: conflict.id,
          notification_id: conflict.notification_id || undefined,
          priority: conflict.priority,
          message: 'Shifted to tomorrow due to overlap with a higher priority task.'
        });
        placed = true;
      } else {
        // Shift incoming task after the conflicting task
        finalStart = new Date(conflict.planned_end);
        finalEnd = new Date(finalStart.getTime() + durationMs);
        message = 'Moved to next available slot to avoid overlap.';
      }
    }

    // 5. BEDTIME SAFETY FALLBACK
    // If the task cannot fit before the user's bedtime (sleepDate), mark it as unscheduled.
    if (finalEnd > sleepDate) {
      unscheduled.push({
        id: Crypto.randomUUID(),
        type: 'CREATE',
        task_title: action.title || 'Task',
        priority: action.priority || 5,
        duration: durationMinutes,
        message: 'Could not fit in today\'s schedule.'
      });
      continue;
    }

    // Save end time of this part to map for splitting
    const baseTitle = action.title?.split(' (Part ')[0] || '';
    lastPartEndMap[baseTitle] = finalEnd;

    const finalTaskMock: Task = {
      id: existingTask?.id || Crypto.randomUUID(),
      title: action.title || existingTask?.title || 'Task',
      status: 'pending',
      planned_start: finalStart.toISOString(),
      planned_end: finalEnd.toISOString(),
      actual_start: null,
      actual_end: null,
      notification_id: existingTask?.notification_id || null,
      priority: action.priority || existingTask?.priority || 5,
      duration: durationMinutes,
      flexibility: existingTask?.flexibility || 3,
      fixed: !!action.time, // Fixed if hard constraint
      energy: existingTask?.energy || 'medium',
      category: action.category || existingTask?.category || undefined,
      created_by: metadata?.sourceTranscript ? 'voice' : 'text',
      source_transcript: metadata?.sourceTranscript || null,
      repeat: action.recurrence?.frequency || undefined
    };

    activeTasks.push(finalTaskMock);

    drafts.push({
      id: Crypto.randomUUID(),
      type: isMove ? 'SHIFT' : 'CREATE',
      task_title: finalTaskMock.title,
      task_id: isMove ? existingTask?.id : undefined,
      proposed_start: finalTaskMock.planned_start,
      proposed_end: finalTaskMock.planned_end,
      priority: finalTaskMock.priority,
      duration: finalTaskMock.duration,
      category: finalTaskMock.category,
      created_by: finalTaskMock.created_by,
      source_transcript: finalTaskMock.source_transcript,
      repeat: finalTaskMock.repeat,
      message: message || undefined
    });
  }

  let totalScheduledHours = 0;
  for (const t of activeTasks) {
    if (t.planned_start && t.planned_end) {
      totalScheduledHours += (new Date(t.planned_end).getTime() - new Date(t.planned_start).getTime()) / (1000 * 60 * 60);
    }
  }

  const isOverbooked = totalScheduledHours > totalWakingHours * 0.85;

  return {
    drafts,
    unscheduled,
    isOverbooked,
    message: isOverbooked
      ? "Warning: Your proposed plan fills up more than 85% of your available waking day. Consider trimming some tasks."
      : undefined
  };
}

export async function executeDrafts(drafts: ProposedDraft[]): Promise<void> {
  const errors: string[] = [];
  for (const draft of drafts) {
    try {
      if (draft.type === 'COMPLETE' && draft.task_id) {
        if (draft.notification_id) await cancelTaskNotification(draft.notification_id);
        await updateTaskStatus(draft.task_id, 'completed', new Date().toISOString(), new Date().toISOString());
      } else if (draft.type === 'DELETE') {
        if (draft.notification_id) await cancelTaskNotification(draft.notification_id);
        if (draft.task_id) await updateTaskStatus(draft.task_id, 'cancelled', null, new Date().toISOString());
      } else if (draft.type === 'CARRY_FORWARD' && draft.task_id) {
        if (draft.notification_id) await cancelTaskNotification(draft.notification_id);
        let newNotifId: string | null = null;
        if (draft.proposed_start) newNotifId = await scheduleTaskNotification(draft.task_title, draft.proposed_start);
        if (draft.proposed_start && draft.proposed_end) {
          const taskObj: Task = {
            id: draft.task_id,
            title: draft.task_title,
            status: 'rescheduled',
            planned_start: draft.proposed_start,
            planned_end: draft.proposed_end,
            actual_start: null,
            actual_end: null,
            notification_id: newNotifId,
            priority: draft.priority || 5,
            duration: draft.duration || 60,
            flexibility: 3,
            fixed: false,
            energy: 'medium',
            category: draft.category || undefined,
            created_by: draft.created_by || null,
            source_transcript: draft.source_transcript || null,
            repeat: draft.repeat || undefined
          };
          await saveTask(taskObj);
        }
      } else if ((draft.type === 'CREATE' || draft.type === 'SHIFT') && draft.proposed_start && draft.proposed_end) {
        if (draft.notification_id) await cancelTaskNotification(draft.notification_id);
        const newNotifId = await scheduleTaskNotification(draft.task_title, draft.proposed_start);
        const taskId = draft.task_id || Crypto.randomUUID();
        const taskObj: Task = {
          id: taskId,
          title: draft.task_title,
          status: 'pending',
          planned_start: draft.proposed_start,
          planned_end: draft.proposed_end,
          actual_start: null,
          actual_end: null,
          notification_id: newNotifId,
          priority: draft.priority || 5,
          duration: draft.duration || 60,
          flexibility: 3,
          fixed: draft.type === 'CREATE' && draft.original_start ? true : false,
          energy: 'medium',
          category: draft.category || undefined,
          created_by: draft.created_by || null,
          source_transcript: draft.source_transcript || null,
          repeat: draft.repeat || undefined
        };
        await saveTask(taskObj);
      }
    } catch (err) {
      console.error(`Error executing draft ID ${draft.id}:`, err);
      errors.push(draft.task_title);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Failed to update: ${errors.join(', ')}`);
  }
}
