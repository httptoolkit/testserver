import * as net from 'node:net';
import * as zlib from 'node:zlib';
import { expect } from 'chai';
import { DestroyableServer, makeDestroyable } from 'destroyable-server';

import { createServer } from '../src/server.js';

describe('Encoding Endpoints', () => {

    let server: DestroyableServer;
    let serverPort: number;

    beforeEach(async () => {
        server = makeDestroyable(await createServer());
        await new Promise<void>((resolve) => server.listen(resolve));
        serverPort = (server.address() as net.AddressInfo).port;
    });

    afterEach(async () => {
        await server.destroy();
    });

    const testCases = [
        {
            name: 'gzip',
            expectedJson: { gzipped: true }
        },
        {
            name: 'deflate',
            expectedJson: { deflated: true }
        },
        {
            name: 'brotli',
            encodingName: 'br',
            expectedJson: { brotli: true }
        },
        {
            name: 'zstd',
            expectedJson: { zstd: true }
        },
        {
            name: 'identity',
            expectedJson: { identity: true }
        }
    ];

    testCases.forEach(({ name, encodingName, expectedJson }) => {
        it(`/encoding/${name} should return decodeable content`, async () => {
            const url = `http://localhost:${serverPort}/encoding/${name}`;
            const response = await fetch(url);

            expect(response.status).to.equal(200);
            expect(response.headers.get('content-encoding')).to.equal(encodingName || name);

            const actualJson = await response.json(); // Content is decodeable by fetch automatically

            expect(actualJson).to.deep.equals(expectedJson);
        });
    });
});