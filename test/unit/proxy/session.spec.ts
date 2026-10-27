import { expect } from 'chai';
import { getJitteredDelay, getMaxSessionMemory } from '../../../src/proxy/session.ts';

describe('proxy session helpers', () => {
    it('getMaxSessionMemory: 1.2x the limit in MB, at least 10', () => {
        expect(getMaxSessionMemory(1000)).to.equal(10);
        expect(getMaxSessionMemory(100 * 1024 * 1024)).to.equal(120);
    });

    it('getJitteredDelay stays within ±factor', () => {
        for (let i = 0; i < 100; i++) {
            const d = getJitteredDelay(1000, 0.3);
            expect(d).to.be.within(700, 1300);
        }
        expect(getJitteredDelay(1000, 0)).to.equal(1000);
    });
});
