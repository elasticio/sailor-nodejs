#! /usr/bin/env node
const execSync = require('child_process').execSync;
const version = require('./package.json').version;

if (!version) {
    console.error('Can not determine current version');
    process.exit(0);
}

const tag = `v${version}`;

try {
    execSync(`git tag | grep ${tag}`);
    process.exit(0);
} catch (e) {
    console.info(`Creating new tag and pushing to origin: ${tag}`);
    execSync(`git tag ${tag}`);
    execSync(`git push origin ${tag}`);
}
