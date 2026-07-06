import React, { useState, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { voiceService } from '../services/voice';

interface WaveformBarsProps {
  isListening: boolean;
  status?: 'listening' | 'restarting' | 'stopped';
}

const BAR_COUNT = 45; // Number of bars to fill the length of the text box

export default function WaveformBars({ isListening, status }: WaveformBarsProps) {
  const [history, setHistory] = useState<number[]>(() => Array(BAR_COUNT).fill(0));

  useEffect(() => {
    if (!isListening) {
      setHistory(Array(BAR_COUNT).fill(0));
      return;
    }

    const handleVolume = (volume: number) => {
      // Normalize volume (typically -2 to 10 on iOS, 0 to 10 on Android)
      const normalized = Math.max(0, Math.min(10, volume + 2));
      setHistory(prev => [...prev.slice(1), normalized]);
    };

    // Subscribe to voiceService volume changes
    voiceService.addVolumeListener(handleVolume);

    // If running in simulator/web, simulate volume changes
    let mockInterval: any = null;
    const hasNativeVoice = voiceService.hasNativeVoiceModule();
    if (!hasNativeVoice || Platform.OS === 'web') {
      mockInterval = setInterval(() => {
        // Generate random mock volumes (a mix of speech peaks and silences)
        const mockVol = status === 'restarting'
          ? 0.5 // Minimal volume simulation when restarting/buffering
          : Math.random() > 0.3 ? 2 + Math.random() * 6 : Math.random() * 2;
        handleVolume(mockVol);
      }, 70); // 70ms tick for a smooth rolling effect
    }

    return () => {
      voiceService.removeVolumeListener(handleVolume);
      if (mockInterval) clearInterval(mockInterval);
    };
  }, [isListening, status]);

  return (
    <View style={styles.waveformContainer}>
      {history.map((volumeVal, i) => {
        const height = 4 + volumeVal * 2.4; // maps 0-10 volume to 4-28 height

        return (
          <View
            key={i}
            style={[
              styles.bar,
              {
                height: height,
                backgroundColor: status === 'restarting' ? '#CBD5E1' : '#FF8DA1'
              }
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  waveformContainer: {
    flex: 1, // Span the full width of the text box
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between', // Distribute bars evenly across the text box
    height: 28,
    paddingHorizontal: 8,
  },
  bar: {
    flex: 1,
    maxWidth: 3,
    marginHorizontal: 1,
    borderRadius: 2,
  },
});
