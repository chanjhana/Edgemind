# EdgeMind — Final System Architecture (v2, Finals Prototype)
## Multi-Agent AI for Real-Time Pod Resource Discovery and Dependency Mapping
### Pump Station Condition Monitoring on ABB Edgenius (k3s)

---

> **About this version.** This is the finals build of EdgeMind. It supersedes v1
> (`EdgeMind_Final_System_Architecture.md`, preserved unchanged) by folding in the
> two finals design docs — *Our System* and *Data Synthesis*. The detection layer
> (4 domain agents + deterministic correlation filter + single Claude orchestrator)
> and the dashboard are architecturally identical to v1; what changed is the
> **monitored workload** and the **data path**:
>
> - The monitored assets are now **3 pumps** (centrifugal pumps), not motors.
> - The workload namespace is **`pump-station`** with a **9-pod pipeline**.
> - Sensors speak **real OPC-UA** via `asyncua` — not HTTP labelled as OPC-UA.
>   This resolves the v1 "fake OPC-UA" honesty problem: the protocol is now genuine.
> - The historian is **InfluxDB 2.x**, not SQLite. Its internal TSM compaction
>   produces real large sequential I/O, fixing the v1 large-file-I/O gap.
> - The pipeline gains a **health-scorer** and **alert-manager**, and **batch-sync**
>   now performs real Parquet bulk export (50 MB–1 GB), the genuine large-file-I/O event.
> - **Hard design rule:** Layer-0 pods expose **no custom Prometheus metrics**.
>   EdgeMind detects everything from standard kubelet / node-exporter / cAdvisor
>   infrastructure metrics only. The claim is "zero modification to existing software."

---

# 0. Design Principles

This architecture is shaped by four constraints: it must be genuinely agentic (not
threshold monitors wearing an AI label), it must be buildable by a small team in a
hackathon timeframe, it must produce a reliable live demo, and **it must detect
stress without instrumenting the workload it monitors**. Every decision below was
filtered through those constraints.

Key design choices:
- **4 domain agents + 1 AI orchestrator** — the agents are statistical specialists
  that run continuously. The orchestrator is a single Claude tool-use call that
  reasons over their combined output. Multi-agent analysis without the brittleness
  of multiple competing LLM loops.
- **Infra-level detection only** — Layer-0 pods (sensors, collector, historian,
  feature-extractor, health-scorer, alert-manager, batch-sync) run as they would in a
  real ABB Edgenius deployment. **No custom Prometheus metrics, no artificial
  instrumentation.** EdgeMind reads only CPU, memory, network, filesystem and PVC
  metrics that Prometheus scrapes automatically from the kubelet and node-exporter.
  This is the central claim: detection requires zero modification to existing software.
  *Exception, case-by-case:* an app-level metric is admissible only if a bottleneck is
  genuinely invisible without it AND that metric would realistically exist in a
  production system of that type. Any such exception is justified explicitly.
- **Real protocols** — sensors are OPC-UA servers (`asyncua`); the collector is an
  OPC-UA client. The historian is InfluxDB. An ABB judge recognises this stack.
- **Honest naming** — statistical detection is called statistical detection. AI
  reasoning is called AI reasoning. OPC-UA is actually OPC-UA. Nothing is mislabelled.
- **Indirect correlation is the point** — the demo's value is catching cross-service
  effects between pods that *never communicate* (e.g. `sensor-sim-2` → … → `alert-manager`).

---

# 1. Application Layer — Cluster and Workload

## 1.1 Cluster Stack

| Component | Technology | Why this choice |
|---|---|---|
| Cluster | k3s v1.29+ (ABB Edgenius-style edge node) | Single binary, ~512 MB RAM, matches real edge deployments. Ships with containerd, Flannel CNI, CoreDNS, local-path-provisioner, metrics-server. |
| Metrics | Prometheus (kube-prometheus-stack Helm chart) | ServiceMonitor CRDs, node-exporter, kube-state-metrics, cAdvisor via kubelet. One `helm install` gives the full infra-metrics pipeline. 15s scrape. |
| Historian | InfluxDB 2.x | Real industrial time-series DB. Internal TSM compaction produces genuine large sequential PVC I/O with no extra code. |
| Sensor protocol | OPC-UA via `asyncua` (Python ≥ 3.10) | Genuine industrial protocol. Sensors are OPC-UA servers; collector is an OPC-UA client using the subscription (push) model. |
| Bulk export | pandas + pyarrow (Parquet, snappy) | Industry-standard bulk time-series export format. Snappy compression is a real CPU load. |
| Package mgmt | Helm 3 | Whole stack deployable in a few `helm install` commands. |
| Storage | local-path-provisioner (k3s built-in) | Provisions PVCs from node disk. ReadWriteOnce — sufficient for single-node. |

**Cluster resource budget:** a single node with 4 CPU cores and 8 GB RAM. Runs on a
modern laptop, a cloud VM, or an edge gateway.

## 1.2 Namespace Structure

Three namespaces.

| Namespace | What lives here |
|---|---|
| `pump-station` | The industrial workload — all pump pipeline pods (the thing being monitored). |
| `monitoring` | Prometheus stack + EdgeMind (agents, correlation filter, orchestrator, API, dashboard). |
| `kube-system` | k3s internals (coredns, kube-proxy, metrics-server, local-path-provisioner). Untouched, monitored, not a stress target. |

Three namespaces are enough to demonstrate cross-namespace correlation without the
deployment overhead of more (no ResourceQuotas/NetworkPolicies on a single node).

## 1.3 Workload — `pump-station` (9 pods)

A simplified-but-realistic pump-station condition-monitoring pipeline: 3 pumps fitted
with ABB Smart Sensors emit telemetry over OPC-UA; a collector normalises and stores
it; features and health scores are computed on the edge; alerts and bulk exports flow
downstream. **Every pod produces a distinct, observable infra-resource signature, and
none of them expose custom metrics.**

| Pod | What it does | Resource signature (infra metrics only) |
|---|---|---|
| `sensor-sim-1` | OPC-UA server simulating the Smart Sensor on **Pump 1** (primary transfer pump). Emits 5 raw parameters at 1 Hz. | Steady low CPU, steady low network egress. Burst/flood mode → 10× rate. |
| `sensor-sim-2` | Same for **Pump 2** (secondary transfer pump). **Primary fault-injection target.** | Same; flood mode is the main network/CPU cascade trigger. |
| `sensor-sim-3` | Same for **Pump 3** (chemical dosing pump). Lower RPM/vibration baseline. | Same, lower magnitudes. |
| `opc-ua-collector` | `asyncua` **client** subscribing to all 3 OPC-UA servers (push). Validates quality + physical bounds, aligns timestamps, batches every 500 ms, flushes to InfluxDB. Single consumer for all 3 sensors. | CPU moderate during normalisation; network ingress from sensors. **Bottleneck** under flood (single process for 3 sensors). |
| `data-historian` | **InfluxDB 2.x** on PVC-1. Bucket `pump_station`, 7-day retention. Stores telemetry + features + health. Serves Flux/InfluxQL to readers. | PVC write-heavy; CPU spikes during TSM compaction; read contention under concurrent bulk+streaming reads. |
| `feature-extractor` | Custom Python. Every 30 s, queries last 5 min of telemetry per pump, computes derived features, writes them back to InfluxDB (`pump_features`). Has `LEAK_MODE`. | Bursty CPU (computation window); memory grows in leak mode; InfluxDB reads. |
| `health-scorer` | Custom Python. Every 30 s, reads latest `pump_features`, scores each pump, writes `pump_health`, triggers `alert-manager` (alerts) and `batch-sync` (export) on threshold crossings. | Low steady CPU; small InfluxDB reads; small network spike when triggering batch-sync. |
| `alert-manager` | Custom Python. Receives alert POSTs from health-scorer, enriches (description/severity/recommendation), dedups, appends JSONL to PVC-2, exposes a REST API for the dashboard. Always running. | Low normally; CPU + PVC-2 write burst when a flood of alerts arrives. |
| `batch-sync` | Custom Python. **The large-file-I/O pod.** Scheduled (every 5 min) and fault-triggered exports: bulk InfluxDB read → pandas → Parquet (snappy) → PVC-2 → simulated upload (HTTP POST to mock endpoint). | Heavy PVC-2 sequential writes + bulk InfluxDB reads + CPU spike (serialisation) + network egress burst. |

> **Why purpose-built pods, not a generic demo app?** The problem statement requires
> PVC stress, large file I/O, bursty workloads and an industrial/edge context. A
> generic e-commerce app produces none of those. These 9 pods generate exactly the
> required resource signatures while each remaining a small Python service. Crucially,
> they generate those signatures **organically** — InfluxDB compaction, Parquet
> serialisation, OPC-UA flood parsing — not via fake metrics.

### 1.3.1 Sensor Simulation — the Data Synthesis layer

Sensors emit **only raw physical measurements** (no derived scores — bearing health is
computed downstream by feature-extractor, consistent with Edgenius architecture).

**Parameters emitted per pump (5 + timestamp):**

| Parameter | Unit | Physical meaning |
|---|---|---|
| Vibration radial | mm/s RMS | Side-to-side shaft movement |
| Vibration tangential | mm/s RMS | Rotational-direction movement |
| Vibration axial | mm/s RMS | Along shaft axis — primary bearing-wear indicator |
| Skin temperature | °C | Motor casing heat |
| RPM | rev/min | Shaft speed |

**Per-pump baseline ranges (normal operation) — agents must hold per-pod baselines, not global thresholds:**

| Parameter | Pump 1 (Primary, 75 kW, 1450 RPM) | Pump 2 (Secondary, 45 kW, 1450 RPM) | Pump 3 (Dosing, 7.5 kW, 960 RPM, 6-pole) |
|---|---|---|---|
| Vibration radial (mm/s RMS) | 1.8 – 2.3 | 1.4 – 1.9 | 0.8 – 1.2 |
| Vibration tangential (mm/s RMS) | 1.5 – 2.0 | 1.2 – 1.6 | 0.6 – 1.0 |
| Vibration axial (mm/s RMS) | 0.8 – 1.2 | 0.6 – 1.0 | 0.3 – 0.6 |
| Temperature (°C) | 48 – 55 | 43 – 50 | 38 – 45 |
| RPM | 1448 – 1455 | 1449 – 1456 | 958 – 963 |

**Gaussian noise:** vibration ±0.15 mm/s, temperature ±0.5 °C, RPM ±2.

**Fault modes (per pump):**

| Fault | Pump | Parameters that change | Pattern |
|---|---|---|---|
| `imbalance` | Pump 1 | Radial + tangential rise together, temp rises | Gradual linear drift, 4 min |
| `seal_leak` | Pump 1 | Temp rises sharply, axial moderate rise, RPM slight drop | Gradual linear drift, 6 min |
| `bearing_fault` | Pump 2 | Axial vibration rises | Gradual linear drift, 5 min |
| `cavitation` | Pump 2 | Radial + tangential sudden spike, RPM drop, temp rise | Immediate step change, sustained |
| `flood` | Pump 2 | All parameters at 10× emission **rate**, values unchanged | Rate change only |
| `overheat` | Pump 3 | Temp rises, RPM slight drop, radial slight rise | Gradual linear drift, 5 min |
| `sensor_noise` | Any | Random spikes on all parameters | Occasional outliers |
| `combined_cascade` | Pump 2 + Pump 3 | flood + overheat simultaneously | Both active |
| `combined_primary_failure` | Pump 1 + Pump 2 | imbalance + bearing_fault simultaneously | Both active |

**Fault values (start → end):**

- **`imbalance` (Pump 1, 4 min linear):** radial 2.0 → 5.8; tangential 1.7 → 5.1; temp 52 → 61 °C; RPM unchanged. *(Radial+tangential rising equally distinguishes imbalance from axial-dominant bearing fault.)*
- **`seal_leak` (Pump 1, 6 min linear):** temp 51 → 74 °C; axial 1.0 → 2.6; RPM 1451 → 1443; radial/tangential unchanged.
- **`bearing_fault` (Pump 2, 5 min linear):** axial 0.8 → 4.8 (Zone B → Zone D); everything else unchanged.
- **`cavitation` (Pump 2, step):** radial+tangential 1.6 → 5.2; RPM 1452 → 1438; temp 47 → 53 °C.
- **`flood` (Pump 2, rate only):** all 5 params at 10 Hz (vs 1 Hz); values stay in normal range.
- **`overheat` (Pump 3, 5 min linear):** temp 42 → 79 °C; RPM 960 → 951; radial 1.0 → 1.7.

**ISO 10816-3 vibration zones (used for severity framing and the bearing-health score):**

| Zone | Range | Status |
|---|---|---|
| A | ≤ 1.4 mm/s | Newly commissioned, excellent |
| B | 1.4 – 2.8 mm/s | Acceptable, long-term operation |
| C | 2.8 – 4.5 mm/s | Investigate, restricted operation |
| D | > 4.5 mm/s | Damage occurring, take out of service |

Temperature: normal 40–60 °C, warning 60–75 °C, critical > 75 °C.

**Data-generator requirements:** (1) per-pump hardcoded baselines; (2) HTTP injection
endpoint on each sensor-sim accepting `{mode, duration?}`; (3) gradual (linear drift)
vs step faults; (4) independent injection per pod for combined scenarios.

**OPC-UA address space** (each sensor-sim hosts its pump's subtree; 5 raw nodes + timestamp):

```
Objects/
  PumpStation/
    Pump1/  VibrationRadial  VibrationTangential  VibrationAxial  Temperature  RPM  Timestamp
    Pump2/  (same nodes)
    Pump3/  (same nodes)
```

**Emission frequency:** normal 1 reading/s/pump; flood 10 readings/s/pump.

### 1.3.2 Edge computation — feature-extractor

Every 30 s, per pump, query last 5 min of `pump_telemetry` and compute:

| Feature | Input | Method | Meaning |
|---|---|---|---|
| Vibration RMS trend | axial/radial/tangential over 5 min | Linear-regression slope | Is vibration growing? |
| Axial dominance ratio | axial / (radial + tangential) | Ratio | Bearing faults are axial-dominant |
| Temperature rate of change | temp over 5 min | Linear-regression slope | Is the motor heating? |
| RPM stability | RPM over 5 min | Std deviation | Unstable RPM ⇒ hydraulic issue |
| Bearing health score | axial + temp + RPM stability | Weighted formula ↓ | Edgenius-style edge health score |

**Bearing-health formula (transparent, defensible):**
```
vibration_penalty = clip((axial - axial_baseline) / axial_baseline, 0, 1) * 40
temp_penalty      = clip((temp - 60) / 20, 0, 1) * 30
rpm_penalty       = clip(rpm_std / 10, 0, 1) * 30
bearing_health    = 100 - vibration_penalty - temp_penalty - rpm_penalty
```
Weights 40/30/30: vibration is primary, temperature and RPM-stability secondary.

**Write-back:** measurement `pump_features`, tag `pump_id`, fields
`vibration_rms_trend, axial_dominance_ratio, temp_rate_of_change, rpm_stability, bearing_health`.

**Why 30 s:** 5-min window at 1 Hz = 300 points (good for regression); fresh features
every 30 s. Under flood (10 Hz) the same window holds 3000 points → numpy work scales
up → real, proportional CPU spike. The timing fits the 45 s correlation window: flood at
T+0 → collector CPU spike → slower extractor cycle at T+30 → stale features at T+30–60.

**Leak mode (`LEAK_MODE=true`):** each cycle appends a numpy buffer to a module-level
list without releasing. RSS grows ~15–20 MB/min; OOMKill occurs naturally at the limit.
Memory agent detects the slope and forecasts OOM.

### 1.3.3 Decision layer — health-scorer

Every 30 s, read the **latest** `pump_features` per pump (not a window). Produce three
scores: vibration score (trend + axial dominance), thermal score (temp rate), overall
health (passthrough of bearing_health). Classify:
```
bearing_health >= 75      → HEALTHY
50 <= bearing_health < 75 → WARNING
bearing_health < 50       → CRITICAL
```
**Downstream actions:** WARNING for 2 consecutive cycles → alert; CRITICAL → alert
immediately; crossing WARNING → trigger batch-sync export; CRITICAL on Pump 1 →
trigger batch-sync immediately. Write `pump_health` (scores, state,
`consecutive_warning_cycles`).

**Stale-data handling:** if latest `pump_features` is older than 90 s (3 missed extractor
cycles), flag the pump `DATA_STALE` and raise a WARNING — stale data in a pump station is
itself an operational problem. **`DATA_STALE` is a distinct trigger type from
`bearing_fault`**, so the two do not dedup against each other (this is what produces the
dual alert stream under flood).

**Decoupling rationale:** health-scorer reads InfluxDB, not feature-extractor directly,
so it degrades gracefully on stale data — and this is exactly what creates the
hard-to-see correlation: extractor delayed by historian contention → scorer silently
works on stale data → looks healthy from outside.

### 1.3.4 alert-manager

Receives health-scorer POSTs (`{pump_id, state, overall_health, vibration_score,
thermal_score, trigger, timestamp}`), enriches with a human-readable description +
severity + one-sentence recommendation (hardcoded templates per trigger type — **LLM
reasoning lives in EdgeMind's orchestrator, not here**), and:

1. Appends JSONL to PVC-2: `/alerts/YYYY-MM-DD/pump_station_alerts.jsonl` (one object/line).
2. Exposes REST for the dashboard: `GET /alerts`, `GET /alerts?pump=pump2`,
   `GET /alerts/active`, `GET /health`. Dashboard polls every 15 s for the application
   alert feed.
3. **Dedup:** same pump in WARNING for 10 consecutive cycles → one alert, not 10;
   resets on state change. **Deliberate gap:** `DATA_STALE` ≠ `BEARING_FAULT`, so during
   a combined flood the scorer emits two distinct alert streams → the burst that stresses
   alert-manager's write path. Concurrent PVC-2 writes (alerts) alongside batch-sync
   Parquet writes create storage contention visible to the storage agent.

### 1.3.5 batch-sync — the large-file-I/O event

| Trigger | Condition | Exports |
|---|---|---|
| Scheduled | every 5 min | last 5 min `pump_telemetry`, all pumps → ~500 KB–1 MB Parquet |
| Fault-triggered | health-scorer POST on WARNING/CRITICAL | last 30 min `pump_telemetry`+`pump_features`+`pump_health` for the affected pump → ~50–100 MB (1 Hz), **500 MB–1 GB at 10 Hz flood** |

Flow: bulk InfluxDB read → pandas DataFrame → Parquet (snappy) → PVC-2
(`/exports/scheduled/…` or `/exports/fault/…`) → simulated upload (multipart POST to a
mock endpoint). **Retention:** scheduled exports 24 h then deleted; **fault exports
permanent** — so repeated fault injections during a demo measurably fill PVC-2, which is
exactly the PVC-stress / time-to-full forecasting scenario. Snappy compression is a real
CPU spike; concurrent bulk reads degrade InfluxDB TSM read performance for the extractor.

## 1.4 Persistent Volumes

| PVC | Mounted by | Access | Size | Purpose |
|---|---|---|---|---|
| PVC-1 `historian-data` | data-historian (RW); feature-extractor & batch-sync via InfluxDB **HTTP API**, not direct mount | ReadWriteOnce | 2 Gi | InfluxDB TSM store. Primary storage stress target. |
| PVC-2 `export-data` | batch-sync (RW), alert-manager (RW) | ReadWriteOnce | 5 Gi | Parquet exports + alert JSONL. Large-file-I/O target; fill-rate forecast target. |
| PVC-3 `prometheus-tsdb` | prometheus | ReadWriteOnce | 2 Gi | Prometheus TSDB. EdgeMind reads via HTTP API, never touches this PVC. |

**Precision for judges:** feature-extractor and batch-sync do **not** mount PVC-1 — they
read InfluxDB over HTTP. Contention is therefore at the **InfluxDB application layer**
(concurrent query handling, TSM read/write competition), observable via
`container_fs_reads_bytes_total`, `container_fs_writes_bytes_total`, and
`kubelet_volume_stats_used_bytes` — application-level contention surfaced through
infra metrics, not OS-level shared-mount contention. PVC-2 contention is real OS-level
concurrent writes (alert-manager + batch-sync share the mount).

## 1.5 Service Topology and Dependency Graph

```
sensor-sim-1 ─┐
sensor-sim-2 ─┼─→ opc-ua-collector ─→ data-historian ─→ feature-extractor ─→ health-scorer ─→ alert-manager
sensor-sim-3 ─┘                                     └─→ batch-sync ─→ PVC-2
```
(health-scorer also issues a lightweight HTTP trigger to batch-sync on fault.)

**Auto-discovery:** on startup and every 5 min, EdgeMind queries the Kubernetes API for
Service and Endpoints objects across all namespaces and builds a directed graph
(networkx DiGraph): nodes = pods, edges = service connections. If a pod goes down its
edge disappears; if batch-sync starts hitting a new endpoint it appears. Supplemented
with shared-data edges (pods reading the same InfluxDB / writing the same PVC-2).

**Captures:** service-level dependencies, shared-data access. **Does not capture:**
DNS-only discovery, init-container deps, ConfigMap/Secret sharing, sidecars. Honest
limitation: topology from K8s API objects, not eBPF traffic inference. Sufficient for
the demo; eBPF would be the production upgrade.

## 1.6 Stress Scenarios (with the indirect correlations they prove)

Each scenario is driven **organically** by the workload — no fake metrics — and each
proves a cross-service correlation between pods that do not talk to each other.

**Scenario 1 — Sensor flood cascade** *(bursty + network + CPU + dependency)*
`sensor-sim-2` → 10× rate → `opc-ua-collector` CPU spikes parsing the flood → historian
write rate spikes → feature-extractor reads slow (historian under write pressure) →
health-scorer gets stale features → `alert-manager` receives a DATA_STALE burst.
**IC:** sensor-sim-2 and alert-manager never communicate; alert-manager latency is
causally downstream of the sensor (4 hops). Detection window ~30–45 s.

**Scenario 2 — feature-extractor memory leak** *(memory + sudden anomaly + dependency)*
`LEAK_MODE` → RSS grows linearly → approaches limit → extractor responses slow →
health-scorer latency rises while its own CPU/memory look normal.
**IC:** health-scorer looks degraded; extractor looks fine on CPU; root cause is memory,
invisible without the memory agent. Eventually OOMKill (Memory + Log/Net agent via K8s event).

**Scenario 3 — batch-sync PVC/historian contention** *(large file I/O + PVC stress + bottleneck)*
batch-sync bulk export reads large volume from InfluxDB while feature-extractor's regular
reads run → historian read contention → extractor stalls → health-scorer scoring falls
behind. **IC:** batch-sync and feature-extractor never communicate; batch-sync's read
burst degrades health-scorer output quality. Recurs on the 5-min schedule (purely structural).

**Scenario 4 — InfluxDB TSM compaction** *(PVC stress + CPU + bursty)*
InfluxDB triggers internal compaction → large sequential PVC-1 reads/writes → historian
response latency spikes for **all** readers at once → feature-extractor AND batch-sync
slow simultaneously → looks like a network problem or an extractor bug.
**IC:** two pods degrade together with no apparent link; root cause is inside the
historian — only visible via the storage agent tracking `container_fs_io_time` approaching 1.0.

**Scenario 5 — Combined pressure (demo finale)** *(everything at once)*
Sensor flood while batch-sync fires its bulk export → historian under max write pressure
(flood) AND max read pressure (export) → all downstream pods degrade together → all 4
agents fire within the 45 s window. Tests whether the orchestrator can say **"two
independent root causes converging, not one cascade"** — the hardest reasoning case and
the most impressive moment.

---

# 2. Multi-Agent Detection Layer

*(Architecturally identical to v1; pod targets and one storage metric updated.)*

## 2.1 Architecture: 4 Domain Agents + 1 AI Orchestrator

```
                    Prometheus (15s scrape, infra metrics only)
                                   │
        ┌──────────────┬───────────┴───────────┬──────────────┐
        ▼              ▼                       ▼              ▼
   ┌──────────────────────────────────────────────────────────────┐
   │              4 DOMAIN AGENTS (statistical, no LLM)            │
   │   CPU        Memory        Storage        Network + Log       │
   └───────┬────────────┬──────────────┬───────────────┬──────────┘
           │ Finding     │ Finding      │ Finding        │ Finding
           ▼             ▼              ▼                ▼
   ┌──────────────────────────────────────────────────────────────┐
   │         CORRELATION FILTER (deterministic)                    │
   │  Groups findings by 45s window. 2+ agents = trigger;          │
   │  single critical finding = also trigger.                      │
   └───────────────────────────┬──────────────────────────────────┘
                               │ CorrelatedSignalBundle
                               ▼
   ┌──────────────────────────────────────────────────────────────┐
   │         AI ORCHESTRATOR (Claude, 1 call, 2–4 turns)           │
   │  In: findings + dependency graph + pod metadata + log tails   │
   │  Tools: query_prometheus, get_pod_logs, get_kubernetes_events │
   │  Out: root cause, causal chain, confidence, NLP insight, rec  │
   └───────────────────────────┬──────────────────────────────────┘
                               │ CorrelatedAlert + NLPInsight
                               ▼
                       FastAPI WebSocket → Dashboard
```

The 4 domain agents are genuine specialists running continuously at zero LLM cost. The
orchestrator is the single reasoning call — it decides whether to pull extra context,
distinguishes causal cascades from coincidental timing, and emits a confidence score with
defined semantics. 1–3 API calls per event, not 15–20.

## 2.2 Technology Stack

Python 3.11 asyncio; httpx (async Prometheus client); numpy + scipy.stats (zscore,
linregress); kubernetes-client (in-cluster config, Watch API); networkx (DiGraph);
anthropic SDK → `claude-sonnet-4` (orchestrator, graceful degradation if unavailable);
asyncio.Queue (agent → filter); FastAPI + uvicorn (REST + WebSocket).
edgemind-core budget: 500m CPU, 384 MB RAM.

## 2.3 Metrics Collection Strategy

One collector coroutine runs ~13 **batch** PromQL queries every 15 s (each returns data
for all pods), parses to a per-pod snapshot, distributes to all 4 agents in-process —
~75% less Prometheus load than per-agent/per-pod queries, and avoids the observer effect.

```
cpu_usage      rate(container_cpu_usage_seconds_total{container!="POD",container!=""}[1m])
cpu_throttle   rate(container_cpu_cfs_throttled_seconds_total{container!=""}[1m])
cpu_limits     kube_pod_container_resource_limits{resource="cpu"}
mem_working_set container_memory_working_set_bytes{container!="POD",container!=""}
mem_rss        container_memory_rss{container!="POD",container!=""}
mem_limits     kube_pod_container_resource_limits{resource="memory"}
pvc_used       kubelet_volume_stats_used_bytes
pvc_capacity   kubelet_volume_stats_capacity_bytes
fs_writes      rate(container_fs_writes_bytes_total{container!=""}[1m])
fs_reads       rate(container_fs_reads_bytes_total{container!=""}[1m])
fs_io_time     rate(container_fs_io_time_seconds_total{container!=""}[1m])   # ← Scenario 4 (compaction)
net_tx         rate(container_network_transmit_bytes_total[1m])
net_rx         rate(container_network_receive_bytes_total[1m])
net_drops      rate(container_network_receive_packets_dropped_total[1m])
```

## 2.4 The 4 Domain Agents

**CPU agent** — per-pod CPU rate Z-score (75-pt window, warn z>3, crit z>4), CFS throttle
ratio (>20% for 3+ cycles), usage-to-limit. Targets: `opc-ua-collector` (flood parsing),
`feature-extractor` (computation bursts), `batch-sync` (Parquet serialisation).

**Memory agent** — working-set trend (linregress over 20-pt window; slope + r>0.7 →
leak), usage-to-limit pre-OOM at 85%, RSS step-change for cold starts, time-to-OOM
forecast. Targets: `feature-extractor` (leak mode), any pod after restart.

**Storage agent** — PVC fill % and fill-rate (linregress → time-to-full; PVC-2 from fault
exports), fs write/read IOPS anomalies, and **`fs_io_time` approaching 1.0** (saturated
disk during InfluxDB compaction — Scenario 4). Targets: PVC-1 (historian writes/compaction),
PVC-2 (export fill rate), data-historian.

**Network + Log agent** — per-pod TX/RX flood detection (>2× baseline for 2+ cycles),
packet-drop threshold, **K8s events** via Watch API (OOMKilled, CrashLoopBackOff, Evicted,
FailedMount), and **pod log tails** (every 30 s, last 20 lines, ERROR/WARN/Exception/
Traceback). Covers the "Log/IO" requirement. Targets: sensor flood egress, batch-sync
upload egress, OOMKill events on feature-extractor.

**Finding object** (emitted by all agents) carries `agent, pod, namespace, anomaly_type,
metric, current_value, baseline_value, deviation, severity, evidence[], timestamp`. Every
finding includes its evidence chain — the orchestrator reasons over evidence, not labels.

## 2.5 Correlation Filter (deterministic, no LLM)

Buffers findings; keeps those within a 45 s window. Trigger when ≥2 distinct agents have
findings in-window (multi-agent correlation) OR a single critical finding occurs. Emits a
`CorrelatedSignalBundle`. **Why 45 s:** a cascade through 3–4 pods at 15 s scrape takes
2–3 cycles (30–45 s) to become fully visible; 45 s captures most cascades without grouping
unrelated events. Stated as a tunable parameter, not a constant.

## 2.6 AI Orchestrator

Single Claude tool-use call (2–4 turns max, hard cap) receiving all findings + dependency
graph + pod metadata + recent alert history. Three tools: `query_prometheus`,
`get_pod_logs`, `get_kubernetes_events` (used sparingly — typically 0–2 calls). Produces
JSON: `root_cause_pod, root_cause_metric, causal_chain[], alert_type
(cascade|contention|lifecycle|coincidental), severity, confidence, nlp_summary
(operator-language, pump terms), recommendation, business_impact, reasoning`.

**Confidence semantics:** 0.9+ multiple agents agree + temporal ordering matches topology;
0.7–0.9 two agents, plausible chain with gaps; 0.5–0.7 single agent / ambiguous; <0.5
insufficient evidence ("needs investigation").

**Orchestrator topology block (system prompt):**
```
sensor-sim-1/2/3 → opc-ua-collector → data-historian → feature-extractor → health-scorer → alert-manager
                                      data-historian → batch-sync → PVC-2 (export-data)
PVC-1 historian-data (InfluxDB; read via API by feature-extractor & batch-sync)
PVC-2 export-data (written by batch-sync and alert-manager)
PVC-3 prometheus-tsdb
```

**Graceful degradation:** if Claude is unavailable/slow (>5 s), agents + correlation still
run (zero LLM); a fallback template emits a basic alert; the dashboard never goes blank.

**Cost/latency:** 1–3 API calls, ~4–5K tokens, ~3–6 s per event; ~$0.005–0.01/event;
a 10-event demo < $0.10.

## 2.7 Why this is defensibly "Multi-Agent AI"

(1) 4 genuine domain specialists with independent rolling state + domain logic.
(2) A genuinely agentic orchestrator that chooses what to investigate and distinguishes
causation from coincidence. (3) Clean separation — agents detect, orchestrator interprets
— mirroring real incident response. We do **not** claim the agents negotiate; it's a
hub-and-spoke pattern, stated honestly.

---

# 3. Dashboard Layer

*(Same 4-panel React/Vite design as v1; pod names updated. EdgeMind's panels are
infra-domain; the pump-station's own `alert-manager` REST API is the application-domain
alert feed the dashboard can also surface — the two are distinct, and the contrast
between application alerts and EdgeMind's infra-level correlation is part of the story.)*

**Stack:** React 18 (useReducer + Context), Vite 5, Recharts (line/area), D3 force
simulation (graph only), native WebSocket (auto-reconnect), Tailwind 3, lightweight static
server pod.

**Panels (fixed viewport, no scrolling):**
- **Panel 1 — Overview + Live Metrics:** 3 namespace cards (health by worst finding) +
  tabbed charts (CPU / Memory / Storage / Network), one line per pod, 300-pt rolling
  window, anomaly ReferenceLines. Source: `metric_update` every 15 s.
- **Panel 2 — Dependency Graph (D3 force):** nodes = pods (size ∝ CPU rate, border pulses
  on anomaly), edges = service links (green/amber/red), dashed = shared-data. Simulation
  runs only on structural change, not on every metric tick (no jank). Source:
  `GET /api/graph` + `pod_event`.
- **Panel 3 — Anomaly Timeline:** one row per namespace, events as colored blocks,
  correlation brackets from the orchestrator (alert type + confidence), click → analysis
  popover. Source: `correlated_alert` (+ single-agent `agent_finding` markers).
- **Panel 4 — AI Analysis Feed:** orchestrator cards (severity, confidence, NLP summary,
  causal chain, recommendation, business impact) + forecast widgets (PVC-2 time-to-full,
  memory growth → projected OOM). "System nominal" card when empty. Source:
  `correlated_alert`, `nlp_insight`, `forecast_update` (every 5 min).

**WebSocket events:** `metric_update` (15 s), `agent_finding` (on detection),
`correlated_alert` (orchestrator), `pod_event` (K8s watch), `forecast_update` (5 min).

---

# 4. Deployment and Demo

## 4.1 Deployment (Helm)

```bash
# 1. k3s
curl -sfL https://get.k3s.io | sh -

# 2. Prometheus stack
helm install monitoring prometheus-community/kube-prometheus-stack \
  --namespace monitoring --create-namespace \
  --set prometheus.prometheusSpec.scrapeInterval=15s \
  --set prometheus.prometheusSpec.retention=7d \
  --set grafana.enabled=false

# 3. EdgeMind (pump-station workload + InfluxDB + agents + dashboard)
helm install edgemind ./charts/edgemind \
  --namespace monitoring \
  --set apiKey=$ANTHROPIC_API_KEY
```
The EdgeMind chart deploys the `pump-station` namespace (9 workload pods incl. InfluxDB +
the mock-upload service), `edgemind-core`, `edgemind-dashboard`, all Services, the 3 PVCs,
and RBAC (read-only ClusterRole for metrics + pod/service info + events).

## 4.2 Demo Walkthrough (~3 min)

1. **Boot** — pods online, 3 namespace cards green, graph populated. *"EdgeMind monitoring
   a live pump station on k3s. The graph is auto-discovered from the Kubernetes API."*
2. **Explain the graph** — click `health-scorer`, show upstream (feature-extractor),
   downstream (alert-manager). *"No manual config. It traces root cause upstream on this graph."*
3. **Inject** — `kubectl exec -n pump-station deploy/sensor-sim-2 -- curl -X POST
   localhost:8080/inject -d '{"mode":"bearing_fault"}'` (or `flood`). *"Simulating a bearing
   fault on Pump 2."*
4. **Watch the cascade** — Network tab (sensor-sim-2 spike) → CPU tab (collector, then
   feature-extractor rise) → Storage tab (historian write rate; PVC-2 fill on export).
   *"One pump fault, four pods, three resource domains."*
5. **AI analysis** — Panel 3 bracket spans namespaces; Panel 4 card names
   `sensor-sim-2 (Pump 2)` as root cause, traces the chain, gives an operator-language
   recommendation. Read it aloud.
6. **Forecasts** — PVC-2 time-to-full (fault exports accumulating) and/or memory→OOM.
   *"Without EdgeMind you'd find out when the historian stops writing and pump alerts go silent."*
7. **Close** — *"Seconds from pump fault to explained alert. Four agents detected the
   symptoms; one AI orchestrator traced the root cause through the dependency graph. It
   watches the infrastructure running your industrial apps — with zero modification to that software."*

## 4.3 Build Priority (high level)

- **Foundation:** k3s + Prometheus + InfluxDB up; 3 sensor-sim OPC-UA servers emitting;
  opc-ua-collector writing to InfluxDB; injection endpoint working.
- **Pipeline:** feature-extractor + health-scorer + alert-manager + batch-sync; full data
  path telemetry → features → health → alerts/exports.
- **EdgeMind:** collector + 4 agents + correlation filter + orchestrator + WebSocket.
- **Dashboard + polish:** 4 panels, graceful degradation, scenario rehearsal, backup video,
  Helm packaging.

**Minimum viable demo:** real-time metrics + 4 agents + findings on the dashboard, with the
orchestrator shown via a curl'd API response if the UI panel isn't finished. Still fully demoable.

---

# 5. Requirement Coverage

| Requirement | How satisfied | Component |
|---|---|---|
| Container-based automation | Pump-station condition-monitoring pipeline on k3s | 9-pod workload |
| Container orchestration | k3s single-node | Layer 1 |
| Real-time resource discovery (CPU/RAM/disk/PVC/network) | 13 batch PromQL queries, infra metrics only, 15 s | Collector |
| Multi-agent AI across CPU/Memory/Storage/PVC/Log-IO | 4 independent domain agents | Layer 2 |
| Interdependency mapping | networkx DiGraph from K8s Service/Endpoints + shared-data, auto-discovered | Orchestrator + Panel 2 |
| Intelligent recommendations | Orchestrator per-event, operator language | Claude orchestrator |
| Alerts | Per-agent findings + orchestrator correlated alerts (EdgeMind, infra) and pump-station's own alert-manager (application) | Agents + Orchestrator + alert-manager |
| Forecasting | Storage agent PVC-2 time-to-full; Memory agent OOM projection | Storage + Memory agents |
| Dashboard (graphs/correlations/timelines/NLP) | 4-panel React via WebSocket | Layer 3 |
| Bursty workloads | sensor flood (10×), batch-sync export bursts, feature-extractor computation | Scenarios 1, 3, 5 |
| Large file I/O | batch-sync Parquet export (50 MB–1 GB) + InfluxDB TSM compaction | Scenarios 3, 4 |
| PVC storage stress | PVC-2 fill from permanent fault exports; PVC-1 compaction I/O; `fs_io_time` | Scenarios 3, 4 |
| Multi-service dependency / indirect correlation | 6-hop pipeline; ICs between non-communicating pods | Scenarios 1–5 |
| Anomalies / leaks | feature-extractor leak → OOMKill; fault injection | Scenario 2 |
| Which pod causes CPU spikes? | CPU agent Z-score + orchestrator upstream trace | Scenario 1 |
| PVC I/O linked to restarts? | Storage IOPS + Memory OOMKill + Log K8s events → orchestrator links | Scenario 2 |
| Services influencing each other? | Dependency graph + correlation window + causal-chain reasoning | Scenarios 3, 4, 5 |
| Live demo / technical report | 7-step walkthrough; this doc + repo + diagrams | Section 4 / deliverables |

---

# 6. Architecture Decisions Log

| Decision | Alternative | Why |
|---|---|---|
| k3s (Edgenius-style) | Minikube | Production-grade edge distribution; closer to ABB's real target. |
| 3 namespaces | 5 | Enough for cross-namespace correlation; less single-node overhead. |
| 9 purpose-built pump pods | Generic demo app | Only purpose-built pods produce PVC stress, large file I/O, OPC-UA flood, industrial context. |
| **Real OPC-UA via `asyncua`** | HTTP labelled "OPC-UA" (v1) | Genuine protocol resolves the v1 honesty problem; an ABB judge recognises the subscription model. |
| **InfluxDB historian** | SQLite (v1) | Real industrial TSDB; internal TSM compaction creates organic large sequential I/O — fixes the v1 large-file-I/O gap and removes the SQLite single-writer bottleneck artifact. |
| **No custom Prometheus metrics** | App-level instrumentation | Core claim: detection from standard infra metrics only → "zero modification to existing software." Exceptions only if a bottleneck is otherwise invisible AND the metric would exist in production. |
| **Real Parquet bulk export (snappy)** | Simulated upload only | Industrially realistic; serialisation CPU + large PVC-2 writes + egress burst are the genuine large-file-I/O event. Mock upload endpoint (destination doesn't affect the infra metrics). |
| **health-scorer / alert-manager split** | One monolithic scorer | Decoupling via InfluxDB enables graceful degradation and the key indirect correlations (stale-data path). |
| Pure asyncio | LangGraph/CrewAI | Agents are continuous I/O-bound observers, not conversational chains. |
| 1 orchestrator call | 4 LLM agents + tribunal | 15–20 calls/event is brittle/slow/non-deterministic; one tool-use call is agentic in 3–6 s. |
| 4 panels | 7 | Each polished; fixed viewport; no demo scrolling. |
| Consolidated PromQL (13/cycle) | 48/cycle | ~75% less Prometheus load; avoids the observer effect. |
| Confidence with defined semantics | Undefined score | Defensible under Q&A. |
| Network+Log combined agent | Separate 5th agent | Network and log analysis complement each other; matches the "CPU/Memory/Storage/Log-IO" framing with 4 agents. |

---

# 7. Risk Mitigation

| Risk | Mitigation |
|---|---|
| Claude API slow/unavailable | Graceful degradation: statistical monitoring + correlation run without LLM; fallback template; dashboard never blank. |
| Single event-loop crash | Each agent coroutine in try/except with restart; supervisor restarts failed agents in ~5 s; FastAPI separate exception handling. |
| InfluxDB / Prometheus memory | Set limits (Prometheus 7-day retention, 512Mi); InfluxDB bucket 7-day retention; monitor with `kubectl top`. |
| Demo anomaly doesn't propagate | Pre-test all 5 scenarios; scripted injection commands; backup recorded video per scenario. |
| Dashboard re-render storms | D3 simulation only on structural change; Recharts skip on unchanged data; rAF-batched WebSocket dispatch. |
| Orchestrator non-determinism | Statistical layer fully deterministic; only NLP phrasing varies; pre-test each scenario 3–5× for consistent root-cause identification. |
| OPC-UA flood overwhelms a sensor-sim pod itself (not the collector) | Flood is rate-only on the server's publish loop; cap publish queue; the intended bottleneck is the single collector, which is the design's point. |
| PVC-2 fills before demo ends | Fault exports permanent by design (that's the forecast scenario); reset PVC-2 between full rehearsals; 5 Gi sized for a multi-injection session. |
