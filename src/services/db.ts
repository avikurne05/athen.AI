import * as SQLite from 'expo-sqlite';

export interface Task {
  id: string;
  title: string;
  status: 'pending' | 'completed' | 'skipped' | 'rescheduled' | 'cancelled';
  planned_start: string; // ISO string
  planned_end: string;   // ISO string
  actual_start: string | null; // ISO string
  actual_end: string | null;   // ISO string
  notification_id: string | null; // Local Notification ID
  priority: number; // 1-10
  duration: number; // minutes
  flexibility: number; // 1-5
  fixed: boolean;
  energy: 'high' | 'medium' | 'low';
  deadline?: string; // ISO string
  repeat?: string;
  estimated_duration?: number;
  actual_duration?: number;
  category?: 'work' | 'study' | 'health' | 'personal' | 'social';
  streak?: number;
  created_by?: 'voice' | 'text' | 'auto_schedule' | null;
  source_transcript?: string | null;
}

export interface MemoryMetadata {
  defaultTime?: string;
  duration?: number;
  skipDays?: string[];
  energy?: 'high' | 'medium' | 'low';
  preferredSlot?: 'morning' | 'afternoon' | 'evening';
  repeatRule?: string;
}

export interface Memory {
  key: string;
  description: string;
  confidence: number;
  category: 'preference' | 'habit' | 'goal' | 'routine' | 'constraint' | 'temporary';
  expires_at: string | null; // ISO string
  pinned?: number; // 0 or 1
  metadata?: MemoryMetadata | null;
  last_used_at?: string | null; // ISO string
  usage_count?: number;
}

export interface LearningDuration {
  task_type: string;
  avg_estimated_duration: number; // in minutes
  avg_actual_duration: number;    // in minutes
  occurrences: number;
}

export interface DailySummary {
  date: string; // YYYY-MM-DD
  summary_text: string;
  completed_count: number;
  missed_count: number;
  carry_forward_count: number;
  suggestions: string; // JSON array of strings
}

// Removed SyncOperation type (Offline mode runs on local notifications now)

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDBConnection(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('athena.db');
  }
  return dbInstance;
}

/**
 * Initializes all SQLite tables if they do not exist.
 */
export async function initDatabase(): Promise<void> {
  const db = await getDBConnection();

  // Create tables sequentially
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      planned_start TEXT NOT NULL,
      planned_end TEXT NOT NULL,
      actual_start TEXT,
      actual_end TEXT,
      notification_id TEXT,
      priority INTEGER NOT NULL DEFAULT 5,
      duration INTEGER NOT NULL DEFAULT 60,
      flexibility INTEGER NOT NULL DEFAULT 3,
      fixed INTEGER NOT NULL DEFAULT 0,
      energy TEXT NOT NULL DEFAULT 'medium',
      deadline TEXT,
      repeat TEXT,
      estimated_duration INTEGER,
      actual_duration INTEGER,
      category TEXT,
      streak INTEGER DEFAULT 0,
      created_by TEXT,
      source_transcript TEXT
    );

    CREATE TABLE IF NOT EXISTS memory (
      key TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      confidence REAL NOT NULL,
      category TEXT NOT NULL,
      expires_at TEXT,
      pinned INTEGER DEFAULT 0,
      metadata TEXT,
      last_used_at TEXT,
      usage_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS learning_durations (
      task_type TEXT PRIMARY KEY,
      avg_estimated_duration INTEGER NOT NULL,
      avg_actual_duration INTEGER NOT NULL,
      occurrences INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_summaries (
      date TEXT PRIMARY KEY,
      summary_text TEXT NOT NULL,
      completed_count INTEGER NOT NULL,
      missed_count INTEGER NOT NULL,
      carry_forward_count INTEGER NOT NULL,
      suggestions TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS greetings_history (
      greeting_text TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL
    );
  `);

  // Run cleanup for expired temporary memory contexts on startup
  await deleteExpiredMemories();

  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN duration INTEGER NOT NULL DEFAULT 60"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN flexibility INTEGER NOT NULL DEFAULT 3"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN fixed INTEGER NOT NULL DEFAULT 0"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN energy TEXT NOT NULL DEFAULT 'medium'"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN deadline TEXT"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN repeat TEXT"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN estimated_duration INTEGER"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN actual_duration INTEGER"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN category TEXT"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN streak INTEGER DEFAULT 0"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN created_by TEXT"); } catch (e) {}
  try { await db.execAsync("ALTER TABLE tasks ADD COLUMN source_transcript TEXT"); } catch (e) {}

  // Convert old string priority to numbers
  try {
    await db.execAsync(`
      UPDATE tasks SET priority = 8 WHERE priority = 'high';
      UPDATE tasks SET priority = 5 WHERE priority = 'medium';
      UPDATE tasks SET priority = 2 WHERE priority = 'low';
    `);
  } catch (e) {}

  // Migrate memory categories and columns
  try { await db.execAsync("ALTER TABLE memory ADD COLUMN pinned INTEGER DEFAULT 0"); } catch (e) {}
  try { await db.execAsync("UPDATE memory SET category = 'preference' WHERE category = 'identity'"); } catch (e) {}
  try {
    await db.execAsync("ALTER TABLE memory ADD COLUMN metadata TEXT");
  } catch (e: any) {
    if (!e.message.includes("duplicate column") && !e.message.includes("already exists")) throw e;
  }
  try {
    await db.execAsync("ALTER TABLE memory ADD COLUMN last_used_at TEXT");
  } catch (e: any) {
    if (!e.message.includes("duplicate column") && !e.message.includes("already exists")) throw e;
  }
  try {
    await db.execAsync("ALTER TABLE memory ADD COLUMN usage_count INTEGER DEFAULT 0");
  } catch (e: any) {
    if (!e.message.includes("duplicate column") && !e.message.includes("already exists")) throw e;
  }
}

/**
 * Clean up expired temporary memory context
 */
export async function deleteExpiredMemories(): Promise<void> {
  const db = await getDBConnection();
  const now = new Date().toISOString();
  await db.runAsync(
    'DELETE FROM memory WHERE category = ? AND expires_at IS NOT NULL AND expires_at < ?',
    'temporary',
    now
  );
}

/* ==========================================================================
   User Profile Queries (Settings, Calendar IDs, Reminder Times)
   ========================================================================== */

export async function getUserProfile(key: string): Promise<string | null> {
  const db = await getDBConnection();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM user_profile WHERE key = ?',
    key
  );
  return row ? row.value : null;
}

export async function setUserProfile(key: string, value: string): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync(
    'INSERT INTO user_profile (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    key,
    value
  );
}

export async function deleteUserProfile(key: string): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync('DELETE FROM user_profile WHERE key = ?', key);
}

/* ==========================================================================
   Tasks Queries
   ========================================================================== */

export async function getTasks(): Promise<Task[]> {
  const db = await getDBConnection();
  const rows = await db.getAllAsync<Task>('SELECT * FROM tasks ORDER BY planned_start ASC');
  return rows;
}

export async function getTasksInRange(startISO: string, endISO: string): Promise<Task[]> {
  const db = await getDBConnection();
  return db.getAllAsync<Task>(
    `SELECT * FROM tasks
     WHERE planned_start < ? AND planned_end >= ?
     ORDER BY planned_start ASC`,
    endISO,
    startISO
  );
}

export async function saveTask(task: Task): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync(
    `INSERT INTO tasks (
      id, title, status, planned_start, planned_end, actual_start, actual_end, notification_id, priority,
      duration, flexibility, fixed, energy, deadline, repeat, estimated_duration, actual_duration, category, streak,
      created_by, source_transcript
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       title = excluded.title,
       status = excluded.status,
       planned_start = excluded.planned_start,
       planned_end = excluded.planned_end,
       actual_start = excluded.actual_start,
       actual_end = excluded.actual_end,
       notification_id = excluded.notification_id,
       priority = excluded.priority,
       duration = excluded.duration,
       flexibility = excluded.flexibility,
       fixed = excluded.fixed,
       energy = excluded.energy,
       deadline = excluded.deadline,
       repeat = excluded.repeat,
       estimated_duration = excluded.estimated_duration,
       actual_duration = excluded.actual_duration,
       category = excluded.category,
       streak = excluded.streak,
       created_by = excluded.created_by,
       source_transcript = excluded.source_transcript`,
    task.id,
    task.title,
    task.status,
    task.planned_start,
    task.planned_end,
    task.actual_start,
    task.actual_end,
    task.notification_id,
    task.priority,
    task.duration,
    task.flexibility,
    task.fixed ? 1 : 0,
    task.energy,
    task.deadline || null,
    task.repeat || null,
    task.estimated_duration || null,
    task.actual_duration || null,
    task.category || null,
    task.streak || 0,
    task.created_by || null,
    task.source_transcript || null
  );
}

export async function updateTaskStatus(
  id: string,
  status: Task['status'],
  actualStart?: string | null,
  actualEnd?: string | null
): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync(
    'UPDATE tasks SET status = ?, actual_start = COALESCE(?, actual_start), actual_end = COALESCE(?, actual_end) WHERE id = ?',
    status,
    actualStart || null,
    actualEnd || null,
    id
  );
}

export async function deleteTask(id: string): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync('DELETE FROM tasks WHERE id = ?', id);
}

/* ==========================================================================
   Memory Queries (AI Context, Beliefs, Habits, Identities)
   ========================================================================== */

export async function getMemory(key: string): Promise<Memory | null> {
  const db = await getDBConnection();
  const row = await db.getFirstAsync<any>('SELECT * FROM memory WHERE key = ?', key);
  if (!row) return null;
  return {
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  };
}

export async function saveMemory(memory: Memory): Promise<void> {
  const db = await getDBConnection();
  const metadataStr = memory.metadata 
    ? (typeof memory.metadata === 'string' ? memory.metadata : JSON.stringify(memory.metadata)) 
    : null;
  await db.runAsync(
    `INSERT INTO memory (key, description, confidence, category, expires_at, pinned, metadata, last_used_at, usage_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET
       description = excluded.description,
       confidence = excluded.confidence,
       category = excluded.category,
       expires_at = excluded.expires_at,
       pinned = excluded.pinned,
       metadata = excluded.metadata,
       last_used_at = COALESCE(excluded.last_used_at, memory.last_used_at),
       usage_count = COALESCE(excluded.usage_count, memory.usage_count)`,
    memory.key,
    memory.description,
    memory.confidence,
    memory.category,
    memory.expires_at,
    memory.pinned ?? 0,
    metadataStr,
    memory.last_used_at || null,
    memory.usage_count ?? 0
  );
}

export async function getAllMemories(): Promise<Memory[]> {
  const db = await getDBConnection();
  // Ensure we delete expired memories first
  await deleteExpiredMemories();
  const rows = await db.getAllAsync<any>('SELECT * FROM memory');
  return rows.map(row => ({
    ...row,
    metadata: row.metadata ? JSON.parse(row.metadata) : null
  }));
}

export async function deleteMemory(key: string): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync('DELETE FROM memory WHERE key = ?', key);
}

export async function incrementMemoryUsage(key: string): Promise<void> {
  const db = await getDBConnection();
  const now = new Date().toISOString();
  await db.runAsync(
    `UPDATE memory 
     SET usage_count = COALESCE(usage_count, 0) + 1, 
         last_used_at = ? 
     WHERE key = ?`,
    now,
    key
  );
}

export async function getTasksInLast30Days(): Promise<Task[]> {
  const db = await getDBConnection();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return db.getAllAsync<Task>(
    `SELECT * FROM tasks
     WHERE planned_start >= ?
     ORDER BY planned_start ASC`,
    thirtyDaysAgo
  );
}

/* ==========================================================================
   Learning Durations (Estimated vs Actual Task Durations)
   ========================================================================== */
// NOTE: These averages and aggregates are strictly stored locally on this device.
// They are never uploaded or included in any external telemetry or exports.

export async function getLearningDuration(taskType: string): Promise<LearningDuration | null> {
  const db = await getDBConnection();
  const row = await db.getFirstAsync<LearningDuration>(
    'SELECT * FROM learning_durations WHERE task_type = ?',
    taskType
  );
  return row || null;
}

export async function updateLearningDuration(
  taskType: string,
  estimatedMinutes: number,
  actualMinutes: number
): Promise<void> {
  const db = await getDBConnection();
  const existing = await getLearningDuration(taskType);

  if (existing) {
    const nextOccurrences = existing.occurrences + 1;
    // Calculate running average
    const nextAvgEst = Math.round(
      (existing.avg_estimated_duration * existing.occurrences + estimatedMinutes) / nextOccurrences
    );
    const nextAvgAct = Math.round(
      (existing.avg_actual_duration * existing.occurrences + actualMinutes) / nextOccurrences
    );

    await db.runAsync(
      'UPDATE learning_durations SET avg_estimated_duration = ?, avg_actual_duration = ?, occurrences = ? WHERE task_type = ?',
      nextAvgEst,
      nextAvgAct,
      nextOccurrences,
      taskType
    );
  } else {
    await db.runAsync(
      'INSERT INTO learning_durations (task_type, avg_estimated_duration, avg_actual_duration, occurrences) VALUES (?, ?, ?, 1)',
      taskType,
      estimatedMinutes,
      actualMinutes
    );
  }
}

export async function getAllLearningDurations(): Promise<LearningDuration[]> {
  const db = await getDBConnection();
  return db.getAllAsync<LearningDuration>('SELECT * FROM learning_durations');
}

/* ==========================================================================
   Daily Summaries (Night Flow Logs)
   ========================================================================== */
// NOTE: These daily summary logs are stored locally on this device.
// They are never uploaded or shared externally.

export async function getDailySummary(date: string): Promise<DailySummary | null> {
  const db = await getDBConnection();
  const row = await db.getFirstAsync<DailySummary>('SELECT * FROM daily_summaries WHERE date = ?', date);
  return row || null;
}

export async function saveDailySummary(summary: DailySummary): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync(
    `INSERT INTO daily_summaries (date, summary_text, completed_count, missed_count, carry_forward_count, suggestions)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(date) DO UPDATE SET
       summary_text = excluded.summary_text,
       completed_count = excluded.completed_count,
       missed_count = excluded.missed_count,
       carry_forward_count = excluded.carry_forward_count,
       suggestions = excluded.suggestions`,
    summary.date,
    summary.summary_text,
    summary.completed_count,
    summary.missed_count,
    summary.carry_forward_count,
    summary.suggestions
  );
}

export async function getDailySummariesRange(limit: number = 7): Promise<DailySummary[]> {
  const db = await getDBConnection();
  return db.getAllAsync<DailySummary>(
    'SELECT * FROM daily_summaries ORDER BY date DESC LIMIT ?',
    limit
  );
}

/* ==========================================================================
   Greetings History (Anti-Repeat Logic)
   ========================================================================== */

export async function getRecentGreetings(): Promise<string[]> {
  const db = await getDBConnection();
  const rows = await db.getAllAsync<{ greeting_text: string }>(
    'SELECT greeting_text FROM greetings_history ORDER BY timestamp DESC LIMIT 15'
  );
  return rows.map((r) => r.greeting_text);
}

export async function addGreetingToHistory(greeting: string): Promise<void> {
  const db = await getDBConnection();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    'INSERT OR REPLACE INTO greetings_history (greeting_text, timestamp) VALUES (?, ?)',
    greeting,
    now
  );

  // Keep greetings history pruned to last 30 items
  await db.runAsync(
    'DELETE FROM greetings_history WHERE greeting_text NOT IN (SELECT greeting_text FROM greetings_history ORDER BY timestamp DESC LIMIT 30)'
  );
}

/* ==========================================================================
   Factory Reset (Delete Memory)
   ========================================================================== */

export async function clearAllData(): Promise<void> {
  const db = await getDBConnection();
  await db.runAsync('DELETE FROM user_profile');
  await db.runAsync('DELETE FROM tasks');
  await db.runAsync('DELETE FROM memory');
  await db.runAsync('DELETE FROM learning_durations');
  await db.runAsync('DELETE FROM daily_summaries');
  await db.runAsync('DELETE FROM greetings_history');
}
