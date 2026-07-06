import React, { createContext, useContext, useState, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { initDatabase, getUserProfile, setUserProfile, clearAllData, getTasks, Task, getAllMemories, Memory } from '../services/db';
import { scheduleMorningReminder, scheduleNightReminder, cancelAllNotifications } from '../services/localNotifications';

interface AppContextProps {
  dbReady: boolean;
  userName: string;
  apiKey: string;
  isLoggedIn: boolean; // Retained for route mapping (defaults to true since bypass OAuth)
  calendarId: string | null;
  tasks: Task[];
  memories: Memory[];
  morningReminder: string; // "HH:MM"
  nightReminder: string;   // "HH:MM"
  refreshTasks: () => Promise<void>;
  refreshMemories: () => Promise<void>;
  saveKeys: (apiKey: string) => Promise<void>;
  updateOnboardingCompleted: () => Promise<void>;
  updateReminders: (morning: string, night: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

const AppContext = createContext<AppContextProps | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [dbReady, setDbReady] = useState(false);
  const [userName, setUserName] = useState('Mohit');
  const [apiKey, setApiKey] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(true); // Always true for local-only flow
  const [tasks, setTasks] = useState<Task[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);

  // Reminder times for push notifications (separate from user's actual wake/sleep schedule)
  const [morningReminder, setMorningReminder] = useState('08:00');
  const [nightReminder, setNightReminder] = useState('21:00');

  useEffect(() => {
    async function loadApp() {
      try {
        // 1. Initialize SQLite Database
        await initDatabase();

        // 2. Fetch profile fields
        const storedName = await getUserProfile('user_name');
        if (storedName) setUserName(storedName);

        const storedMorning = await getUserProfile('morning_reminder_time');
        if (storedMorning) setMorningReminder(storedMorning);

        const storedNight = await getUserProfile('night_reminder_time');
        if (storedNight) setNightReminder(storedNight);

        // 3. Load API key securely
        const storedKey = await SecureStore.getItemAsync('gemini_api_key');
        if (storedKey) setApiKey(storedKey);

        // 4. Load tasks & memory
        await refreshTasks();
        await refreshMemories();

        setDbReady(true);
      } catch (err) {
        console.error("App startup loading failed:", err);
        setDbReady(true);
      }
    }
    loadApp();
  }, []);

  const refreshTasks = async () => {
    try {
      const activeTasks = await getTasks();
      const sortedTasks = [...activeTasks].sort((a, b) => {
        const timeA = new Date(a.planned_start).getTime();
        const timeB = new Date(b.planned_start).getTime();
        if (isNaN(timeA) && isNaN(timeB)) return 0;
        if (isNaN(timeA)) return 1;
        if (isNaN(timeB)) return -1;
        return timeA - timeB;
      });
      setTasks(sortedTasks);
    } catch (e) {
      console.error("Failed loading tasks:", e);
    }
  };

  const refreshMemories = async () => {
    try {
      const list = await getAllMemories();
      setMemories(list);
    } catch (e) {
      console.error("Failed loading memories:", e);
    }
  };

  const saveKeys = async (geminiKey: string) => {
    if (geminiKey) {
      await SecureStore.setItemAsync('gemini_api_key', geminiKey);
      setApiKey(geminiKey);
    }
  };

  const updateOnboardingCompleted = async () => {
    await setUserProfile('onboarding_completed', 'true');
    // Set morning and night recurring push alarms
    await scheduleMorningReminder(morningReminder);
    await scheduleNightReminder(nightReminder);
  };

  const updateReminders = async (morning: string, night: string) => {
    await setUserProfile('morning_reminder_time', morning);
    await setUserProfile('night_reminder_time', night);
    setMorningReminder(morning);
    setNightReminder(night);

    // Schedule local push reminder alarms
    await scheduleMorningReminder(morning);
    await scheduleNightReminder(night);
  };

  const resetAll = async () => {
    // Cancel all scheduled task alarms and reminders
    await cancelAllNotifications();
    
    // Clear local SQLite and secure storage
    await clearAllData();
    await SecureStore.deleteItemAsync('gemini_api_key');
    
    setUserName('Mohit');
    setApiKey('');
    setIsLoggedIn(true);
    setTasks([]);
    setMemories([]);
    setMorningReminder('08:00');
    setNightReminder('21:00');
  };

  return (
    <AppContext.Provider
      value={{
        dbReady,
        userName,
        apiKey,
        isLoggedIn,
        calendarId: null, // Unused in local-only flow
        tasks,
        memories,
        morningReminder,
        nightReminder,
        refreshTasks,
        refreshMemories,
        saveKeys,
        updateOnboardingCompleted,
        updateReminders,
        resetAll
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}
