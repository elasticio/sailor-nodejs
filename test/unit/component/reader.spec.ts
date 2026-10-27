import { expect } from 'chai';
import path from 'node:path';
import { ComponentReader } from '../../../src/component/reader.ts';

const FIXTURES = path.relative(process.cwd(), path.join(import.meta.dirname, 'fixtures'));

async function reader(name: string): Promise<ComponentReader> {
    const r = new ComponentReader();
    await r.init(path.join(FIXTURES, name));
    return r;
}

describe('ComponentReader', () => {
    it('loads component.json relative to the working directory', async () => {
        const r = await reader('cjs');
        expect(r.componentPath).to.equal(path.join(import.meta.dirname, 'fixtures', 'cjs'));
        expect(r.componentJson?.triggers).to.have.property('exports_trigger');
    });

    it('rejects when component.json is missing', async () => {
        await expect(new ComponentReader().init(FIXTURES))
            .to.be.rejectedWith(/^Failed to load component.json from /);
    });

    it('throws before init', () => {
        expect(() => new ComponentReader().findTriggerOrAction('x')).to.throw('Component.json was not loaded');
    });

    describe('findTriggerOrActionDefinition', () => {
        it('defaults autoResolveObjectReferences to true', async () => {
            const r = await reader('cjs');
            expect(r.findTriggerOrActionDefinition('exports_trigger')).to.deep.equal({
                main: './triggers/exports_trigger.js', autoResolveObjectReferences: true
            });
            expect(r.findTriggerOrActionDefinition('fn_action').autoResolveObjectReferences).to.equal(false);
        });

        it('throws for an unknown name', async () => {
            const r = await reader('cjs');
            expect(() => r.findTriggerOrAction('nope'))
                .to.throw('Trigger or action "nope" is not found in component.json!');
        });
    });

    describe('loadTriggerOrAction (CJS)', () => {
        it('loads `exports.process` and keeps module state between loads', async () => {
            const r = await reader('cjs');
            const first = await r.loadTriggerOrAction('exports_trigger') as { process: () => number };
            const second = await r.loadTriggerOrAction('no_extension') as { process: () => number };
            expect(first.process()).to.equal(1);
            expect(second).to.equal(first);
            expect(second.process()).to.equal(2);
        });

        it('unwraps `module.exports = fn`', async () => {
            const r = await reader('cjs');
            const fn = await r.loadTriggerOrAction('fn_action') as () => string;
            expect(fn()).to.equal('fn');
        });

        it('reports a missing file', async () => {
            const r = await reader('cjs');
            const err = await r.loadTriggerOrAction('missing_trigger').then(() => null, (e: unknown) => e);
            expect(err).to.have.property('code', 'MODULE_NOT_FOUND');
            expect((err as Error).message).to.match(
                /^Failed to load file '.\/triggers\/missing_trigger.js': Cannot find module.+missing_trigger\.js/
            );
        });

        it('reports a missing dependency', async () => {
            const r = await reader('cjs');
            const err = await r.loadTriggerOrAction('wrong_dependency').then(() => null, (e: unknown) => e);
            expect(err).to.have.property('code', 'MODULE_NOT_FOUND');
            expect((err as Error).message.split('\n')[0]).to.equal(
                'Failed to load file \'./triggers/wrong_dependency.js\': Cannot find module \'../not-found-dependency\''
            );
        });

        it('reports a broken module', async () => {
            const r = await reader('cjs');
            await expect(r.loadTriggerOrAction('syntax_error')).to.be.rejectedWith(
                'Trigger or action \'syntax_error\' is found, but can not be loaded. '
                + 'Please check if the file \'./triggers/syntax_error.js\' is correct.'
            );
        });
    });

    describe('loadTriggerOrAction (ESM)', () => {
        it('loads named exports', async () => {
            const r = await reader('esm');
            const mod = await r.loadTriggerOrAction('named') as { process: () => string };
            expect(mod.process()).to.equal('named');
        });

        it('loads the default export', async () => {
            const r = await reader('esm');
            const mod = await r.loadTriggerOrAction('default_export') as { process: () => string };
            expect(mod.process()).to.equal('default');
        });

        it('reports a missing import as MODULE_NOT_FOUND', async () => {
            const r = await reader('esm');
            const err = await r.loadTriggerOrAction('missing_import').then(() => null, (e: unknown) => e);
            expect(err).to.have.property('code', 'MODULE_NOT_FOUND');
            expect((err as Error).message).to.match(/^Failed to load file '.\/actions\/missing_import.js': /);
        });
    });

    describe('loadVerifyCredentials', () => {
        it('loads a CJS verifyCredentials', async () => {
            const verify = await (await reader('cjs')).loadVerifyCredentials();
            const result = await new Promise(resolve => verify({ ok: 1 }, (_e, r) => resolve(r)));
            expect(result).to.deep.equal({ verified: 1 });
        });

        it('loads an ESM default export', async () => {
            const verify = await (await reader('esm')).loadVerifyCredentials();
            expect(await verify({}, () => undefined)).to.deep.equal({ verified: 'esm' });
        });

        it('falls back to a stub that verifies', async () => {
            const r = new ComponentReader();
            r.componentPath = import.meta.dirname;
            const verify = await r.loadVerifyCredentials();
            const result = await new Promise(resolve => verify({}, (_e, res) => resolve(res)));
            expect(result).to.deep.equal({ verified: true });
        });

        it('rejects when verifyCredentials exists but fails to load', async () => {
            const r = await reader('broken-verify');
            await expect(r.loadVerifyCredentials()).to.be.rejectedWith(/Cannot find module '.\/not-found-dependency'/);
        });
    });
});
