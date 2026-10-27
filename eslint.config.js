import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
    {
        ignores: ['dist/', 'coverage/',
            // Fixture components (some broken on purpose).
            'test/**/fixtures/']
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: { ...globals.node }
        },
        rules: {
            'semi': ['error', 'always'],
            'quotes': ['error', 'single', { avoidEscape: true, allowTemplateLiterals: true }],
            'indent': ['error', 4, { SwitchCase: 1 }],
            'curly': ['error', 'all'],
            'brace-style': ['error', '1tbs', { allowSingleLine: false }],
            'max-len': ['warn', { code: 120, ignoreUrls: true, ignoreTemplateLiterals: true }]
        }
    },
    {
        files: ['test/**/*.ts'],
        languageOptions: {
            globals: { ...globals.mocha }
        },
        rules: {
            // chai/sinon-chai property assertions (`expect(x).to.be.true`).
            '@typescript-eslint/no-unused-expressions': 'off'
        }
    }
);
