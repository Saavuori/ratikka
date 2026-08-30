/**
 * typescript-eslint v8 does not support TypeScript 7.0 (tracked in
 * https://github.com/typescript-eslint/typescript-eslint/issues/10940).
 * TypeScript 7.1+ support is planned, but in the meantime the TypeScript team
 * recommends a side-by-side setup where the main `typescript` package is v7
 * (used by tsc / Vite) while the ESLint toolchain resolves `typescript` to v6.
 *
 * npm cannot nest peer-dependency overrides automatically, so this postinstall
 * script creates nested symlinks for every package in the typescript-eslint
 * toolchain that loads `require("typescript")` at module-load time:
 *
 *   node_modules/<pkg>/node_modules/typescript -> ../../typescript-6
 *
 * That makes those packages resolve `typescript` to the `typescript-6` alias
 * (typescript@6.x) rather than the root typescript@7.
 *
 * Once typescript-eslint ships TS 7.1+ support this script (and the
 * `typescript-6` devDependency) can be removed.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const nmDir = path.resolve(__dirname, '..', 'node_modules');
const ts6Src = path.join(nmDir, 'typescript-6');

if (!fs.existsSync(ts6Src)) {
  console.error('[postinstall] typescript-6 not found, skipping symlinks');
  process.exit(0);
}

// All packages that do require("typescript") at load time in the ESLint chain
const targets = [
  'typescript-eslint',
  'ts-api-utils',
];

for (const pkg of targets) {
  const pkgDir = path.join(nmDir, pkg);
  if (!fs.existsSync(pkgDir)) continue;

  const destDir = path.join(pkgDir, 'node_modules');
  const destLink = path.join(destDir, 'typescript');

  fs.mkdirSync(destDir, { recursive: true });

  if (fs.existsSync(destLink)) {
    fs.rmSync(destLink, { recursive: true, force: true });
  }

  fs.symlinkSync(ts6Src, destLink, 'junction');
  console.log(`[postinstall] Linked typescript-6 into ${pkg}/node_modules/typescript`);
}
