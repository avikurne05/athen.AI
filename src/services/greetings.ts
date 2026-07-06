import { getRecentGreetings, addGreetingToHistory } from './db';

const MORNING_GREETINGS = [
  "Good morning! Ready to plan your day?",
  "Morning! A fresh day to focus on what matters.",
  "Good morning. Let's see what we can achieve today.",
  "Rise and shine. Let's design a smooth flow for your tasks.",
  "Good morning. A calm start leads to a productive day.",
  "Good morning! Ready to take it step by step?",
  "Morning. What's on your mind for today?",
  "Good morning. Let's prioritize what's truly important today.",
  "Good morning! Remember, progress over perfection.",
  "Good morning. Let's map out your day together.",
  "Morning! Ready to build consistency today?",
  "Good morning. Let's set some clear, achievable goals.",
  "Good morning! What habits shall we focus on today?",
  "Morning! Hope you slept well. Ready to plan?",
  "Good morning. A brand new day to write some code and stay active.",
  "Good morning! Let's take control of our time today.",
  "Morning! Let's make today a good one, one task at a time.",
  "Good morning. Ready to tackle that DSA practice?",
  "Good morning! Let's align your tasks with your goals today.",
  "Morning! Ready to map out your day and adapt as we go?",
  "Good morning. A calm and structured plan is waiting for you.",
  "Good morning! Focus on the journey today, not just the checklist.",
  "Morning! How can I help you coordinate your schedule today?",
  "Good morning. Let's outline a steady, balanced plan.",
  "Good morning! Let's build momentum early today."
];

const AFTERNOON_GREETINGS = [
  "Good afternoon! Hope your day is going smoothly.",
  "Hello. Ready for a quick mid-day check?",
  "Good afternoon. How is the flow of your day?",
  "Good afternoon! Let's take a deep breath and review our plan.",
  "Hi there! Need to adjust any schedules for the rest of the day?",
  "Good afternoon. How are we doing on our placement prep?",
  "Good afternoon. Remember to stay hydrated and take small breaks.",
  "Good afternoon! Halfway through, let's keep the focus steady.",
  "Hi! Hope your morning was productive. Let's check the afternoon.",
  "Good afternoon. Any changes to your schedule for the evening?",
  "Good afternoon! Keep pushing, you are doing great.",
  "Hello! Let's check in on the tasks completed so far.",
  "Good afternoon. Ready to transition into your project work?",
  "Good afternoon! How can I help you optimize the rest of your day?",
  "Good afternoon. Let's stay adaptive. What's next on your plate?",
  "Good afternoon! Hope you are feeling good and focused.",
  "Hi! Let's review the timeline for the next few hours.",
  "Good afternoon. A perfect time to check your progress.",
  "Good afternoon! Keep taking steps forward, no matter how small.",
  "Good afternoon. Let's look at what's remaining on the list.",
  "Hello! Ready to power through the afternoon session?",
  "Good afternoon. Let's ensure your evening workload is balanced.",
  "Good afternoon! Staying consistent is the key. Let's do this.",
  "Hi there. Hope your day is bringing you closer to your goals.",
  "Good afternoon. Let's review and adjust your afternoon block."
];

const EVENING_GREETINGS = [
  "Good evening! Let's review today's progress.",
  "Good evening. How was the second half of your day?",
  "Good evening! Ready to wind down or shift to your gym session?",
  "Good evening. How did your coding block go today?",
  "Good evening! Let's see how much we accomplished.",
  "Good evening. Take a moment to appreciate your effort today.",
  "Good evening! Ready to look over the carry-forward tasks?",
  "Good evening. Let's check in before we finish for the day.",
  "Good evening! Hope your day was balanced and fulfilling.",
  "Good evening. What's the plan for tonight's review?",
  "Good evening! Ready to wrap up work and transition to personal time?",
  "Hello! Let's reflect on how you managed your energy today.",
  "Good evening. Let's look at your gym streak and task updates.",
  "Good evening! Hope you had a good focus session today.",
  "Good evening. Let's double check your evening list.",
  "Good evening! You did some solid work today. Let's review.",
  "Good evening. Time to slowly wind down and review.",
  "Good evening. A nice evening to celebrate small wins.",
  "Good evening! Let's prepare a summary of what went well.",
  "Good evening. Hope you got some quality focus time today.",
  "Good evening. Let's adapt any remaining tasks to tomorrow.",
  "Good evening! Consistency built today is success tomorrow.",
  "Good evening. How are you feeling after today's schedule?",
  "Good evening! Let's check the progress bar together.",
  "Good evening. Ready for a calm check-in?"
];

const NIGHT_GREETINGS = [
  "What went well today?",
  "Good night! Let's summarize your achievements.",
  "Late evening check-in. Time to wrap up and reflect.",
  "Good night. What are you most proud of completing today?",
  "Good night. Let's look at the carry-over list for tomorrow.",
  "Good night! Reflection time. What did you learn today?",
  "Good night. Let's set up a clean slate for tomorrow.",
  "Good night. Take a deep breath. How was your day?",
  "Good night! Let's check the completion rates for the week.",
  "Good night. What habit did we build or practice today?",
  "Good night. How can we make tomorrow even smoother?",
  "Good night. Rest well. Let's quickly review the day.",
  "Good night! Remember, any progress is good progress.",
  "Good night. Let's close out our tasks and secure our sleep.",
  "Good night. Sleep is important. Let's log your actual timings.",
  "Good night! Let's make sure we carry forward DSA to tomorrow morning.",
  "Good night. You worked hard. What went well?",
  "Good night. Let's review and clear our minds for sleep.",
  "Good night! Sleep tight. Ready for a quick 2-minute review?",
  "Good night. Let's document what was completed and skipped.",
  "Good night. Let's wrap up with a calm reflection.",
  "Good night! What made you smile today during your tasks?",
  "Good night. Let's update the scheduler with today's learning durations.",
  "Good night! Hope you feel satisfied with your effort today.",
  "Good night. Time to turn off coding and rest."
];

/**
 * Gets a randomized greeting for the current time of day,
 * ensuring no greeting from the last 15 is repeated.
 */
export async function getGreeting(userName: string = "Mohit"): Promise<string> {
  const now = new Date();
  const hours = now.getHours();
  
  let greetingList: string[] = [];
  
  // Time buckets:
  // 5 - 11 AM -> Morning
  // 11 AM - 4 PM -> Afternoon
  // 4 - 8 PM -> Evening
  // 8 PM - 5 AM -> Night
  if (hours >= 5 && hours < 11) {
    greetingList = MORNING_GREETINGS;
  } else if (hours >= 11 && hours < 16) {
    greetingList = AFTERNOON_GREETINGS;
  } else if (hours >= 16 && hours < 20) {
    greetingList = EVENING_GREETINGS;
  } else {
    greetingList = NIGHT_GREETINGS;
  }
  
  // Format userName into templates
  const formattedGreetings = greetingList.map(g => g.replace(", Mohit", `, ${userName}`));

  try {
    const recent = await getRecentGreetings();
    
    // Filter out recent greetings
    const available = formattedGreetings.filter(g => !recent.includes(g));
    
    // Fallback to all if somehow all are filtered out
    const pool = available.length > 0 ? available : formattedGreetings;
    
    // Pick random
    const randomIndex = Math.floor(Math.random() * pool.length);
    const selectedGreeting = pool[randomIndex];
    
    // Add to history
    await addGreetingToHistory(selectedGreeting);
    
    return selectedGreeting;
  } catch (error) {
    console.error("Error in greetings service:", error);
    // Fallback to a simple static greeting if DB fails
    if (hours >= 5 && hours < 11) return `Good morning, ${userName}!`;
    if (hours >= 11 && hours < 16) return `Good afternoon, ${userName}!`;
    if (hours >= 16 && hours < 20) return `Good evening, ${userName}!`;
    return `Hello, ${userName}! Ready for reflection?`;
  }
}
