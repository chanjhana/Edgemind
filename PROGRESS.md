# EdgeMind — Progress Log

> **How to read this file:**
> This is the living build log for the EdgeMind project. Every work session appends to the bottom.
> Each entry records what was built, what was tested, what broke and how it was fixed, and any setup
> instructions needed to reproduce the environment.
>
> For the full architecture spec, read `tmp_md_files/EdgeMind_Final_System_Architecture_v2.md`.
> For the full data-layer spec (sensor values, fault modes, InfluxDB schema, HTTP contracts),
> read `tmp_md_files/data_sythetsis_updated.md`.
> For a historical build log of completed work, read `BUILD_LOG.md`.

---

## Project Overview (snapshot)

**What this is:** EdgeMind — a multi-agent AI system that detects cross-service resource anomalies
in a 9-pod Kubernetes pump-station pipeline, using only standard infrastructure metrics (CPU,
memory, network, filesystem, PVC). No custom Prometheus metrics on the monitored workload.

**The 9-pod pipeline (pump-station namespace):**

```
sensor-sim-1 ─┐
sensor-sim-2 ─┼─→ opc-ua-collector → data-historian → feature-extractor → health-scorer → alert-manager
sensor-sim-3 ─┘                                      └→ batch-sync → PVC-2 (export-data)
```

**The detection layer (monitoring namespace):**
```
Prometheus (15s scrape)
    │
    ├─ CPU Agent ────────────────────────────────────┐
    ├─ Memory Agent ─────────────────────────────────┤
    ├─ Storage Agent ────────────────────────────────┤→ Correlation Filter (45s window) → Claude Orchestrator → WebSocket API
    └─ Network + Log Agent ──────────────────────────┘
```

---

## Layer Status

| Layer | Component | Status |
|---|---|---|
| **Phase 0** | sensor-sim-1/2/3 (OPC-UA + inject API + Docker) | ✅ **Complete** |
| **Phase 1** | common/contract.py, opc-ua-collector, data-historian (InfluxDB), feature-extractor | ✅ **Complete** |
| **Phase 1** | Root docker-compose.yml (6-service stack) | ✅ **Complete** |
| **Phase 2** | health-scorer (scorer.py + main.py + Dockerfile) | ✅ **Complete** |
| **Phase 2** | alert-manager (enricher.py + main.py + Dockerfile) | ✅ **Complete** |
| **Phase 2** | mock-upload (main.py + Dockerfile) | ✅ **Complete** |
| **Phase 2** | batch-sync (main.py + Dockerfile + 33 tests) | ✅ **Complete** |
| **Phase 3** | EdgeMind 4 agents + correlation filter + orchestrator + API | 🔲 Not started |
| **Phase 4** | React/Vite dashboard (4 panels) | 🔲 Not started |
| **Phase 4** | k3s + Prometheus deployment + Helm chart | 🔲 Not started |

**Current test count:** 209 passing (45 sensor_sim + 4 common + 10 opc_ua_collector + 9 feature_extractor + 41 health_scorer + 67 alert_manager + 33 batch_sync)

---

## Active Branch

```
data_synthesis   ← current work branch
demo             ← base branch (Phase 0 + Phase 1 merged here)
```

All Phase 2 work happens on `data_synthesis`. Merge to `demo` after end-to-end verification.

---

## Repository Layout

```
k8s-Pod-Resource-AI-Driven-Correlation/
├── sensor_sim/               ← Phase 0: OPC-UA pump simulators (complete)
│   ├── pump_config.py        ← Baselines, fault defs, OPC-UA layout (source of truth)
│   ├── fault_engine.py       ← Pure-math fault engine
│   ├── opc_server.py         ← asyncua OPC-UA server + emit loop
│   ├── inject_server.py      ← FastAPI fault injection HTTP API
│   ├── main.py               ← asyncio.gather wiring
│   ├── Dockerfile
│   ├── docker-compose.yml    ← sensor-sim-only stack (for isolated testing)
│   ├── requirements.txt
│   └── tests/                ← 45 tests
├── common/
│   ├── contract.py           ← Shared InfluxDB schema + HTTP contracts + baselines
│   └── tests/                ← 4 guard tests (contract stays in sync with pump_config)
├── opc_ua_collector/         ← Phase 1: asyncua subscription client → InfluxDB
│   ├── collector.py          ← Buffer/validation logic (pure, testable)
│   ├── main.py               ← OPC-UA subscription glue + async InfluxDB writes
│   ├── Dockerfile
│   ├── requirements.txt
│   └── tests/                ← 10 tests
├── feature_extractor/        ← Phase 1: 30s cycle, computes bearing health score
│   ├── features.py           ← Pure numpy/scipy feature math
│   ├── main.py               ← 30s loop + InfluxDB read/write + LEAK_MODE
│   ├── Dockerfile
│   ├── requirements.txt
│   └── tests/                ← 9 tests
├── docker-compose.yml        ← Root stack (sensor-sim-1/2/3 + influxdb + collector + extractor)
├── BUILD_LOG.md              ← Historical build log (Phase 0 + 1)
├── PROGRESS.md               ← This file (living log)
├── README.md                 ← Setup guide + inject API reference
├── TECHNICAL.md              ← Architecture, data model, Mermaid diagrams
└── tmp_md_files/
    ├── data_sythetsis_updated.md        ← Full data layer spec (authoritative)
    └── EdgeMind_Final_System_Architecture_v2.md ← Full system architecture
```

---

## Environment Setup

### Prerequisites

| Tool | Version | Install |
|---|---|---|
| Python | 3.11+ | `pyenv install 3.11` or system package |
| Docker Desktop | 4.x+ | https://docs.docker.com/desktop/ |
| Docker Compose | v2 (bundled with Docker Desktop) | Bundled |
| Git | any | `sudo apt install git` |

### Python virtualenv (local test runs)

```bash
cd /path/to/k8s-Pod-Resource-AI-Driven-Correlation
python -m venv venv
source venv/bin/activate      # Linux/Mac
# venv\Scripts\activate       # Windows

# Install all deps for the current built layers
pip install asyncua==1.1.5 fastapi uvicorn pytest pytest-asyncio pydantic httpx \
            influxdb-client[async]==1.48.0 numpy scipy
```

### Running the full test suite (no Docker needed)

```bash
source venv/bin/activate
python -m pytest common/tests opc_ua_collector/tests feature_extractor/tests sensor_sim -q
# Expected: 68 passed
```

### Starting the current Docker stack (6 services)

```bash
# From repo root
docker compose up --build -d

# Check all 6 services are up
docker compose ps

# Expected containers:
# sensor-sim-1   → healthy (OPC-UA :4840, HTTP :8080)
# sensor-sim-2   → healthy (OPC-UA :4841, HTTP :8081)
# sensor-sim-3   → healthy (OPC-UA :4842, HTTP :8082)
# influxdb        → healthy (InfluxDB :8086)
# opc-ua-collector → up
# feature-extractor → up
```

### Verifying the current data path

```bash
# 1. Check live telemetry is flowing (sensor → collector → InfluxDB)
docker compose exec influxdb influx query \
  --org edgemind --token devtoken \
  'from(bucket:"pump_station") |> range(start: -1m) |> filter(fn: (r) => r._measurement == "pump_telemetry") |> count()'

# 2. Check features are being computed (feature-extractor → InfluxDB)
docker compose exec influxdb influx query \
  --org edgemind --token devtoken \
  'from(bucket:"pump_station") |> range(start: -2m) |> filter(fn: (r) => r._measurement == "pump_features") |> last()'

# 3. Watch feature-extractor logs
docker compose logs -f feature-extractor
# Should see: pump=pump1 bearing_health≈90-95 every 30s (HEALTHY at rest)
```

### Injecting a fault (quick test)

```bash
# Inject bearing fault on pump2
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"bearing_fault","duration_s":300}'

# Watch bearing_health decline (takes ~5 min for full ramp)
watch -n 30 'docker compose logs --tail=5 feature-extractor'

# Clear the fault
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"clear"}'
```

### Tearing down

```bash
docker compose down          # stops containers, keeps InfluxDB volume
docker compose down -v       # stops containers AND wipes InfluxDB data (clean slate)
```

---

## Phase 2 Plan — Pipeline Backend

> **Decision:** Stay on Docker Compose throughout Phase 2. k3s comes later (Phase 4).
> **Decision:** Claude API stubbed for now. Orchestrator JSON will be hardcoded during initial development.

### What Phase 2 adds

Three new custom Python services + one trivial mock endpoint:

| Service | Port | Role |
|---|---|---|
| `health-scorer` | — (no external port needed) | Reads `pump_features` every 30s, scores each pump, writes `pump_health`, triggers alert-manager + batch-sync on threshold crossings |
| `alert-manager` | 8090 | Receives alert POSTs from health-scorer, enriches them, appends JSONL to PVC-2, exposes REST API |
| `batch-sync` | 8091 | Bulk Parquet export: scheduled every 5min AND fault-triggered by health-scorer |
| `mock-upload` | 9000 | Receives multipart POST from batch-sync, logs filename + size, returns 200 |

### New volume

`PVC-2 (export-data)` — shared between `alert-manager` (writes `/alerts/`) and `batch-sync` (writes `/exports/`)

### Files to create

```
health_scorer/
    main.py
    Dockerfile
    requirements.txt
    .dockerignore
    tests/
        test_health_scorer.py

alert_manager/
    main.py
    Dockerfile
    requirements.txt
    .dockerignore
    tests/
        test_alert_manager.py

batch_sync/
    main.py
    Dockerfile
    requirements.txt
    .dockerignore
    tests/
        test_batch_sync.py

mock_upload/
    main.py
    Dockerfile
    requirements.txt
    .dockerignore
```

Root `docker-compose.yml` updated to add 4 new services + `export-data` named volume.

---

## Session Log

---

### Session 1 — 2026-06-13

**Branch:** `data_synthesis` (freshly created from `demo`)

**Context established:**
- Read all project docs: `data_sythetsis_updated.md`, `EdgeMind_Final_System_Architecture_v2.md`, `BUILD_LOG.md`, `README.md`, `TECHNICAL.md`
- Confirmed Phase 0 (sensor-sim) and Phase 1 (data foundation) are complete and verified
- Current pipeline stops at `feature-extractor` — nothing reads `pump_features` downstream yet
- 68 tests passing, 6-container Docker stack verified end-to-end with bearing_fault propagation

**Decisions recorded:**
- Phase 2 stays on Docker Compose (k3s deferred to Phase 4)
- Claude orchestrator stubbed during initial development (Anthropic API deferred)
- Created `PROGRESS.md` (this file) as living log

**Status at end of session:** Phase 2 planning complete. No code written yet.

**Next action:** Build `health_scorer/` — start with `tests/test_health_scorer.py` (spec the scoring logic), then implement `main.py` to pass.

---

### Session 2 — 2026-06-13

**Branch:** `data_synthesis`

**Built:**
| File | Purpose |
|---|---|
| `health_scorer/__init__.py` | Package marker |
| `health_scorer/scorer.py` | Pure scoring logic: `_classify()`, `_vibration_score()`, `_thermal_score()`, `PumpState`, `ScoringResult`, `score_pump()`. No I/O, fully testable on synthetic dicts |
| `health_scorer/tests/test_scorer.py` | 41 unit tests covering all state paths (HEALTHY, WARNING, CRITICAL, DATA_STALE), trigger threshold logic, score boundary conditions, PumpState lifecycle |
| `health_scorer/main.py` | 30s async loop: queries `pump_features`, calls `score_pump()`, writes `pump_health` to InfluxDB, fires HTTP POSTs to alert-manager + batch-sync concurrently via `asyncio.gather`. Emits mandatory log contract `pump=X bearing_health=Y state=Z action=W` |
| `health_scorer/Dockerfile` | Build context = repo root (same pattern as opc_ua_collector, feature_extractor) |
| `health_scorer/requirements.txt` | `influxdb-client[async]==1.48.0`, `httpx==0.27.2` |
| `health_scorer/.dockerignore` | Excludes tests, pycache |
| `docker-compose.yml` | Added `health-scorer` service + `export-data` named volume (for PVC-2, shared by alert-manager + batch-sync later) |

**Key design decisions in scorer.py:**
- **Vibration score** combines `vib_rms_trend` (60% weight) + `axial_dominance_ratio` (40% weight) — axial dominance >0.35 is the bearing-fault fingerprint
- **Thermal score** saturates at 0.05°C/s (3°C/min) — slow seal_leak drifts score gradually, overheat scores fast
- **Trigger logic** in `PumpState.should_trigger()` — WARNING requires 2 consecutive cycles (WARNING_TRIGGER_CYCLES), CRITICAL always triggers immediately, DATA_STALE follows the same 2-cycle rule
- **Action label** is always `trigger_both` when triggered (sends to both alert-manager AND batch-sync per spec)
- **Log format** exactly matches the inter-pod contract: `pump=X bearing_health=Y.Y state=Z action=W`

**Tests run:**
```
41 scorer unit tests:   41/41 PASSED (0.08s)
Full suite (all layers): 109/109 PASSED (8.07s)
docker compose config: valid
```

**Issue hit and fixed:**
- `numpy` + `scipy` not installed in venv for this session → `pip install numpy scipy httpx` before final test run

**Status at end of session:** `health_scorer/` fully built and tested. docker-compose.yml updated with health-scorer service. 109 tests passing.

**Next action:** Build `alert_manager/` — receives POSTs from health-scorer, enriches alerts, writes JSONL to PVC-2, exposes REST API.

---

### Session 3 — 2026-06-13

**Branch:** `data_synthesis`

**Built:**
| File | Purpose |
|---|---|
| `alert_manager/__init__.py` | Package marker |
| `alert_manager/enricher.py` | Pure logic: `IncomingAlert.from_dict()` (parse + validate), `enrich()` (apply hardcoded templates per trigger type), `DedupTracker` (suppress identical (pump_id, trigger) pairs after 10 hits) |
| `alert_manager/tests/test_enricher.py` | 36 unit tests — payload parsing, all 4 trigger templates, severity mapping, UUID generation, dedup lifecycle, deliberate dedup gap |
| `alert_manager/main.py` | FastAPI app: `POST /alert` (validate → dedup check → enrich → JSONL write → ring buffer), `GET /alerts` (newest-first, pump filter, limit), `GET /alerts/active` (latest per pump in non-HEALTHY state), `GET /health` |
| `alert_manager/tests/test_api.py` | 31 TestClient integration tests — all endpoints, JSONL file write isolation per test (fresh tempdir per method), dedup 429 path, deliberate gap test, validation 422s |
| `alert_manager/Dockerfile` | Build context = repo root |
| `alert_manager/requirements.txt` | `fastapi==0.115.12`, `uvicorn==0.34.2` |
| `alert_manager/.dockerignore` | Excludes tests, pycache |
| `docker-compose.yml` | Added `alert-manager` service mounting `export-data` volume at `/data`, port 8090 exposed |

**Key design decisions:**
- **Dedup key = (pump_id, trigger)** — not (pump_id, state). This preserves the deliberate gap: `bearing_fault_pattern` and `data_stale` are distinct keys. During a flood, health-scorer sends both simultaneously; both pass through; alert-manager's write path is stressed. A dedicated test (`test_deliberate_gap_data_stale_and_bearing_fault_independent`) locks this in.
- **In-memory ring buffer (500 entries)** for `GET /alerts` — fast, no disk read on every poll. The JSONL file on PVC-2 is the durable record.
- **`GET /alerts/active`** deduplicates by pump_id in the response — returns at most one record per pump (the most recent). The dashboard gets a clean "current state" view.
- **ALERTS_DIR env var** makes the path configurable: `/data/alerts` in Docker Compose, same in k3s (PVC mount point).

**Tests run:**
```
alert_manager/tests/: 67/67 PASSED
Full suite (all layers): 176/176 PASSED (8.20s)
docker compose config: valid
```

**Issue hit and fixed:**
- `TestJSONLWrite` tests failed because the shared temp dir accumulated JSONL lines from previous test classes. Fixed by giving each JSONL test method its own temp dir via `setup_method` / `teardown_method`.

**Status at end of session:** `alert_manager/` fully built and tested. docker-compose.yml now has 8 services (all except batch-sync and mock-upload). 176 tests passing.

**Next action:** Build `batch_sync/` — Parquet bulk export service (scheduled every 5min + fault-triggered by health-scorer POST).

---

<!-- New sessions appended below this line -->

### Session 4 — 2026-06-13

**Branch:** `data_synthesis`

**Built:**
| File | Purpose |
|---|---|
| `mock_upload/__init__.py` | Package marker |
| `mock_upload/main.py` | FastAPI `POST /upload` (multipart, 64 KB chunked reads, discards bytes), `GET /health`. Creates organic network egress from batch-sync on every upload. |
| `mock_upload/Dockerfile` | python:3.11-slim, self-contained (no common/ needed) |
| `mock_upload/requirements.txt` | fastapi, uvicorn, python-multipart |
| `mock_upload/.dockerignore` | Standard exclusions |
| `batch_sync/__init__.py` | Package marker |
| `batch_sync/main.py` | FastAPI bulk-export service (port 8091): scheduled 5-min loop + `POST /trigger` (fault-triggered), single asyncio.Lock (one export at a time → 409 if busy), returns 200 immediately and runs export as background task. Two export paths: `scheduled/` (24h retention) and `fault/` (permanent). Parquet snappy via pandas+pyarrow. HTTP upload to mock-upload. `GET /status`, `GET /health`. |
| `batch_sync/Dockerfile` | Build context = repo root (copies common/), python:3.11-slim |
| `batch_sync/requirements.txt` | fastapi, uvicorn, influxdb-client[async], pandas, pyarrow, httpx |
| `batch_sync/.dockerignore` | Standard + tests/ exclusion |
| `batch_sync/tests/__init__.py` | Package marker |
| `batch_sync/tests/conftest.py` | Path setup conftest |
| `batch_sync/tests/test_batch_sync.py` | 33 unit tests (7 groups): ExportState lock semantics, cleanup retention policy, Parquet round-trip, /trigger 200/409/422, /status+/health, pump_id validation (8 bad IDs), _query_to_df column cleanup |
| `docker-compose.yml` | Added mock-upload (port 9000) and batch-sync (port 8091) services; export-data volume shared with alert-manager |

**Key design decisions:**
- **Single asyncio.Lock** — health-scorer gets 409 if an export is already in progress (not queued). Prevents concurrent InfluxDB bulk reads and avoids unbounded PVC-2 growth in rapid-fault scenarios.
- **Fault exports permanent** — PVC-2 fills measurably across demo session. Storage agent forecasts time-to-full from this fill rate.
- **Sequential InfluxDB queries** for fault exports (telemetry → features → health) — avoids overloading the historian while still creating a clear read-pressure spike visible to the storage agent.
- **FastAPI lifespan** — used modern `@asynccontextmanager` lifespan pattern instead of deprecated `@app.on_event`.
- **importlib.util for test isolation** — loaded as `batch_sync_main` module name to avoid `sys.modules["main"]` collision with alert_manager/main.py when all suites run together.

**Tests run:**
```
33 batch_sync tests:  33/33 PASSED (1.89s, isolated)
Full suite (all layers): 209/209 PASSED (11.40s)
docker compose config: valid
```

**Issue hit and fixed:**
- `sys.modules["main"]` collision: when running `pytest alert_manager/tests batch_sync/tests`, alert_manager's `main.py` is imported first and cached. Fix: loaded `batch_sync/main.py` via `importlib.util.spec_from_file_location` under the unique name `batch_sync_main`, avoiding the collision entirely.
- One test assertion used `/data/exports/fault/test.parquet` (Linux slashes) but `Path.str()` on Windows returns backslashes. Fix: compare as `Path` objects.

**Status at end of session:** Phase 2 complete — all 8 pipeline services built. 209 tests passing. docker-compose.yml has 10 services.

**Next action:** Phase 3 — EdgeMind detection layer: 4 domain agents (CPU, Memory, Storage, Network+Log) + correlation filter + Claude orchestrator + WebSocket API.
