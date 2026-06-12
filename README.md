# EdgeMind — Multi-Agent AI for Pod Resource Correlation
### Pump Station Condition Monitoring on ABB Edgenius (k3s)

EdgeMind detects cross-service resource anomalies in a Kubernetes-based industrial pump station pipeline using 4 domain agents + 1 Claude AI orchestrator. It reads **only standard infrastructure metrics** (CPU, memory, network, filesystem, PVC) — zero modification to the monitored workload.

---

## Architecture Overview

```
sensor-sim-1 ──┐
sensor-sim-2 ──┼──► opc-ua-collector ──► data-historian ──► feature-extractor ──► health-scorer ──► alert-manager
sensor-sim-3 ──┘                                         └──► batch-sync ──► PVC-2
```

Three OPC-UA pump simulators feed a 9-pod pipeline. EdgeMind watches the whole stack from the outside using Prometheus metrics.

---

## Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Docker Desktop | 4.x+ | Run sensor-sim containers |
| Docker Compose | v2 (bundled) | Orchestrate 3 pump containers |
| Python | 3.11+ | Run tests locally |
| Git | any | Clone repo |
| k3s | 1.29+ | Full pipeline deployment (later) |

---

## Repository Structure

```
k8s-Pod-Resource-AI-Driven-Correlation/
├── sensor_sim/                  ← Pump sensor simulation (complete)
│   ├── pump_config.py           ← Single source of truth: baselines, faults, OPC-UA layout
│   ├── fault_engine.py          ← Pure-math fault engine (FaultState, compute_reading)
│   ├── opc_server.py            ← asyncua OPC-UA server + emit loop
│   ├── inject_server.py         ← FastAPI fault injection HTTP API
│   ├── main.py                  ← Wiring layer (asyncio.gather)
│   ├── Dockerfile               ← Single image, env-driven per pump
│   ├── docker-compose.yml       ← 3 services: sensor-sim-1/2/3
│   ├── requirements.txt
│   └── tests/
│       ├── test_faults.py       ← Person A: pure math tests (12)
│       ├── test_server.py       ← Person B: OPC-UA server tests (25)
│       ├── test_inject.py       ← Person C: inject API tests (8)
│       └── test_inject.sh       ← Integration smoke test (containers must be running)
└── README.md
```

---

## Setup

### 1. Clone the repository

```bash
git clone git@github.com:chanjhana/k8s-Pod-Resource-AI-Driven-Correlation.git
cd k8s-Pod-Resource-AI-Driven-Correlation
```

### 2. Install Python dependencies (for local tests)

```bash
cd sensor_sim
pip install -r requirements.txt
```

### 3. Run the test suite (no Docker needed)

```bash
cd sensor_sim
python -m pytest -v
# Expected: 45 passed
```

---

## Running the Sensor Simulators

All commands run from `sensor_sim/`.

### Start all three pump containers

```bash
docker compose up --build -d
```

This builds one image and starts three containers:

| Container | Pump | OPC-UA Port | HTTP Port |
|---|---|---|---|
| sensor-sim-1 | Pump 1 (Primary, 75 kW) | 4840 | 8080 |
| sensor-sim-2 | Pump 2 (Secondary, 45 kW) | 4841 | 8081 |
| sensor-sim-3 | Pump 3 (Dosing, 7.5 kW) | 4842 | 8082 |

### Check containers are healthy

```bash
docker compose ps
```

### View live logs

```bash
docker compose logs -f sensor-sim-2
```

### Stop all containers

```bash
docker compose down
```

---

## Inject API

Each container exposes an HTTP API for fault injection.

### Check status (live sensor readings)

```bash
# Bash
curl http://localhost:8081/status

# PowerShell
curl.exe http://localhost:8081/status
```

### Inject a fault

```bash
# Bash
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"bearing_fault","duration_s":300}'

# PowerShell
curl.exe -X POST http://localhost:8081/inject -H "Content-Type: application/json" -d '{\"mode\":\"bearing_fault\",\"duration_s\":300}'
```

### Clear active fault

```bash
# Bash
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"clear"}'

# PowerShell
curl.exe -X POST http://localhost:8081/inject -H "Content-Type: application/json" -d '{\"mode\":\"clear\"}'
```

### Discover available modes

```bash
curl http://localhost:8081/modes
```

### Available fault modes

| Mode | Pump | Effect |
|---|---|---|
| `bearing_fault` | Pump 2 | Axial vibration drifts 0.8 → 4.8 mm/s over 5 min |
| `cavitation` | Pump 2 | Radial + tangential spike to 5.2 mm/s immediately |
| `flood` | Pump 2 | Emission rate jumps to 10 Hz (values stay normal) |
| `imbalance` | Pump 1 | Radial + tangential drift together over 4 min |
| `seal_leak` | Pump 1 | Temperature rises sharply over 6 min |
| `overheat` | Pump 3 | Temperature drifts 42 → 79 °C over 5 min |
| `sensor_noise` | Any | Occasional random spikes on all parameters |
| `clear` | Any | Cancel active fault, return to normal |

### Combined scenario (two containers at once)

```bash
# Bash — flood on pump2 + overheat on pump3 simultaneously
curl -X POST http://localhost:8081/inject -H "Content-Type: application/json" -d '{"mode":"flood"}'
curl -X POST http://localhost:8082/inject -H "Content-Type: application/json" -d '{"mode":"overheat","duration_s":300}'
```

---

## Integration Smoke Test (containers must be running)

```bash
bash tests/test_inject.sh
# Expected: 4 passed, 0 failed
```

---

## Watch a Fault Live

Open two terminals.

**Terminal 1 — watch values update:**
```bash
# Bash
watch -n 1 "curl -s http://localhost:8081/status"
```

**Terminal 2 — inject the fault:**
```bash
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"bearing_fault","duration_s":300}'
```

Watch `vibration_axial` climb from ~0.8 toward 4.8 mm/s over 5 minutes. Inject `clear` to reset.

---

## What's Next

| Layer | Status |
|---|---|
| sensor-sim (3 pumps, OPC-UA + inject API) | ✅ Complete |
| opc-ua-collector (subscribes to OPC-UA, writes to InfluxDB) | 🔲 Next |
| data-historian (InfluxDB 2.x) | 🔲 Next |
| feature-extractor | 🔲 Next |
| health-scorer | 🔲 Next |
| alert-manager | 🔲 Next |
| batch-sync | 🔲 Next |
| EdgeMind agents + orchestrator | 🔲 Next |
| Dashboard | 🔲 Next |
