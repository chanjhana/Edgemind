import React, { useEffect, useRef } from 'react';
import { Animated, Text, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToast, useApp } from '../../core/store/AppContext';
import { Colors, Typography, Spacing, Radius } from './tokens';

/**
 * Global toast — slides down from top on CRITICAL / WARNING events.
 * Auto-dismisses (dispatch SET_TOAST null from useWebSocket).
 * Color changes based on severity prefix in the message.
 */
export default function Toast() {
  const message = useToast();
  const { dispatch } = useApp();
  const insets     = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-80)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message) {
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80 }),
        Animated.timing(opacity,    { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -80, duration: 250, useNativeDriver: true }),
        Animated.timing(opacity,    { toValue: 0,   duration: 200, useNativeDriver: true }),
      ]).start();
    }
  }, [message]);

  if (!message) return null;

  // Determine color based on severity prefix in the message string
  const isCritical = message.startsWith('CRITICAL');
  const isWarning  = message.startsWith('WARNING');
  const bgColor    = isCritical ? Colors.danger : isWarning ? Colors.warning : Colors.abbGray1;
  const prefix     = isCritical ? 'CRITICAL' : isWarning ? 'WARNING' : null;
  const body       = prefix ? message.replace(`${prefix}: `, '') : message;

  return (
    <Animated.View
      style={[
        styles.toast,
        { top: insets.top + 8, opacity, transform: [{ translateY }], backgroundColor: bgColor },
      ]}
    >
      <View style={styles.row}>
        {prefix && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{prefix}</Text>
          </View>
        )}
        <Text style={styles.text} numberOfLines={2}>{body}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16, right: 16,
    borderRadius: Radius.md,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    zIndex: 9999,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  badge: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  text: {
    color: '#fff',
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.semibold,
    flex: 1,
  },
});
