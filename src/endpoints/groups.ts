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
export const httpRequestInspection: EndpointGroup = {
    id: 'request-inspection',
    name: 'Request Inspection'
};

export const httpCustomResponses: EndpointGroup = {
    id: 'custom-responses',
    name: 'Custom Responses'
};

export const httpRedirects: EndpointGroup = {
    id: 'redirects',
    name: 'Redirects'
};

export const httpCaching: EndpointGroup = {
    id: 'caching',
    name: 'Caching'
};

export const httpAuthentication: EndpointGroup = {
    id: 'authentication',
    name: 'Authentication'
};

export const httpCookies: EndpointGroup = {
    id: 'cookies',
    name: 'Cookies'
};

export const httpResponseFormats: EndpointGroup = {
    id: 'response-formats',
    name: 'Response Formats'
};

export const httpResponseEncoding: EndpointGroup = {
    id: 'response-encoding',
    name: 'Response Encoding'
};

export const httpDynamicData: EndpointGroup = {
    id: 'dynamic-data',
    name: 'Dynamic Data'
};

export const httpTlsInspection: EndpointGroup = {
    id: 'tls-inspection',
    name: 'TLS Inspection'
};

export const httpErrors: EndpointGroup = {
    id: 'errors',
    name: 'Errors'
};

export const httpGroupOrder: EndpointGroup[] = [
    httpRequestInspection,
    httpCustomResponses,
    httpRedirects,
    httpCaching,
    httpAuthentication,
    httpCookies,
    httpResponseFormats,
    httpResponseEncoding,
    httpDynamicData,
    httpTlsInspection,
    httpErrors
];

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

export const wsGroupOrder: EndpointGroup[] = [
    wsMessaging,
    wsConnection,
    wsTiming,
    wsErrors
];

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

export const tlsGroupOrder: EndpointGroup[] = [
    tlsCertificateModes,
    tlsProtocolNegotiation,
    tlsVersions
];
