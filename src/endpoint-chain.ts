import { StatusError } from '@httptoolkit/util';

const MAX_CHAIN_DEPTH = 10;

export interface ChainableEndpoint {
    matchPath: (path: string, hostnamePrefix?: string) => boolean;
    getRemainingPath?: (path: string) => string | undefined;
}

export function resolveEndpointChain<T extends ChainableEndpoint>(
    endpoints: Array<T & { name: string }>,
    initialPath: string,
    hostnamePrefix?: string
): Array<{ endpoint: T & { name: string }; path: string }> {
    const entries: Array<{ endpoint: T & { name: string }; path: string }> = [];
    let path: string | undefined = initialPath;

    while (path && entries.length <= MAX_CHAIN_DEPTH) {
        // matchPath may throw StatusError for invalid parameters
        const endpoint = endpoints.find(ep => ep.matchPath(path!, hostnamePrefix));
        if (!endpoint) {
            throw new StatusError(404, `Could not match endpoint for ${initialPath}${
                hostnamePrefix ? ` (${hostnamePrefix})` : ''
            }`);
        }

        entries.push({ endpoint, path });
        path = endpoint.getRemainingPath?.(path);
    }

    if (path) {
        throw new StatusError(400, `Endpoint chain exceeded maximum depth for ${initialPath}`);
    }

    return entries;
}
