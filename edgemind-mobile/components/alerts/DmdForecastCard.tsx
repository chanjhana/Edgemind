import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Colors, Typography, Spacing, Radius, severityColor, severityTint } from '../ui/tokens';
import Badge from '../ui/Badge';
import SeverityDot from '../ui/SeverityDot';

interface DmdForecastCardProps {
  forecast: {
    finding_id: string;
    anomaly_type: string;
    severity: string;
    pod: string;
    container: string;
    metric_label?: string;
    predicted_breach_seconds?: number;
    predicted_value_at_breach?: number;
    deviation: string;
    dominant_growth_rate_per_sec?: number;
    evidence?: string[];
    timestamp: string;
  };
}

export default function DmdForecastCard({ forecast }: DmdForecastCardProps) {
  const [expanded, setExpanded] = useState(false);
  const color = severityColor(forecast.severity);
  const tint = severityTint(forecast.severity);
  const timeAgo = formatTimeAgo(forecast.timestamp);

  const growthRate = forecast.dominant_growth_rate_per_sec !== undefined 
    ? (forecast.dominant_growth_rate_per_sec * 100).toFixed(3) + '%/s'
    : 'N/A';

  return (
    <Pressable
      onPress={() => setExpanded(!expanded)}
      style={({ pressed }) => [
        styles.card,
        { borderLeftColor: color },
        pressed && styles.pressed
      ]}
    >
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <SeverityDot severity={forecast.severity} size={8} pulse />
          <Text style={styles.title} numberOfLines={1}>
            DMD: {forecast.metric_label || 'Resource Breach'}
          </Text>
        </View>
        <Badge severity={forecast.severity} small />
      </View>

      <Text style={styles.deviation}>{forecast.deviation}</Text>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>Pod: {forecast.container || forecast.pod}</Text>
        <Text style={styles.metaText}>{timeAgo}</Text>
      </View>

      <View style={styles.forecastMetricContainer}>
        {forecast.predicted_breach_seconds !== undefined && (
          <View style={styles.metricBlock}>
            <Text style={styles.metricLabel}>BREACH IN</Text>
            <Text style={[styles.metricValue, { color: Colors.danger }]}>
              {formatSeconds(forecast.predicted_breach_seconds)}
            </Text>
          </View>
        )}
        <View style={styles.metricBlock}>
          <Text style={styles.metricLabel}>GROWTH RATE</Text>
          <Text style={[styles.metricValue, { color: Colors.warning }]}>
            {growthRate}
          </Text>
        </View>
      </View>

      {expanded && forecast.evidence && (
        <View style={styles.evidenceContainer}>
          <Text style={styles.evidenceTitle}>DMD EVIDENCE & DATA PATH</Text>
          {forecast.evidence.map((ev, idx) => (
            <Text key={idx} style={styles.evidenceLine}>• {ev}</Text>
          ))}
        </View>
      )}

      <Text style={styles.tapPrompt}>
        {expanded ? 'Tap to collapse details' : 'Tap to expand evidence & mathematical model'}
      </Text>
    </Pressable>
  );
}

function formatSeconds(s: number | undefined): string {
  if (s === undefined) return '—';
  if (s <= 0)   return 'now';
  if (s < 60)   return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatTimeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.borderCard,
    borderLeftWidth: 4,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  pressed: {
    backgroundColor: Colors.bgCardHover,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flex: 1,
  },
  title: {
    fontSize: Typography.sizes.base,
    fontWeight: Typography.weights.bold,
    color: Colors.textPrimary,
    letterSpacing: 0.2,
  },
  deviation: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    marginBottom: Spacing.sm,
    lineHeight: 18,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
  },
  metaText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: Typography.weights.medium,
  },
  forecastMetricContainer: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: Radius.sm,
    padding: Spacing.sm,
    gap: Spacing.lg,
    marginBottom: Spacing.sm,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.05)',
  },
  metricBlock: {
    flex: 1,
  },
  metricLabel: {
    fontSize: 8,
    fontWeight: Typography.weights.bold,
    color: Colors.textTertiary,
    letterSpacing: 1.1,
    marginBottom: 2,
  },
  metricValue: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
  },
  evidenceContainer: {
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.borderCard,
    gap: 4,
  },
  evidenceTitle: {
    fontSize: 9,
    fontWeight: Typography.weights.bold,
    color: Colors.textTertiary,
    letterSpacing: 1,
    marginBottom: 4,
  },
  evidenceLine: {
    fontSize: 11,
    color: Colors.textSecondary,
    lineHeight: 15,
  },
  tapPrompt: {
    fontSize: 9,
    color: Colors.textTertiary,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
});
