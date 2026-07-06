import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, SafeAreaView, StatusBar, TextInput, ScrollView, ActivityIndicator, Alert, Platform, ImageBackground, KeyboardAvoidingView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '../../context/AppContext';
import { verifyApiKey } from '../../services/gemini';
import { requestNotificationPermissions } from '../../services/localNotifications';
import { setUserProfile } from '../../services/db';

export default function WelcomeScreen() {
  const router = useRouter();
  const { saveKeys, updateReminders } = useApp();

  const [inputName, setInputName] = useState('');
  const [inputKey, setInputKey] = useState('');
  
  const [isValidating, setIsValidating] = useState(false);
  const [validated, setValidated] = useState(false);

  // Default reminders
  const [morning, setMorning] = useState('08:00');
  const [night, setNight] = useState('21:00');

  const handleValidateAndContinue = async () => {
    if (inputName.trim() === '') {
      Alert.alert("Name Required", "Please enter your name to personalize Athena.");
      return;
    }
    if (inputKey.trim() === '') {
      Alert.alert("API Key Required", "Please enter your Gemini API Key.");
      return;
    }

    setIsValidating(true);
    const success = await verifyApiKey(inputKey);
    setIsValidating(false);

    if (success) {
      setValidated(true);
      try {
        // Request notifications permission
        await requestNotificationPermissions();
        
        // Save Name to database
        await setUserProfile('user_name', inputName.trim());
        
        // Save API key
        await saveKeys(inputKey);
        
        // Save default reminders
        await updateReminders(morning, night);

        Alert.alert("Success!", "Key verified. Welcome to Athena!", [
          {
            text: "Continue",
            onPress: () => router.push('/onboarding/conversational')
          }
        ]);
      } catch (err) {
        console.error(err);
        Alert.alert("Error", "Could not complete configuration. Please try again.");
      }
    } else {
      setValidated(false);
      Alert.alert("Verification Failed", "The provided Gemini API Key is invalid or inactive. Please double check and enter a working key.");
    }
  };

  const isFormFilled = inputName.trim().length > 0 && inputKey.trim().length > 0;

  const KeyboardWrapper = KeyboardAvoidingView;
  const wrapperProps = { behavior: Platform.OS === 'ios' ? 'padding' as const : 'height' as const };

  return (
    <ImageBackground 
      source={require('../../../assets/images/doodle_bg.png')} 
      style={styles.backgroundImage}
      resizeMode="cover"
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardWrapper
          style={styles.keyboardAvoidingView}
          {...wrapperProps}
        >
          <StatusBar barStyle="dark-content" />
          <ScrollView contentContainerStyle={styles.scrollContainer} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <View style={styles.heroSection}>
              <Text style={styles.appName}>Athena</Text>
            </View>

            {/* Input Card */}
            <View style={styles.card}>
              <View style={styles.inputGroup}>
                <Text style={styles.label}>Your Name</Text>
                <TextInput
                  style={styles.input}
                  value={inputName}
                  onChangeText={setInputName}
                  placeholder="e.g. Mohit"
                  placeholderTextColor="#98A2B3"
                  editable={!isValidating}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>Gemini API Key</Text>
                <TextInput
                  style={[styles.input, validated ? styles.validatedInput : null]}
                  value={inputKey}
                  onChangeText={(text) => {
                    setInputKey(text);
                    setValidated(false);
                  }}
                  placeholder="AIzaSy..."
                  placeholderTextColor="#98A2B3"
                  secureTextEntry={true}
                  autoCapitalize="none"
                  editable={!isValidating}
                />
              </View>
            </View>

            {/* Action Button */}
            <TouchableOpacity 
              style={[styles.nextButton, !isFormFilled ? styles.disabledButton : null]} 
              onPress={handleValidateAndContinue}
              disabled={isValidating || !isFormFilled}
            >
              {isValidating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.nextButtonText}>Verify & Enter →</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
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
  scrollContainer: {
    padding: 24,
    gap: 20,
    flexGrow: 1,
    justifyContent: 'center', // Center everything vertically
    alignItems: 'center'
  },
  heroSection: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 8
  },
  emoji: {
    fontSize: 72
  },
  appName: {
    fontSize: 54,
    fontWeight: '700',
    fontFamily: Platform.select({ ios: 'Georgia', android: 'serif', default: 'serif' }),
    color: '#4A354F', // Deep plum for elegant contrast
    letterSpacing: 0.5
  },
  tagline: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FF8DA1', // Soft pink
    textTransform: 'uppercase',
    letterSpacing: 1.5
  },
  description: {
    fontSize: 13,
    color: '#B3556A', // Soft rose-plum
    textAlign: 'center',
    lineHeight: 20,
    paddingHorizontal: 12,
    marginTop: 4
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 28, // soft rounded
    borderWidth: 1,
    borderColor: '#FFE3E6',
    width: '100%',
    padding: 20,
    gap: 16,
    shadowColor: '#FF8DA1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#4A354F'
  },
  cardHelp: {
    fontSize: 12,
    color: '#B3556A',
    lineHeight: 16
  },
  inputGroup: {
    gap: 6
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FF5C7A'
  },
  input: {
    backgroundColor: '#FFF9FA',
    borderRadius: 24, // soft rounded
    borderWidth: 1,
    borderColor: '#FFE3E6',
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#4A354F'
  },
  validatedInput: {
    borderColor: '#A3E635',
    backgroundColor: '#F7FEE7'
  },
  transparencyCard: {
    backgroundColor: '#FFF5EE', // Peach background
    borderColor: '#FFE3E6',
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    width: '100%'
  },
  transparencyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#D44A70',
    marginBottom: 4
  },
  transparencyText: {
    fontSize: 12,
    color: '#B3556A',
    lineHeight: 16
  },
  nextButton: {
    backgroundColor: '#FF8DA1', // Rose-pink button
    paddingVertical: 14,
    borderRadius: 24, // soft corners
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FF8DA1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 3,
    marginTop: 8
  },
  nextButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700'
  },
  disabledButton: {
    backgroundColor: '#FFC0CB',
    shadowOpacity: 0,
    elevation: 0
  }
});
