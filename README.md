# Testserver

> _Part of [HTTP Toolkit](https://httptoolkit.com): powerful tools for building, testing & debugging HTTP(S)_

A public test server for HTTP & related protocols (similar to httpbin.org and badssl.com) but:

* Actively maintained, as a core part of HTTP Toolkit's infrastructure.
* Fully automated, globally distributed & horizontally scalable, to avoid downtime & reliability issues - e.g. using ACME plus an internal CA to provision TLS certificates on-demand for every configuration.
* Covering a wider range of testing endpoints, all with one service, in composable chainable ways.
* Easily self-hostable anywhere with a single Docker container.

The endpoints provide everything from request introspection (to see what your client is actually sending) to unusual and even totally invalid cases (to test how your client handles weird data) so you can fully explore and test your network clients.

## How can I use it?

The hosted test server is available at `testserver.host` - try [testserver.host/echo](http://testserver.host/echo) for example. See the documentation below for the full list of endpoints available for testing.

This hosted service is actively maintained and intended to be up at all times, but there's no specific SLA offered or suggested here right now, so there may be occasional intermittent downtime. If you'd like more control over this, you can also easily self-host a testserver locally:

```bash
docker run --rm -it -p 3000:3000 httptoolkit/testserver
```

Run `curl -v localhost:3000/echo` to test the HTTP echo endpoint. See the full self-hosting instructions below for more advanced setups.

## Endpoints

The server includes custom endpoints for HTTP, WebSockets and TLS. These can be combined: e.g. specifying multiple TLS behaviours via the hostname (`expired--http2.testserver.host`) along with a chain of HTTP behaviours defined in the request path (`/delay/1/error/reset`). For full documentation of all endpoints, see the home page at **[testserver.host](https://testserver.host/)**.

## Self-hosting

A public container image is published to [Docker Hub](https://hub.docker.com/r/httptoolkit/testserver) (and mirrored to `ghcr.io/httptoolkit/testserver`):

```bash
docker run -p 3000:3000 httptoolkit/testserver
```

This is usable with no configuration, in which case TLS will be served with a dynamically generated local CA. There are various env vars that can be used for configuration including:

- `PORTS` - comma-separated ports to listen on (default `3000`)
- `ROOT_DOMAIN` - the domain being served (default `localhost`)
- `ACME_PROVIDER` - obtain real certificates via ACME: `letsencrypt`, `zerossl` or `google` (omit to use only the self-signed local CA)
- `ACME_ACCOUNT_KEY` - ACME account key in PEM format; required when `ACME_PROVIDER` is set
- `CERT_CACHE_DIR` - directory to persist issued certificates. This or `CERT_STORE_S3_BUCKET` (mutually exclusive) must be set if ACME is enabled to avoid accidentally hitting ACME rate limits.
- `CERT_STORE_S3_BUCKET` - use a shared, S3-compatible bucket for the cert store instead of `CERT_CACHE_DIR` (mutually exclusive with `CERT_CACHE_DIR`). Works with any S3-compatible host; the connection is read from the standard AWS variables `AWS_ENDPOINT_URL_S3`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (required), plus optional `AWS_REGION` (default `auto`)
- `PROACTIVE_CERT_DOMAINS` - comma-separated list of domains to proactively fetch certificates for on startup
- `LOCAL_CA_KEY` / `LOCAL_CA_CERT` - pin the local CA in PEM format; generated fresh if unset
- `DNS_SERVER` - set `true` to run the built-in DNS server for wildcard (DNS-01) certs (needs UDP port 53)
- `TRUST_PROXY_PROTOCOL` - set `true` to honour PROXY protocol headers (for reading upstream client IP and connection information from behind a reverse proxy)
- `METRICS_PORT` - port to expose Prometheus metrics on

For advanced TLS cases, you will want:

* Some way to persist the generated certificates, so they don't change every time you restart the container.
    * For a persistent local CA, set the `LOCAL_CA_KEY` and `LOCAL_CA_CERT` to the generated CA values.
    * If you have just one container, you can mount `$CERT_CACHE_DIR` as a volume to persist generated leaf & intermediate certs outside the container.
    * For multiple instances or advanced persistent cases, use `CERT_STORE_S3_BUCKET` to use a shared cert store on top of any S3-compatible provider instead.
* An ACME provider, to generate publicly trusted certificates.
    * Let's Encrypt, ZeroSSL & Google Trust Services are supported. Google Trust Services is recommended notably because they have fairly relaxed rate limits, and support very short certificate lifetimes (so pre-expired certificates will start working quickly - see below).
    * You need to set the provider via `ACME_PROVIDER`, create an account and provide the account key (as PEM) in `ACME_ACCOUNT_KEY`, and set `CERT_CACHE_DIR` (to a volume-mounted dir) or `CERT_STORE_S3_BUCKET` (and related S3 auth params) to persist the issued certificates.
    * A public server or heavily used instance may hit rate limits with all the different possible hostnames. Wildcard certificates are the best solution to this. To support these, you need to set `DNS_SERVER` to `true`, expose UDP port 53, and configure the testserver as the nameserver for the `_acme-challenge` subdomain of its domain. If you use multiple instances, this requires use of S3 to coordinate challenge responses, or wildcard issuance will usually fail.
    * Note that with a publicly trusted CA, some certificate configurations won't work as expected immediately. For example, the first time you visit `expired.*` it won't have an expired certificate ready. It will request a new short-lived certificate from the CA immediately to start that process, but it has to wait until this expires before it can use it. In the meantime, an expired certificate signed by the untrusted local CA will be used instead. Similarly for `revoked.*` - although the public cert will be revoked immediately, your client generally won't notice this immediately since revocation information nowadays is distributed asynchronously.