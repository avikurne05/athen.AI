import { Platform } from 'react-native';

let Notifications: any = null;
let isExpoGoError = false;

try {
  Notifications = require('expo-notifications');
  if (Notifications) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
} catch (e) {
  console.warn("expo-notifications failed to load (likely running inside Expo Go on Android). Reminders will run in simulated mode:", e);
  isExpoGoError = true;
}

/**
 * Request notification permissions from the user
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web' || isExpoGoError || !Notifications) {
    console.log("Simulating notification permissions (granted).");
    return true;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn("Notification permissions not granted.");
      return false;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#208AEF',
      });
    }

    return true;
  } catch (err) {
    console.warn("Failed to request native permissions, running in fallback mode:", err);
    return true;
  }
}

/**
 * Schedules the recurring morning planning alarm.
 */
export async function scheduleMorningReminder(timeStr: string): Promise<string> {
  if (Platform.OS === 'web' || isExpoGoError || !Notifications) {
    console.log(`[Simulated] Scheduled morning reminder daily alarm for ${timeStr}`);
    return `sim_morning_${timeStr}`;
  }

  try {
    await cancelReminderByTitle("Athena Morning Plan");
    const [hour, minute] = timeStr.split(':').map(Number);

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Athena Morning Plan",
        body: "Good morning! Let's quickly outline your day.",
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });

    return notificationId;
  } catch (err) {
    console.warn("Failed scheduling morning reminder, simulating:", err);
    return `sim_morning_${timeStr}`;
  }
}

/**
 * Schedules the recurring night review alarm.
 */
export async function scheduleNightReminder(timeStr: string): Promise<string> {
  if (Platform.OS === 'web' || isExpoGoError || !Notifications) {
    console.log(`[Simulated] Scheduled night reminder daily alarm for ${timeStr}`);
    return `sim_night_${timeStr}`;
  }

  try {
    await cancelReminderByTitle("Athena Night Review");
    const [hour, minute] = timeStr.split(':').map(Number);

    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Athena Night Review",
        body: "Good evening! Ready to reflect on today's progress?",
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });

    return notificationId;
  } catch (err) {
    console.warn("Failed scheduling night reminder, simulating:", err);
    return `sim_night_${timeStr}`;
  }
}

/**
 * Helper to cancel specific reminders based on their titles
 */
async function cancelReminderByTitle(title: string): Promise<void> {
  if (Platform.OS === 'web' || isExpoGoError || !Notifications) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    for (const n of scheduled) {
      if (n.content.title === title) {
        await Notifications.cancelScheduledNotificationAsync(n.identifier);
      }
    }
  } catch (err) {
    console.warn("Error cancelling reminder:", err);
  }
}

/**
 * Schedules an alarm for an individual task 15 minutes before its planned start time.
 */
export async function scheduleTaskNotification(
  taskTitle: string,
  plannedStartISO: string
): Promise<string | null> {
  if (Platform.OS === 'web' || isExpoGoError || !Notifications) {
    console.log(`[Simulated] Scheduled 15-min alarm for task "${taskTitle}" at ${plannedStartISO}`);
    return `sim_task_${Date.now()}`;
  }

  const startTime = new Date(plannedStartISO);
  const triggerTime = new Date(startTime.getTime() - 15 * 60 * 1000); // 15 minutes before
  
  const now = new Date();
  if (startTime < now) return null;

  const finalTrigger = triggerTime > now ? triggerTime : new Date(now.getTime() + 10 * 1000);

  try {
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: {
        title: "Upcoming Task",
        body: `"${taskTitle}" starts in 15 minutes.`,
        sound: true,
      },
      trigger: {
        date: finalTrigger,
        type: Notifications.SchedulableTriggerInputTypes.DATE
      },
    });
    return notificationId;
  } catch (error) {
    console.error("Failed to schedule individual task notification:", error);
    return `sim_task_${Date.now()}`;
  }
}

/**
 * Cancels a scheduled task notification
 */
export async function cancelTaskNotification(notificationId: string | null): Promise<void> {
  if (!notificationId || Platform.OS === 'web' || isExpoGoError || !Notifications) {
    console.log(`[Simulated] Cancelled notification: ${notificationId}`);
    return;
  }
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch (error) {
    console.error(`Failed to cancel notification ${notificationId}:`, error);
  }
}

/**
 * Cancels all scheduled local notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  if (Platform.OS === 'web' || isExpoGoError || !Notifications) {
    console.log("[Simulated] Cancelled all notifications.");
    return;
  }
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn("Failed to cancel all notifications:", err);
  }
}
