# EdgeMind — Build Log

A detailed, chronological record of everything built and verified so far, including
every test run and every issue hit and how it was fixed. Newest milestone last.

Components are grouped into two layers built in sequence:
1. **sensor-sim** — the 3 OPC-UA pump simulators + fault injection (Layer-0 sensors)
2. **Data Synthesis foundation** — opc-ua-collector → InfluxDB → feature-extractor

---

## 0. Repo onboarding

- Cloned `git@github.com:chanjhana/k8s-Pod-Resource-AI-Driven-Correlation.git` (branch `demo`).
- Initial state: only a frontend stub (`index.html`, `index.js`, `index.css`, `logo.png`).
  No Python, no pipeline. Everything below was built from scratch.

---

## 1. Phase 0 + sensor fault engine (`sensor_sim/`)

Locked the shared contracts first so parallel work could not drift on numbers.

### Files created
| File | Purpose |
|---|---|
| `sensor_sim/pump_config.py` | Single source of truth: 5 params, OPC-UA node names/paths, per-pump baselines, noise sigmas, sanity bounds, 7 fault definitions, ISO 10816-3 zones, inject-API contract |
| `sensor_sim/fault_engine.py` | Pure math: `FaultState`, `compute_reading()`, `linear_drift()`, `step_change()`, `sensor_noise()` |
| `sensor_sim/tests/test_faults.py` | Fault-math unit tests (no server) |
| `sensor_sim/requirements.txt` | Dependencies |

### Key values encoded (from the Data Synthesis doc)
- Baselines (midpoints): pump1 axial 1.0 / pump2 0.8 / pump3 0.45, etc.
- Faults: `bearing_fault` axial 0.8→4.8 over 300 s; `cavitation` step; `flood` rate-only 10 Hz;
  `imbalance`, `seal_leak`, `overheat`, `sensor_noise`.
- Noise: vibration ±0.15, temp ±0.5, RPM ±2. Emission 1 Hz normal / 10 Hz flood.

### Tests
- Ran `python tests/test_faults.py` → **12/12 PASS** (bearing_fault ramp, cavitation-at-t0,
  flood-stays-normal, imbalance, overheat→79 °C, baselines, sanity bounds, FaultState lifecycle).

---

## 2. Integrating the OPC-UA server (pulled teammate's work)

Pulled `opc_server.py`, `main.py`, `inject_server.py` (stub), `pytest.ini`, `tests/test_server.py`.

### Dependency install
- Installed `asyncua==1.1.5`, `fastapi`, `uvicorn`, `pytest`, `pytest-asyncio`, `pydantic`, `httpx`.
- (Pre-existing unrelated global package conflicts — langflow/embedchain — ignored; sensor_sim deps imported cleanly.)

### Test run #1 — found a failure
- `python -m pytest -v` → **33 passed, 3 failed**.
- The 3 failures were all OPC-UA **client** tests (`test_server_state_running`,
  `test_client_can_browse_*`) failing with `TimeoutError`.

### Diagnosis
- Wrote a standalone script connecting a real `asyncua.Client` to the server **outside pytest** →
  it read `ServerState=0` (Running) and `axial=0.70` fine. This proved the **server code was correct**.
- Root cause was the test harness: `pytest.ini` had `asyncio_default_fixture_loop_scope = module`
  but tests defaulted to `asyncio_default_test_loop_scope = function`. The server (bound on the
  module-scoped loop) was not serviced during per-function-loop tests → client requests connected
  but timed out.

### Fix
- Added `asyncio_default_test_loop_scope = module` to `pytest.ini`.
- Re-ran → **36 passed** (suite time dropped 21.5 s → ~6 s, no more timeouts).

### Added missing coverage
- The checklist item "flood switches to 10 Hz" had no live coverage (only the flag + constant were
  tested). Added `test_emit_loop_flood_ticks_faster_than_normal` — counts emit-loop ticks over 1 s:
  normal ≤3, flood ≥5.
- Re-ran → **37 passed**.

---

## 3. Fault-injection API + Docker packaging (`sensor_sim/`)

### Files created / replaced
| File | Purpose |
|---|---|
| `sensor_sim/inject_server.py` | **Real** impl replacing the stub: `POST /inject`, `GET /status`, `GET /modes`, `GET /health`; validates mode (422 on unknown); `create_inject_app(fault_state)` factory used by `main.py` |
| `sensor_sim/Dockerfile` | Single image; runs as any pump via `PUMP_ID`/`OPC_PORT`/`HTTP_PORT`; `/health` healthcheck |
| `sensor_sim/.dockerignore` | Keeps tests/pycache out of the image |
| `sensor_sim/docker-compose.yml` | 3 sensor services (pump1/2/3 on ports 4840-4842 / 8080-8082) |
| `sensor_sim/tests/test_inject.sh` | HTTP smoke test against running containers |
| `sensor_sim/tests/test_inject.py` | In-process inject API tests (FastAPI TestClient) |
| `.gitignore` (repo root) | Standard Python + runtime artifacts (exports/alerts/parquet) |

### Tests
- Verified `import main` succeeds (real inject_server wired in).
- `python -m pytest -q` → **45 passed** (12 fault + 25 server + 8 inject).
- `docker compose config --quiet` → compose file **valid**.

### Live run (sensor stack)
- `docker compose up --build -d` → 3 containers healthy.
- `bash tests/test_inject.sh` → **4 passed, 0 failed** (health, modes, bearing_fault, 422 on unknown,
  flood, clear, combined flood+overheat across pump2/pump3).

---

## 4. Documentation

- `README.md` — project setup, run steps, inject API reference, fault table, watch-a-fault walkthrough.
- `TECHNICAL.md` — architecture, data model, OPC-UA address space, fault engine internals, emit-loop
  cadence, Docker packaging, test suite, with Mermaid diagrams.

---

## 5. Data Synthesis foundation — telemetry → InfluxDB → features

Planned (approved) scope: **data foundation** = opc-ua-collector + InfluxDB + feature-extractor on a
root docker-compose full stack. (Decision/alert/export layers deferred.)

### 5.1 Shared contract
| File | Purpose |
|---|---|
| `common/contract.py` | OPC-UA constants + sanity bounds + per-pump baselines (mirrored verbatim from `pump_config.py`) + InfluxDB schema (`pump_station` bucket, `pump_telemetry`/`pump_features` measurements, field names, health thresholds) |
| `common/tests/test_contract_matches_pump_config.py` | Guard test asserting the mirror never drifts from the sensor source of truth |

- `python -m pytest common/tests -q` → **4 passed**.

### 5.2 opc-ua-collector (`opc_ua_collector/`)
| File | Purpose |
|---|---|
| `collector.py` | Pure logic (no asyncua/influx imports): `in_bounds()`, `is_valid()` (quality + bounds + NaN/inf reject), `TelemetryBuffer` that groups per-tick notifications by `(pump_id, source_timestamp)` into complete 5-param samples; bounded pending memory |
| `main.py` | OPC-UA subscription glue: one `asyncua.Client` per sensor (push model), `node→(pump,param)` map, per-pump reconnect loop, async InfluxDB writer, 500 ms batched flush of completed samples to `pump_telemetry` |
| `Dockerfile`, `.dockerignore`, `requirements.txt` | Build context = repo root (so `common/` is copied in) |
| `tests/test_collector.py` | Validation + buffer-grouping tests |

- Grouping insight: the sensor writes all 5 nodes per tick with one shared `SourceTimestamp`, so
  bucketing by that timestamp yields complete samples robust to notification ordering, at 1 Hz and 10 Hz.
- `python -m pytest opc_ua_collector/tests -q` → **10 passed**.

### 5.3 feature-extractor (`feature_extractor/`)
| File | Purpose |
|---|---|
| `features.py` | Pure math (numpy/scipy): `vibration_rms_trend` (slope of per-sample RMS), `axial_dominance_ratio`, `temp_rate_of_change` (slope), `rpm_stability` (std), `bearing_health` (exact doc formula, axial baseline from contract) |
| `main.py` | 30 s loop: Flux-query last 5 min of `pump_telemetry` per pump → `compute_features()` → write `pump_features`; `LEAK_MODE` for the later memory-leak scenario; cold-start skip (<3 samples) |
| `Dockerfile`, `.dockerignore`, `requirements.txt` | |
| `tests/test_features.py` | Feature-math tests on synthetic arrays |

- `python -m pytest feature_extractor/tests -q` → **8 passed** (numpy 1.26.4, scipy 1.16.0).

### 5.4 Root docker-compose
- `docker-compose.yml` (repo root): `sensor-sim-1/2/3` (build `./sensor_sim`) + `influxdb` (influxdb:2.7,
  bucket `pump_station`, org `edgemind`, dev token, 7-day retention, named volume) + `opc-ua-collector` +
  `feature-extractor`, dependency-ordered with healthchecks.
- `docker compose config --quiet` → **valid**.
- Full unit suite at this point: `python -m pytest common/tests opc_ua_collector/tests feature_extractor/tests sensor_sim -q` → **67 passed**.

---

## 6. End-to-end bring-up — issues hit and fixed

1. **Container name conflict** — `up --build` failed: `sensor-sim-1` already in use by the earlier
   `sensor_sim/` compose stack. → `docker compose down` on the sensor_sim stack, then started the root stack.
2. **Wrong working directory** — a chained `cd sensor_sim && docker compose up` brought up only the
   sensors (sensor_sim compose) instead of the root stack. → Re-ran the root stack with an explicit
   `-f <repo>/docker-compose.yml` path (the Bash tool resets cwd between calls).
3. **`ModuleNotFoundError: aiohttp`** — `InfluxDBClientAsync` crash-looped both async services; the
   async client needs the extra. → Changed both requirements to `influxdb-client[async]==1.48.0` and
   rebuilt with `--no-cache` (a normal rebuild had hit a full layer-cache and skipped the pip step).
   `aiohttp 3.14.1` then installed; both services came up.
4. **InfluxDB healthcheck** — used `influx ping`; influxdb reported healthy and dependents started.

### Verification queries / observations
- **Telemetry flowing**: `influx query` counted **28 samples/pump** for `pump_telemetry.vibration_axial`
  in a 2-min window (all of pump1/pump2/pump3) — confirming the collector validates and writes at ~1 Hz.
- **Features computing**: feature-extractor logged at-rest `bearing_health` ≈ **90–95** for all pumps
  (HEALTHY), `vib_trend ≈ 0` (flat).

### Fault-propagation test (the key end-to-end proof)
- Injected `bearing_fault` on pump2 (`POST :8081/inject`).
- Over ~5 min, pump2 `bearing_health` declined through the feature-extractor cycles as axial ramped to 4.75:
  `91.1 → 85.0 → 77.9 → 69.9 → 60.6 → 54.5 → 54.4` (settled in the **WARNING** band).
- Confirms the full path: **sensor fault → OPC-UA → collector → InfluxDB → feature-extractor → bearing_health drop.**

---

## 7. Bug caught and fixed during verification — zero `vib_trend`

- **Symptom**: `vibration_rms_trend` logged as exactly `0.0000` every cycle, even while axial was ramping.
- **Root cause**: in `features._slope()`, timestamps are epoch seconds (~1.78e9). The degeneracy guard
  `np.allclose(t, t[0])` uses a relative tolerance — `rtol * 1.78e9 ≈ 17 800 s` (~5 h) — so a 300 s
  window looked "all equal" and the function short-circuited to `0.0`.
- **Fix**: rebase time to zero (`t = t - t.min()`) and guard with `np.ptp(t) == 0` before regression.
  This also conditions the fit numerically. (`temp_rate_of_change` had the same latent bug — also fixed.)
- **Regression test added**: `test_trend_correct_at_epoch_scale_timestamps` uses epoch-scale timestamps
  (~1.78e9) over a ramping axial and asserts a clearly positive slope.
- `python -m pytest feature_extractor/tests -q` → **9 passed**.

### Cosmetic fix — collector log noise
- asyncua's own loggers printed a full `Publish callback` dump per notification at INFO, drowning the
  collector's logs. → Raised `asyncua*` loggers to WARNING in `opc_ua_collector/main.py`. Collector logs
  are now clean: `subscribed pump=… (5 nodes)` + a periodic `telemetry: completed=N dropped_bad=0 pending=0`.

### Rebuild + re-verify
- Rebuilt and **force-recreated** both services (a plain `--build` rebuilt the images but left the old
  containers running — `--force-recreate` was needed).
- Re-injected `bearing_fault` on pump2 → `vib_trend` now reports **real non-zero slopes**
  (e.g. `-0.0140 → -0.0090 → -0.0043 → +0.0021`). The negative-then-rising values reflect the just-cleared
  prior fault aging out of the 5-min window while the new ramp fills in — expected given overlapping
  windows, and proof the slope is genuinely computed (no longer stuck at 0).
- Cleared the fault to return to a healthy steady state.

---

## 8. Current test tally

`python -m pytest common/tests opc_ua_collector/tests feature_extractor/tests sensor_sim -q` → **68 passed**

| Suite | Tests |
|---|---|
| `sensor_sim` (fault engine, OPC-UA server, inject API) | 45 |
| `common/tests` (contract-sync guard) | 4 |
| `opc_ua_collector/tests` (validation + buffer) | 10 |
| `feature_extractor/tests` (feature math incl. epoch-scale guard) | 9 |
| **Total** | **68** |

Plus `sensor_sim/tests/test_inject.sh` (4 passed) against live containers.

---

## 9. Current running stack

`docker compose ps` (root `docker-compose.yml`):

| Container | Role | Status |
|---|---|---|
| sensor-sim-1/2/3 | OPC-UA pump simulators + inject API | healthy |
| influxdb | data-historian (bucket `pump_station`) | healthy |
| opc-ua-collector | OPC-UA subscription → `pump_telemetry` | up |
| feature-extractor | `pump_telemetry` → `pump_features` (30 s) | up |

Data path verified end-to-end. Bring up with `docker compose up --build -d`; tear down with
`docker compose down` (`-v` to also wipe the InfluxDB volume).

---

## 10. Not yet built (explicit follow-ups)

- `health-scorer`, `alert-manager`, `batch-sync`, `mock-upload` (decision/alert/export half)
- EdgeMind detection layer (4 domain agents + correlation filter + Claude orchestrator)
- React dashboard
- k3s / Helm + Prometheus stack
