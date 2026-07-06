import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import { useApp } from '../context/AppContext';
import { deleteMemory, saveMemory } from '../services/db';
import { verifyApiKey } from '../services/gemini';
import { convertTo12Hour, normalizeClockTime } from '../services/time';

interface SettingsOverlayProps {
  visible: boolean;
  onClose: () => void;
}

export default function SettingsOverlay({ visible, onClose }: SettingsOverlayProps) {
  const {
    apiKey,
    saveKeys,
    morningReminder,
    nightReminder,
    updateReminders,
    memories,
    refreshMemories
  } = useApp();

  const [inputKey, setInputKey] = useState(apiKey);
  const [isValidating, setIsValidating] = useState(false);
  const [keyActive, setKeyActive] = useState(!!apiKey);
  const [morning, setMorning] = useState(convertTo12Hour(morningReminder));
  const [night, setNight] = useState(convertTo12Hour(nightReminder));
  const [memoryDrafts, setMemoryDrafts] = useState<Record<string, string>>({});
  const [newDetail, setNewDetail] = useState('');
  const [savedMessage, setSavedMessage] = useState('');
  const [activeCategory, setActiveCategory] = useState<'preference' | 'habit' | 'goal' | 'routine' | 'constraint'>('preference');

  useEffect(() => {
    if (!visible) return;
    setInputKey(apiKey);
    setKeyActive(!!apiKey);
    setMorning(convertTo12Hour(morningReminder));
    setNight(convertTo12Hour(nightReminder));
    setMemoryDrafts(Object.fromEntries(memories.map(memory => [memory.key, memory.description])));
    setSavedMessage('');
  }, [
    apiKey,
    memories,
    morningReminder,
    nightReminder,
    visible
  ]);

  const showSaved = (message: string) => {
    setSavedMessage(message);
    setTimeout(() => setSavedMessage(''), 1800);
  };

  const handleSaveKey = async () => {
    if (!inputKey.trim()) return;
    setIsValidating(true);
    const valid = await verifyApiKey(inputKey.trim());
    setIsValidating(false);
    if (!valid) {
      Alert.alert('Could not connect', 'Check the Gemini key and try again.');
      return;
    }
    await saveKeys(inputKey.trim());
    setKeyActive(true);
    showSaved('Gemini key saved');
  };

  const handleSaveReminders = async () => {
    const normMorning = normalizeClockTime(morning);
    const normNight = normalizeClockTime(night);

    if (!normMorning || !normNight) {
      Alert.alert('Invalid Time', 'Please enter a valid time (e.g., 08:00 AM, 9:00 PM).');
      return;
    }

    await updateReminders(normMorning, normNight);
    setMorning(convertTo12Hour(normMorning));
    setNight(convertTo12Hour(normNight));
    showSaved('Reminders saved');
  };

  const handleSaveMemory = async (key: string) => {
    const memory = memories.find(item => item.key === key);
    const description = memoryDrafts[key]?.trim();
    if (!memory || !description) return;
    await saveMemory({ ...memory, description });
    await refreshMemories();
    showSaved('Memory updated');
  };

  const handleDeleteMemory = async (key: string) => {
    await deleteMemory(key);
    await refreshMemories();
    showSaved('Memory forgotten');
  };

  const handleTogglePinMemory = async (key: string) => {
    const memory = memories.find(item => item.key === key);
    if (!memory) return;
    const nextPinned = memory.pinned === 1 ? 0 : 1;
    await saveMemory({ ...memory, pinned: nextPinned });
    await refreshMemories();
    showSaved(nextPinned === 1 ? 'Preference pinned' : 'Preference unpinned');
  };

  const handleAddDetail = async () => {
    const description = newDetail.trim();
    if (!description) return;
    await saveMemory({
      key: `user_detail_${Date.now()}`,
      description,
      confidence: 1,
      category: activeCategory,
      expires_at: null,
      pinned: 0
    });
    setNewDetail('');
    await refreshMemories();
    showSaved('Detail added');
  };

  // Filter out raw onboarding answers and focus on active tab
  const displayMemories = memories.filter(
    m => m.category === activeCategory && !m.key.startsWith('onboarding_answer_')
  );
  const sortedMemories = [...displayMemories].sort((a, b) => (b.pinned || 0) - (a.pinned || 0));

  const categoriesList: { key: typeof activeCategory; label: string; icon: string }[] = [
    { key: 'preference', label: 'Preferences', icon: '🌸' },
    { key: 'habit', label: 'Habits', icon: '⭐️' },
    { key: 'goal', label: 'Goals', icon: '🎯' },
    { key: 'routine', label: 'Routines', icon: '⏰' },
    { key: 'constraint', label: 'Constraints', icon: '🚫' }
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeText}>Done</Text>
            </TouchableOpacity>
          </View>

          {savedMessage ? <Text style={styles.savedMessage}>{savedMessage}</Text> : null}

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.card}>
              <Text style={styles.cardTitle}>AI Memory</Text>
              <Text style={styles.cardSubtitle}>
                Athena learns your preferences, habits, goals, routines, and constraints. View, edit, forget, or pin them to align Athena's scheduling decisions.
              </Text>

              {/* Horizontal scrollable category selector tabs */}
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.tabsContainer}
                style={styles.tabsWrapper}
              >
                {categoriesList.map(cat => (
                  <TouchableOpacity
                    key={cat.key}
                    style={[styles.tabButton, activeCategory === cat.key && styles.activeTabButton]}
                    onPress={() => setActiveCategory(cat.key)}
                  >
                    <Text style={styles.tabIcon}>{cat.icon}</Text>
                    <Text style={[styles.tabButtonText, activeCategory === cat.key && styles.activeTabButtonText]}>
                      {cat.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {/* Memories for currently selected category */}
              {sortedMemories.length === 0 ? (
                <Text style={styles.mutedText}>
                  No {activeCategory}s saved yet. Athena learns this as you interact!
                </Text>
              ) : (
                sortedMemories.map(memory => {
                  const isPinned = memory.pinned === 1;
                  return (
                    <View key={memory.key} style={[styles.memoryItem, isPinned && styles.pinnedMemoryItem]}>
                      <View style={styles.memoryHeader}>
                        <Text style={styles.memoryKey}>{memory.key.replace(/_/g, ' ')}</Text>
                        <View style={styles.headerBadgeContainer}>
                          {isPinned && <Text style={styles.pinnedBadge}>📌 Pinned</Text>}
                          <Text style={styles.categoryBadge}>{memory.category}</Text>
                        </View>
                      </View>
                      <TextInput
                        style={[styles.input, styles.memoryInput, isPinned && styles.pinnedMemoryInput]}
                        value={memoryDrafts[memory.key] ?? memory.description}
                        onChangeText={text => setMemoryDrafts(current => ({
                          ...current,
                          [memory.key]: text
                        }))}
                        multiline
                      />
                      <View style={styles.smallActions}>
                        <TouchableOpacity style={styles.iconActionButton} onPress={() => handleTogglePinMemory(memory.key)}>
                          <Text style={styles.iconActionText}>{isPinned ? '★ Pinned' : '☆ Pin'}</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.textButton} onPress={() => handleSaveMemory(memory.key)}>
                          <Text style={styles.textButtonPrimary}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.textButton} onPress={() => handleDeleteMemory(memory.key)}>
                          <Text style={styles.textButtonMuted}>Forget</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}

              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.addInput]}
                  value={newDetail}
                  onChangeText={setNewDetail}
                  placeholder={`Add a new ${activeCategory}...`}
                  placeholderTextColor="#98A2B3"
                />
                <TouchableOpacity style={styles.compactButton} onPress={handleAddDetail}>
                  <Text style={styles.buttonText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Reminders</Text>
              <View style={styles.twoColumns}>
                <TimeField label="Morning" value={morning} onChangeText={setMorning} />
                <TimeField label="Night" value={night} onChangeText={setNight} />
              </View>
              <PrimaryButton label="Save reminders" onPress={handleSaveReminders} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Gemini</Text>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, styles.addInput, keyActive && styles.activeInput]}
                  value={inputKey}
                  onChangeText={text => {
                    setInputKey(text);
                    setKeyActive(false);
                  }}
                  placeholder="API key"
                  placeholderTextColor="#98A2B3"
                  secureTextEntry
                  autoCapitalize="none"
                />
                <TouchableOpacity style={styles.compactButton} onPress={handleSaveKey} disabled={isValidating}>
                  {isValidating
                    ? <ActivityIndicator size="small" color="#FFFFFF" />
                    : <Text style={styles.buttonText}>{keyActive ? 'Active' : 'Save'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function TimeField({
  label,
  value,
  onChangeText
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.timeField}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder="08:00 AM"
        maxLength={8}
        keyboardType="default"
      />
    </View>
  );
}

function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.primaryButton} onPress={onPress}>
      <Text style={styles.buttonText}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFF7F8'
  },
  container: {
    flex: 1,
    paddingHorizontal: 18
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16
  },
  title: {
    color: '#4A354F',
    fontSize: 24,
    fontWeight: '800'
  },
  closeButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 20
  },
  closeText: {
    color: '#FF5C7A',
    fontSize: 13,
    fontWeight: '700'
  },
  savedMessage: {
    alignSelf: 'center',
    color: '#438A55',
    fontSize: 12,
    marginBottom: 8
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 28
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#FFE3E6'
  },
  cardTitle: {
    color: '#4A354F',
    fontSize: 16,
    fontWeight: '700'
  },
  cardSubtitle: {
    color: '#8F8392',
    fontSize: 12,
    lineHeight: 17
  },
  input: {
    backgroundColor: '#FFF9FA',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFE3E6',
    paddingHorizontal: 13,
    paddingVertical: 10,
    color: '#4A354F',
    fontSize: 13
  },
  activeInput: {
    borderColor: '#9ED5A8'
  },
  memoryItem: {
    gap: 4
  },
  memoryHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 4
  },
  memoryKey: {
    color: '#8F6572',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'capitalize',
    flex: 1
  },
  categoryBadge: {
    color: '#FF8DA1',
    fontSize: 9,
    fontWeight: '700',
    textTransform: 'uppercase',
    backgroundColor: '#FFF0F2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden'
  },
  memoryInput: {
    minHeight: 54,
    textAlignVertical: 'top'
  },
  pinnedMemoryInput: {
    borderColor: '#FFD700',
    backgroundColor: '#FFFFF0'
  },
  pinnedMemoryItem: {
    backgroundColor: '#FFFFFA',
    padding: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#FFF8DC'
  },
  headerBadgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  pinnedBadge: {
    color: '#D4AF37',
    fontSize: 9,
    fontWeight: '700',
    backgroundColor: '#FFFDE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: 'hidden',
    borderWidth: 0.5,
    borderColor: '#FFE082'
  },
  iconActionButton: {
    marginRight: 'auto',
    paddingVertical: 4
  },
  iconActionText: {
    color: '#D4AF37',
    fontSize: 12,
    fontWeight: '700'
  },
  smallActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 14,
    alignItems: 'center'
  },
  textButton: {
    paddingVertical: 4
  },
  textButtonPrimary: {
    color: '#FF5C7A',
    fontSize: 12,
    fontWeight: '700'
  },
  textButtonMuted: {
    color: '#8F8392',
    fontSize: 12
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10
  },
  addInput: {
    flex: 1
  },
  compactButton: {
    minWidth: 66,
    minHeight: 42,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#FF8DA1',
    alignItems: 'center',
    justifyContent: 'center'
  },
  primaryButton: {
    backgroundColor: '#FF8DA1',
    borderRadius: 16,
    paddingVertical: 11,
    alignItems: 'center'
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700'
  },
  label: {
    color: '#8F6572',
    fontSize: 11,
    fontWeight: '600'
  },
  timeField: {
    flex: 1,
    gap: 5
  },
  twoColumns: {
    flexDirection: 'row',
    gap: 10
  },
  mutedText: {
    color: '#8F8392',
    fontSize: 12,
    fontStyle: 'italic',
    paddingVertical: 8
  },
  tabsWrapper: {
    marginVertical: 4
  },
  tabsContainer: {
    gap: 8,
    paddingVertical: 4,
    flexDirection: 'row'
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF0F2',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FFE3E6',
    gap: 6
  },
  activeTabButton: {
    backgroundColor: '#FF8DA1',
    borderColor: '#FF8DA1'
  },
  tabIcon: {
    fontSize: 12
  },
  tabButtonText: {
    color: '#FF5C7A',
    fontSize: 12,
    fontWeight: '700'
  },
  activeTabButtonText: {
    color: '#FFFFFF'
  }
});
