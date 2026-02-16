import { serializeJson } from '../../util.js';
import { httpContentExamples } from '../groups.js';
import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/json';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/json'
    });

    // HTTPBin seems to just return this fixed example document:
    res.end(serializeJson({
        "slideshow": {
            "author": "Yours Truly",
            "date": "date of publication",
            "slides": [
                {
                    "title": "Wake up to WonderWidgets!",
                    "type": "all"
                },
                {
                    "items": [
                        "Why <em>WonderWidgets</em> are great",
                        "Who <em>buys</em> WonderWidgets"
                    ],
                    "title": "Overview",
                    "type": "all"
                }
            ],
            "title": "Sample Slide Show"
        }
    }));
}

export const json: HttpEndpoint = {
    matchPath,
    handle,
    meta: {
        path: '/json',
        description: 'Returns a sample JSON document.',
        examples: ['/json'],
        group: httpContentExamples
    }
};