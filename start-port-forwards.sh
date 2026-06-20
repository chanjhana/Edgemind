#!/usr/bin/env bash
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
sudo killall kubectl 2>/dev/null || true
sleep 1
nohup sudo -E kubectl port-forward svc/edgemind-server-svc 8080:8080 -n monitoring --address 0.0.0.0 > ~/pf-server.log 2>&1 &
nohup sudo -E kubectl port-forward svc/sensor-sim-1-svc 8001:8080 -n pump-station --address 0.0.0.0 > ~/pf-sim1.log 2>&1 &
nohup sudo -E kubectl port-forward svc/sensor-sim-2-svc 8002:8080 -n pump-station --address 0.0.0.0 > ~/pf-sim2.log 2>&1 &
nohup sudo -E kubectl port-forward svc/sensor-sim-3-svc 8003:8080 -n pump-station --address 0.0.0.0 > ~/pf-sim3.log 2>&1 &
nohup sudo -E kubectl port-forward svc/alert-manager-svc 8006:8090 -n pump-station --address 0.0.0.0 > ~/pf-alertmanager.log 2>&1 &
sleep 2
ps aux | grep kubectl
