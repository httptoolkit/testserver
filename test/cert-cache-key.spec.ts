import { expect } from 'chai';

import { calculateCertCacheKey } from '../src/tls-certificates/cert-definitions.js';

describe("calculateCertCacheKey", () => {

    it("uses the bare domain when no options are set", () => {
        expect(calculateCertCacheKey('example.testserver.host', {})).to.equal('example.testserver.host+');
    });

    it("encodes cert mode flags", () => {
        expect(calculateCertCacheKey('expired.testserver.host', { expired: true }))
            .to.equal('expired.testserver.host+expired');
    });

    it("distinguishes overridePrefix certs from the genuine cert for the same domain", () => {
        // wrong-host serves the 'example' cert but must not collide with a genuine request
        // for example.testserver.host, which resolves to a wildcard cert that would wrongly
        // match the original (wrong-host) hostname.
        const genuine = calculateCertCacheKey('example.testserver.host', {});
        const wrongHost = calculateCertCacheKey('example.testserver.host', { overridePrefix: 'example' });

        expect(wrongHost).to.not.equal(genuine);
    });

});
