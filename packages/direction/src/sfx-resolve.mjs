// AKARI Sounds（ユーザースコープ ~/.akari/assets/audio/akari-sounds-*/）からの
// se_default id 解決。ファイル I/O を行う（契約書 §3-4）。

import { readFile, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const PACK_KINDS = ['sfx', 'jingle', 'bgm'];

/**
 * --audio-root 配下の akari-sounds-* パックから .origin-catalog.json を探して読む。
 * 複数パックにコピーが配布されている想定だが、内容は同一カタログなので最初に見つかった 1 件でよい。
 * 見つからなければ null（未導入 = フォールバックの正常系）。
 */
export async function loadAkariSoundsCatalog(audioRoot) {
  for (const kind of PACK_KINDS) {
    const catalogPath = path.join(audioRoot, `akari-sounds-${kind}`, '.origin-catalog.json');
    try {
      const text = await readFile(catalogPath, 'utf8');
      return JSON.parse(text);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return null;
}

/** catalog.tracks から id でトラックを引く。ファイル名（mp3）と kind を返す。無ければ null。 */
export function resolveSfxTrack(catalog, id) {
  if (!catalog || !Array.isArray(catalog.tracks)) return null;
  const track = catalog.tracks.find((t) => t.id === id);
  if (!track) return null;
  const file = Array.isArray(track.files) ? track.files[0] : undefined;
  if (!file?.mp3) return null;
  return { kind: track.kind, filename: file.mp3, durationSec: file.duration_sec ?? null };
}

/**
 * se_default id を実ファイルへ解決し、プロジェクト内 assets/sfx/<id>.mp3 へコピーする。
 * 見つからなければ null（呼び出し側が「フォールバック」ノートを出す）。
 * @returns {Promise<{path:string}|null>} project 相対パス（"assets/sfx/<id>.mp3"）
 */
export async function resolveAndCopySfx({ audioRoot, projectRoot, seDefaultId }) {
  const catalog = await loadAkariSoundsCatalog(audioRoot);
  const track = resolveSfxTrack(catalog, seDefaultId);
  if (!track) return null;
  const sourcePath = path.join(audioRoot, `akari-sounds-${track.kind}`, track.filename);
  const relativePath = path.join('assets', 'sfx', `${seDefaultId}.mp3`);
  const destPath = path.join(projectRoot, relativePath);
  await mkdir(path.dirname(destPath), { recursive: true });
  await copyFile(sourcePath, destPath);
  return { path: relativePath.split(path.sep).join('/'), durationSec: track.durationSec };
}
