export const FAULT_MODES = [
  {
    id: 'imbalance',
    label: 'Imbalance',
    description: 'Rotational imbalance — elevated radial + tangential vibration',
    defaultDuration: 120,
    sustained: false,
  },
  {
    id: 'seal_leak',
    label: 'Seal Leak',
    description: 'Mechanical seal degradation — gradual temperature rise',
    defaultDuration: 180,
    sustained: false,
  },
  {
    id: 'bearing_fault',
    label: 'Bearing Fault',
    description: 'Bearing degradation — elevated axial vibration, bearing health drop',
    defaultDuration: 120,
    sustained: false,
  },
  {
    id: 'cavitation',
    label: 'Cavitation',
    description: 'Fluid cavitation — broadband vibration spike, sustained',
    defaultDuration: null,
    sustained: true,
  },
  {
    id: 'flood',
    label: 'Flood Mode',
    description: 'Sensor emission rate 1 Hz → 10 Hz, triggering network load cascade',
    defaultDuration: null,
    sustained: true,
  },
  {
    id: 'overheat',
    label: 'Overheat',
    description: 'Thermal fault — temperature ramp above safe threshold',
    defaultDuration: 180,
    sustained: false,
  },
  {
    id: 'sensor_noise',
    label: 'Sensor Noise',
    description: 'Random noise injected across all readings',
    defaultDuration: 60,
    sustained: false,
  },
]

export const FAULT_MODE_IDS = FAULT_MODES.map(f => f.id)

export const FAULT_MODES_BY_ID = Object.fromEntries(FAULT_MODES.map(f => [f.id, f]))

// Demo scenarios: each step has an expected anomaly_type on an expected pod
export const SCENARIOS = [
  {
    id: 1,
    title: 'Network Flood Cascade',
    description: 'Sensor-sim-2 switches to 10 Hz flood mode, overloading the collector and historian',
    faultMode: 'flood',
    targetPump: 'pump2',
    targetSensor: 'sensor-sim-2',
    expectedAgents: ['cpu', 'network_log'],
    expectedDuration: '3–5 min',
    steps: [
      { id: 'inject',    label: 'Flood injected on sensor-sim-2',        anomalyType: null,            pod: null },
      { id: 'net_flood', label: 'network_flood detected on sensor-sim-2', anomalyType: 'network_flood', pod: 'sensor-sim-2' },
      { id: 'cpu_spike', label: 'cpu_spike on opc-ua-collector',          anomalyType: 'cpu_spike',     pod: 'opc-ua-collector' },
      { id: 'corr',      label: 'Correlated alert from orchestrator',      anomalyType: null,            pod: null, waitForAlert: true },
    ],
  },
  {
    id: 2,
    title: 'Memory Leak (Feature Extractor)',
    description: 'LEAK_MODE env flag causes feature-extractor RSS to grow steadily toward OOM',
    faultMode: null,
    targetPump: null,
    targetSensor: null,
    expectedAgents: ['memory'],
    expectedDuration: '5–10 min',
    steps: [
      { id: 'enable',   label: 'LEAK_MODE=true on feature-extractor',   anomalyType: null,           pod: null },
      { id: 'leak',     label: 'memory_leak detected',                   anomalyType: 'memory_leak',  pod: 'feature-extractor' },
      { id: 'pre_oom',  label: 'pre_oom ETA < 10 min',                   anomalyType: 'pre_oom',      pod: 'feature-extractor' },
      { id: 'corr',     label: 'Correlated alert from orchestrator',      anomalyType: null,           pod: null, waitForAlert: true },
    ],
  },
  {
    id: 3,
    title: 'PVC Fill (Export Data)',
    description: 'Alert-manager writes alerts continuously until PVC-2 reaches critical fill',
    faultMode: null,
    targetPump: null,
    targetSensor: null,
    expectedAgents: ['storage'],
    expectedDuration: '8–15 min',
    steps: [
      { id: 'pvc_fill',  label: 'pvc_fill detected on export-data PVC',  anomalyType: 'pvc_fill',     pod: 'pvc' },
      { id: 'write',     label: 'write_burst on alert-manager',           anomalyType: 'write_burst',  pod: 'alert-manager' },
      { id: 'corr',      label: 'Correlated alert from orchestrator',      anomalyType: null,           pod: null, waitForAlert: true },
    ],
  },
  {
    id: 4,
    title: 'Bearing Fault → Health Score Drop',
    description: 'Bearing fault on pump2 propagates through feature-extractor to health-scorer WARNING',
    faultMode: 'bearing_fault',
    targetPump: 'pump2',
    targetSensor: 'sensor-sim-2',
    expectedAgents: ['network_log'],
    expectedDuration: '2–4 min',
    steps: [
      { id: 'inject',    label: 'bearing_fault injected on sensor-sim-2', anomalyType: null,               pod: null },
      { id: 'health',    label: 'pump_health_critical detected',           anomalyType: 'pump_health_critical', pod: 'health-scorer' },
      { id: 'corr',      label: 'Correlated alert from orchestrator',       anomalyType: null,               pod: null, waitForAlert: true },
    ],
  },
  {
    id: 5,
    title: 'Full Multi-Agent Scenario',
    description: 'Combined flood + bearing fault triggers all 4 agents simultaneously',
    faultMode: 'flood',
    targetPump: 'pump2',
    targetSensor: 'sensor-sim-2',
    expectedAgents: ['cpu', 'memory', 'storage', 'network_log'],
    expectedDuration: '5–8 min',
    steps: [
      { id: 'inject',    label: 'Flood + bearing fault on pump2',          anomalyType: null,               pod: null },
      { id: 'net_flood', label: 'network_flood on sensor-sim-2',            anomalyType: 'network_flood',    pod: 'sensor-sim-2' },
      { id: 'cpu_spike', label: 'cpu_spike on opc-ua-collector',             anomalyType: 'cpu_spike',        pod: 'opc-ua-collector' },
      { id: 'health',    label: 'pump_health_critical on health-scorer',     anomalyType: 'pump_health_critical', pod: 'health-scorer' },
      { id: 'corr',      label: 'Multi-agent correlated alert',              anomalyType: null,               pod: null, waitForAlert: true },
    ],
  },
]
