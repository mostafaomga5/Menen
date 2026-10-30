import { cp, readdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist');

for (const name of ['index.html', 'assets', 'favicon.svg', 'manus-routes.json']) {
  await rm(resolve(root, name), { recursive: true, force: true });
}

for (const name of await readdir(output)) {
  await cp(resolve(output, name), resolve(root, name), { recursive: true });
}

console.log('GitHub Pages files copied from dist/ to the repository root.');
