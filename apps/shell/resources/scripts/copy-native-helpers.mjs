import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (process.platform === 'darwin') {
  const platformArch = `${process.platform}-${process.arch}`;
  const source = path.join(
    shellRoot,
    'node_modules',
    'node-pty',
    'prebuilds',
    platformArch,
    'spawn-helper'
  );
  const destination = path.join(
    shellRoot,
    'lib',
    'prebuilds',
    platformArch,
    'spawn-helper'
  );

  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
  await chmod(destination, 0o755);
  console.log(`Copied node-pty spawn-helper to ${path.relative(shellRoot, destination)}`);
}
