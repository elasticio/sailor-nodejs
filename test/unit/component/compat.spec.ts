import { expect } from 'chai';
import { callComponentFunction, type LegacyCallback } from '../../../src/component/compat.ts';

describe('callComponentFunction', () => {
    it('resolves with the callback result and passes args + this', async () => {
        const scope = { tag: 'scope' };
        function fn(this: typeof scope, cfg: number, cb: LegacyCallback) {
            cb(null, [this.tag, cfg]);
        }
        expect(await callComponentFunction(fn, scope, 1)).to.deep.equal(['scope', 1]);
    });

    it('rejects with the callback error', async () => {
        const fn = (_cfg: unknown, cb: LegacyCallback) => cb(new Error('cb failed'));
        await expect(callComponentFunction(fn, null, {})).to.be.rejectedWith('cb failed');
    });

    it('resolves with a truthy return value', async () => {
        expect(await callComponentFunction(() => ({ ok: true }), null, {})).to.deep.equal({ ok: true });
    });

    it('adopts a returned promise', async () => {
        expect(await callComponentFunction(async () => 'async', null, {})).to.equal('async');
        await expect(callComponentFunction(async () => {
            throw new Error('async failed');
        }, null, {})).to.be.rejectedWith('async failed');
    });

    it('rejects on a sync throw', async () => {
        await expect(callComponentFunction(() => {
            throw new Error('sync failed');
        }, null, {})).to.be.rejectedWith('sync failed');
    });

    it('lets the first answer win', async () => {
        const fn = (_cfg: unknown, cb: LegacyCallback) => {
            cb(null, 'callback');
            return 'returned';
        };
        expect(await callComponentFunction(fn, null, {})).to.equal('callback');
    });
});
