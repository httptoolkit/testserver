import { HttpEndpoint } from '../http-index.js';
import { httpContentExamples } from '../groups.js';

const DENY_TEXT = `
          .-''''''-.
        .' _      _ '.
       /   O      O   \\
      :                :
      |                |
      :       __       :
       \\  .-"\`  \`"-.  /
        '.          .'
          '-......-'
     YOU SHOULDN'T BE HERE
`;

export const deny: HttpEndpoint = {
    matchPath: (path) => path === '/deny',
    handle: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(DENY_TEXT);
    },
    meta: {
        path: '/deny',
        description: 'Returns a page denied by robots.txt.',
        examples: ['/deny'],
        group: httpContentExamples
    }
};
