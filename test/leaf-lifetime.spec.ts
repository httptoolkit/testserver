import * as crypto from 'node:crypto';

import { expect } from 'chai';

import { LocalCA, generateCACertificate } from '../src/tls-certificates/local-ca.js';
import { extractLeafCertificate } from '../src/tls-certificates/cert-definitions.js';

const DAY_MS = 1000 * 60 * 60 * 24;

describe("Local CA leaf lifetime", () => {

    let localCA: LocalCA;
    before(async () => { localCA = await LocalCA.create(await generateCACertificate()); });

    const lifetimeMs = async (options: Parameters<LocalCA['generateCertificate']>[1]) => {
        const { cert } = await localCA.generateCertificate('lifetime.localhost', options);
        const leaf = new crypto.X509Certificate(extractLeafCertificate(cert));
        return Date.parse(leaf.validTo) - Date.parse(leaf.validFrom);
    };

    // The BRs count validity inclusively, so this leaves a day's margin under the 47-day maximum
    it("issues leaves valid for 46 days in total", async () => {
        expect(await lifetimeMs({})).to.equal(46 * DAY_MS);
    });

    it("uses the same lifetime for self-signed leaves", async () => {
        expect(await lifetimeMs({ issuer: 'self' })).to.equal(46 * DAY_MS);
    });

    it("uses the same lifetime for leaves from an external intermediate", async () => {
        expect(await lifetimeMs({ issuer: 'emudhra-ov-tls-g3c' })).to.equal(46 * DAY_MS);
    });
});
