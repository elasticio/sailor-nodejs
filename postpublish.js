#! /usr/bin/env node


const { execSync } = require('child_process');
const { version } = require('./package.json');

if (!version) {
  console.error('Can not determine current version');
  process.exit(0);
}

const tag = `v${version}`;
try {
  // if grep not found anything, it's exit code isn't zero, so execSync raises an Error
  execSync(`git tag | grep "${tag}"`);
  // it seems tag is found, do nothing
  process.exit(0);
} catch (e) {
  // grep found nothing, so le'ts create new tag
  console.info('creating a new tag: ', tag);
  execSync(`git tag ${tag}`);
  console.info('pushing tag to origin: ', tag);
  execSync(`git push origin ${tag}`);
}
