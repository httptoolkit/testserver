import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/json';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/json'
    });

    // HTTPBin seems to just return this fixed example document:
    res.end(JSON.stringify({
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
    }, null, 2));
}

export const json: HttpEndpoint = {
    matchPath,
    handle
};