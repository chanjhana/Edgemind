import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { Alert } from '../../core/store/AppContext';

// Configure how notifications appear when app is in foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge:  true,
  }),
});

let _permissionGranted = false;

/**
 * Request notification permissions on first launch.
 * Call this once at app startup (e.g. from WsBootstrap or _layout).
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  // Local notifications can be tested on Emulators/Simulators.
  // We only log a warning but still request permission to allow testing.
  if (!Device.isDevice) {
    console.log('[Notifications] Running on simulator/emulator. Local notifications are allowed for testing.');
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[Notifications] Permission denied.');
    return false;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('edgemind-critical', {
      name: 'EdgeMind Critical Alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#ff000f',
      sound: 'default',
    });
  }

  _permissionGranted = true;
  return true;
}

/**
 * Schedule a local push notification for a CRITICAL alert.
 * Called from useWebSocket when severity === 'CRITICAL'.
 */
export async function scheduleAlertNotification(alert: Alert): Promise<void> {
  // In Expo Go (simulator), just log — real device needed for push
  console.log(`[Notifications] CRITICAL alert: ${alert.pod_id} — ${alert.title}`);

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title:    `⚡ CRITICAL: ${alert.pod_id}`,
        body:     alert.title,
        subtitle: alert.pump_id ? `Pump: ${alert.pump_id}` : undefined,
        data:     { alertId: alert.id, screen: 'alerts' },
        sound:    'default',
        ...(Platform.OS === 'android' && { channelId: 'edgemind-critical' }),
      },
      trigger: null,  // fire immediately
    });
  } catch (err) {
    console.warn('[Notifications] Failed to schedule notification:', err);
  }
}

/**
 * Clear all delivered notifications (e.g. when user opens the app).
 */
export async function clearAllNotifications(): Promise<void> {
  await Notifications.dismissAllNotificationsAsync();
  await Notifications.setBadgeCountAsync(0);
}

/**
 * Listen for notification taps — route to the alerts tab.
 * Call once in _layout.tsx.
 */
export function useNotificationListener(onPress: (alertId: string) => void) {
  const subscription = Notifications.addNotificationResponseReceivedListener(response => {
    const alertId = response.notification.request.content.data?.alertId as string;
    if (alertId) onPress(alertId);
  });
  return () => subscription.remove();
}
