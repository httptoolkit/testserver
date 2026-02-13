import { delay, StatusError } from '@httptoolkit/util';
import { WebSocketEndpoint } from '../ws-index.js';

const getRemainingPath = (path: string): string | undefined => {
    const idx = path.indexOf('/', '/ws/delay/'.length);
    return idx !== -1 ? '/ws' + path.slice(idx) : undefined;
};

const parseDelaySeconds = (path: string): number => {
    const idx = path.indexOf('/', '/ws/delay/'.length);
    const end = idx !== -1 ? idx : path.length;
    return parseFloat(path.slice('/ws/delay/'.length, end));
};

export const wsDelayEndpoint: WebSocketEndpoint = {
    matchPath: (path) => {
        if (!path.startsWith('/ws/delay/')) return false;
        const delaySeconds = parseDelaySeconds(path);
        if (isNaN(delaySeconds)) {
            throw new StatusError(400, `Invalid delay duration in ${path}`);
        }
        return true;
    },
    getRemainingPath,
    handle: async (ws, req, { path }) => {
        const delaySeconds = parseDelaySeconds(path);
        const cappedDelayMs = Math.min(delaySeconds, 10) * 1000;
        await delay(cappedDelayMs);
    }
};
