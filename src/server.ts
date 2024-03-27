import * as net from 'net';
import * as http from 'http';
import * as stream from 'stream';
import * as streamConsumers from 'stream/consumers';

declare module 'stream' {
    interface Duplex {
        pendingInput?: Buffer[];
    }
}

const clearArray = (array: Array<unknown> | undefined) => {
    if (!array) return;
    array.length = 0;
}

const createServer = () => {
    const httpServer = new http.Server(async (req, res) => {
        console.log(`Handling request to ${req.url}`);

        if (req.url === '/echo') {
            await streamConsumers.buffer(req); // Wait for all request data
            const input = Buffer.concat(req.socket.pendingInput ?? []);
            res.writeHead(200, {
                'Content-Length': Buffer.byteLength(input)
            });
            res.end(input);
        } else {
            res.writeHead(404);
            res.end(`No handler for ${req.url}`);
        }

        clearArray(req.socket.pendingInput);
    });

    const tcpServer = net.createServer();
    tcpServer.on('connection', (conn) => {
        conn.pendingInput = [];

        conn.on('data', (data) => {
            conn.pendingInput?.push(data);
        });

        conn.on('error', (err) => console.error('TCP socket error', err));

        const duplex = stream.Duplex.from({ writable: conn, readable: conn });
        duplex.pendingInput = conn.pendingInput;
        httpServer.emit('connection', duplex);
    });

    httpServer.on('error', (err) => console.error('HTTP server error', err));
    tcpServer.on('error', (err) => console.error('TCP server error', err));

    return tcpServer;
};

export { createServer };

// This is not a perfect test (various odd cases) but good enough
const wasRunDirectly = import.meta.filename === process?.argv[1];
if (wasRunDirectly) {
    const port = process.env.PORT ?? 3000;
    const server = createServer();
    server.listen(port, () => {
        console.log(`Testserver listening on port ${port}`);
    });
}