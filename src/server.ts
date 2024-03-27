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

const logEmits = (name, emitter) => {
    const originalEmit = emitter.emit;
    emitter.emit = function () {
        const eventType = arguments[0];
        console.log(`${name} fired ${eventType}`);
        return originalEmit.apply(this, arguments);
    };
}

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

const port = process.env.PORT ?? 3000;
tcpServer.listen(port, () => {
    console.log(`Testserver listening on port ${port}`);
});