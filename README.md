# HTTP/TCP/TLS Testserver

> _Part of [HTTP Toolkit](https://httptoolkit.tech): powerful tools for building, testing & debugging HTTP(S)_

A public test server for HTTP & related protocols (similar to httpbin.org and badssl.com) but actively maintained, reliable & fast.

It provides configurable endpoints to inspect requests, return custom HTTP & WebSocket responses, and serve TLS certificates in a wide range of valid & invalid configurations.

The server with full endpoint documentation is live at **[testserver.host](https://testserver.host/)**.

## Self-hosting

A public container image is published to [Docker Hub](https://hub.docker.com/r/httptoolkit/testserver) (and mirrored to `ghcr.io/httptoolkit/testserver`):

```bash
docker run -p 3000:3000 httptoolkit/testserver
```

This is usable with no configuration, serving TLS with a self-signed local CA for `localhost`. For advanced functionality (especially ACME, to get a publicly trusted CA cert) configure via environment variables:

- `PORTS` - comma-separated ports to listen on (default `3000`)
- `ROOT_DOMAIN` - the domain being served (default `localhost`)
- `ACME_PROVIDER` - obtain real certificates via ACME: `letsencrypt`, `zerossl` or `google` (omit for a self-signed local CA)
- `ACME_ACCOUNT_KEY` - ACME account key in PEM format; required when `ACME_PROVIDER` is set
- `CERT_CACHE_DIR` - directory to persist issued certificates; required for ACME unless using an S3 store (the image defaults this to `/usr/src/app/cert_dir`)
- `CERT_STORE_S3_BUCKET` - use a shared, S3-compatible bucket for the cert store instead of `CERT_CACHE_DIR` (lets multiple instances share issued certs; mutually exclusive with `CERT_CACHE_DIR`). Works with any S3-compatible host; the connection is read from the standard AWS variables `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (required), plus optional `AWS_REGION` (default `auto`)
- `PROACTIVE_CERT_DOMAINS` - comma-separated domains to fetch certificates for on startup
- `LOCAL_CA_KEY` / `LOCAL_CA_CERT` - pin the local CA in PEM format; generated fresh if unset
- `DNS_SERVER` - set `true` to run the built-in DNS server for wildcard (DNS-01) certs (needs UDP port 53)
- `TRUST_PROXY_PROTOCOL` - set `true` to honour PROXY protocol headers
- `METRICS_PORT` - port to expose Prometheus metrics on
