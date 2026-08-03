// harvest-asset の規律（audio: waveform を preview にする）に従い、library scope の
// 実体エントリへ preview.png（波形画像）を作る共有ロジック。
// register-drop-folder.mjs と fetch-akari-sounds.mjs の両方から使う（重複実装しない）。

import { spawnSync } from 'node:child_process';
import { resolveFfmpeg } from '../../media-bin/src/index.mjs';

let ffmpegPathCache;
function resolvedFfmpegPath() {
    if (ffmpegPathCache === undefined) {
        try {
            ffmpegPathCache = resolveFfmpeg();
        } catch {
            ffmpegPathCache = null;
        }
    }
    return ffmpegPathCache;
}

/**
 * ffmpeg が無ければ生成せず理由を返す（実物と違う mock を preview として作らない）。
 */
export function generateWaveformPreview(sourceAudioPath, destPngPath) {
    const ffmpegPath = resolvedFfmpegPath();
    if (!ffmpegPath) {
        return { ok: false, reason: 'ffmpeg が見つからないため preview.png を生成できません' };
    }
    const result = spawnSync(ffmpegPath, [
        '-y',
        '-i', sourceAudioPath,
        '-filter_complex', 'showwavespic=s=640x120:colors=0d6efd',
        '-frames:v', '1',
        destPngPath,
    ], { stdio: 'ignore' });
    if (result.status !== 0) {
        return { ok: false, reason: `ffmpeg の実行に失敗しました（exit ${result.status}）。音声実体が壊れているか非対応形式の可能性` };
    }
    return { ok: true };
}
