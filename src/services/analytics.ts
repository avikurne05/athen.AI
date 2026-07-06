import { Task, getTasksInLast30Days, Memory } from './db';
import { extractTimeConstraints } from './scheduler';

export interface HistoricalStats {
  period: string;
  tasks_completed: number;
  completion_rate: number;
  most_common_categories: string[];
  average_sleep: number;
  average_work_hours: number;
  missed_tasks: { category: string; count: number }[];
  peak_productivity_hours: string[];
}

/**
 * Computes statistics from the SQLite database for the past 30 days of tasks.
 */
export async function computeLast30DaysStats(memories: Memory[]): Promise<HistoricalStats> {
  const tasks = await getTasksInLast30Days();
  const completedTasks = tasks.filter(t => t.status === 'completed');
  
  // 1. Completion Rate
  // Exclude cancelled tasks from total count
  const validTasks = tasks.filter(t => t.status !== 'cancelled');
  const totalCount = validTasks.length;
  const completedCount = completedTasks.length;
  const completionRate = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // 2. Average Sleep (derived from sleep routine memory constraints)
  let sleepHours = 7.5; // default fallback
  try {
    const { wakeTime, sleepTime } = extractTimeConstraints(memories);
    const [wakeH, wakeM] = wakeTime.split(':').map(Number);
    const [sleepH, sleepM] = sleepTime.split(':').map(Number);
    
    let diffMs = (wakeH * 60 + wakeM) - (sleepH * 60 + sleepM);
    if (diffMs <= 0) {
      diffMs += 24 * 60; // crossed midnight
    }
    sleepHours = Math.round((diffMs / 60) * 10) / 10;
  } catch (e) {
    console.error("Error computing sleep average from memories:", e);
  }

  // 3. Most Common Categories of completed tasks
  const categoryCounts: Record<string, number> = {};
  completedTasks.forEach(t => {
    // If category is set, use it. Otherwise, try to infer capital category from title
    let cat = t.category ? t.category.charAt(0).toUpperCase() + t.category.slice(1) : '';
    if (!cat) {
      const title = t.title.toLowerCase();
      if (title.includes('dsa') || title.includes('study') || title.includes('exam') || title.includes('code')) {
        cat = 'Study';
      } else if (title.includes('gym') || title.includes('workout') || title.includes('run') || title.includes('health')) {
        cat = 'Health';
      } else if (title.includes('work') || title.includes('project') || title.includes('meeting')) {
        cat = 'Work';
      } else {
        cat = 'Personal';
      }
    }
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  });

  const mostCommonCategories = Object.entries(categoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0])
    .slice(0, 3);

  // 4. Average Work/Study Hours per Day
  // Calculate average daily completed minutes of 'work' or 'study' (or inferred Study/Work)
  let totalWorkMinutes = 0;
  completedTasks.forEach(t => {
    const isWorkOrStudy = t.category === 'work' || t.category === 'study' ||
      t.title.toLowerCase().match(/(dsa|study|exam|code|work|project|meeting)/);
    if (isWorkOrStudy) {
      // Use actual_duration or fall back to planned duration
      totalWorkMinutes += t.actual_duration || t.duration || 60;
    }
  });
  const averageWorkHours = Math.round((totalWorkMinutes / 60 / 30) * 10) / 10;

  // 5. Missed Tasks (pending, skipped, rescheduled) grouped by category
  const missedTasksList = tasks.filter(t => t.status === 'skipped' || t.status === 'pending');
  const missedCategoryCounts: Record<string, number> = {};
  missedTasksList.forEach(t => {
    let cat = t.category ? t.category.charAt(0).toUpperCase() + t.category.slice(1) : '';
    if (!cat) {
      const title = t.title.toLowerCase();
      if (title.includes('gym') || title.includes('workout') || title.includes('health') || title.includes('exercise')) {
        cat = 'Gym';
      } else if (title.includes('dsa') || title.includes('study') || title.includes('code')) {
        cat = 'Study';
      } else if (title.includes('work') || title.includes('job') || title.includes('office')) {
        cat = 'Work';
      } else {
        cat = 'Personal';
      }
    }
    missedCategoryCounts[cat] = (missedCategoryCounts[cat] || 0) + 1;
  });

  const missed_tasks = Object.entries(missedCategoryCounts)
    .sort((a, b) => b[1] - a[1])
    .map(entry => ({ category: entry[0], count: entry[1] }));

  // 6. Peak Productivity Hour Blocks
  // Group completed tasks into four standard daily blocks
  const blocks = {
    '09:00-12:00': 0,
    '12:00-15:00': 0,
    '15:00-18:00': 0,
    '18:00-21:00': 0
  };
  
  completedTasks.forEach(t => {
    try {
      const date = new Date(t.planned_start);
      const hour = date.getHours();
      if (hour >= 9 && hour < 12) blocks['09:00-12:00']++;
      else if (hour >= 12 && hour < 15) blocks['12:00-15:00']++;
      else if (hour >= 15 && hour < 18) blocks['15:00-18:00']++;
      else if (hour >= 18 && hour < 21) blocks['18:00-21:00']++;
    } catch (e) {}
  });

  const peak_productivity_hours = Object.entries(blocks)
    .sort((a, b) => b[1] - a[1])
    .map(entry => entry[0])
    .slice(0, 1);

  return {
    period: 'last_30_days',
    tasks_completed: completedCount,
    completion_rate: completionRate,
    most_common_categories: mostCommonCategories.length > 0 ? mostCommonCategories : ['Study', 'Personal'],
    average_sleep: sleepHours,
    average_work_hours: averageWorkHours > 0 ? averageWorkHours : 6.0,
    missed_tasks: missed_tasks.length > 0 ? missed_tasks : [{ category: 'None', count: 0 }],
    peak_productivity_hours: peak_productivity_hours[0] ? peak_productivity_hours : ['09:00-12:00']
  };
}
