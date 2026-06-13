# Data Synthesis

<aside>
‼️

> No custom Prometheus metrics on Layer 0 pods. No artificial instrumentation. Every pod behaves as it would in a real ABB Edgenius deployment. EdgeMind detects anomalies from standard Kubernetes infra metrics only — CPU, memory, network, filesystem, PVC — scraped automatically by Prometheus from the kubelet and node-exporter. This is the claim: zero modification to existing software required.
> 

*The only exception to evaluate case-by-case: if a bottleneck is genuinely invisible without one specific app-level metric AND that metric would realistically exist in a production system of that type. Justify it explicitly if added.*

</aside>

# Sensor Simulation Design - Pump Station

### Pumps and Roles

| Pod | Pump | Role |
| --- | --- | --- |
| `sensor-sim-1` | Pump 1 — Primary transfer pump | Moves water/fluid from intake to treatment. Runs continuously, highest load |
| `sensor-sim-2` | Pump 2 — Secondary transfer pump | Backup + overflow handling. Variable load |
| `sensor-sim-3` | Pump 3 — Chemical dosing pump | Smaller pump, lower RPM, lower vibration baseline. Different normal ranges |

### Parameters Emitted (all 3 pumps)

Sensor-sim emits only raw physical measurements — no derived scores. Bearing health is computed on the edge node by feature-extractor, consistent with ABB Ability Edgenius architecture.

| Parameter | Unit | Physical meaning |
| --- | --- | --- |
| Vibration radial | mm/s RMS | Side-to-side shaft movement |
| Vibration tangential | mm/s RMS | Rotational direction movement |
| Vibration axial | mm/s RMS | Along shaft axis — primary bearing wear indicator |
| Skin temperature | °C | Motor casing heat |
| RPM | rev/min | Shaft speed |

### Baseline Ranges Per Pump (Normal Operation)

| Parameter | Pump 1 (Primary, 75kW, 1450RPM) | Pump 2 (Secondary, 45kW, 1450RPM) | Pump 3 (Dosing, 7.5kW, 960RPM) |
| --- | --- | --- | --- |
| Vibration radial (mm/s RMS) | 1.8 – 2.3 | 1.4 – 1.9 | 0.8 – 1.2 |
| Vibration tangential (mm/s RMS) | 1.5 – 2.0 | 1.2 – 1.6 | 0.6 – 1.0 |
| Vibration axial (mm/s RMS) | 0.8 – 1.2 | 0.6 – 1.0 | 0.3 – 0.6 |
| Temperature (°C) | 48 – 55 | 43 – 50 | 38 – 45 |
| RPM | 1448 – 1455 | 1449 – 1456 | 958 – 963 |

Pump 3 is a 6-pole motor at 960 RPM. Genuinely different baseline. Agents must maintain per-pod baselines, not global thresholds.

Gaussian noise: vibration ±0.15 mm/s, temperature ±0.5°C, RPM ±2.

### Fault Modes Per Pump

| Fault | Pump | Parameters that change | Pattern |
| --- | --- | --- | --- |
| `imbalance` | Pump 1 | Radial + tangential rise together, temperature rises | Gradual linear drift, 4 min |
| `seal_leak` | Pump 1 | Temperature rises sharply, axial vibration moderate rise, RPM slight drop | Gradual linear drift, 6 min |
| `bearing_fault` | Pump 2 | Axial vibration rises | Gradual linear drift, 5 min |
| `cavitation` | Pump 2 | Radial + tangential sudden spike, RPM drop, temperature rise | Immediate step change, sustained |
| `flood` | Pump 2 | All parameters at 10x emission rate, values unchanged | Rate change only |
| `overheat` | Pump 3 | Temperature rises, RPM slight drop, radial vibration slight rise | Gradual linear drift, 5 min |
| `sensor_noise` | Any | Random spikes on all parameters | Occasional outliers |
| `combined_cascade` | Pump 2 + Pump 3 | flood + overheat simultaneously | Both active |
| `combined_primary_failure` | Pump 1 + Pump 2 | imbalance + bearing_fault simultaneously | Both active |

### Fault Values

**`imbalance` on Pump 1** — gradual, linear drift over 4 minutes:

- Vibration radial: 2.0 → 5.8 mm/s
- Vibration tangential: 1.7 → 5.1 mm/s
- Temperature: 52 → 61°C
- RPM: unchanged

Radial and tangential rising equally distinguishes imbalance from bearing fault, which is axial-dominant.

**`seal_leak` on Pump 1** — gradual, linear drift over 6 minutes:

- Temperature: 51 → 74°C
- Vibration axial: 1.0 → 2.6 mm/s
- RPM: 1451 → 1443
- Radial and tangential: unchanged

**`bearing_fault` on Pump 2** — gradual, linear drift over 5 minutes:

- Vibration axial: 0.8 → 4.8 mm/s (Zone B → Zone D)
- Everything else unchanged

**`cavitation` on Pump 2** — immediate step change:

- Vibration radial + tangential: 1.6 → 5.2 mm/s
- RPM: 1452 → 1438
- Temperature: 47 → 53°C

**`flood` on Pump 2** — rate change only:

- All 5 parameters at 10x emission frequency (10Hz instead of 1Hz)
- Values remain within normal range

**`overheat` on Pump 3** — gradual, linear drift over 5 minutes:

- Temperature: 42 → 79°C
- RPM: 960 → 951
- Vibration radial: 1.0 → 1.7 mm/s

### Downstream Effects Per Fault

| Fault | Chain | Requirements hit |
| --- | --- | --- |
| `flood` (Pump 2) | opc-ua-collector CPU spike → historian write rate spike → feature-extractor reads slow → health-scorer stale → alert-manager burst | Bursty workload, network spike, CPU spike, bottleneck |
| `bearing_fault` (Pump 2) | feature-extractor detects axial slope → health-scorer triggers export → batch-sync bulk write to PVC-2 → contention with historian reads | Large file I/O, PVC stress, multi-service dependency |
| `imbalance` (Pump 1) | feature-extractor high CPU on elevated vibration → health-scorer flags critical → alert-manager sustained burst | CPU spike, sudden anomaly |
| `seal_leak` (Pump 1) | Slow temperature drift → health-scorer gradual degradation → batch-sync triggered | Memory stress, gradual anomaly |
| `overheat` (Pump 3) | Gradual temperature drift → anomalous readings accumulate in historian → batch-sync triggered | PVC storage stress, gradual anomaly |
| `combined_cascade` | flood + overheat chains simultaneously → all 4 agents fire | All requirements |
| `combined_primary_failure` | Pump 1 + Pump 2 degrading simultaneously → no healthy pump → critical station alert | Multi-service, CPU, storage |

### Data Generator Requirements

1. **Per-pump baselines** — hardcoded per pump, not global
2. **Injection endpoint** — HTTP POST on each sensor-sim pod accepting fault mode + optional duration
3. **Gradual vs step faults** — linear drift for bearing/thermal faults, immediate step for cavitation/flood
4. **Independent fault injection** — each pod accepts faults independently for combined scenarios

### Protocol and Format

**Protocol:** OPC-UA via `asyncua` (`pip install asyncua`, Python ≥ 3.10)

Each sensor-sim pod runs an asyncua OPC-UA server. opc-ua-collector runs an asyncua OPC-UA client subscribing to all three.

**OPC-UA address space:**

`Objects/
  PumpStation/
    Pump1/
      VibrationRadial      → Float (mm/s RMS)
      VibrationTangential  → Float (mm/s RMS)
      VibrationAxial       → Float (mm/s RMS)
      Temperature          → Float (°C)
      RPM                  → Float (rev/min)
      Timestamp            → DateTime
    Pump2/
      (same nodes)
    Pump3/
      (same nodes)`

5 raw parameters per pump. No derived scores at this layer.

**Emission frequency:**

- Normal: 1 reading/second/pump
- Flood mode: 10 readings/second/pump

### Vibration Reference — ISO 10816-3

| Zone | Range | Status |
| --- | --- | --- |
| A | ≤ 1.4 mm/s | Newly commissioned, excellent |
| B | 1.4 – 2.8 mm/s | Acceptable, long-term operation |
| C | 2.8 – 4.5 mm/s | Investigate, restricted operation |
| D | > 4.5 mm/s | Damage occurring, take out of service |

Temperature: normal 40–60°C, warning 60–75°C, critical above 75°C.

# `opc-ua-collector`

**What it does:**

- Subscribes to all 3 sensor-sim OPC-UA servers via `asyncua` subscription model (push, not poll)
- On every incoming value change notification: validates quality flag, validates physical bounds, aligns timestamp to OPC-UA server time
- Batches writes every 500ms and flushes to InfluxDB via influxdb-client async library
- Drops and logs bad-quality readings — no disk buffering if InfluxDB is unavailable

**Resource signature:**

- Normal: low CPU, low memory, steady low network ingress
- Under flood: CPU spikes parsing 10x notifications, network ingress 10x, InfluxDB write pressure increases
- Natural bottleneck — single process handling all 3 sensors simultaneously

**What it does NOT do:**

- No feature computation — raw values only
- No anomaly detection — that's feature-extractor's job
- No buffering to disk — if historian is down, readings are dropped and logged

**How agents detect its stress:**

- `container_cpu_usage_seconds_total` — CPU spike visible during flood
- `container_network_receive_bytes_total` — ingress flood visible

# `data-historian`

**What it is:** InfluxDB 2.x running in a container.

**Configuration only:**

- Bucket: `pump_station`, retention: 7 days
- Organisation and auth token
- Nothing else — InfluxDB handles all internal operations

**What InfluxDB does internally (no code required):**

- Accepts line protocol writes from `opc-ua-collector` and `feature-extractor`
- Serves Flux/InfluxQL queries to feature-extractor and batch-sync
- Periodically compacts TSM files internally — this creates large sequential PVC reads and writes naturally, no intervention needed
- Stores data on PVC-1

**Resource signature:**

- Normal: steady PVC writes, moderate memory for cache
- Under write pressure (flood): write latency increases, query latency increases for concurrent readers
- During compaction: large sequential PVC I/O, CPU spike, temporary query slowdown — emerges organically from InfluxDB internals

**What it does NOT expose:**

- InfluxDB does expose its own `/metrics` endpoint natively — this is standard, not added by the team. Prometheus can scrape it if configured. *You may want to check whether to include this or not — I'd recommend not scraping it deliberately, since EdgeMind's claim is infra-level detection, not application-level.*

**How agents detect its stress:**

- `container_fs_writes_bytes_total` — write rate spike visible
- `container_fs_reads_bytes_total` — read contention visible
- `kubelet_volume_stats_used_bytes` — PVC fill rate visible
- `container_cpu_usage_seconds_total` — compaction CPU spike visible
- `container_memory_working_set_bytes` — cache pressure visible

**Note on PVC contention:** feature-extractor and batch-sync access InfluxDB via its HTTP query API — they do not mount PVC-1 directly. Contention is at the InfluxDB application layer (concurrent query handling, TSM read/write competition). This is real and observable via the fs metrics above, but it's application-level contention, not OS-level PVC contention. Be precise about this if judges ask.

# `feature-extractor`

**What it is:** Custom Python service. Reads raw telemetry from InfluxDB, computes derived features, writes computed features back to InfluxDB. Runs on a fixed cycle.

**What it computes:**

For each pump, every 30 seconds, it queries the last 5 minutes of raw telemetry from InfluxDB and computes:

| Feature | Input | Method | Physical meaning |
| --- | --- | --- | --- |
| Vibration RMS trend | Axial, radial, tangential over 5 min window | Linear regression slope | Is vibration growing? Rate of change |
| Axial dominance ratio | Axial / (radial + tangential) | Simple ratio | Bearing faults show axial-dominant signature |
| Temperature rate of change | Temperature over 5 min window | Linear regression slope | Is motor heating up? |
| RPM stability | RPM over 5 min window | Standard deviation | Unstable RPM indicates hydraulic issues |
| Bearing health score | Axial vibration + temperature + RPM stability | Weighted formula (see below) | Edgenius-style edge-computed health score |

**Bearing health score formula:**

`vibration_penalty = clip((axial - axial_baseline) / axial_baseline, 0, 1) × 40
temp_penalty      = clip((temp - 60) / 20, 0, 1) × 30
rpm_penalty       = clip(rpm_std / 10, 0, 1) × 30

bearing_health = 100 - vibration_penalty - temp_penalty - rpm_penalty`

Simple, transparent, defensible. An ABB judge can follow the logic. The weights (40/30/30) reflect that vibration is the primary bearing fault indicator, temperature and RPM stability are secondary.

**Write back to InfluxDB:**

Computed features written to a separate InfluxDB measurement:

`measurement: pump_features
tags:        pump_id=pump1
fields:      vibration_rms_trend=0.003,
             axial_dominance_ratio=0.31,
             temp_rate_of_change=0.12,
             rpm_stability=1.8,
             bearing_health=84.2
timestamp:   computation time`

health-scorer reads from `pump_features`, not `pump_telemetry`. Clean separation.

**Computation cycle — why 30 seconds:**

- 5-minute window at 1Hz = 300 data points per parameter per pump — enough for meaningful regression
- 30-second cycle means health-scorer gets fresh features every 30 seconds
- Under flood (10Hz): same 5-minute window now has 3000 points — numpy operations take longer, CPU spike is real and proportional
- This fits within the 45-second correlation filter window: flood starts → collector CPU spikes (T+0) → feature-extractor next cycle is slower (T+30) → health-scorer gets stale features (T+30 to T+60) → agents have correlated findings within window

**Memory leak mode:**

Configurable via environment variable `LEAK_MODE=true`. When enabled, each computation cycle allocates a numpy result buffer and appends it to a module-level list without releasing. RSS grows at approximately 15–20 MB per minute depending on data volume. OOMKill occurs naturally when memory limit is reached — no artificial termination needed.

This is the `seal_leak` and gradual fault detection scenario. Memory agent detects the slope, forecasts OOM time, orchestrator correlates with health-scorer degradation.

**Resource signature:**

- Normal: bursty CPU every 30 seconds during computation, low memory, moderate InfluxDB reads
- Under flood: computation window has 10x data points — numpy operations proportionally more expensive, cycle takes longer, CPU spike sustained
- Leak mode: RSS grows linearly, visible to memory agent within 3–4 minutes
- Under historian contention: InfluxDB query takes longer → computation cycle delayed → health-scorer receives stale features → visible as increased cycle latency

**What it does NOT do:**

- No alerting — that is health-scorer's job
- No custom Prometheus metrics — standard container metrics only
- Does not talk to health-scorer directly — health-scorer reads from InfluxDB independently

**How agents detect its stress:**

- `container_cpu_usage_seconds_total` — computation bursts visible, sustained spike during flood
- `container_memory_working_set_bytes` — linear growth in leak mode
- `container_fs_reads_bytes_total` — InfluxDB query reads visible
- Memory agent's linear regression on RSS detects leak slope and forecasts OOM

# `health-scorer`

**What it is:** Custom Python service. Reads computed features from InfluxDB every 30 seconds, scores each pump's operational state, decides whether to trigger downstream actions.

**What it does:**

**1. Reads latest features from InfluxDB**

Queries `pump_features` measurement for the most recent entry per pump. Not a window — just the latest computed values. health-scorer is a decision layer, not a computation layer.

**2. Scores each pump**

Three independent scores per pump per cycle:

| Score | Input | Logic |
| --- | --- | --- |
| Vibration score | vibration_rms_trend, axial_dominance_ratio | Weighted combination. High axial dominance + rising trend = bearing fault pattern |
| Thermal score | temp_rate_of_change | Rate-based. Slow rise = warning. Fast rise = critical |
| Overall health | bearing_health from feature-extractor | Direct passthrough with threshold classification |

Threshold classification:

`bearing_health ≥ 75    → HEALTHY
50 ≤ bearing_health < 75  → WARNING
bearing_health < 50    → CRITICAL`

**3. Decides downstream actions**

| Condition | Action |
| --- | --- |
| Any pump WARNING for 2 consecutive cycles | Write alert to alert-manager |
| Any pump CRITICAL | Write alert to alert-manager immediately |
| Any pump crosses WARNING threshold | Trigger batch-sync bulk export |
| CRITICAL on Pump 1 (primary pump) | Trigger batch-sync immediately regardless of schedule |

The batch-sync trigger is the key architectural connection. health-scorer → batch-sync is how a fault detection event causes large file I/O downstream. This is the indirect correlation IC2 — batch-sync's PVC stress is causally downstream of health-scorer's decision, not a scheduled event.

**4. Writes state to InfluxDB**

`measurement: pump_health
tags:        pump_id=pump1
fields:      vibration_score=0.82,
             thermal_score=0.91,
             overall_health=84.2,
             state=HEALTHY,
             consecutive_warning_cycles=0
timestamp:   scoring time`

alert-manager and batch-sync both read from `pump_health` to decide what to act on.

**Why health-scorer reads InfluxDB instead of calling feature-extractor directly:**

Decoupled by design. If feature-extractor is slow or restarting, health-scorer reads the last known features and scores from them — it degrades gracefully rather than failing. This also creates the indirect correlation: when feature-extractor is delayed by historian contention, health-scorer silently works on stale data. From outside, health-scorer looks fine — CPU normal, no errors. Only the memory agent noticing feature-extractor's growing latency reveals the real cause.

**Stale data handling:**

If the latest `pump_features` entry is older than 90 seconds (3 missed cycles from feature-extractor), health-scorer flags that pump as `DATA_STALE` and writes a WARNING alert. This is intentional — stale data in a pump station is itself an operational problem worth alerting on.

**Resource signature:**

- Normal: low steady CPU, very low memory, small InfluxDB reads every 30 seconds
- Under flood: feature-extractor is slow → health-scorer reads stale features → DATA_STALE warnings → alert-manager receives burst of stale alerts — CPU stays low but alert volume spikes
- When batch-sync is triggered: health-scorer initiates the trigger via a lightweight HTTP POST to batch-sync's internal endpoint — small network spike, negligible CPU

**What it does NOT do:**

- No custom Prometheus metrics
- No direct communication with feature-extractor
- No computation — purely a decision and classification layer

**How agents detect its stress:**

- `container_cpu_usage_seconds_total` — normally very low. If it spikes, something is wrong with the scoring loop itself
- `container_network_transmit_bytes_total` — small spike when triggering batch-sync
- Indirect detection: health-scorer stress is visible through alert-manager receiving anomalous alert volumes and batch-sync being triggered unexpectedly

**The indirect correlation this enables:**

`health-scorer` and `opc-ua-collector` never communicate. But:

`sensor-sim-2` flood → `opc-ua-collector` overwhelmed → InfluxDB write pressure → feature-extractor query latency increases → health-scorer reads stale features → DATA_STALE warnings on Pump 2 → alert-manager burst

From the outside: health-scorer looks completely healthy. alert-manager looks like it's misbehaving. The root cause is a sensor flood three hops upstream. This is exactly the kind of non-obvious cross-service correlation EdgeMind is built to catch.

# `alert-manager`

**What it is:** Custom Python service. Receives alert triggers from health-scorer, formats them, writes to PVC-2, exposes them via a REST API for the dashboard. Always running.

**What it does:**

**1. Receives alerts from health-scorer**

health-scorer POSTs to alert-manager's HTTP endpoint when a threshold is crossed. One POST per pump per decision cycle when state is WARNING or CRITICAL.

Alert payload from health-scorer:

json

`{
  "pump_id": "pump2",
  "state": "WARNING",
  "overall_health": 61.3,
  "vibration_score": 0.43,
  "thermal_score": 0.89,
  "trigger": "bearing_fault_pattern",
  "timestamp": "2025-06-12T08:32:15Z"
}`

**2. Enriches the alert**

alert-manager adds context before writing:

- Human-readable description based on trigger type
- Severity classification (INFO / WARNING / CRITICAL)
- Recommended action — one sentence, operator language

Example enrichment for `bearing_fault_pattern`:

`description:  "Pump 2 bearing health declining. Axial vibration rising
               above Zone C threshold. Bearing wear pattern detected."
severity:     WARNING
recommended:  "Schedule bearing inspection within 48 hours.
               Monitor axial vibration trend closely."`

These descriptions are hardcoded templates per trigger type — not LLM-generated at this layer. The LLM reasoning happens in EdgeMind's orchestrator, not in the application layer.

**3. Writes to PVC-2**

Every alert is appended to a daily log file on PVC-2:

`/alerts/2025-06-12/pump_station_alerts.jsonl`

JSONL format — one JSON object per line. File grows throughout the day. batch-sync includes this file in its bulk export.

This is the second write target on PVC-2 alongside batch-sync's Parquet exports. Under high alert volume (flood scenario), alert-manager writes rapidly to PVC-2 while batch-sync is also writing. Concurrent PVC-2 writes create contention — visible to storage agent.

**4. Exposes REST API for dashboard**

`GET  /alerts              → last 100 alerts, newest first
GET  /alerts?pump=pump2   → filtered by pump
GET  /alerts/active       → current WARNING + CRITICAL states only
GET  /health              → service health check`

Dashboard polls this endpoint every 15 seconds for the anomaly timeline panel.

**Alert deduplication:**

alert-manager suppresses duplicate alerts — if the same pump is in WARNING state for 10 consecutive cycles, it writes one alert, not 10. Deduplication resets when state changes. Without this, a 5-minute bearing fault would generate 10 identical alerts and flood PVC-2 unnecessarily.

However: deduplication has a deliberate gap. Under the flood scenario, sensor-sim-2 causes DATA_STALE warnings on health-scorer. DATA_STALE is treated as a different trigger type from BEARING_FAULT — so they don't deduplicate against each other. This means during a combined scenario, alert-manager receives two distinct alert streams simultaneously — one for the actual fault, one for the stale data condition. This is the burst that stresses alert-manager's write path.

**Resource signature:**

- Normal: very low CPU, minimal PVC writes, low network
- Under single fault: moderate write rate to PVC-2, small CPU
- Under flood scenario: burst of DATA_STALE + fault alerts simultaneously → rapid PVC-2 writes → CPU spike processing and enriching multiple concurrent POSTs → visible to both CPU agent and storage agent
- Under combined scenario: multiple pumps alerting simultaneously → maximum write pressure on PVC-2

**What it does NOT do:**

- No custom Prometheus metrics
- Does not talk to InfluxDB directly
- Does not trigger batch-sync — that is health-scorer's responsibility
- Does not send emails, SMS, or external notifications — out of scope for edge node

**How agents detect its stress:**

- `container_cpu_usage_seconds_total` — spike during alert burst
- `container_fs_writes_bytes_total` — PVC-2 write rate spike
- `container_network_receive_bytes_total` — ingress spike when health-scorer POSTs burst of alerts
- Storage agent correlates PVC-2 write spike with simultaneous batch-sync writes — contention visible

**The indirect correlation this enables:**

alert-manager and sensor-sim-2 never communicate. But:

sensor-sim-2 flood → health-scorer DATA_STALE warnings → alert-manager receives burst → rapid PVC-2 writes → batch-sync simultaneously writing Parquet export to same PVC-2 → storage contention

From outside: alert-manager and batch-sync both show storage stress simultaneously. Neither is the root cause. sensor-sim-2 is — three and four hops upstream respectively. Only cross-service correlation catches this.

# **`batch-sync`**

**What it is:** Custom Python service. Periodically reads bulk data from InfluxDB, serialises to Parquet files, writes to PVC-2, simulates cloud upload via HTTP. Triggered by schedule AND by health-scorer on fault detection.

**What it does:**

**Two trigger modes:**

| Trigger | Condition | What it exports |
| --- | --- | --- |
| Scheduled | Every 5 minutes | Last 5 minutes of `pump_telemetry` for all 3 pumps |
| Fault-triggered | health-scorer POST on WARNING/CRITICAL | Last 30 minutes of `pump_telemetry` + `pump_features` + `pump_health` for affected pump |

Fault-triggered export is deliberately larger — it captures enough history for a maintenance engineer to diagnose the fault offline. This is the large file I/O event.

**Scheduled export (every 5 minutes):**

1. Query InfluxDB `pump_telemetry` for last 5 minutes, all 3 pumps
2. Convert to pandas DataFrame
3. Serialise to Parquet — compressed with snappy
4. Write to PVC-2: `/exports/scheduled/YYYY-MM-DD_HH-MM.parquet`
5. Simulate upload: HTTP POST to a mock endpoint with file as multipart payload
6. Log success, keep file on PVC-2 for 24 hours then delete

File size: approximately 500KB–1MB at 1Hz normal operation. Small, manageable.

**Fault-triggered export:**

1. Receive POST from health-scorer with pump_id and fault context
2. Query InfluxDB for last 30 minutes of three measurements: `pump_telemetry`, `pump_features`, `pump_health` for affected pump
3. Merge into single pandas DataFrame
4. Serialise to Parquet
5. Write to PVC-2: `/exports/fault/YYYY-MM-DD_HH-MM_{pump_id}.parquet`
6. Simulate upload
7. Keep file permanently — fault records are never deleted

File size: approximately 50–100MB per fault export at 1Hz. At 10Hz (flood mode): 500MB–1GB. This is the large file I/O event that stresses PVC-2.

**Why Parquet:**

Industrially realistic. Parquet is the standard format for bulk time-series export in modern industrial data pipelines — InfluxDB, OSIsoft PI, and Historian all support Parquet export. Snappy compression is CPU-intensive, creating a real CPU spike during serialisation. An ABB engineer will recognise this choice immediately.

**The contention this creates:**

batch-sync reads from InfluxDB (HTTP query API) at the same time feature-extractor is also reading from InfluxDB every 30 seconds. InfluxDB handles concurrent queries but TSM read performance degrades under simultaneous bulk + streaming reads. This is the indirect correlation IC2:

batch-sync fires scheduled export → bulk InfluxDB read → feature-extractor's next query takes longer → health-scorer gets stale features → DATA_STALE warning on affected pump → alert-manager writes alert to PVC-2 → batch-sync is simultaneously writing Parquet to PVC-2

All of this from a scheduled 5-minute sync. No fault injected. Purely structural.

**Cleanup policy:**

| File type | Retention |
| --- | --- |
| Scheduled exports | 24 hours then deleted |
| Fault exports | Permanent — never deleted |

Fault exports accumulating permanently is intentional. Over a demo session with multiple fault injections, PVC-2 fills measurably. Storage agent's linear regression detects the fill rate and forecasts time-to-full. This is the PVC storage stress scenario.

**Resource signature:**

- Scheduled (normal): moderate CPU during serialisation, large sequential InfluxDB read, large sequential PVC-2 write, network egress burst during simulated upload
- Fault-triggered (normal fault): heavy CPU during Parquet serialisation of 30-minute window, 50–100MB PVC-2 write, large network egress
- Fault-triggered (flood mode): 500MB–1GB PVC-2 write, sustained heavy CPU, extended InfluxDB read competing with feature-extractor
- Concurrent with alert-manager: both writing to PVC-2 simultaneously — storage contention visible

**What it does NOT do:**

- No custom Prometheus metrics
- Does not read from alert-manager directly — alert logs on PVC-2 are included in export via filesystem read, not API call
- Does not modify or delete InfluxDB data
- Does not authenticate to a real cloud — mock endpoint only

**How agents detect its stress:**

- `container_cpu_usage_seconds_total` — serialisation spike
- `container_fs_writes_bytes_total` — large sequential PVC-2 writes
- `container_fs_reads_bytes_total` — bulk InfluxDB query reads
- `container_network_transmit_bytes_total` — simulated upload egress burst
- `kubelet_volume_stats_used_bytes` on PVC-2 — fill rate acceleration after multiple fault exports
- Storage agent correlates PVC-2 fill rate slope with fault export frequency

**The indirect correlations this enables:**

**IC1:** batch-sync scheduled read → InfluxDB contention → feature-extractor delayed → health-scorer stale → DATA_STALE alert. batch-sync and health-scorer never communicate. Purely structural contention.

**IC2:** Fault export writing 100MB to PVC-2 → alert-manager simultaneously writing alerts to PVC-2 → storage contention → alert-manager write latency increases → alert delivery slows. Two pods writing to the same PVC for completely independent reasons.

**IC3:** Flood mode fault export (500MB–1GB) → InfluxDB under sustained bulk read → opc-ua-collector's writes begin queuing → collector CPU spikes → network ingress backs up. batch-sync's read load propagates backwards up the pipeline to the collector.