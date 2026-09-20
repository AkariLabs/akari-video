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
  // Windows のディレクトリ symlink（type 'dir'）は管理者権限か開発者モードが必要で、
  // 一般の Windows 機では EPERM になり **シェルのビルドが prebuild で止まる**。
  // junction は同じ「ディレクトリへの参照」を権限なしで作れるので、リンクを拒まれた
  // ときだけそちらへ倒す（packages/edit-store/src/write-gate.ts と同じ規律。不具合メモ 第8項）。
  // 既に通っている環境の挙動は変えない（相対パスの 'dir' リンクのまま）。
  try {
    await symlink(path.relative(path.dirname(link), target), link, 'dir');
  } catch (error) {
    const code = error?.code;
    if (!['EPERM', 'EACCES', 'EINVAL', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN'].includes(code)) {
      throw error;
    }
    // junction は絶対パスでなければ解決先がずれる。
    await symlink(target, link, 'junction');
    console.log(`linked (junction): ${name} -> ${path.relative(shellRoot, target)}`);
    continue;
  }
  console.log(`linked: ${name} -> ${path.relative(shellRoot, target)}`);
}
