import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ── EdgeMind Vite config ──────────────────────────────────────────────────────
// SSH tunnel maps local ports → VM kubectl port-forwards → k8s services:
//   localhost:8090 → VM:8080 → edgemind-server-svc (monitoring)
//   localhost:9090 → VM:9090 → prometheus (monitoring)
//   localhost:8001 → VM:8001 → sensor-sim-1 (pump-station)
//   localhost:8002 → VM:8002 → sensor-sim-2 (pump-station)
//   localhost:8003 → VM:8003 → sensor-sim-3 (pump-station)
//   localhost:8006 → VM:8006 → alert-manager (pump-station)
//
// Start tunnel: ssh -i ~/.ssh/edgemind-vm_key.pem -N \
//   -L 8090:localhost:8080 -L 8001:localhost:8001 -L 8002:localhost:8002 \
//   -L 8003:localhost:8003 -L 8006:localhost:8006 azureuser@172.188.241.209

const BACKEND_HOST = 'localhost'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': `http://${BACKEND_HOST}:8090`,
      '/ws': {
        target: `ws://${BACKEND_HOST}:8090`,
        ws: true,
      },
      '/sensor1': {
        target: `http://${BACKEND_HOST}:8001`,
        rewrite: path => path.replace(/^\/sensor1/, ''),
      },
      '/sensor2': {
        target: `http://${BACKEND_HOST}:8002`,
        rewrite: path => path.replace(/^\/sensor2/, ''),
      },
      '/sensor3': {
        target: `http://${BACKEND_HOST}:8003`,
        rewrite: path => path.replace(/^\/sensor3/, ''),
      },
      '/alertmanager': {
        target: `http://${BACKEND_HOST}:8006`,
        rewrite: path => path.replace(/^\/alertmanager/, ''),
      },
      '/featureextractor': {
        target: `http://${BACKEND_HOST}:8004`,
        rewrite: path => path.replace(/^\/featureextractor/, ''),
      },
    },
  },
})
