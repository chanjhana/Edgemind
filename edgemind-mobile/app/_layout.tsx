import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from '../core/store/AppContext';
import WsBootstrap from '../components/ui/WsBootstrap';
import Toast from '../components/ui/Toast';
import { requestNotificationPermissions, useNotificationListener } from '../components/notifications/notificationService';

export default function RootLayout() {
  useEffect(() => {
    requestNotificationPermissions();

    const removeListener = useNotificationListener((alertId) => {
      // Tap on notification redirects user to the main Alerts screen
      router.push('/(tabs)/alerts');
    });

    return () => {
      removeListener();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppProvider>
          <WsBootstrap />
          <StatusBar style="light" backgroundColor="#000000" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
          <Toast />
        </AppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
