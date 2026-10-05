import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { recordProjectReference } from './project-references.mjs';
import { appendLibraryUsage } from './library-usage.mjs';
import { ASSET_CATEGORIES } from './library.mjs';
import { resolveAssetLibraryRoots } from '../../creator-root/src/index.mjs';

const within = (root, target) => {
  const rel = relative(root, target);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
};

export async function placeLibraryAsset(source, projectPath, env = process.env) {
  if (!source || !ASSET_CATEGORIES.includes(source.category)
      || typeof source.id !== 'string' || !source.id || source.id === '.'
      || source.id.includes('..') || source.id.includes('/') || source.id.includes(String.fromCharCode(92))
      || typeof source.libraryDir !== 'string' || !isAbsolute(source.libraryDir)) {
    throw new Error('素材の種類・名前・置き場が不正です');
  }
  const actual = await realpath(source.libraryDir);
  if (basename(actual) !== source.id || basename(dirname(actual)) !== source.category
      || !(await stat(actual)).isDirectory()) {
    throw new Error('素材の置き場と種類・名前が一致しません');
  }
  let allowed = false;
  for (const root of resolveAssetLibraryRoots(env).read) {
    try { if (within(await realpath(root), actual)) allowed = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!allowed) throw new Error('素材がライブラリの置き場の外にあります');
  const project = await realpath(projectPath);
  if (!(await stat(project)).isDirectory()) throw new Error('プロジェクトがフォルダではありません');
  const destination = join(project, 'assets', source.category, source.id);
  let parent = dirname(destination);
  let actualDestination;
  while (true) {
    try {
      const actualParent = await realpath(parent);
      if (!within(project, actualParent)) throw new Error('配置先がプロジェクトの外にあります');
      actualDestination = join(actualParent, relative(parent, destination));
      break;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      parent = dirname(parent);
    }
  }
  if (within(actualDestination, actual) || within(actual, actualDestination)) {
    throw new Error('素材の大元と重なる配置はできません');
  }
  await recordProjectReference(project, { category: source.category, id: source.id });
  await appendLibraryUsage({ category: source.category, id: source.id, project });
  return { success: true, projectAssetPath: join(projectPath, 'assets', source.category, source.id),
    reference: true, libraryDir: actual };
}
