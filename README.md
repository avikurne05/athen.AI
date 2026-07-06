# Athena AI 🏛️✨
> An advanced agentic AI daily planner and executive assistant that turns speech into optimized, conflict-resolved, and safety-validated schedules.

Athena AI is not just another todo app or speech-to-text wrapper. It is a structured daily planning engine designed to act as your personal Chief of Staff. It understands spoken goals, detects your intent, auto-schedules tasks around your hard commitments, splits long tasks into focus blocks with breaks, and ensures you never overbook your day.

---

## 🚀 Key Features

* **Multi-Task Voice Extraction**: Speak naturally (*"Gym at 6, work on ReeWise for 2 hours, solve two LeetCode problems, and call mom"*), and Athena extracts all tasks as individual actionable items.
* **Whisper-like Dictation Flow**: An ultra-fast, auto-restarting microphone system (80ms re-entrance) with real-time visual buffering and recording feedback.
* **Context-Isolated Intent Parser**: Treats your onboarding, habits, and profile as strictly read-only references. Athena never hallucinates tasks from your profile unless you explicitly ask for them.
* **Deterministic Scheduler (Planner AI)**:
  * **Hard vs. Soft Constraints**: Anchor fixed appointments first, then dynamically fit flexible tasks around them.
  * **Smart Task Splitting**: Automatically breaks long tasks (>120 minutes) into 90-minute focus blocks interspersed with 15-minute breaks.
  * **Bedtime Safety Fallback**: Flags overbooked tasks that exceed your bedtime as `unscheduled` instead of packing your night.
* **Safety & Approval Pipeline**: All drafts are previewed in a single consolidated dashboard. You can tweak them conversationally or tap once to approve and sync.
* **Rich Task Attributes**: Auto-categorizes tasks (`work`, `study`, `health`, `personal`, `social`) and maintains provenance (`created_by`, `source_transcript`) for debugging hallucinations.

---

## 🛠️ Architecture Pipeline

```text
Speech / Text Command
        ↓
    Parser AI (Gemini 2.5 Flash)  ── [Classifies Intent, Extracts Tasks & Metadata]
        ↓
    Validator Stage               ── [Verifies Confidence & Task-Level Ambiguity]
        ↓
 Deterministic Scheduler          ── [Applies Hard/Soft Rules, Focus Splits & Bedtime Safety]
        ↓
   Draft Preview                  ── [Consolidated Approval Card Display]
        ↓
   User Approval                  ── [✏️ Modify / ✓ Approve]
        ↓
  Database Commit                 ── [Saves Tasks with Provenance to SQLite]
```

---

## 📦 Tech Stack

- **Framework**: [Expo](https://expo.dev/) (React Native) with Expo Router (file-based routing)
- **AI Core**: [Gemini 2.5 Flash](https://deepmind.google/technologies/gemini/) (via `@google/generative-ai`)
- **Database**: SQLite (via `expo-sqlite`)
- **State Management**: React Context API
- **Local Notifications**: `expo-notifications`
- **Voice System**: `@react-native-voice/voice`

---

## 🏁 Get Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root directory and add your Gemini API Key:
```env
EXPO_PUBLIC_GEMINI_API_KEY=your_gemini_api_key
```

### 3. Start the Development Server
```bash
npx expo start
```
You can run it in your Android emulator, iOS simulator, or Web browser by choosing the corresponding CLI option.

---

## 🔒 Safety & Provenance
Every task created via Athena retains its origin details in SQLite:
* `created_by`: `'voice' | 'text' | 'auto_schedule'`
* `source_transcript`: The exact transcript that created the task.

This ensures you can always inspect and query why a task was created or rescheduled.
# athen.AI
