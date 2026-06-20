import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useActiveAlert, useAlerts, useSensors, useApp } from '../../core/store/AppContext';
import AlertCard from '../../components/alerts/AlertCard';
import RootCausePanel from '../../components/alerts/RootCausePanel';
import SparklineChart from '../../components/ui/SparklineChart';
import InvestigationModal from '../../components/alerts/InvestigationModal';
import { Colors, Typography, Spacing } from '../../components/ui/tokens';

export default function AlertsScreen() {
  const activeAlert  = useActiveAlert();
  const alerts       = useAlerts();
  const sensors      = useSensors();
  const { dispatch } = useApp();
  const [showModal, setShowModal]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const pump1Readings = sensors['pump1'] ?? [];
  const vibrationData = pump1Readings.map(r => ({ x: r.timestamp, y: r.vibration_axial }));
  const tempData      = pump1Readings.map(r => ({ x: r.timestamp, y: r.temperature }));

  const otherAlerts = alerts.filter(a => a.id !== activeAlert?.id).slice(0, 3);

  async function onRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 1200);
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.abbRed} />}
      >
        {/* ── Active Alert Section ─────────────────────────────────────── */}
        <Text style={styles.sectionLabel}>ACTIVE ALERT</Text>

        {activeAlert ? (
          <>
            <AlertCard
              alert={activeAlert}
              isActive
              onPress={() => setShowModal(true)}
            />
            <RootCausePanel alert={activeAlert} compact />
          </>
        ) : (
          <View style={styles.noAlert}>
            <View style={styles.noAlertDot} />
            <Text style={styles.noAlertTitle}>All Systems Normal</Text>
            <Text style={styles.noAlertSub}>No active critical alerts.</Text>
          </View>
        )}

        {/* ── Live Metrics ─────────────────────────────────────────────── */}
        {pump1Readings.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>LIVE METRICS — PUMP 1</Text>
            <SparklineChart
              data={vibrationData}
              label="Vibration Axial (g)"
              color={Colors.danger}
              dangerThreshold={1.5}
            />
            <SparklineChart
              data={tempData}
              label="Temperature (°C)"
              color={Colors.abbBlue}
              dangerThreshold={65}
            />
          </>
        )}

        {/* ── Other Alerts ─────────────────────────────────────────────── */}
        {otherAlerts.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>OTHER ALERTS</Text>
            {otherAlerts.map(alert => (
              <AlertCard
                key={alert.id}
                alert={alert}
                onPress={() => {
                  dispatch({ type: 'SET_ACTIVE_ALERT', payload: alert });
                  setShowModal(true);
                }}
              />
            ))}
          </>
        )}
      </ScrollView>

      {/* Investigation Modal */}
      {showModal && activeAlert && (
        <InvestigationModal
          alert={activeAlert}
          onClose={() => setShowModal(false)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.bgSurface },
  scroll:   { flex: 1 },
  content:  { padding: Spacing.base, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 10, fontWeight: Typography.weights.bold,
    color: Colors.textTertiary, letterSpacing: 1.4,
    marginBottom: Spacing.sm, marginTop: Spacing.sm,
  },
  noAlert: {
    alignItems: 'center', paddingVertical: Spacing.xxl,
    backgroundColor: Colors.bgCard, borderRadius: 16,
    borderWidth: 1, borderColor: Colors.borderCard,
    marginBottom: Spacing.base,
  },
  noAlertDot: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: Colors.successTint,
    borderWidth: 3, borderColor: Colors.success,
    marginBottom: Spacing.md,
  },
  noAlertTitle: { fontSize: Typography.sizes.lg, fontWeight: Typography.weights.bold, color: Colors.success },
  noAlertSub:   { fontSize: Typography.sizes.sm, color: Colors.textTertiary, marginTop: 4 },
});
