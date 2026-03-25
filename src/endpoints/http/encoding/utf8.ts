import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { HttpEndpoint } from '../../http-index.js';
import { httpResponseFormats } from '../../groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UTF8_HTML = fs.readFileSync(path.join(__dirname, 'utf8-demo.html'), 'utf-8').trimEnd();

export const utf8Encoding: HttpEndpoint = {
    matchPath: (path) => path === '/encoding/utf8',
    handle: (_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(UTF8_HTML);
    },
    meta: {
        path: '/encoding/utf8',
        description: 'Returns a UTF-8 encoded HTML page with various Unicode characters.',
        examples: ['/encoding/utf8'],
        group: httpResponseFormats
    }
};
