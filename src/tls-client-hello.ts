import { TLSSocket } from 'tls';
import type { TlsClientHelloMessage } from 'read-tls-client-hello';
import type { HttpRequest } from './endpoints/http-index.js';

export const TLS_CLIENT_HELLO: unique symbol = Symbol('tlsClientHello');

export interface TlsClientHelloData extends TlsClientHelloMessage {
    ja3: string;
    ja4: string;
}

export function getClientHello(req: HttpRequest): TlsClientHelloData | undefined {
    // HTTP/1: socket is the TLS socket directly
    if (req.socket instanceof TLSSocket) {
        return req.socket[TLS_CLIENT_HELLO];
    }

    // HTTP/2: req.socket is a JSStreamSocket wrapping our DataCapturingStream.
    // The DataCapturingStream has the symbol, accessible via .stream on the JSStreamSocket.
    const innerStream = (req.socket as any).stream;
    return innerStream?.[TLS_CLIENT_HELLO];
}
