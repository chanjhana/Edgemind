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

# Severity
SEV_INFO = "info"
SEV_WARNING = "warning"
SEV_CRITICAL = "critical"

# Agent names
AGENT_CPU = "cpu"
AGENT_MEMORY = "memory"
AGENT_STORAGE = "storage"
AGENT_NETWORK_LOG = "network_log"

# Redis keys
REDIS_FINDINGS_KEY = "edgemind:findings"
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

# CPU thresholds
CPU_SPIKE_WARNING_Z = 3.0
CPU_SPIKE_CRITICAL_Z = 4.0
CPU_THROTTLE_RATIO = 0.20
CPU_THROTTLE_CYCLES = 3
CPU_ROLLING_WINDOW = 75
CPU_WARMUP_MIN = 20

# Memory thresholds
MEM_LEAK_SLOPE_MB_PER_MIN = 5.0
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
CPU_SUSTAINED_SPIKE_CYCLES = 2
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
LOG_ERROR_THRESHOLD = 3
LOG_TIMEOUT_THRESHOLD = 2
DEP_CONFIRM_LAG_S = 30

# Namespace filter
WATCHED_NAMESPACES = "pump-station|monitoring"

# Kubernetes critical event reasons
CRITICAL_K8S_EVENTS = {
    "OOMKilling": K8S_OOMKILL,
    "BackOff": CRASH_LOOP,
    "Evicted": "eviction",
    "FailedMount": "volume_mount_failure",
    "NodeNotReady": "node_pressure",
}
