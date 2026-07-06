import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, ActivityIndicator, Alert, TextInput, Platform, ScrollView, ImageBackground, StatusBar, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../../context/AppContext';
import { runConversationalOnboarding } from '../../services/gemini';
import { saveMemory, setUserProfile } from '../../services/db';
import { extractTimeAndDurationFromDescription } from '../../services/memoryEngine';
import { voiceService } from '../../services/voice';
import WaveformBars from '../../components/WaveformBars';

const ONBOARDING_QUESTIONS = [
  "Walk me through your typical day. When do you usually wake up and go to sleep?",
  "What are your biggest goals this year?",
  "What usually distracts you?",
  "When are you most productive during the day?",
  "What should I never schedule (any constraints or restricted times)?",
  "What habits do you want to build (like gym, coding, reading)?",
  "What habits do you want to reduce?"
];

export default function ConversationalOnboardingScreen() {
  const router = useRouter();
  const {
    apiKey,
    refreshMemories,
    updateOnboardingCompleted
  } = useApp();

  const [currentStep, setCurrentStep] = useState(0);
  const [aiMessage, setAiMessage] = useState(
    "Hi, I'm Athena, your Second Brain assistant. Let's get to know your routine first. Walk me through your typical day. When do you usually wake up and sleep?"
  );
  
  const [userInput, setUserInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: 'user' | 'model'; parts: { text: string }[] }[]>([]);
  
  // Voice transcription state
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceStopping, setIsVoiceStopping] = useState(false);
  const recordingBaseRef = useRef('');

  useEffect(() => {
    // Setup voice recognition listener
    voiceService.setDelegate({
      onSpeechStart: () => {
        setIsRecording(true);
        setIsVoiceStopping(false);
      },
      onSpeechResults: (text) => {
        const base = recordingBaseRef.current.trim();
        setUserInput(base ? `${base} ${text}`.trim() : text);
      },
      onSpeechError: (err) => {
        setIsRecording(false);
        setIsVoiceStopping(false);
        Alert.alert("Speech Error", err);
      },
      onSpeechEnd: (finalTranscript) => {
        setIsRecording(false);
        setIsVoiceStopping(false);
        if (finalTranscript && finalTranscript.trim() !== '') {
          const base = recordingBaseRef.current.trim();
          setUserInput(base ? `${base} ${finalTranscript}`.trim() : finalTranscript.trim());
        }
      }
    });

    return () => {
      voiceService.destroy();
    };
  }, []);

  const handleStartRecording = async () => {
    try {
      recordingBaseRef.current = userInput;
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

  const handleSendResponse = async (responseText: string) => {
    if (responseText.trim() === "") return;

    if (isRecording) {
      try {
        await voiceService.stopListening();
      } catch (e) {
        console.warn('[VOICE] Stop listening failed during send:', e);
      }
    }

    setIsLoading(true);
    
    // 1. Build chat history payload
    const updatedHistory = [
      ...chatHistory,
      { role: 'user' as const, parts: [{ text: responseText }] }
    ];
    setChatHistory(updatedHistory);
    setUserInput('');

    try {
      // 2. Fetch Gemini response
      const result = await runConversationalOnboarding(
        apiKey,
        updatedHistory,
        currentStep,
        ONBOARDING_QUESTIONS[currentStep]
      );

      // 3. Update chat history with AI's reply
      setChatHistory([
        ...updatedHistory,
        { role: 'model' as const, parts: [{ text: result.reply }] }
      ]);
      setAiMessage(result.reply);

      // 4. Save all extracted info as About Me memories
      for (const item of result.extractedInfo) {
        const key = item.key;
        const value = item.value;
        const category = (item.category as any) || 'preference';
        if (key) {
          const description = Array.isArray(value) ? value.join(', ') : String(value);
          // Retrieve metadata from Gemini or fall back to regex extraction
          let metadata = item.metadata;
          if (!metadata || Object.keys(metadata).length === 0) {
            metadata = extractTimeAndDurationFromDescription(description);
          }
          await saveMemory({
            key: key.replace(/[^a-z0-9_]+/gi, '_').toLowerCase(),
            description,
            confidence: 0.9,
            category,
            expires_at: null,
            metadata: metadata && Object.keys(metadata).length > 0 ? metadata : null
          });
        }
      }

      // Also save the raw user answer as a memory for context
      await saveMemory({
        key: `onboarding_answer_${currentStep + 1}`,
        description: responseText.trim(),
        confidence: 1,
        category: 'temporary',
        expires_at: null
      });

      await refreshMemories();

      // 5. Advance to next step
      const nextStep = currentStep + 1;
      if (nextStep < ONBOARDING_QUESTIONS.length) {
        setCurrentStep(nextStep);
      } else {
        // All onboarding questions completed
        setCurrentStep(ONBOARDING_QUESTIONS.length);
        setAiMessage(
          "Thank you for sharing that! I've set up your Second Brain database. You're ready to start structuring and adapting your daily schedule."
        );
      }
    } catch (err) {
      console.error(err);
      Alert.alert("Onboarding Error", "Communication failed. Moving to next question.");
      setCurrentStep(currentStep + 1);
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinishOnboarding = async () => {
    setIsLoading(true);
    try {
      // Save name if not already saved
      await setUserProfile('onboarding_completed', 'true');
      await updateOnboardingCompleted();
      router.replace('/');
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  const progressPercent = (currentStep / ONBOARDING_QUESTIONS.length) * 100;

  const KeyboardWrapper = KeyboardAvoidingView;
  const wrapperProps = { behavior: Platform.OS === 'ios' ? 'padding' as const : 'height' as const };

  return (
    <ImageBackground
      source={require('../../../assets/images/doodle_bg.png')}
      style={styles.bgImage}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardWrapper style={styles.flex} {...wrapperProps}>
          <View style={styles.container}>
            {/* Progress Bar */}
            <View style={styles.progressContainer}>
              <View style={[styles.progressBar, { width: `${progressPercent}%` }]} />
            </View>

            {/* Athena's Response */}
            <ScrollView
              style={styles.chatArea}
              contentContainerStyle={styles.chatContent}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.aiBubble}>
                <Text style={styles.aiBubbleText}>{aiMessage}</Text>
              </View>
            </ScrollView>

            {/* Input Area */}
            {currentStep < ONBOARDING_QUESTIONS.length ? (
              <View style={styles.inputBar}>
                <View style={styles.inputStack}>
                  <TextInput
                    style={styles.textInput}
                    value={userInput}
                    onChangeText={setUserInput}
                    placeholder="Type or tap mic..."
                    placeholderTextColor="#98A2B3"
                    editable={!isLoading && !isRecording}
                    multiline={true}
                    scrollEnabled={true}
                  />
                  {isRecording && (
                    <View style={styles.waveformOverlay}>
                      <WaveformBars isListening={isRecording} />
                    </View>
                  )}
                </View>
                <TouchableOpacity
                  style={styles.micButton}
                  onPress={isRecording ? handleStopRecording : handleStartRecording}
                  disabled={isLoading || isVoiceStopping}
                >
                  <Text style={styles.micText}>{isRecording ? "⏹️" : "🎤"}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sendButton, (isLoading || userInput.trim() === '') && styles.sendButtonDisabled]}
                  onPress={() => handleSendResponse(userInput)}
                  disabled={isLoading || userInput.trim() === ''}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.sendText}>→</Text>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.finishButton}
                onPress={handleFinishOnboarding}
                disabled={isLoading}
              >
                {isLoading ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.finishButtonText}>Let's Get Started →</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </KeyboardWrapper>
      </SafeAreaView>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  bgImage: {
    flex: 1,
    width: '100%',
    height: '100%'
  },
  safeArea: {
    flex: 1,
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0
  },
  flex: {
    flex: 1
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingBottom: Platform.select({ ios: 24, android: 16, default: 16 }),
    justifyContent: 'space-between'
  },
  progressContainer: {
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 2,
    marginBottom: 16
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#FF5C7A',
    borderRadius: 2
  },
  chatArea: {
    flex: 1,
    marginBottom: 12
  },
  chatContent: {
    paddingVertical: 8
  },
  aiBubble: {
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    padding: 24,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#FFE3E6'
  },
  aiBubbleText: {
    color: '#4A354F',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500'
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: Platform.select({ ios: 24, android: 16, default: 16 }),
  },
  textInput: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
    color: '#4A354F',
    fontSize: 14,
    borderWidth: 1,
    borderColor: '#FFE3E6',
    minHeight: 45,
    maxHeight: 150
  },
  micButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FFE3E6'
  },
  micText: {
    fontSize: 20
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF5C7A',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sendButtonDisabled: {
    opacity: 0.5
  },
  sendText: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700'
  },
  finishButton: {
    backgroundColor: '#FF5C7A',
    borderRadius: 24,
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: Platform.select({ ios: 24, android: 16, default: 16 })
  },
  finishButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
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
  }
});
