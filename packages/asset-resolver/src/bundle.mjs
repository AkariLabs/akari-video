import { resolveAkariHome } from './env.mjs';
import { isAssetCached, localAssetDir } from './library.mjs';
import { readProjectReferences, removeProjectReference } from './project-references.mjs';
import { copyIntoProject, resolve as resolveAsset } from './resolve.mjs';

export async function bundleProjectReferences({
  project,
  env = process.env,
  dryRun = false,
} = {}) {
  const planned = await readProjectReferences(project);
  const result = { planned, materialized: [], failures: [] };
  if (dryRun) return result;

  const home = resolveAkariHome(env);
  for (const reference of planned) {
    try {
      if (!isAssetCached(home, reference.category, reference.id)) {
        const resolved = await resolveAsset(reference.id, { env });
        if (resolved.category !== reference.category) {
          throw new Error(
            `カタログのカテゴリが台帳と一致しません: ${reference.category}/${reference.id}（実際: ${resolved.category}）`,
          );
        }
      }
      const sourceDir = localAssetDir(home, reference.category, reference.id);
      const projectDir = await copyIntoProject(
        sourceDir,
        project,
        reference.category,
        reference.id,
      );
      await removeProjectReference(project, reference);
      result.materialized.push({ ...reference, projectDir });
    } catch (error) {
      result.failures.push({
        reference,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
