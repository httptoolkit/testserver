import { httpEndpoints, wsEndpoints, tlsEndpoints } from './endpoints/endpoint-index.js';
import { EndpointMeta, EndpointGroup } from './endpoints/groups.js';

interface EndpointWithMeta {
    meta?: EndpointMeta;
}

interface GroupedEndpoints {
    group: EndpointGroup;
    endpoints: EndpointMeta[];
}

const GENERAL_GROUP: EndpointGroup = {
    id: 'general',
    name: 'General'
};

function sortEndpoints(endpoints: EndpointMeta[]): EndpointMeta[] {
    return endpoints.sort((a, b) => a.path.localeCompare(b.path));
}

function groupEndpoints(endpoints: EndpointWithMeta[]): GroupedEndpoints[] {
    const withMeta = endpoints.filter(e => e.meta).map(e => e.meta!);
    const groups = new Map<string, { group: EndpointGroup; endpoints: EndpointMeta[] }>();

    for (const meta of withMeta) {
        const groupKey = meta.group?.id || '';
        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                group: meta.group || GENERAL_GROUP,
                endpoints: []
            });
        }
        groups.get(groupKey)!.endpoints.push(meta);
    }

    const result: GroupedEndpoints[] = [];

    // Add ungrouped endpoints first, sorted
    const ungrouped = groups.get('');
    if (ungrouped && ungrouped.endpoints.length > 0) {
        ungrouped.endpoints = sortEndpoints(ungrouped.endpoints);
        result.push(ungrouped);
    }

    // Add grouped endpoints alphabetically by name, with sorted endpoints within
    const sortedEntries = [...groups.entries()]
        .filter(([k]) => k !== '')
        .sort((a, b) => a[1].group.name.localeCompare(b[1].group.name));

    for (const [, groupData] of sortedEntries) {
        groupData.endpoints = sortEndpoints(groupData.endpoints);
        result.push(groupData);
    }

    return result;
}

// This is for formatting - not security. There's no untrusted inputs here.
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

type EndpointType = 'http' | 'ws' | 'tls';

function renderExample(example: string, type: EndpointType): string {
    const escaped = escapeHtml(example);
    // HTTP examples that are relative paths
    if (type === 'http' && example.startsWith('/')) {
        return `<a href="${escaped}" class="example-link" target="_blank"><code>${escaped}</code></a>`;
    }
    // HTTP examples that are full URLs with subdomains need JS to construct URL
    if (type === 'http' && example.startsWith('https://')) {
        return `<a href="${escaped}" class="example-link" target="_blank" data-example="${escaped}" data-type="subdomain"><code>${escaped}</code></a>`;
    }
    // WS examples are not clickable - just show the path
    if (type === 'ws') {
        return `<code>${escaped}</code>`;
    }
    // TLS examples need JS to construct the URL based on current domain
    return `<a href="${escaped}" class="example-link" target="_blank" data-example="${escaped}" data-type="${type}"><code>${escaped}</code></a>`;
}

function renderEndpoint(meta: EndpointMeta, type: EndpointType): string {
    const examples = meta.examples || [];
    const pathIsExample = examples.includes(meta.path);
    const otherExamples = examples.filter(ex => ex !== meta.path);

    // If path matches an example, make the path itself a link (reusing renderExample logic)
    const pathHtml = pathIsExample && type !== 'ws'
        ? renderExample(meta.path, type).replace('<code>', '<code class="path">')
        : `<code class="path">${escapeHtml(meta.path)}</code>`;

    const examplesHtml = otherExamples.length > 0
        ? `<span class="examples">${otherExamples.map(ex => renderExample(ex, type)).join(' ')}</span>`
        : '';

    return `
        <div class="endpoint">
            ${pathHtml}
            <span class="desc">${escapeHtml(meta.description)}</span>${examplesHtml}
        </div>`;
}

function renderEndpointGroup(group: GroupedEndpoints, sectionId: string, type: EndpointType): string {
    const groupId = `${sectionId}-${group.group.id}`;

    if (group.group.id === 'general') {
        return group.endpoints.map(e => renderEndpoint(e, type)).join('\n');
    }

    const descriptionHtml = group.group.description
        ? `<p class="group-description">${escapeHtml(group.group.description)}</p>`
        : '';

    return `
        <details class="endpoint-group" open>
            <summary id="${groupId}">${escapeHtml(group.group.name)} <span class="count">(${group.endpoints.length})</span></summary>
            <div class="group-content">
                ${descriptionHtml}
                ${group.endpoints.map(e => renderEndpoint(e, type)).join('\n')}
            </div>
        </details>`;
}

interface Section {
    id: string;
    title: string;
    intro: string[];
    groups: GroupedEndpoints[];
    type: EndpointType;
}

function buildToc(sections: Section[]) {
    return sections.map(section => {
        const sectionId = section.id.replace('-endpoints', '');
        return {
            id: section.id,
            label: section.title,
            groups: section.groups
                .filter(g => g.group.id !== 'general')
                .map(g => ({
                    id: `${sectionId}-${g.group.id}`,
                    label: g.group.name
                }))
        };
    });
}

function renderSidebar(toc: ReturnType<typeof buildToc>): string {
    return `
    <nav class="sidebar" id="sidebar">
        ${toc.map(section => `
        <div class="toc-section">
            <a href="#${section.id}" class="toc-section-link">${escapeHtml(section.label)}</a>
            <ul class="toc-groups">
                ${section.groups.map(g =>
                    `<li><a href="#${g.id}">${escapeHtml(g.label)}</a></li>`
                ).join('\n                ')}
            </ul>
        </div>
        `).join('\n        ')}
    </nav>`;
}

function renderSection(section: Section): string {
    const sectionId = section.id.replace('-endpoints', '');
    return `
        <section class="section">
            <h2 id="${section.id}">${escapeHtml(section.title)}</h2>
            <div class="section-content">
                ${section.intro.map(p => `<p>${p}</p>`).join('\n')}
                ${section.groups.map(g => renderEndpointGroup(g, sectionId, section.type)).join('\n')}
            </div>
        </section>`;
}

const CSS = `
<style>
    /* Light mode (default) */
    :root {
        --primary-color: #e1421f;
        --text-color: #222;
        --text-muted: #555;
        --text-faint: #666;
        --bg-color: #fafafa;
        --bg-card: #ffffff;
        --bg-header: #f8f8f8;
        --code-bg: #f0f0f0;
        --border-color: #ddd;
        --content-width: 800px;
        --sidebar-width: 260px;
        --sidebar-gap: 30px;
    }

    /* Dark mode - matches httptoolkit.com */
    @media (prefers-color-scheme: dark) {
        :root {
            --primary-color: #e1421f;
            --text-color: #E6E8F2;
            --text-muted: #818490;
            --text-faint: #818490;
            --bg-color: #16181E;
            --bg-card: #1E2028;
            --bg-header: #252830;
            --code-bg: #32343B;
            --border-color: #32343B;
        }
    }

    * {
        box-sizing: border-box;
    }
    html {
        scroll-behavior: smooth;
    }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        line-height: 1.6;
        color: var(--text-color);
        background: var(--bg-color);
        margin: 0;
        padding: 0;
        display: flex;
        justify-content: center;
    }
    .page-wrapper {
        position: relative;
        width: var(--content-width);
        min-height: 100vh;
        padding: 2rem;
    }

    /* Sidebar - wing positioned outside the centered content */
    .sidebar {
        position: fixed;
        top: 2rem;
        left: calc(50% + var(--content-width) / 2 + var(--sidebar-gap));
        width: var(--sidebar-width);
        max-height: calc(100vh - 4rem);
        overflow-y: auto;
        font-size: 0.8rem;
    }
    .toc-section {
        margin-bottom: 0.5rem;
    }
    .toc-section-link {
        font-weight: 600;
        color: var(--text-color);
        text-decoration: none;
    }
    .toc-section-link:hover {
        color: var(--primary-color);
    }
    .toc-groups {
        list-style: none;
        padding-left: 0.75rem;
        margin: 0.1rem 0 0 0;
    }
    .toc-groups li {
        margin: 0;
    }
    .toc-groups a {
        color: var(--text-muted);
        text-decoration: none;
    }
    .toc-groups a:hover {
        color: var(--primary-color);
    }

    /* Header */
    h1 {
        color: var(--text-color);
        border-bottom: 2px solid var(--text-muted);
        padding: 2rem 0;
        margin-top: 0;
        margin-bottom: 2rem;
        font-size: 3rem;
        line-height: 1;
    }

    h1 + p {
        margin-top: 0;
    }

    /* Code */
    code {
        background: var(--code-bg);
        color: var(--text-color);
        padding: 0.1rem 0.3rem;
        border-radius: 3px;
        font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
        font-size: 0.9em;
    }

    /* Links */
    a {
        color: var(--primary-color);
        text-decoration: none;
    }
    a:hover {
        text-decoration: underline;
    }

    /* Sections */
    .section {
        margin: 1.5rem 0;
        border: 1px solid var(--border-color);
        border-radius: 6px;
        background: var(--bg-card);
    }
    .section > h2 {
        padding: 0.5rem 1rem;
        margin: 0;
        background: var(--bg-header);
        border-radius: 6px 6px 0 0;
        border-bottom: 1px solid var(--border-color);
        font-size: 1.1rem;
    }
    .section-content {
        padding: 0.5rem 1rem;
    }
    .section-content > p {
        margin: 0 0 0.5rem 0;
        font-size: 0.9rem;
        color: var(--text-muted);
    }

    /* Endpoint groups (collapsible) */
    .endpoint-group {
        margin: 0.5rem 0;
        border: 1px solid var(--border-color);
        border-radius: 4px;
        background: var(--bg-color);
    }
    .endpoint-group > summary {
        padding: 0.4rem 0.75rem;
        cursor: pointer;
        font-weight: 600;
        font-size: 0.95rem;
        background: var(--bg-card);
        border-radius: 4px;
        list-style: none;
    }
    .endpoint-group > summary::-webkit-details-marker {
        display: none;
    }
    .endpoint-group > summary::before {
        content: '\\25BC';
        display: inline-block;
        margin-right: 0.4rem;
        font-size: 0.6rem;
        transition: transform 0.2s;
    }
    .endpoint-group:not([open]) > summary::before {
        transform: rotate(-90deg);
    }
    .endpoint-group[open] > summary {
        border-bottom: 1px solid var(--border-color);
        border-radius: 4px 4px 0 0;
    }
    .endpoint-group .count {
        color: var(--text-faint);
        font-weight: normal;
        font-size: 0.8rem;
    }
    .group-content {
        padding: 0.25rem 0.75rem;
    }
    .group-description {
        margin: 0.25rem 0 0.5rem 0;
        font-size: 0.9rem;
        color: var(--text-muted);
    }

    /* Individual endpoints */
    .endpoint {
        padding: 0.3rem 0;
        border-bottom: 1px solid var(--border-color);
    }
    .endpoint:last-child {
        border-bottom: none;
    }
    .endpoint .path {
        font-weight: 600;
    }
    .endpoint .desc {
        color: var(--text-muted);
        margin-left: 0.5rem;
    }
    .endpoint .examples {
        margin-left: 0.75rem;
        font-size: 0.85em;
    }
    .endpoint .examples code {
        background: none;
        padding: 0;
        white-space: nowrap;
    }
    .endpoint .examples .example-link,
    .endpoint .examples > code {
        margin-right: 0.75rem;
        display: inline-block;
    }
    .example-link {
        text-decoration: none;
    }
    .example-link:hover {
        text-decoration: underline;
    }
    .example-link code {
        color: var(--primary-color);
    }

    /* Footer */
    footer {
        margin-top: 3rem;
        padding-top: 1rem;
        border-top: 1px solid var(--border-color);
        text-align: center;
        color: var(--text-faint);
        font-size: 0.9rem;
    }

    /* Responsive - hide sidebar when viewport can't fit content + sidebar */
    @media (max-width: 1400px) {
        .sidebar {
            display: none;
        }
    }

    /* Tablet - allow content to shrink */
    @media (max-width: 900px) {
        .page-wrapper {
            width: 100%;
            max-width: var(--content-width);
        }
    }

    /* Mobile - optimize for smaller screens */
    @media (max-width: 850px) {
        .page-wrapper {
            padding: 1rem;
        }
        h1 {
            font-size: 1.3rem;
        }
        .section > h2 {
            font-size: 1rem;
        }
        .endpoint {
            display: block;
        }
        .endpoint .desc {
            display: block;
            margin-left: 0;
        }
        .endpoint .examples {
            display: block;
            margin-left: 0;
        }
        .endpoint .path {
            word-break: break-all;
        }
    }
</style>
`;

let cachedHtml: string | null = null;

export function getDocsHtml(): string {
    if (cachedHtml) return cachedHtml;

    const sections: Section[] = [
        {
            id: 'http-endpoints',
            title: 'HTTP Endpoints',
            intro: [],
            groups: groupEndpoints(httpEndpoints),
            type: 'http'
        },
        {
            id: 'websocket-endpoints',
            title: 'WebSocket Endpoints',
            intro: ['Connect via <code>wss://{hostname}/ws/...</code>'],
            groups: groupEndpoints(wsEndpoints),
            type: 'ws'
        },
        {
            id: 'tls-endpoints',
            title: 'TLS Endpoints',
            intro: [
                'The TLS endpoint(s) to use are specified by subdomain, e.g. <code>expired.{domain}</code>.',
                'Endpoints can be combined using double-dashes, e.g. <code>expired--revoked--http2--tls-v1-2.{domain}</code> will return an expired and revoked certificate, use TLSv1.2, and then negotiate HTTP/2 on the connection.',
                'These can also be combined with the HTTP or WebSocket handlers above, which can be independently specified in the request path.'
            ],
            groups: groupEndpoints(tlsEndpoints),
            type: 'tls'
        }
    ];

    const toc = buildToc(sections);

    const SCRIPT = `
<script>
document.addEventListener('DOMContentLoaded', function() {
    const hostname = location.hostname;
    const port = location.port ? ':' + location.port : '';
    const httpProtocol = location.protocol;

    // Update subdomain-based example links with current domain
    document.querySelectorAll('a.example-link[data-example]').forEach(function(link) {
        const example = link.dataset.example;
        const type = link.dataset.type;
        if (type === 'tls' || type === 'subdomain') {
            // https://prefix.testserver.host/ -> https://prefix.hostname:port/
            const match = example.match(/^https?:\/\/([^.]+)/);
            if (match) {
                const prefix = match[1];
                const url = httpProtocol + '//' + prefix + '.' + hostname + port + '/';
                link.href = url;
                link.title = url;
            }
        }
    });
});
</script>
`;

    cachedHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Testserver</title>
    ${CSS}
</head>
<body>
    ${renderSidebar(toc)}
    <main class="page-wrapper">
        <h1>Testserver</h1>
        <p>A public test server for HTTP &amp; friends, built as part of <a href="https://httptoolkit.com" target="_blank">HTTP Toolkit</a>.</p>
        <p>Source code available at <a href="https://github.com/httptoolkit/testserver" target="_blank">github.com/httptoolkit/testserver</a>.</p>

        ${sections.map(renderSection).join('\n')}

        <footer>
            <p>Built by <a href="https://httptoolkit.com" target="_blank">HTTP Toolkit</a></p>
        </footer>
    </main>
    ${SCRIPT}
</body>
</html>`;

    return cachedHtml;
}
