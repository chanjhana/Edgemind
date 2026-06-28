import os

# CPU anomaly types
CPU_SPIKE = "cpu_spike"
CPU_THROTTLE = "cpu_throttle"
CPU_CONTENTION = "cpu_contention"

# Memory anomaly types
MEMORY_LEAK = "memory_leak"
PRE_OOM = "pre_oom"
NODE_PRESSURE = "node_memory_pressure"
OOMKILL = "oomkill_detected"
MEMORY_STEP = "memory_step_change"

# Storage anomaly types
IO_SATURATION = "io_saturation"
WRITE_BURST = "write_burst"
PVC_FILL = "pvc_fill"
PVC_CONTENTION = "pvc_contention"
RESTART_IO = "restart_linked_to_io"

# Network + Log anomaly types
NETWORK_FLOOD = "network_flood"
PACKET_DROP = "packet_drop"
DEPENDENCY_CONFIRM = "dependency_confirmed"
K8S_OOMKILL = "k8s_oomkill"
CRASH_LOOP = "crash_loop"
LOG_ERROR_SURGE = "log_error_surge"
TIMEOUT_PATTERN = "timeout_pattern"
PUMP_HEALTH_CRIT = "pump_health_critical"

# DMD Early Warning anomaly types
DMD_CPU_FORECAST  = "dmd_cpu_forecast"
DMD_MEM_FORECAST  = "dmd_mem_forecast"
DMD_IO_FORECAST   = "dmd_io_forecast"
DMD_NET_FORECAST  = "dmd_net_forecast"
DMD_INSTABILITY   = "dmd_instability"

# Severity
SEV_INFO = "info"
SEV_WARNING = "warning"
SEV_CRITICAL = "critical"

# Agent names
AGENT_CPU = "cpu"
AGENT_MEMORY = "memory"
AGENT_STORAGE = "storage"
AGENT_NETWORK_LOG = "network_log"
AGENT_DMD = "dmd"

# Redis keys
REDIS_FINDINGS_KEY = "edgemind:findings"
REDIS_FINDINGS_RELAY_KEY = "edgemind:findings:relay"
REDIS_ALERTS_KEY = "edgemind:alerts"
REDIS_HEARTBEAT_KEY = "edgemind:heartbeat:{agent}"
FINDINGS_MAX_LEN = 500
ALERTS_MAX_LEN = 100

# Infrastructure URLs (inside k3s cluster)
PROMETHEUS_URL = "http://prometheus-operated.monitoring.svc.cluster.local:9090"
REDIS_URL = "redis://redis-svc.monitoring.svc.cluster.local:6379"

# Collector timing
COLLECT_INTERVAL_S = 15
STARTUP_OFFSET_S = 5
QUERY_TIMEOUT_S = 5

# CPU thresholds. z-score is kept only for severity grading — NOT as the spike
# gate. Measured rationale: near-idle services (alert-manager, health-scorer at
# <0.005 cores) have a tiny rolling std, so a trivial periodic bump yields a huge
# z-score → false cpu_spike (the recurring false positive). Conversely a real
# flood only pushes opc-ua-collector ~2x (0.011→0.0225 cores), which against its
# naturally noisy baseline (std ~0.005) gives z~1.4 — well below any z threshold.
# So z separates neither case correctly. The reliable discriminator is absolute:
# a pod must use meaningful CPU AND rise materially above its own baseline.
CPU_SPIKE_WARNING_Z = 3.0
CPU_SPIKE_CRITICAL_Z = 4.0
# Pod must currently use at least this many cores to be spike-eligible. Excludes
# the entire class of idle services (all <0.005 cores) that caused false spikes;
# opc-ua-collector floods to ~0.0225 cores, well above this.
CPU_SPIKE_MIN_ABS_CORES = 0.010
# Required rise above the rolling-window baseline (z-independent). Collector
# flood delta is ~0.007 (busy window) to ~0.012 (clean); idle bumps are <0.003.
CPU_SPIKE_MIN_DELTA_CORES = 0.005
CPU_THROTTLE_RATIO = 0.20
CPU_THROTTLE_CYCLES = 3
CPU_ROLLING_WINDOW = 75
CPU_WARMUP_MIN = 20

# Memory thresholds
MEM_LEAK_SLOPE_MB_PER_MIN = 0.5
MEM_LEAK_R2_MIN = 0.7
MEM_PRE_OOM_RATIO = 0.85
MEM_OOM_ETA_CRITICAL_MIN = 5
MEM_OOM_ETA_WARNING_MIN = 15
MEM_OOM_ETA_INFO_MIN = 30
MEM_NODE_WARN_RATIO = 0.15
MEM_NODE_CRIT_RATIO = 0.10
MEM_STEP_CHANGE_MB = 50.0
MEM_REGRESSION_WINDOW = 20
MEM_WARMUP_MIN = 20

# CPU detection tuning
# 3 cycles (45s). False-positive suppression now comes from the absolute gates
# (CPU_SPIKE_MIN_ABS_CORES + CPU_SPIKE_MIN_DELTA_CORES), so this only needs to
# reject brief transients while staying fast enough for the collector spike to
# join the flood-cascade correlation window. The collector holds elevated for
# minutes, so 3 is easily reached.
CPU_SUSTAINED_SPIKE_CYCLES = 3
CPU_RESTART_SUPPRESS_CYCLES = 3

# Memory detection tuning
MEM_OOM_WS_RATIO = 0.90

# Storage detection tuning
STORAGE_PVC_REFRESH_S = 300
STORAGE_SUSTAINED_BURST_CYCLES = 2

# Storage thresholds
STORAGE_IO_SAT_WARNING = 0.80
STORAGE_IO_SAT_CRITICAL = 0.95
STORAGE_WRITE_BURST_Z = 3.0
STORAGE_PVC_FILL_WARN = 0.70
STORAGE_PVC_FILL_CRIT = 0.85
STORAGE_TTF_WARN_HOURS = 8.0
STORAGE_TTF_CRIT_HOURS = 1.0
STORAGE_ROLL_WINDOW = 75
STORAGE_PVC_ROLL_WINDOW = 20
STORAGE_WARMUP_MIN = 20

# Network + Log thresholds
NET_FLOOD_MULTIPLIER = 2.0
NET_FLOOD_CYCLES = 2
NET_DROP_RATE_THRESHOLD = 0.001
NET_ROLL_WINDOW = 75
NET_WARMUP_MIN = 20
LOG_TAIL_INTERVAL_S = 60
LOG_TAIL_LINES = 50
LOG_ERROR_THRESHOLD = 10
LOG_TIMEOUT_THRESHOLD = 5
DEP_CONFIRM_LAG_S = 30

# Namespace filter
WATCHED_NAMESPACES = "pump-station"

# Kubernetes event type strings (used as anomaly_type values in findings)
K8S_EVICTION = "eviction"
K8S_FAILED_MOUNT = "volume_mount_failure"
K8S_NODE_NOT_READY = "node_pressure"

# Kubernetes critical event reasons
CRITICAL_K8S_EVENTS = {
    "OOMKilling":  K8S_OOMKILL,
    "BackOff":     CRASH_LOOP,
    "Evicted":     K8S_EVICTION,
    "FailedMount": K8S_FAILED_MOUNT,
    "NodeNotReady": K8S_NODE_NOT_READY,
}

# ── DMD tuning constants ──────────────────────────────────────────────────────
# Window and fit schedule
DMD_WINDOW              = 30      # rolling buffer size (snapshots)
DMD_WARMUP_MIN          = int(os.environ.get("DMD_WARMUP_MIN", 5))      # minimum snapshots before first DMD fit
DMD_FIT_INTERVAL        = 3       # fit every N collector cycles (45s at 15s/cycle)
DMD_FORECAST_STEPS      = int(os.environ.get("DMD_FORECAST_STEPS", 40))  # steps to forecast ahead (10 min at 15s/step)
DMD_N_MODES             = None    # None = keep all significant SVD modes

# Growth-rate threshold: σ > 0.001/s means amplitude doubles in < 12 minutes
DMD_GROWTH_RATE_THRESH  = 0.001   # 1/second

# Cooldown between same-metric warnings per pod (seconds)
DMD_WARNING_COOLDOWN_S  = 300

# Per-metric breach ratios (fraction of resource limit)
DMD_CPU_BREACH_RATIO    = 0.90    # 90% of cpu_limit_cores
DMD_MEM_BREACH_RATIO    = 0.85    # 85% of mem_limit_bytes
DMD_IO_BREACH_RATIO     = 0.80    # 80% I/O saturation
DMD_NET_FLOOD_FACTOR    = 3.0     # TX normalised against P75 × this factor
