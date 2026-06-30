import * as crypto from 'node:crypto';

import { expect } from 'chai';

import {
    mergeContribution,
    resolveEnabledVersions
} from '../src/endpoints/tls-merge.js';

describe("TLS/cert option merge", () => {

    it("sets a field from a single contribution", () => {
        const acc: Record<string, unknown> = {};
        mergeContribution(acc, { ciphers: 'AES128-SHA' });
        expect(acc.ciphers).to.equal('AES128-SHA');
    });

    it("allows the same field set to the same value", () => {
        const acc: Record<string, unknown> = {};
        mergeContribution(acc, { requiredType: 'local' });
        mergeContribution(acc, { requiredType: 'local', selfSigned: true });
        expect(acc).to.deep.equal({ requiredType: 'local', selfSigned: true });
    });

    it("rejects an exclusive field set to two different values", () => {
        const acc: Record<string, unknown> = {};
        mergeContribution(acc, { ciphers: 'AES128-SHA' });
        expect(() => mergeContribution(acc, { ciphers: 'NULL-SHA' }))
            .to.throw(/Conflicting endpoint options.*ciphers/);
    });

    it("combines the additive enabledVersions field instead of conflicting", () => {
        const acc: Record<string, unknown> = {};
        mergeContribution(acc, { enabledVersions: ['TLSv1'] });
        mergeContribution(acc, { enabledVersions: ['TLSv1.2'] });
        expect(acc.enabledVersions).to.deep.equal(['TLSv1', 'TLSv1.2']);
    });

    it("resolves enabledVersions into disable flags + minVersion + legacy seclevel", () => {
        const opts: Record<string, unknown> = { enabledVersions: ['TLSv1', 'TLSv1.3'] };
        resolveEnabledVersions(opts);

        expect(opts.enabledVersions).to.equal(undefined);
        expect(opts.minVersion).to.equal('TLSv1');
        expect(opts.ciphers).to.contain('@SECLEVEL=0'); // legacy min => lowered security level

        const so = opts.secureOptions as number;
        // 1.1 and 1.2 disabled; 1.0 and 1.3 left enabled:
        expect(so & crypto.constants.SSL_OP_NO_TLSv1_1).to.be.greaterThan(0);
        expect(so & crypto.constants.SSL_OP_NO_TLSv1_2).to.be.greaterThan(0);
        expect(so & crypto.constants.SSL_OP_NO_TLSv1).to.equal(0);
        expect(so & crypto.constants.SSL_OP_NO_TLSv1_3).to.equal(0);
    });

    it("does not lower the security level for modern-only version sets", () => {
        const opts: Record<string, unknown> = { enabledVersions: ['TLSv1.2'] };
        resolveEnabledVersions(opts);
        expect(opts.minVersion).to.equal('TLSv1.2');
        expect(opts.ciphers).to.equal(undefined);
    });
});
