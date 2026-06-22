# EdgeMind Helm chart

A Helm packaging of the EdgeMind-owned Kubernetes workloads — the pump-station
pipeline (Layer 0) and the EdgeMind detection agents + correlation server
(Layers 1 & 2). It is a faithful conversion of the raw manifests under
[`../../k8s/`](../../k8s/); both forms are kept (the raw manifests are still used
by `deploy.sh`).

## What it deploys

**`monitoring` namespace**
- `edgemind-agents` (Deployment) — rollout pinned to `maxSurge: 0`
- `edgemind-server` (Deployment + NodePort Service `:30080`)
- `redis` (Deployment + Service)
- ServiceAccount `edgemind-sa` + ClusterRole/Binding `edgemind-reader`
- *(optional)* `groq-credentials` LLM secret

**`pump-station` namespace**
- `sensor-sim-1/2/3`, `opc-ua-collector`, `feature-extractor`, `health-scorer`,
  `alert-manager`, `batch-sync`, `mock-upload` (Deployments; most with Services)
- `export-data` PVC, `pump-station-quota` ResourceQuota, `influxdb-token` Secret

## What it does NOT deploy (external dependencies)

These are installed separately (as in `deploy.sh`) and are intentionally out of
scope so the chart doesn't fight those releases:

1. **InfluxDB** (`data-historian`):
   ```bash
   helm upgrade --install data-historian influxdata/influxdb2 -n pump-station \
     --set adminUser.organization=edgemind \
     --set adminUser.bucket=pump_station \
     --set adminUser.token=edgemind-dev-token
   ```
2. **kube-prometheus-stack** (release `monitoring`):
   ```bash
   helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
     -n monitoring --create-namespace --set grafana.enabled=false
   ```

> The `influx.token` value here must match the token used in the InfluxDB install.

## Install

Images are local `edgemind/<svc>:dev` loaded into k3d (`imagePullPolicy: Never`).
Build/import them first (`bash deploy.sh` does this), then:

```bash
# namespaces already exist after the external installs above:
helm upgrade --install edgemind ./helm/edgemind --set namespaces.create=false

# provide the LLM key (either let the chart create the secret …)
helm upgrade --install edgemind ./helm/edgemind \
  --set namespaces.create=false \
  --set llmCredentials.create=true \
  --set llmCredentials.apiKey=<YOUR_GROQ_KEY>

# … or create it yourself and leave llmCredentials.create=false (default):
kubectl create secret generic groq-credentials -n monitoring \
  --from-literal=api-key=<YOUR_GROQ_KEY>
```

If you let the chart create the namespaces (`namespaces.create=true`, default),
install the external charts into those namespaces *after* this chart, or pre-create
the namespaces — Helm sorts `Namespace` first so a single `helm install` is fine.

## Common overrides

| Value | Default | Purpose |
|---|---|---|
| `global.imageTag` | `dev` | Tag for all EdgeMind images |
| `global.imagePullPolicy` | `Never` | Set `IfNotPresent`/`Always` for a real registry |
| `namespaces.create` | `true` | Disable if namespaces already exist |
| `llmCredentials.create` / `.apiKey` | `false` / `""` | Let the chart manage the LLM secret |
| `featureExtractor.leakMode` | `false` | Trigger the memory-leak demo scenario |
| `influxdbToken.token` | `edgemind-dev-token` | Must match the InfluxDB install |
| `edgemindServer.service.nodePort` | `30080` | Server NodePort |
| `<service>.enabled` | `true` | Toggle any individual workload |

See [`values.yaml`](values.yaml) for the full set (per-service replicas, resources,
ports, env).

## Verify locally

```bash
helm lint ./helm/edgemind
helm template edgemind ./helm/edgemind | kubectl apply --dry-run=client -f -
```
