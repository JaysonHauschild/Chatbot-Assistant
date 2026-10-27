import { execFile } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const outdir = new URL('../dist/', import.meta.url);
const runFile = promisify(execFile);

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const shared = {
  entryPoints: [fileURLToPath(new URL('../src/index.ts', import.meta.url))],
  bundle: true,
  packages: 'external',
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  legalComments: 'none',
};

await Promise.all([
  build({
    ...shared,
    format: 'esm',
    outfile: fileURLToPath(new URL('index.js', outdir)),
  }),
  build({
    ...shared,
    format: 'cjs',
    outfile: fileURLToPath(new URL('index.cjs', outdir)),
  }),
  runFile(process.execPath, [
    fileURLToPath(
      new URL('../node_modules/typescript/bin/tsc', import.meta.url),
    ),
    '--project',
    fileURLToPath(new URL('../tsconfig.build.json', import.meta.url)),
  ]),
]);
