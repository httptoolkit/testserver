import { HttpEndpoint, HttpHandler } from '../http-index.js';

const matchPath = (path: string) => path === '/xml';

const handle: HttpHandler = (req, res) => {
    res.writeHead(200, {
        'content-type': 'application/xml'
    });

    // HTTPBin seems to just return this fixed example document:
    res.end(`<?xml version='1.0' encoding='us-ascii'?>

<!--  A SAMPLE set of slides  -->

<slideshow 
    title="Sample Slide Show"
    date="Date of publication"
    author="Yours Truly"
    >

    <!-- TITLE SLIDE -->
    <slide type="all">
      <title>Wake up to WonderWidgets!</title>
    </slide>

    <!-- OVERVIEW -->
    <slide type="all">
        <title>Overview</title>
        <item>Why <em>WonderWidgets</em> are great</item>
        <item/>
        <item>Who <em>buys</em> WonderWidgets</item>
    </slide>

</slideshow>`);
}

export const xml: HttpEndpoint = {
    matchPath,
    handle
};