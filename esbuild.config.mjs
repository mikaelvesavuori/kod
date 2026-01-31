import { readFileSync, chmodSync } from 'node:fs';
import { build } from 'esbuild';

const getPackageVersion = () =>
  JSON.parse(readFileSync('./package.json', 'utf-8')).version;

const packageVersion = getPackageVersion();

console.log(`Building Kod (${packageVersion})...`);

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/kod.mjs',
  bundle: true,
  minify: true,
  treeShaking: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  define: {
    __PKG_VERSION__: JSON.stringify(packageVersion)
  },
  banner: {
    js: '#!/usr/bin/env node\n// Kod - Minimalist Git repository management'
  }
})
  .then(() => {
    // Make the output executable
    chmodSync('dist/kod.mjs', 0o755);
    console.log('Build complete: dist/kod.mjs');
  })
  .catch(() => process.exit(1));
