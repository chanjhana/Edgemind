// Scenario step matching. Findings carry full pod names (alert-manager-db9f4fb8b-pj79k)
// while scenario steps use short deployment names (alert-manager) — so match by
// prefix. PVC findings use the literal pod "pvc", which matches exactly.

export function podMatches(findingPod, stepPod) {
  if (!findingPod || !stepPod) return false
  return findingPod === stepPod || findingPod.startsWith(stepPod + '-')
}

// True if a step is satisfied by the current findings / correlated alerts.
export function stepIsDone(step, { findings, correlatedAlerts, startCutoff = 0, startedAt = null }) {
  if (step.waitForAlert) {
    return correlatedAlerts.some(a => a.timestamp && new Date(a.timestamp).getTime() > startCutoff)
  }
  if (step.anomalyType && step.pod) {
    return findings.some(f =>
      f.anomaly_type === step.anomalyType &&
      podMatches(f.pod, step.pod) &&
      (!startedAt || new Date(f.timestamp).getTime() >= startCutoff)
    )
  }
  return false
}
