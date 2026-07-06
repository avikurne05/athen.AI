import { NativeModules, Platform } from 'react-native';

export interface VoiceRecognitionDelegate {
  onSpeechStart?: () => void;
  onSpeechResults?: (text: string) => void;
  onSpeechError?: (error: string) => void;
  onSpeechEnd?: (finalTranscript: string) => void;
  onSpeechVolumeChanged?: (volume: number) => void;
  onSpeechStatusChanged?: (status: 'listening' | 'restarting' | 'stopped') => void;
}

const RECOGNITION_OPTIONS = {
  EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS: 300000,
  EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: 2500,
  EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS: 1500
};

class VoiceService {
  private isListening = false;
  private stopRequested = false;
  private isNativeRecognizing = false;
  private hasFinished = false;
  private delegate: VoiceRecognitionDelegate | null = null;
  private nativeVoiceModule: any = null;
  private webRecognition: any = null;
  private committedText = '';
  private currentText = '';
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private mockVolumeTimer: ReturnType<typeof setInterval> | null = null;
  private volumeListeners: ((volume: number) => void)[] = [];
  private currentStatus: 'listening' | 'restarting' | 'stopped' = 'stopped';

  private setStatus(status: 'listening' | 'restarting' | 'stopped') {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.delegate?.onSpeechStatusChanged?.(status);
  }

  constructor() {
    this.initializeNativeModule();
    this.initializeWebSpeech();
  }

  private mergeWithOverlap(str1: string, str2: string): string {
    const s1 = str1.trim();
    const s2 = str2.trim();
    if (!s1) return s2;
    if (!s2) return s1;

    const normalize = (s: string) => s.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, "").trim();

    if (normalize(s2).startsWith(normalize(s1))) {
      return s2;
    }

    const words1 = s1.split(/\s+/);
    const words2 = s2.split(/\s+/);
    const maxOverlap = Math.min(words1.length, words2.length);

    for (let len = maxOverlap; len > 0; len--) {
      const suffix = words1.slice(-len).map(normalize).join(' ');
      const prefix = words2.slice(0, len).map(normalize).join(' ');
      if (suffix === prefix && suffix !== "") {
        const firstPart = words1.slice(0, words1.length - len).join(' ');
        return firstPart ? `${firstPart} ${s2}` : s2;
      }
    }

    return `${s1} ${s2}`;
  }

  private combinedText(): string {
    return this.mergeWithOverlap(this.committedText, this.currentText);
  }

  private commitCurrentText() {
    this.committedText = this.combinedText();
    this.currentText = '';
  }

  private clearTimers() {
    if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.mockVolumeTimer) clearInterval(this.mockVolumeTimer);
    this.finalizeTimer = null;
    this.restartTimer = null;
    this.mockVolumeTimer = null;
  }

  private scheduleFinalize(delay = 500) {
    if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
    this.finalizeTimer = setTimeout(() => this.finishListening(), delay);
  }

  private finishListening() {
    if (this.hasFinished) return;
    this.commitCurrentText();
    this.clearTimers();
    this.isListening = false;
    this.stopRequested = false;
    this.isNativeRecognizing = false;
    this.hasFinished = true;
    this.setStatus('stopped');
    this.delegate?.onSpeechEnd?.(this.committedText.trim());
  }

  private async startNativeRecognition() {
    if (!this.nativeVoiceModule || !this.isListening || this.stopRequested) return;
    await this.nativeVoiceModule.start('en-US');
  }

  private scheduleRestart() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.setStatus('restarting');
    this.restartTimer = setTimeout(async () => {
      if (!this.isListening || this.stopRequested) return;
      try {
        await this.nativeVoiceModule?.cancel();
        await this.startNativeRecognition();
      } catch (error) {
        console.warn('[VOICE] Could not restart recognition:', error);
      }
    }, 80);
  }

  private initializeNativeModule() {
    if (Platform.OS === 'web') return;

    try {
      const hasNativeVoice = NativeModules?.Voice != null || NativeModules?.RCTVoice != null;
      if (!hasNativeVoice) return;

      const Voice = require('@react-native-voice/voice').default;
      if (!Voice) return;
      this.nativeVoiceModule = Voice;
    } catch (error) {
      console.warn('[VOICE] Native speech recognition is unavailable:', error);
    }
  }

  private bindNativeListeners() {
    if (!this.nativeVoiceModule) return;
    const Voice = this.nativeVoiceModule;

    Voice.onSpeechStart = () => {
      if (!this.isListening || this.stopRequested) return;
      this.isNativeRecognizing = true;
      this.setStatus('listening');
      this.delegate?.onSpeechStart?.();
    };

    Voice.onSpeechResults = (event: any) => {
      const value = event?.value?.[0]?.trim();
      if ((!this.isListening && !this.stopRequested) || !value) return;
      this.currentText = value;
      this.delegate?.onSpeechResults?.(this.combinedText());
      if (this.stopRequested) this.scheduleFinalize(300);
    };

    Voice.onSpeechPartialResults = (event: any) => {
      const value = event?.value?.[0]?.trim();
      if ((!this.isListening && !this.stopRequested) || !value) return;
      this.currentText = value;
      this.delegate?.onSpeechResults?.(this.combinedText());
    };

    Voice.onSpeechEnd = () => {
      this.isNativeRecognizing = false;
      this.commitCurrentText();
      if (this.stopRequested) {
        this.setStatus('stopped');
        this.scheduleFinalize(600);
      } else if (this.isListening) {
        this.setStatus('restarting');
        this.scheduleRestart();
      }
    };

    Voice.onSpeechError = (event: any) => {
      this.isNativeRecognizing = false;
      
      let errorMsg = '';
      let errorCode = '';
      
      if (event) {
        if (event.error) {
          if (typeof event.error === 'object') {
            errorMsg = String(event.error.message || '');
            errorCode = String(event.error.code || '');
          } else {
            errorMsg = String(event.error);
          }
        }
        if (!errorMsg && event.message) {
          errorMsg = String(event.message);
        }
        if (!errorCode && event.code) {
          errorCode = String(event.code);
        }
      }
      
      const cleanErrorMsg = errorMsg.toLowerCase();
      console.log(`[VOICE] Native error occurred: code=${errorCode}, message="${cleanErrorMsg}", stopRequested=${this.stopRequested}, isListening=${this.isListening}`);

      if (this.stopRequested) {
        this.setStatus('stopped');
        this.finishListening();
        return;
      }
      if (!this.isListening) return;

      // Transient codes (Android & iOS)
      const transientCodes = new Set(['5', '6', '7', '8', '11', '13', '203', '209']);
      const isTransient = 
        transientCodes.has(errorCode) ||
        cleanErrorMsg.includes('no speech') ||
        cleanErrorMsg.includes('no match') ||
        cleanErrorMsg.includes('timeout') ||
        cleanErrorMsg.includes('cancel') ||
        cleanErrorMsg.includes('stopped') ||
        cleanErrorMsg.includes('aborted');

      if (isTransient) {
        console.log('[VOICE] Handling transient/silent speech error. Committing current text and restarting...');
        this.commitCurrentText();
        this.delegate?.onSpeechResults?.(this.combinedText());
        this.setStatus('restarting');
        this.scheduleRestart();
        return;
      }

      this.isListening = false;
      this.setStatus('stopped');
      this.delegate?.onSpeechError?.(errorMsg || 'Speech recognition stopped.');
    };

    Voice.onSpeechVolumeChanged = (event: { value?: number }) => {
      if (!this.isListening || typeof event.value !== 'number') return;
      this.delegate?.onSpeechVolumeChanged?.(event.value);
      this.volumeListeners.forEach(listener => listener(event.value as number));
    };
  }

  private initializeWebSpeech() {
    if (Platform.OS !== 'web') return;

    try {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!SpeechRecognition) {
        console.warn('[VOICE] Web Speech Recognition is not supported in this browser.');
        return;
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onstart = () => {
        if (!this.isListening || this.stopRequested) return;
        this.delegate?.onSpeechStart?.();
      };

      recognition.onresult = (event: any) => {
        if (!this.isListening && !this.stopRequested) return;
        
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          } else {
            interimTranscript += event.results[i][0].transcript;
          }
        }

        const value = (finalTranscript || interimTranscript).trim();
        if (value) {
          this.currentText = value;
          this.delegate?.onSpeechResults?.(this.combinedText());
        }
      };

      recognition.onerror = (event: any) => {
        if (this.stopRequested) {
          this.finishListening();
          return;
        }
        if (!this.isListening) return;
        this.isListening = false;
        this.delegate?.onSpeechError?.(event.error || 'Web Speech error.');
      };

      recognition.onend = () => {
        this.commitCurrentText();
        this.finishListening();
      };

      this.webRecognition = recognition;
    } catch (e) {
      console.warn('[VOICE] Web Speech initialization failed:', e);
    }
  }

  public setDelegate(delegate: VoiceRecognitionDelegate) {
    this.delegate = delegate;
    this.bindNativeListeners();
  }

  public addVolumeListener(listener: (volume: number) => void) {
    this.volumeListeners.push(listener);
  }

  public removeVolumeListener(listener: (volume: number) => void) {
    this.volumeListeners.push(listener);
  }

  public hasNativeVoiceModule(): boolean {
    return this.nativeVoiceModule !== null;
  }

  public async startListening(): Promise<void> {
    if (this.isListening) return;
    this.clearTimers();
    this.isListening = true;
    this.stopRequested = false;
    this.isNativeRecognizing = false;
    this.hasFinished = false;
    this.committedText = '';
    this.currentText = '';
    this.setStatus('listening');

    if (this.webRecognition) {
      try {
        this.webRecognition.start();
      } catch (error: any) {
        this.isListening = false;
        this.delegate?.onSpeechError?.(error?.message || 'Could not start web speech recognition.');
      }
      return;
    }

    if (this.nativeVoiceModule) {
      if (Platform.OS === 'android') {
        const { PermissionsAndroid } = require('react-native');
        const permission = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
        const granted = await PermissionsAndroid.check(permission)
          || await PermissionsAndroid.request(permission) === PermissionsAndroid.RESULTS.GRANTED;
        if (!granted) {
          this.isListening = false;
          this.delegate?.onSpeechError?.('Microphone permission denied.');
          return;
        }
      }

      try {
        await this.startNativeRecognition();
      } catch (error: any) {
        this.isListening = false;
        this.delegate?.onSpeechError?.(error?.message || 'Could not start speech recognition.');
      }
      return;
    }

    this.delegate?.onSpeechStart?.();
    this.mockVolumeTimer = setInterval(() => {
      const volume = Math.random() > 0.3 ? 2 + Math.random() * 6 : Math.random() * 2;
      this.delegate?.onSpeechVolumeChanged?.(volume);
      this.volumeListeners.forEach(listener => listener(volume));
    }, 70);
  }

  public async stopListening(): Promise<void> {
    if (!this.isListening || this.stopRequested) return;
    this.stopRequested = true;
    this.isListening = false;

    if (this.webRecognition) {
      try {
        this.webRecognition.stop();
      } catch (error) {
        console.warn('[VOICE] Web stop failed:', error);
      }
      return;
    }

    if (!this.nativeVoiceModule) {
      this.finishListening();
      return;
    }

    try {
      // Use cancel() instead of stop() to safely halt recognition and avoid native speech engine crashes
      await this.nativeVoiceModule.cancel();
    } catch (error) {
      console.warn('[VOICE] Native cancel failed:', error);
    }
    
    this.finishListening();
  }

  public async destroy(): Promise<void> {
    this.clearTimers();
    this.isListening = false;
    this.stopRequested = false;
    this.delegate = null;
    if (this.nativeVoiceModule) {
      try {
        await this.nativeVoiceModule.destroy();
      } catch (error) {
        console.warn('[VOICE] Failed to destroy native voice module during destroy:', error);
      }
      try {
        this.nativeVoiceModule.removeAllListeners();
      } catch (error) {
        console.warn('[VOICE] Failed to remove listeners during destroy:', error);
      }
    }
  }
}

export const voiceService = new VoiceService();
