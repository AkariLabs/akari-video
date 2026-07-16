import { chmod, copyFile, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const repoRoot = path.resolve(shellRoot, '../..');

const overlayRuntimeSource = path.join(repoRoot, 'packages', 'overlay-runtime', 'src');
const overlayRuntimeDestination = path.join(shellRoot, 'lib', 'overlay-runtime');
await cp(overlayRuntimeSource, overlayRuntimeDestination, { recursive: true });
console.log(`Copied overlay-runtime assets to ${path.relative(shellRoot, overlayRuntimeDestination)}`);

const projectTemplateSource = path.join(repoRoot, 'templates', 'project-default');
const projectTemplateDestination = path.join(shellRoot, 'lib', 'templates', 'project-default');
await cp(projectTemplateSource, projectTemplateDestination, { recursive: true });
console.log(`Copied project-default template to ${path.relative(shellRoot, projectTemplateDestination)}`);

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
