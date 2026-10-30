import { expect } from 'chai';
import { AwaitableEmitter } from '../../../src/execution/emitter.ts';

describe('AwaitableEmitter', () => {
    it('awaits listeners one after another, with `this` = emitter', async () => {
        const emitter = new AwaitableEmitter();
        const calls: string[] = [];
        emitter.on('x', async function (this: AwaitableEmitter, v: string) {
            expect(this).to.equal(emitter);
            await new Promise(r => setTimeout(r, 5));
            calls.push(`a${v}`);
        });
        emitter.on('x', (v: string) => calls.push(`b${v}`));
        expect(await emitter.emit('x', '1')).to.equal(true);
        expect(calls).to.deep.equal(['a1', 'b1']);
    });

    it('resolves false without listeners', async () => {
        expect(await new AwaitableEmitter().emit('nope')).to.equal(false);
    });

    it('propagates a listener rejection', async () => {
        const emitter = new AwaitableEmitter().on('x', async () => {
            throw new Error('boom');
        });
        await expect(emitter.emit('x')).to.be.rejectedWith('boom');
    });

    it('once / removeListener / removeAllListeners / listeners', async () => {
        const emitter = new AwaitableEmitter();
        let count = 0;
        const fn = () => count++;
        emitter.once('x', fn);
        await emitter.emit('x');
        await emitter.emit('x');
        expect(count).to.equal(1);

        emitter.once('y', fn);
        emitter.removeListener('y', fn);
        expect(emitter.listeners('y')).to.have.length(0);

        emitter.on('z', fn).on('w', fn);
        emitter.removeAllListeners('z');
        expect(emitter.listeners('z')).to.have.length(0);
        expect(emitter.listeners('w')).to.have.length(1);
        emitter.removeAllListeners();
        expect(emitter.listeners('w')).to.have.length(0);
    });
});
