import { httpContentExamples } from '../groups.js';
import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/robots.txt';

const handle: HttpHandler = (_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    // Only allow access to the root page:
    res.end('User-agent: *\nAllow: /$\nDisallow: /\n')
}

export const robotsTxt: HttpEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/robots.txt',
        description: 'Returns a robots.txt file that disallows crawling of all paths except the root.',
        examples: ['/robots.txt'],
        group: httpContentExamples
    }
};