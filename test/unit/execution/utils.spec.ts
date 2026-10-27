import { expect } from 'chai';
import { isEmpty, isPlainObject, omit, pick, snakeCase } from '../../../src/execution/utils.ts';

describe('execution utils', () => {
    it('snakeCase matches lodash for env var names', () => {
        expect(snakeCase('FIRST')).to.equal('first');
        expect(snakeCase('SECOND_ELASTICIO_ENV')).to.equal('second_elasticio_env');
        expect(snakeCase('VAR1')).to.equal('var_1');
        expect(snakeCase('camelCase')).to.equal('camel_case');
        expect(snakeCase('some-key name')).to.equal('some_key_name');
    });

    it('isEmpty matches lodash', () => {
        for (const v of [null, undefined, '', [], {}, new Map(), 0, 5, true]) {
            expect(isEmpty(v), String(v)).to.equal(true);
        }
        for (const v of ['a', [1], { a: 1 }, new Set([1])]) {
            expect(isEmpty(v), String(v)).to.equal(false);
        }
    });

    it('isPlainObject', () => {
        expect(isPlainObject({})).to.equal(true);
        expect(isPlainObject(Object.create(null))).to.equal(true);
        expect(isPlainObject([])).to.equal(false);
        expect(isPlainObject(new Date())).to.equal(false);
        expect(isPlainObject('x')).to.equal(false);
    });

    it('pick only copies present keys; omit does not mutate', () => {
        const obj: { a: number; b?: number; c: number } = { a: 1, c: 3 };
        expect(pick(obj, ['a', 'b'])).to.deep.equal({ a: 1 });
        expect(omit(obj, 'a')).to.deep.equal({ c: 3 });
        expect(obj).to.deep.equal({ a: 1, c: 3 });
    });
});
