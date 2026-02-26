import { WebSocketEndpoint } from '../ws-index.js';
import { wsConnection } from '../groups.js';

const SUBPROTOCOL_PREFIX = '/ws/subprotocol/';

export const wsSubprotocolEndpoint: WebSocketEndpoint = {
    matchPath: (path) => {
        return path.startsWith(SUBPROTOCOL_PREFIX) && path.length > SUBPROTOCOL_PREFIX.length;
    },
    getRemainingPath: (path) => {
        const idx = path.indexOf('/', SUBPROTOCOL_PREFIX.length);
        return idx !== -1 ? '/ws' + path.slice(idx) : undefined;
    },
    getProtocol: (path) => {
        const idx = path.indexOf('/', SUBPROTOCOL_PREFIX.length);
        const end = idx !== -1 ? idx : path.length;
        return decodeURIComponent(path.slice(SUBPROTOCOL_PREFIX.length, end));
    },
    handle: () => {},
    meta: {
        path: '/ws/subprotocol/{name}',
        description: 'Forces the specified subprotocol in the upgrade response Sec-WebSocket-Protocol header, regardless of what the client requested.',
        examples: ['/ws/subprotocol/graphql-ws/echo', '/ws/subprotocol/mqtt/message/hello/close/1000'],
        group: wsConnection
    }
};

const NO_SUBPROTOCOL_PATH = '/ws/no-subprotocol';

export const wsNoSubprotocolEndpoint: WebSocketEndpoint = {
    matchPath: (path) => {
        return path === NO_SUBPROTOCOL_PATH || path.startsWith(NO_SUBPROTOCOL_PATH + '/');
    },
    getRemainingPath: (path) => {
        return path.length > NO_SUBPROTOCOL_PATH.length
            ? '/ws' + path.slice(NO_SUBPROTOCOL_PATH.length)
            : undefined;
    },
    getProtocol: () => false,
    handle: () => {},
    meta: {
        path: '/ws/no-subprotocol',
        description: 'Explicitly omits the Sec-WebSocket-Protocol header from the upgrade response, overriding the default behavior where the server auto-selects the first client-offered protocol.',
        examples: ['/ws/no-subprotocol/echo'],
        group: wsConnection
    }
};
