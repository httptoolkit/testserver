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

const httpServer = new http.Server(async (req, res) => {
    console.log(`Handling request to ${req.url}`);

    if (req.url === '/echo') {
        await streamConsumers.buffer(req); // Wait for all request data
        res.writeHead(200);
        res.end(Buffer.concat(req.socket.pendingInput ?? []));
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

    const duplex = stream.Duplex.from({ writable: conn, readable: conn });
    duplex.pendingInput = conn.pendingInput;
    httpServer.emit('connection', duplex);
});

tcpServer.on('error', (err) => {
    console.error(err);
});

const port = process.env.PORT ?? 3000;
tcpServer.listen(port, () => {
    console.log(`Testserver listening on port ${port}`);
});