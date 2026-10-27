/**
 * Creates and pushes a `v<version>` git tag after `npm publish`. Skips dev versions and existing tags.
 */
import { execFileSync } from 'node:child_process';
import pkg from '../package.json' with { type: 'json' };

const { version } = pkg;

if (!version) {
    console.error('Can not determine current version');
} else if (version.includes('dev')) {
    console.info('Current version is a development version, skipping tag creation');
} else {
    const tag = `v${version}`;
    const tags = execFileSync('git', ['tag', '--list', tag], { encoding: 'utf8' }).trim();
    if (!tags) {
        console.info('creating a new tag: ', tag);
        execFileSync('git', ['tag', tag]);
        console.info('pushing tag to origin: ', tag);
        execFileSync('git', ['push', 'origin', tag]);
    }
}
