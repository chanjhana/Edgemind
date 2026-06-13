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
| Docker | 24.x+ | Build and run containers |
| k3d | 5.x+ | Run k3s in Docker |
| kubectl | 1.29+ | Interact with the cluster |
| helm | 3.x+ | Install InfluxDB and Prometheus |
| Git | any | Clone repo |
| Python | 3.11+ | Run tests locally (optional) |

---

## Platform-Specific Setup

### macOS

**Recommended: OrbStack** (lighter than Docker Desktop on Apple Silicon)

```bash
# Install OrbStack from https://orbstack.dev — it includes Docker
# Then install CLI tools
brew install k3d kubectl helm

# Verify Docker is working via OrbStack
docker context use orbstack
docker ps
```

If you prefer Docker Desktop instead of OrbStack, install it from https://docker.com and skip the `docker context use orbstack` step. Do **not** run both at the same time.

**Memory:** If you are on 8 GB RAM, cap OrbStack's memory limit to 4 GB in OrbStack → Settings → Resources before proceeding.

---

### Linux

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker

# Install k3d
curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
```

---

### Windows

Use **WSL2** (Windows Subsystem for Linux). Run all commands inside a WSL2 Ubuntu terminal.

```powershell
# In PowerShell (as Administrator) — enable WSL2
wsl --install
# Restart your machine, then open Ubuntu from the Start menu
```

Inside WSL2 Ubuntu, follow the Linux instructions above. Docker Desktop for Windows with the WSL2 backend also works — enable it in Docker Desktop → Settings → Resources → WSL Integration.

---

## Step-by-Step Cluster Setup

### 1. Create the k3d cluster

```bash
k3d cluster create edgemind \
  --servers 1 \
  --agents 0 \
  --k3s-arg "--disable=traefik@server:0" \
  --k3s-arg "--disable=metrics-server@server:0" \
  --wait

# Verify the cluster is up
kubectl config use-context k3d-edgemind
kubectl get nodes
# Expected: k3d-edgemind-server-0   Ready
```

> **Low RAM (8 GB) tip:** The flags above disable traefik and metrics-server to save ~150 MB. Do not add agent nodes on 8 GB machines.

---

### 2. Add Helm repositories

```bash
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo add influxdata https://helm.influxdata.com/
helm repo update

# Verify
helm repo list
```

---

### 3. Create namespaces

```bash
kubectl apply -f k8s/namespaces.yaml

# Verify
kubectl get namespaces | grep -E "pump-station|monitoring"
```

---

### 4. Install Prometheus

```bash
helm install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring \
  --set prometheus.prometheusSpec.scrapeInterval=15s \
  --set grafana.enabled=false \
  --set prometheus.prometheusSpec.retention=7d

# Wait for all pods to be running (~60–90s)
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=prometheus \
  -n monitoring --timeout=180s

kubectl get pods -n monitoring
```

---

### 5. Install InfluxDB

```bash
helm install data-historian influxdata/influxdb2 \
  --namespace pump-station \
  --set adminUser.organization=edgemind \
  --set adminUser.bucket=pump_station \
  --set adminUser.token=edgemind-dev-token \
  --set adminUser.user=admin \
  --set adminUser.password=edgemind-admin \
  --set persistence.enabled=true \
  --set persistence.size=2Gi \
  --set resources.requests.memory=256Mi \
  --set resources.requests.cpu=100m \
  --set resources.limits.memory=512Mi \
  --set resources.limits.cpu=500m

# Wait for it
kubectl wait --for=condition=ready pod \
  -l app.kubernetes.io/name=influxdb2 \
  -n pump-station --timeout=120s

# Confirm service name — must be data-historian-influxdb2
kubectl get svc -n pump-station
```

---

### 6. Apply base manifests

```bash
kubectl apply -f k8s/pump-station/00-pvc.yaml
kubectl apply -f k8s/pump-station/01-secrets.yaml
kubectl apply -f k8s/pump-station/02-resource-quota.yaml
kubectl apply -f k8s/monitoring/redis.yaml
```

---

### 7. Build Docker images

Run from the repo root:

```bash
docker build -t edgemind/sensor-sim:dev ./sensor_sim
docker build -f opc_ua_collector/Dockerfile  -t edgemind/opc-ua-collector:dev  .
docker build -f feature_extractor/Dockerfile -t edgemind/feature-extractor:dev .
docker build -f health_scorer/Dockerfile     -t edgemind/health-scorer:dev     .
docker build -f alert_manager/Dockerfile     -t edgemind/alert-manager:dev     .
docker build -f batch_sync/Dockerfile        -t edgemind/batch-sync:dev        .
docker build -f mock_upload/Dockerfile       -t edgemind/mock-upload:dev       .
```

---

### 8. Import images into k3d

k3d runs its own containerd registry isolated from your local Docker. Images must be explicitly imported:

```bash
k3d image import \
  edgemind/sensor-sim:dev \
  edgemind/opc-ua-collector:dev \
  edgemind/feature-extractor:dev \
  edgemind/health-scorer:dev \
  edgemind/alert-manager:dev \
  edgemind/batch-sync:dev \
  edgemind/mock-upload:dev \
  -c edgemind
```

> **Note:** Any time you rebuild an image you must re-run `k3d image import` and then `kubectl rollout restart deployment/<name> -n pump-station` for the pod to pick up the new image.

---

### 9. Deploy the pipeline

```bash
# Sensors first
kubectl apply -f k8s/pump-station/sensor-sim-1.yaml
kubectl apply -f k8s/pump-station/sensor-sim-2.yaml
kubectl apply -f k8s/pump-station/sensor-sim-3.yaml

# Wait for sensors before pipeline pods
kubectl wait --for=condition=ready pod \
  -l component=sensor \
  -n pump-station --timeout=120s

# Pipeline
kubectl apply -f k8s/pump-station/opc-ua-collector.yaml
kubectl apply -f k8s/pump-station/mock-upload.yaml
kubectl apply -f k8s/pump-station/feature-extractor.yaml
kubectl apply -f k8s/pump-station/health-scorer.yaml
kubectl apply -f k8s/pump-station/alert-manager.yaml
kubectl apply -f k8s/pump-station/batch-sync.yaml
```

---

### 10. Verify everything is running

```bash
kubectl get pods -n pump-station
kubectl get pods -n monitoring
```

All pods should show `1/1 Running`. Expected pod list for `pump-station`:

```
data-historian-influxdb2-0   1/1 Running
sensor-sim-1-*               1/1 Running
sensor-sim-2-*               1/1 Running
sensor-sim-3-*               1/1 Running
opc-ua-collector-*           1/1 Running
feature-extractor-*          1/1 Running
health-scorer-*              1/1 Running
alert-manager-*              1/1 Running
batch-sync-*                 1/1 Running
mock-upload-*                1/1 Running
```

---

## Verifying the Pipeline End-to-End

### Check data is flowing

```bash
# feature-extractor should be computing bearing health every 30s
kubectl logs -n pump-station deployment/feature-extractor | grep "bearing_health" | tail -5

# health-scorer should be classifying pump state
kubectl logs -n pump-station deployment/health-scorer | grep "pump=" | tail -5
```

Expected output:
```
feature-extractor — pump=pump2 samples=280 bearing_health=93.8 vib_trend=0.0001
health-scorer     — pump=pump2 bearing_health=93.7 state=HEALTHY action=none
```

### Inject a fault and watch detection

```bash
# Port-forward sensor-sim-2's inject API to your machine
kubectl port-forward -n pump-station deployment/sensor-sim-2 8081:8080 &

# Inject a bearing fault
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"bearing_fault","duration_s":300}'

# Watch health-scorer detect degradation (~2–3 minutes)
kubectl logs -f -n pump-station deployment/health-scorer | grep pump2
```

You should see `bearing_health` drop from ~94 → 74 → `state=WARNING` → `action=trigger_both`. That confirms the full detection chain works.

Clear the fault when done:

```bash
curl -X POST http://localhost:8081/inject \
  -H "Content-Type: application/json" \
  -d '{"mode":"clear"}'

kill %1  # stop the port-forward
```

---

## Available Fault Modes

| Mode | Pump | Effect |
|---|---|---|
| `bearing_fault` | pump2 | Axial vibration drifts 0.8 → 4.8 mm/s over 5 min |
| `cavitation` | pump2 | Radial + tangential spike to 5.2 mm/s immediately |
| `flood` | pump2 | Emission rate jumps to 10 Hz (values stay normal) |
| `imbalance` | pump1 | Radial + tangential drift together over 4 min |
| `seal_leak` | pump1 | Temperature rises sharply over 6 min |
| `overheat` | pump3 | Temperature drifts 42 → 79 °C over 5 min |
| `sensor_noise` | any | Occasional random spikes on all parameters |
| `clear` | any | Cancel active fault, return to normal |

---

## Teardown

```bash
# Delete just the project namespaces (keeps cluster)
kubectl delete namespace pump-station monitoring

# Or delete the entire cluster
k3d cluster delete edgemind

# Free disk space from unused images
docker system prune -af --volumes
```

---

## Troubleshooting

**Pods stuck in `CreateContainerConfigError`**
The `influxdb-token` secret is missing. Run:
```bash
kubectl apply -f k8s/pump-station/01-secrets.yaml
kubectl rollout restart deployment/opc-ua-collector deployment/feature-extractor deployment/health-scorer -n pump-station
```

**Pods stuck in `Pending`**
The PVC hasn't been created. Run:
```bash
kubectl apply -f k8s/pump-station/00-pvc.yaml
kubectl get pvc -n pump-station  # should show Bound
```

**`ModuleNotFoundError: No module named 'common'`**
The Dockerfile is missing `PYTHONPATH`. Ensure each affected Dockerfile (`health_scorer`, `alert_manager`, `batch_sync`) has this line **before** the `WORKDIR` line:
```dockerfile
ENV PYTHONPATH=/app
```
Rebuild and reimport the image after fixing.

**`unable to retrieve container logs`** (container crashing too fast)
Use `kubectl describe pod` instead:
```bash
kubectl describe pod -n pump-station -l app=<pod-name> | tail -30
```
Look at the `Events:` section and `Exit Code` for the actual failure reason.

**OrbStack or Docker running out of memory**
- Cap OrbStack memory: OrbStack → Settings → Resources → Memory → 4 GB
- Check which context kubectl is using: `kubectl config current-context` — should say `k3d-edgemind`, not `orbstack`
- Switch context if wrong: `kubectl config use-context k3d-edgemind`

**Wrong kubectl context (pods appearing in OrbStack's built-in k8s)**
```bash
kubectl config use-context k3d-edgemind
kubectl config current-context  # must print k3d-edgemind
```

---

## Repository Structure

```
k8s-Pod-Resource-AI-Driven-Correlation/
├── k8s/
│   ├── namespaces.yaml
│   ├── monitoring/
│   │   └── redis.yaml
│   └── pump-station/
│       ├── 00-pvc.yaml
│       ├── 01-secrets.yaml
│       ├── 02-resource-quota.yaml
│       ├── sensor-sim-1/2/3.yaml
│       ├── opc-ua-collector.yaml
│       ├── feature-extractor.yaml
│       ├── health-scorer.yaml
│       ├── alert-manager.yaml
│       ├── batch-sync.yaml
│       └── mock-upload.yaml
├── sensor_sim/           ← OPC-UA pump simulators + fault injection API
├── opc_ua_collector/     ← subscribes to OPC-UA, writes to InfluxDB
├── feature_extractor/    ← computes bearing health features
├── health_scorer/        ← classifies pump state, triggers alerts
├── alert_manager/        ← enriches and stores alerts
├── batch_sync/           ← bulk Parquet export to PVC
├── mock_upload/          ← simulated cloud upload endpoint
└── common/               ← shared contract (field names, thresholds)
```