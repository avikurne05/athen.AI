import { DefaultTheme, ThemeProvider } from 'expo-router';
import { Stack } from 'expo-router';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppProvider, useApp } from '../context/AppContext';

export default function TabLayout() {
  return (
    <AppProvider>
      <LayoutContent />
    </AppProvider>
  );
}

function LayoutContent() {
  const { dbReady } = useApp();

  if (!dbReady) {
    return <AnimatedSplashOverlay />;
  }

  // Force Light Theme (DefaultTheme) for girly-pops pastel palette
  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#FFF0F2' }, // Soft pink base color background
          animation: 'fade'
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" />
      </Stack>
    </ThemeProvider>
  );
}
