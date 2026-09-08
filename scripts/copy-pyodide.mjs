/**
 * Copies the Pyodide runtime assets from node_modules into public/pyodide
 * so they are served statically next to clang.wasm / lld.wasm / sysroot.tar.
 *
 * Wired as the `prebuild` npm script so `npm run build` always ships a
 * matching Pyodide version.
 */
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkgPath = require.resolve('pyodide/package.json');
const pkgDir = dirname(pkgPath);

const destDir = join(root, 'public', 'pyodide');
mkdirSync(destDir, { recursive: true });

const ASSETS = [
  'pyodide.mjs',
  'pyodide.js',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

const REQUIRED_LOCAL_PACKAGES = [
  'sqlite3-1.0.0.zip',
];

for (const asset of ASSETS) {
  const src = join(pkgDir, asset);
  if (!existsSync(src)) {
    console.warn(`[copy-pyodide] missing asset: ${asset}`);
    continue;
  }
  copyFileSync(src, join(destDir, asset));
}

for (const asset of REQUIRED_LOCAL_PACKAGES) {
  const destination = join(destDir, asset);
  if (!existsSync(destination)) {
    console.warn(
      `[copy-pyodide] missing local package: ${asset}`,
    );
  }
}

console.log(
  `[copy-pyodide] copied ${ASSETS.length} assets -> public/pyodide`,
);
