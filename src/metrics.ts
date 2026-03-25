import * as http from 'http';
import client from 'prom-client';

export const register = new client.Registry();

// Collect default process metrics (memory, CPU, event loop lag, etc.)
client.collectDefaultMetrics({ register });

export const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'status_code', 'endpoint'] as const,
    registers: [register]
});

export const tlsConnectionsTotal = new client.Counter({
    name: 'tls_connections_total',
    help: 'Total number of TLS connections',
    labelNames: ['endpoint'] as const,
    registers: [register]
});

export const wsConnectionsTotal = new client.Counter({
    name: 'ws_connections_total',
    help: 'Total number of WebSocket connections',
    labelNames: ['endpoint'] as const,
    registers: [register]
});

export function startMetricsServer(port: number) {
    const server = http.createServer(async (_req, res) => {
        const metrics = await register.metrics();
        res.writeHead(200, { 'content-type': register.contentType });
        res.end(metrics);
    });

    server.listen(port, () => {
        console.log(`Metrics server listening on port ${port}`);
    });

    return server;
}
