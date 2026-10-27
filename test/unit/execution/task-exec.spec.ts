import { expect } from 'chai';
import { TaskExec, type ApiClient, type TriggerOrAction } from '../../../src/execution/task-exec.ts';
import { makeSettings } from '../proxy/helpers.ts';

const services = { apiClient: { accounts: {}, tasks: {} } as unknown as ApiClient, config: makeSettings('http://p') };

function run(module: TriggerOrAction): Promise<unknown[][]> {
    const exec = new TaskExec({ services });
    const events: unknown[][] = [];
    return new Promise(resolve => {
        exec.on('data', d => events.push(['data', d]));
        exec.on('error', e => events.push(['error', (e as Error).message]));
        exec.on('end', () => {
            events.push(['end']);
            resolve(events);
        });
        void exec.process(module, { body: 1 }, { cfg: 1 }, { snap: 1 });
    });
}

describe('TaskExec', () => {
    it('requires services', () => {
        expect(() => new TaskExec({ services: {} as never })).to.throw(/services/);
    });

    it('copies flow variables and exposes services', () => {
        const variables = { a: '1' };
        const exec = new TaskExec({ variables, services });
        variables.a = '2';
        expect(exec.getFlowVariables()).to.deep.equal({ a: '1' });
        expect(new TaskExec({ services }).getFlowVariables()).to.deep.equal({});
        expect(exec.getApiClient()).to.equal(services.apiClient);
        expect(exec.getConfig()).to.equal(services.config);
    });

    it('calls process with this, msg, cfg, snapshot', async () => {
        let args: unknown[] = [];
        const events = await run({
            process(this: TaskExec, ...a: unknown[]) {
                args = [this instanceof TaskExec, ...a];
                void this.emit('end');
            }
        });
        expect(args).to.deep.equal([true, { body: 1 }, { cfg: 1 }, { snap: 1 }]);
        expect(events).to.deep.equal([['end']]);
    });

    it('emits a truthy return value as data, then end', async () => {
        expect(await run({ process: () => ({ v: 1 }) })).to.deep.equal([['data', { v: 1 }], ['end']]);
    });

    it('emits what a returned promise resolves to', async () => {
        expect(await run({ process: async () => 'x' })).to.deep.equal([['data', 'x'], ['end']]);
    });

    it('emits only end for a promise resolving to nothing', async () => {
        expect(await run({ process: () => Promise.resolve() })).to.deep.equal([['end']]);
    });

    it('turns a throw / rejection into error + end', async () => {
        expect(await run({
            process: () => {
                throw new Error('sync');
            }
        })).to.deep.equal([['error', 'sync'], ['end']]);
        expect(await run({
            process: async () => {
                throw new Error('async');
            }
        })).to.deep.equal([['error', 'async'], ['end']]);
    });

    it('reports a missing process function', async () => {
        expect(await run({})).to.deep.equal([['error', 'Process function is not found'], ['end']]);
    });
});
