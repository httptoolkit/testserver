import * as streamConsumers from 'stream/consumers';

import {
    HttpEndpoint,
    HttpRequest,
    HttpResponse
} from '../http-index.js';

const matchPath = ((path: string) => path === '/echo');

interface ParsedFrame {
    stream_id: number;
    type: string;
    flags: string[];
    length: number;
    payload_hex: string;
}

interface FrameOutput extends ParsedFrame {
    decoded_headers?: { [key: string]: string | string[] };
}

function frameToOutput(frameBuffer: Buffer): ParsedFrame {
    const length = (frameBuffer[0] << 16) | (frameBuffer[1] << 8) | frameBuffer[2];
    const typeNum = frameBuffer[3];
    const flagsByte = frameBuffer[4];
    const streamId = ((frameBuffer[5] & 0x7f) << 24) | (frameBuffer[6] << 16) |
                     (frameBuffer[7] << 8) | frameBuffer[8];

    const FRAME_TYPES: { [key: number]: string } = {
        0x0: 'DATA', 0x1: 'HEADERS', 0x2: 'PRIORITY', 0x3: 'RST_STREAM',
        0x4: 'SETTINGS', 0x5: 'PUSH_PROMISE', 0x6: 'PING',
        0x7: 'GOAWAY', 0x8: 'WINDOW_UPDATE', 0x9: 'CONTINUATION'
    };

    const FRAME_FLAGS: { [type: number]: { [flag: number]: string } } = {
        0x0: { 0x1: 'END_STREAM', 0x8: 'PADDED' },
        0x1: { 0x1: 'END_STREAM', 0x4: 'END_HEADERS', 0x8: 'PADDED', 0x20: 'PRIORITY' },
        0x4: { 0x1: 'ACK' },
        0x5: { 0x4: 'END_HEADERS', 0x8: 'PADDED' },
        0x6: { 0x1: 'ACK' },
        0x9: { 0x4: 'END_HEADERS' }
    };

    const flags: string[] = [];
    const flagDefs = FRAME_FLAGS[typeNum] || {};
    for (const [flagValue, flagName] of Object.entries(flagDefs)) {
        if (flagsByte & parseInt(flagValue)) {
            flags.push(flagName);
        }
    }

    const payload = frameBuffer.subarray(9, 9 + length);

    return {
        stream_id: streamId,
        type: FRAME_TYPES[typeNum] || `UNKNOWN_${typeNum}`,
        flags,
        length,
        payload_hex: payload.toString('hex')
    };
}

function writeFrame(res: HttpResponse, frame: ParsedFrame, req?: HttpRequest) {
    const output: FrameOutput = { ...frame };

    if (req && (frame.type === 'HEADERS' || frame.type === 'CONTINUATION')) {
        if (frame.flags.includes('END_HEADERS')) {
            output.decoded_headers = req.headers as { [key: string]: string | string[] };
        }
    }

    (res as any).write(JSON.stringify(output) + '\n');
}

async function handle(req: HttpRequest, res: HttpResponse) {
    if (req.httpVersion === '2.0') {
        const stream = (req as any).stream;
        const session = stream?.session;
        const jsStreamSocket = session?.socket;
        const capturingStream = (jsStreamSocket as any)?.stream;

        if (!capturingStream?.addStreamCallback) {
            res.writeHead(500);
            res.end('Echo endpoint requires data capturing stream');
            return;
        }

        const requestStreamId = stream?.id as number | undefined;
        if (requestStreamId === undefined) {
            res.writeHead(500);
            res.end('Could not determine stream ID');
            return;
        }

        res.writeHead(200, { 'Content-Type': 'text/plain' });

        let responseEnded = false;

        const writeFrameBuffer = (frameBuffer: Buffer, isGlobal: boolean) => {
            if (responseEnded) return;
            const frame = frameToOutput(frameBuffer);
            writeFrame(res, frame, isGlobal ? undefined : req);
        };

        const { globalFrames, streamFrames } = capturingStream.addStreamCallback(
            requestStreamId,
            (frameBuffer: Buffer) => {
                const frame = frameToOutput(frameBuffer);
                if (frame.stream_id === 0) {
                    writeFrame(res, frame);
                } else if (frame.stream_id === requestStreamId) {
                    writeFrame(res, frame, req);
                }
            }
        );

        for (const frameBuffer of globalFrames) {
            writeFrameBuffer(frameBuffer, true);
        }

        for (const frameBuffer of streamFrames) {
            writeFrameBuffer(frameBuffer, false);
        }

        req.resume();

        req.on('end', () => {
            responseEnded = true;
            capturingStream.removeStreamCallback(requestStreamId);
            res.end();
        });

        req.on('error', () => {
            responseEnded = true;
            capturingStream.removeStreamCallback(requestStreamId);
            res.end();
        });

        return;
    }

    // HTTP/1.x: return raw request data
    // Defer briefly to allow other pipelined requests to register
    await new Promise<void>(resolve => process.nextTick(resolve));

    if (req.socket.pipelining) {
        res.writeHead(400);
        res.end('Echo endpoint does not support request pipelining. Send requests sequentially or use HTTP/2 multiplexing instead.');
        return;
    }

    await streamConsumers.buffer(req);
    const rawData = Buffer.concat(req.socket.receivedData ?? []);

    res.writeHead(200, {
        'Content-Length': Buffer.byteLength(rawData)
    });
    res.end(rawData);
}

export const echo: HttpEndpoint = {
    matchPath,
    handle,
    needsRawData: true,
    meta: {
        path: '/echo',
        description: 'Echoes back the raw HTTP request data. For HTTP/2, returns parsed frame data as JSON lines.',
        examples: ['/echo']
    }
}
