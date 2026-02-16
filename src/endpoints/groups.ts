export interface EndpointGroup {
    id: string;
    name: string;
    description?: string;
    combinedExamples?: string[];
}

export interface EndpointMeta {
    path: string;
    description: string;
    examples?: string[];
    group?: EndpointGroup;
}

// HTTP endpoint groups
export const httpContentExamples: EndpointGroup = {
    id: 'content-examples',
    name: 'Response Content Formats'
};

export const httpAuthentication: EndpointGroup = {
    id: 'authentication',
    name: 'Authentication'
};

export const httpCookies: EndpointGroup = {
    id: 'cookies',
    name: 'Cookies'
};

export const httpContentEncoding: EndpointGroup = {
    id: 'content-encoding',
    name: 'Response Content Encodings'
};

export const httpErrors: EndpointGroup = {
    id: 'errors',
    name: 'Errors'
};

// WebSocket endpoint groups
export const wsMessaging: EndpointGroup = {
    id: 'messaging',
    name: 'Messaging'
};

export const wsConnection: EndpointGroup = {
    id: 'connection',
    name: 'Connection'
};

export const wsTiming: EndpointGroup = {
    id: 'timing',
    name: 'Timing'
};

export const wsErrors: EndpointGroup = {
    id: 'errors',
    name: 'Errors'
};

// TLS endpoint groups
export const tlsCertificateModes: EndpointGroup = {
    id: 'certificate-modes',
    name: 'Certificate Modes'
};

export const tlsProtocolNegotiation: EndpointGroup = {
    id: 'protocol-negotiation',
    name: 'Protocol Negotiation',
    description: 'Endpoints that negotiate specific protocols via ALPN. These can be used together, to simulate a server supporting specific combinations of protocols, in the preference order specified.'
};

export const tlsVersions: EndpointGroup = {
    id: 'versions',
    name: 'TLS Versions',
    description: 'Endpoints that only accept specific TLS versions. These can be used together, to simulate a server supporting any specific combination of versions.'
};