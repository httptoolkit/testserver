import { StatusError } from '@httptoolkit/util';
import { WebSocketEndpoint } from '../ws-index.js';
import { wsMessaging } from '../groups.js';

const REPEAT_PREFIX = '/ws/repeat/';

const getRemainingPath = (path: string): string | undefined => {
    // /ws/repeat/$message/$freq/...
    const afterPrefix = path.slice(REPEAT_PREFIX.length);
    const firstSlash = afterPrefix.indexOf('/');
    if (firstSlash === -1) return undefined;
    const afterMessage = afterPrefix.slice(firstSlash + 1);
    const secondSlash = afterMessage.indexOf('/');
    return secondSlash !== -1 ? '/ws' + afterMessage.slice(secondSlash) : undefined;
};

const parseParams = (path: string): { message: string; freqMs: number } => {
    const afterPrefix = path.slice(REPEAT_PREFIX.length);
    const firstSlash = afterPrefix.indexOf('/');
    if (firstSlash === -1) {
        return { message: '', freqMs: NaN };
    }
    const message = decodeURIComponent(afterPrefix.slice(0, firstSlash));
    const afterMessage = afterPrefix.slice(firstSlash + 1);
    const secondSlash = afterMessage.indexOf('/');
    const freqStr = secondSlash !== -1 ? afterMessage.slice(0, secondSlash) : afterMessage;
    return { message, freqMs: parseInt(freqStr, 10) };
};

export const wsRepeatEndpoint: WebSocketEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith(REPEAT_PREFIX)) return false;
        const { freqMs } = parseParams(path);
        if (isNaN(freqMs) || freqMs <= 0) {
            throw new StatusError(400, `Invalid repeat frequency in ${path}`);
        }
        return true;
    },
    getRemainingPath,
    handle: (ws, req, { path }) => {
        const { message, freqMs } = parseParams(path);

        const interval = setInterval(() => {
            if (ws.readyState === ws.OPEN) {
                ws.send(message);
            } else {
                clearInterval(interval);
            }
        }, freqMs);

        ws.on('close', () => clearInterval(interval));
    },
    meta: {
        path: '/ws/repeat/{message}/{intervalMs}',
        description: 'Repeatedly sends the specified message at the given interval (in milliseconds). Can be chained with other WS endpoints.',
        examples: ['/ws/repeat/ping/1000', '/ws/repeat/heartbeat/5000/echo'],
        group: wsMessaging
    }
};
