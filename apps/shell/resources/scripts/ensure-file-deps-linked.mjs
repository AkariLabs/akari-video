import { lstat, mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

for (const [name, specification] of Object.entries(dependencies)) {
  if (typeof specification !== 'string' || !specification.startsWith('file:')) {
    continue;
  }
  const target = path.resolve(shellRoot, specification.slice('file:'.length));
  const link = path.join(shellRoot, 'node_modules', name);
  const exists = await lstat(link).then(() => true, () => false);
  if (exists) {
    continue;
  }
  await mkdir(path.dirname(link), { recursive: true });
  await symlink(path.relative(path.dirname(link), target), link, 'dir');
  console.log(`linked: ${name} -> ${path.relative(shellRoot, target)}`);
}
