import { Stack } from 'expo-router';
import React from 'react';

export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: '#F8F9FC' }, // Light and white global page bg
        animation: 'slide_from_right'
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="conversational" />
    </Stack>
  );
}
