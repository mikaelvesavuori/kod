import { readFileSync, chmodSync } from 'node:fs';
import { build } from 'esbuild';

const getPackageVersion = () =>
  JSON.parse(readFileSync('./package.json', 'utf-8')).version;

const packageVersion = getPackageVersion();

console.log(`Building Kod (${packageVersion})...`);

const sharedOptions = {
  bundle: true,
  minify: true,
  treeShaking: true,
  platform: 'node',
  target: 'node24',
  format: 'esm'
};

// Main CLI
await build({
  ...sharedOptions,
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/kod.mjs',
  define: {
    __PKG_VERSION__: JSON.stringify(packageVersion)
  },
  banner: {
    js: '#!/usr/bin/env node\n// Kod - Minimalist Git repository management'
  }
})
  .then(() => {
    chmodSync('dist/kod.mjs', 0o755);
    console.log('Build complete: dist/kod.mjs');
  })
  .catch(() => process.exit(1));

// Git credential helper
await build({
  ...sharedOptions,
  entryPoints: ['src/cli/git-credential-kod.ts'],
  outfile: 'dist/git-credential-kod.mjs',
  banner: {
    js: '#!/usr/bin/env node\n// Kod Git credential helper'
  }
})
  .then(() => {
    chmodSync('dist/git-credential-kod.mjs', 0o755);
    console.log('Build complete: dist/git-credential-kod.mjs');
  })
  .catch(() => process.exit(1));
