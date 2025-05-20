import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string, hostnamePrefix: string | undefined) =>
    path === '/' && hostnamePrefix === 'example';

const handle: HttpHandler = (_req, res) => {
    // This is a static copy of the current example.com output, to allow easy migration of tests that use example.com
    // to use this endpoint instead. It's not intended to be perfectly identical in every possible behaviour, but
    // should be a good test for anything just checking basic response details.
    res.writeHead(200, {
        'content-type': 'text/html'
    });

    res.end(
`<!doctype html>
<html>
<head>
    <title>Example Domain</title>

    <meta charset="utf-8" />
    <meta http-equiv="Content-type" content="text/html; charset=utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style type="text/css">
    body {
        background-color: #f0f0f2;
        margin: 0;
        padding: 0;
        font-family: -apple-system, system-ui, BlinkMacSystemFont, "Segoe UI", "Open Sans", "Helvetica Neue", Helvetica, Arial, sans-serif;
        
    }
    div {
        width: 600px;
        margin: 5em auto;
        padding: 2em;
        background-color: #fdfdff;
        border-radius: 0.5em;
        box-shadow: 2px 3px 7px 2px rgba(0,0,0,0.02);
    }
    a:link, a:visited {
        color: #38488f;
        text-decoration: none;
    }
    @media (max-width: 700px) {
        div {
            margin: 0 auto;
            width: auto;
        }
    }
    </style>
</head>

<body>
<div>
    <h1>Example Domain</h1>
    <p>This domain is for use in illustrative examples in documents. You may use this
    domain in literature without prior coordination or asking for permission.</p>
    <p><a href="https://www.iana.org/domains/example">More information...</a></p>
</div>
</body>
</html>
`);
}

export const examplePage: HttpEndpoint = {
    matchPath,
    handle
};