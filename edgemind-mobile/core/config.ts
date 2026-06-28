/**
 * API configuration — edit API_BASE_URL to point at your FastAPI server.
 * For local dev: your machine's LAN IP (not localhost — device can't reach localhost).
 * For production: your deployed URL.
 */
export const API_CONFIG = {
  // Configured to point directly to VM public NodePort for physical mobile devices
  baseUrl: 'http://172.188.241.209:30080',
  wsUrl:   'ws://172.188.241.209:30080/ws',
  timeout: 10_000,
};
