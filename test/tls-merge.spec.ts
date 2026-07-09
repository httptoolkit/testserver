import * as crypto from 'node:crypto';

import { expect } from 'chai';

import {
    mergeContribution,
    resolveEnabledVersions,
    resolveSecurityLevel
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

    it("combines securityLevel by taking the lowest (most permissive) value", () => {
        const acc: Record<string, unknown> = {};
        mergeContribution(acc, { securityLevel: 2 });
        mergeContribution(acc, { securityLevel: 0 });
        expect(acc.securityLevel).to.equal(0);
    });

    it("resolves enabledVersions into disable flags + minVersion + legacy seclevel", () => {
        const opts: Record<string, unknown> = { enabledVersions: ['TLSv1', 'TLSv1.3'] };
        resolveEnabledVersions(opts);

        expect(opts.enabledVersions).to.equal(undefined);
        expect(opts.minVersion).to.equal('TLSv1');
        expect(opts.securityLevel).to.equal(0); // legacy min => lowered security level

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
        expect(opts.securityLevel).to.equal(undefined);
    });

    it("folds securityLevel into the ciphers @SECLEVEL suffix", () => {
        const withList: Record<string, unknown> = { ciphers: 'AES128-SHA', securityLevel: 0 };
        resolveSecurityLevel(withList);
        expect(withList.securityLevel).to.equal(undefined);
        expect(withList.ciphers).to.equal('AES128-SHA@SECLEVEL=0');

        // With no cipher list, it applies the level to OpenSSL's DEFAULT set:
        const noList: Record<string, unknown> = { securityLevel: 0 };
        resolveSecurityLevel(noList);
        expect(noList.ciphers).to.equal('DEFAULT@SECLEVEL=0');
    });
});
