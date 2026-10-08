import { realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import { resolveAkariHome } from './env.mjs';

/** A project marker must be a directory distinct from the application-wide AKARI_HOME. */
export function hasProjectAkariDirectory(directory, env = process.env) {
  const marker = path.join(directory, '.akari');
  let markerPath;
  try {
    if (!statSync(marker).isDirectory()) return false;
    markerPath = realpathSync.native(marker);
  } catch {
    return false;
  }
  try {
    return markerPath !== realpathSync.native(resolveAkariHome(env));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      // AKARI_HOME need not exist. An existing marker cannot point to a missing home.
      return true;
    }
    // If the home cannot be checked, do not risk treating it as a project.
    return false;
  }
}
