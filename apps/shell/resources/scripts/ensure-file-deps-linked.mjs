import { lstat, mkdir, readFile, symlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { execSync } from 'node:child_process';

const shellRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageJson = JSON.parse(await readFile(path.join(shellRoot, 'package.json'), 'utf8'));
const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };

function isWindows() {
  return os.platform() === 'win32';
}

function createSymlink(linkPath, targetPath) {
  return symlink(path.relative(path.dirname(linkPath), targetPath), linkPath, 'dir');
}

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

  // Windows-friendly symlink strategy:
  // 1. Try normal symlink (works on Win10+ with admin/dev mode)
  // 2. Fall back to junction (always works on Windows)
  // 3. Fall back to copy (guaranteed but slowest)
  const targetRelative = path.relative(path.dirname(link), target);
  let success = false;

  try {
    await createSymlink(link, target);
    console.log(`linked: ${name} -> ${path.relative(shellRoot, target)}`);
    success = true;
  } catch (e) {
    if (!isWindows()) throw e;

    // Fallback 1: junction (fs.symlink with 'dir' type should handle this, but try junction explicitly)
    try {
      await execSync(`mklink /J "${link}" "${target}"`, { stdio: 'ignore' });
      console.log(`linked (junction): ${name} -> ${path.relative(shellRoot, target)}`);
      success = true;
    } catch (junctionErr) {
      // Fallback 2: copy the directory (guaranteed to work, but slower)
      const { execFileSync } = await import('node:child_process');
      try {
        await execSync(`xcopy /E /I /Q "${target}" "${link}"`, { stdio: 'ignore' });
        console.log(`linked (copy): ${name} -> ${path.relative(shellRoot, target)}`);
        success = true;
      } catch (copyErr) {
        throw new Error(`${name}: failed to link "${target}" to "${link}". Tried symlink, junction, copy. Last error: ${copyErr.message}`);
      }
    }
  }
}
