import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, SafeAreaView, Platform, StatusBar, ImageBackground, KeyboardAvoidingView, Dimensions } from 'react-native';
import { Redirect } from 'expo-router';
import { useApp } from '../context/AppContext';
import { getUserProfile, saveMemory } from '../services/db';
import { enrichActionsWithMemories, extractTimeAndDurationFromDescription } from '../services/memoryEngine';
import { getGreeting } from '../services/greetings';
import { buildScheduleContext, parseUserCommand, generateHistoricalInsights } from '../services/gemini';
import { proposeScheduleChanges, executeDrafts, ProposedDraft, extractTimeConstraints, calculateFreeSlots, PlanningContext } from '../services/scheduler';
import { computeLast30DaysStats } from '../services/analytics';
import { voiceService } from '../services/voice';
import WaveformBars from '../components/WaveformBars';
import ApprovalCard from '../components/ApprovalCard';
import SettingsOverlay from '../components/SettingsOverlay';
import { formatTime12Hour } from '../services/time';

export default function IndexHomeScreen() {
  const {
    userName,
    apiKey,
    tasks,
    refreshTasks,
    memories,
    refreshMemories
  } = useApp();

  const [onboardingCompleted, setOnboardingCompleted] = useState<boolean | null>(null);
  const [greeting, setGreeting] = useState('Good morning!');
  
  // Overlay visibility states
  const [showSettings, setShowSettings] = useState(false);

  // Chat/Voice and drafts states
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);

  const [proposedDrafts, setProposedDrafts] = useState<ProposedDraft[]>([]);
  const [isOverbooked, setIsOverbooked] = useState(false);
  const [warningMsg, setWarningMsg] = useState<string | undefined>(undefined);

  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceStopping, setIsVoiceStopping] = useState(false);
  const [speechStatus, setSpeechStatus] = useState<'listening' | 'restarting' | 'stopped'>('stopped');
  const recordingBaseRef = useRef('');

  useEffect(() => {
    const sub = Dimensions.addEventListener('change', ({ window }) => {
      console.log('[DIAGNOSTIC] window height changed:', window.height);
    });
    return () => sub?.remove();
  }, []);

  useEffect(() => {
    async function checkOnboarding() {
      const res = await getUserProfile('onboarding_completed');
      setOnboardingCompleted(res === 'true');
    }
    checkOnboarding();
  }, []);

  useEffect(() => {
    if (onboardingCompleted === true) {
      loadHomeData();
    }
  }, [onboardingCompleted, userName]);

  useEffect(() => {
    voiceService.setDelegate({
      onSpeechStart: () => {
        setIsRecording(true);
        setIsVoiceStopping(false);
        setSpeechStatus('listening');
      },
      onSpeechResults: (text) => {
        const base = recordingBaseRef.current.trim();
        setChatInput(base ? `${base} ${text}`.trim() : text);
      },
      onSpeechError: (err) => {
        setIsRecording(false);
        setIsVoiceStopping(false);
        setSpeechStatus('stopped');
        Alert.alert("Voice Error", err);
      },
      onSpeechEnd: (finalTranscript) => {
        setIsRecording(false);
        setIsVoiceStopping(false);
        setSpeechStatus('stopped');
        if (finalTranscript && finalTranscript.trim() !== '') {
          const base = recordingBaseRef.current.trim();
          setChatInput(base ? `${base} ${finalTranscript}`.trim() : finalTranscript.trim());
        }
      },
      onSpeechStatusChanged: (status) => {
        setSpeechStatus(status);
      }
    });

    return () => {
      voiceService.destroy();
    };
  }, []);

  const loadHomeData = async () => {
    try {
      const greet = await getGreeting(userName);
      setGreeting(greet);
      await refreshTasks();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStartRecording = async () => {
    try {
      recordingBaseRef.current = chatInput;
      setIsRecording(true);
      await voiceService.startListening();
    } catch (e: any) {
      setIsRecording(false);
      console.error(e);
      Alert.alert("Mic Error", e.message || String(e));
    }
  };

  const handleStopRecording = async () => {
    try {
      setIsVoiceStopping(true);
      await voiceService.stopListening();
    } catch (e: any) {
      setIsVoiceStopping(false);
      console.error(e);
      Alert.alert("Mic Error", e.message || String(e));
    }
  };

  const handleSendCommand = async (command: string) => {
    if (command.trim() === "") return;
    
    if (isRecording) {
      try {
        await voiceService.stopListening();
      } catch (e) {
        console.warn('[VOICE] Stop listening failed during send:', e);
      }
    }
    
    setChatInput('');
    setIsProcessing(true);
    setAiReply(null);
    setProposedDrafts([]);

    try {
      const { wakeTime, sleepTime } = extractTimeConstraints(memories);
      const freeSlots = calculateFreeSlots(tasks, new Date(), wakeTime, sleepTime).map(slot => ({
        start: slot.start.toISOString(),
        end: slot.end.toISOString()
      }));

      const parsed = await parseUserCommand(apiKey, command, {
        tasks,
        freeSlots,
        userName,
        memory: memories
      });

      if (parsed.memory_updates?.length) {
        for (const memory of parsed.memory_updates) {
          const metadata = extractTimeAndDurationFromDescription(memory.description);
          await saveMemory({
            key: memory.key.replace(/[^a-z0-9_]+/gi, '_').toLowerCase(),
            description: memory.description,
            confidence: Math.max(0, Math.min(1, memory.confidence)),
            category: memory.category as any,
            expires_at: memory.category === 'temporary'
              ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
              : null,
            metadata: Object.keys(metadata).length > 0 ? metadata : null
          });
        }
        await refreshMemories();
      }

      // VALIDATOR Checks
      // 1. Confidence Score Threshold
      if (parsed.confidence < 0.6) {
        setAiReply(parsed.reply || "I'm not quite sure what you mean. Could you please clarify?");
        setIsProcessing(false);
        return;
      }

      // 2. Task-Level Ambiguity Detection
      const ambiguousAction = parsed.actions?.find(act => act.needs_clarification);
      if (ambiguousAction && ambiguousAction.clarification_question) {
        setAiReply(ambiguousAction.clarification_question);
        setIsProcessing(false);
        return;
      }

      // Intercept historical analysis command or general chat / query schedules
      const analyzeAction = parsed.actions?.find(act => (act.type as string) === 'ANALYZE');
      if (analyzeAction) {
        const stats = await computeLast30DaysStats(memories);
        const insights = await generateHistoricalInsights(apiKey, userName, stats);
        setAiReply(insights);
        setIsProcessing(false);
        return;
      }

      if (parsed.intent === 'QUERY_SCHEDULE' || parsed.intent === 'GENERAL_CHAT') {
        setAiReply(parsed.reply);
        setIsProcessing(false);
        return;
      }

      let replyMessage = parsed.reply || "Here's a proposed schedule update based on your request.";
      if (parsed.clarifications && parsed.clarifications.length > 0) {
        replyMessage = parsed.clarifications[0];
      }

      const { actions: enrichedActions, clarifications: memoryClarifications } = 
        await enrichActionsWithMemories(parsed.actions || [], memories);

      if (memoryClarifications.length > 0) {
        setAiReply(memoryClarifications[0]);
        setIsProcessing(false);
        return;
      } else {
        setAiReply(replyMessage);
      }

      if (enrichedActions && enrichedActions.length > 0) {
        const planningCtx: PlanningContext = {
          now: new Date(),
          wakeTime,
          sleepTime,
          existingTasks: tasks,
          preferredFocusDuration: 90,
          preferredBreakDuration: 15
        };

        const result = await proposeScheduleChanges(enrichedActions, planningCtx, {
          userName,
          sourceTranscript: command,
          planningMode: parsed.planning_mode
        });

        setProposedDrafts(result.drafts);
        setIsOverbooked(result.isOverbooked);

        let warning = result.message || '';
        if (result.unscheduled && result.unscheduled.length > 0) {
          const listStr = result.unscheduled.map(u => `${u.task_title} (${u.duration}m)`).join(', ');
          warning = (warning ? warning + '\n' : '') + `⚠️ Unscheduled (won't fit today): ${listStr}`;
        }
        setWarningMsg(warning || undefined);
      }
    } catch (e) {
      console.error(e);
      Alert.alert("Processing Error", "Failed to parse command. Please check your network.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveDrafts = async () => {
    setIsProcessing(true);
    try {
      await executeDrafts(proposedDrafts);
      setProposedDrafts([]);
      setAiReply("Changes applied successfully.");
      await loadHomeData();
    } catch (e) {
      console.error(e);
      Alert.alert("Execution Error", "Could not update your tasks.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleModifyDrafts = () => {
    setProposedDrafts([]);
    setAiReply("What would you like to shift or adjust instead?");
  };

  const toggleTaskCompletion = async (task: any) => {
    const nextStatus = task.status === 'completed' ? 'pending' as const : 'completed' as const;
    try {
      await executeDrafts([{
        id: 'toggle',
        type: nextStatus === 'completed' ? 'COMPLETE' : 'CREATE',
        task_title: task.title,
        task_id: task.id,
        notification_id: task.notification_id || undefined,
        proposed_start: task.planned_start,
        proposed_end: task.planned_end,
        priority: task.priority
      }]);
      await loadHomeData();
    } catch (e) {
      console.error(e);
    }
  };

  if (onboardingCompleted === null) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF8DA1" />
      </View>
    );
  }

  if (!onboardingCompleted) {
    return <Redirect href="/onboarding/welcome" />;
  }

  const formatTime = (isoString?: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    const today = new Date();
    const isToday = date.getDate() === today.getDate() &&
                    date.getMonth() === today.getMonth() &&
                    date.getFullYear() === today.getFullYear();
    
    const timeStr = formatTime12Hour(date);
    if (isToday) {
      return timeStr;
    }
    const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  };

  const KeyboardWrapper = KeyboardAvoidingView;
  const wrapperProps = { behavior: Platform.OS === 'ios' ? 'padding' as const : 'height' as const };
  const todayTasks = buildScheduleContext(tasks).today.filter(task => task.status !== 'cancelled');

  return (
    <ImageBackground 
      source={require('../../assets/images/doodle_bg.png')} 
      style={styles.backgroundImage}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardWrapper
          style={styles.keyboardAvoidingView}
          {...wrapperProps}
        >
          <StatusBar barStyle="dark-content" />
          
          {/* Top Navigation Bar with Pill Buttons */}
          <View style={styles.navBar}>
            <TouchableOpacity style={styles.pillButton} onPress={() => setShowSettings(true)}>
              <Text style={styles.pillText}>Settings</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.mainContainer}>
            <ScrollView contentContainerStyle={styles.scrollContent} style={styles.scrollArea} showsVerticalScrollIndicator={false}>
              
              {/* Center Greeting text */}
              <View style={styles.centerGreetingContainer}>
                <Text style={styles.greetingText}>{greeting}</Text>
              </View>

              {/* AI Reply Display */}
              {aiReply && (
                <View style={styles.aiReplyBubble}>
                  <Text style={styles.aiReplyLabel}>Athena Assistant</Text>
                  <Text style={styles.aiReplyText}>{aiReply}</Text>
                </View>
              )}

              {/* Proposed Calendar Changes Card */}
              <ApprovalCard
                drafts={proposedDrafts}
                isOverbooked={isOverbooked}
                warningMessage={warningMsg}
                onApprove={handleApproveDrafts}
                onModify={handleModifyDrafts}
              />

              {/* Task Checklist Timeline */}
              {todayTasks.length > 0 && (
                <View style={styles.timelineSection}>
                  <Text style={styles.timelineTitle}>Today's Schedule</Text>
                  <View style={styles.taskContainer}>
                    {todayTasks.map((task) => (
                      <TouchableOpacity
                        key={task.id}
                        style={styles.taskItem}
                        onPress={() => toggleTaskCompletion(task)}
                      >
                        <View style={[styles.checkbox, task.status === 'completed' ? styles.checkboxChecked : null]}>
                          {task.status === 'completed' && <Text style={styles.checkIcon}>✓</Text>}
                        </View>
                        <View style={styles.taskTextWrapper}>
                          <Text style={[styles.taskTitle, task.status === 'completed' ? styles.completedTaskTitle : null]}>
                            {task.title}
                          </Text>
                          <Text style={styles.taskTime}>
                            {formatTime(task.planned_start)} - {formatTime(task.planned_end)}
                          </Text>
                        </View>
                        <View style={[styles.priorityTag, task.priority >= 8 ? styles.high : task.priority >= 5 ? styles.medium : styles.low]}>
                          <Text style={styles.priorityTagText}>{task.priority >= 8 ? 'High' : task.priority >= 5 ? 'Medium' : 'Low'}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {isProcessing && (
                <View style={styles.processingIndicator}>
                  <ActivityIndicator size="small" color="#FF8DA1" />
                  <Text style={styles.processingText}>Adjusting plan...</Text>
                </View>
              )}
            </ScrollView>

            {/* Bottom Command bar input */}
            <View style={styles.commandDock}>
              <View style={styles.inputStack}>
                <TextInput
                  style={styles.commandInput}
                  value={chatInput}
                  onChangeText={setChatInput}
                  placeholder={
                    isRecording
                      ? speechStatus === 'restarting'
                        ? "Buffering speech..."
                        : "Listening... speak now"
                      : "Tell Athena what changed..."
                  }
                  placeholderTextColor="#98A2B3"
                  editable={!isProcessing && !isRecording}
                  onSubmitEditing={() => handleSendCommand(chatInput)}
                  multiline={true}
                  scrollEnabled={true}
                />
                {isRecording && (
                  <View style={styles.waveformOverlay}>
                    <WaveformBars isListening={isRecording} status={speechStatus} />
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.dockButton, isRecording ? styles.recordingButton : styles.micButton]}
                onPress={isRecording ? handleStopRecording : handleStartRecording}
                disabled={isProcessing || isVoiceStopping}
              >
                <Text style={styles.dockButtonText}>{isRecording ? "⏹️" : "🎤"}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.dockButton, styles.sendButton, chatInput.trim() === '' ? styles.disabledSend : null]}
                onPress={() => handleSendCommand(chatInput)}
                disabled={isProcessing || chatInput.trim() === ''}
              >
                <Text style={styles.dockButtonText}>➤</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Settings sliding Modal */}
          <SettingsOverlay
            visible={showSettings}
            onClose={() => setShowSettings(false)}
          />
        </KeyboardWrapper>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#FFF0F2'
  },
  safeArea: {
    flex: 1,
    backgroundColor: 'transparent',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0
  },
  keyboardAvoidingView: {
    flex: 1
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#FFF0F2'
  },
  navBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'transparent',
    alignItems: 'center'
  },
  pillButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 24, // soft edges
    borderWidth: 1,
    borderColor: '#FFE3E6', // soft pink outline
    shadowColor: '#FF8DA1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1
  },
  pillText: {
    color: '#FF5C7A',
    fontSize: 13,
    fontWeight: '700'
  },
  mainContainer: {
    flex: 1,
    justifyContent: 'space-between'
  },
  scrollArea: {
    flex: 1
  },
  scrollContent: {
    padding: 16,
    gap: 16
  },
  centerGreetingContainer: {
    height: 180,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20
  },
  greetingText: {
    fontSize: 22,
    fontWeight: '700',
    color: '#4A354F', // Elegant plum typography
    textAlign: 'center',
    lineHeight: 30
  },
  aiReplyBubble: {
    backgroundColor: '#F4EFFF', // Soft lavender
    borderColor: '#E6DCFC',
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    gap: 4,
    shadowColor: '#FF8DA1',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1
  },
  aiReplyLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FF5C7A',
    textTransform: 'uppercase'
  },
  aiReplyText: {
    fontSize: 13,
    color: '#4A354F',
    lineHeight: 18
  },
  timelineSection: {
    gap: 8,
    marginTop: 8
  },
  timelineTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#4A354F'
  },
  taskContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28, // soft rounded
    borderWidth: 1,
    borderColor: '#FFE3E6',
    overflow: 'hidden'
  },
  taskItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#FFF0F2',
    gap: 12
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 8, // soft rounded checkbox
    borderWidth: 2,
    borderColor: '#FF8DA1',
    alignItems: 'center',
    justifyContent: 'center'
  },
  checkboxChecked: {
    borderColor: '#FF8DA1',
    backgroundColor: '#FF8DA1'
  },
  checkIcon: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700'
  },
  taskTextWrapper: {
    flex: 1,
    gap: 2
  },
  taskTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#4A354F'
  },
  completedTaskTitle: {
    color: '#B3556A',
    textDecorationLine: 'line-through'
  },
  taskTime: {
    fontSize: 12,
    color: '#B3556A'
  },
  priorityTag: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6
  },
  priorityTagText: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    color: '#4A354F'
  },
  high: {
    backgroundColor: '#FFE3E6',
  },
  medium: {
    backgroundColor: '#F4EFFF',
  },
  low: {
    backgroundColor: '#FFF5EE',
  },
  processingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12
  },
  processingText: {
    fontSize: 12,
    color: '#D44A70',
    fontStyle: 'italic'
  },
  commandDock: {
    marginHorizontal: 16,
    marginBottom: Platform.select({ ios: 24, android: 16, default: 16 }),
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#FFE3E6',
    flexDirection: 'row',
    gap: 8,
    alignItems: 'flex-end',
    shadowColor: '#FF8DA1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4
  },
  commandInput: {
    backgroundColor: '#FFFFFF', // White text box
    borderRadius: 24, // soft corners
    borderWidth: 1,
    borderColor: '#FFE3E6',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontSize: 14,
    color: '#4A354F',
    minHeight: 45,
    maxHeight: 150
  },
  inputStack: {
    flex: 1,
    position: 'relative'
  },
  waveformOverlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 3,
    height: 12,
    justifyContent: 'center',
    alignItems: 'center',
    opacity: 0.45
  },
  dockButton: {
    width: 48,
    height: 48,
    borderRadius: 24, // soft corners
    alignItems: 'center',
    justifyContent: 'center'
  },
  micButton: {
    backgroundColor: '#FFF5EE',
    borderWidth: 1,
    borderColor: '#FFE3E6'
  },
  recordingButton: {
    backgroundColor: '#FECDCA',
    borderWidth: 1,
    borderColor: '#FF8DA1'
  },
  sendButton: {
    backgroundColor: '#FF8DA1'
  },
  disabledSend: {
    backgroundColor: '#FFC0CB'
  },
  dockButtonText: {
    fontSize: 18,
    color: '#FFFFFF'
  }
});
