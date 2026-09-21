import { view } from '../v2/model.mjs';
export const prefix = 'playback_relative_';
export function applyPlaybackRelative(env, d) {
    const kind = d.op.slice(prefix.length);
    const unavailable = reason => env.log.push(`${d.op} → 未適用（${reason}）`);
    if (!env.ui || typeof env.ui !== 'object' || Array.isArray(env.ui)) {
        unavailable('env.ui がなくプレビュー／タイムラインへ意図を渡せない');
        return;
    }
    if (kind === 'play' || kind === 'pause') {
        env.ui.playing = kind === 'play';
    } else if (kind === 'seek' || kind === 'loop' || kind === 'fit') {
        const segments = view(JSON.parse(env.source)).segments;
        const end = segments.at(-1)?.end;
        if (!Number.isFinite(end) || end <= 0) { unavailable('本編の時間範囲がない'); return; }
        if (kind === 'fit') {
            env.ui.timelineZoom = 'fit';
            env.ui.timelineRange = { start: 0, end };
        } else {
            if (!Number.isFinite(env.playheadT)) { unavailable('現在の再生位置が不明'); return; }
            if (kind === 'loop') {
                if (env.playheadT < 0 || env.playheadT >= end) { unavailable('現在位置から末尾までのループ区間が空'); return; }
                env.ui.loop = { start: env.playheadT, end };
                env.ui.playing = true;
            } else {
                const seconds = d.playback_relative_seconds, direction = d.playback_relative_direction;
                if (!Number.isFinite(seconds) || seconds < 0 || !['forward', 'backward'].includes(direction)) {
                    unavailable('相対秒数または方向が未確定'); return;
                }
                // Match applyDecision's last playable second clamp.
                env.playheadT = Math.max(0, Math.min(Math.max(0, end - 0.01), env.playheadT + (direction === 'forward' ? seconds : -seconds)));
                env.ui.seekTo = env.playheadT;
            }
        }
    } else if (kind === 'zoom_in' || kind === 'zoom_out') {
        // Ratio intent avoids inventing the shell's current zoom / viewport width.
        env.ui.timelineZoom = { factor: kind === 'zoom_in' ? 1.25 : 0.8 };
    } else { unavailable('対応する画面操作がない'); return; }
    env.log.push(`${d.op} → UI意図${kind === 'seek' ? ` ${env.playheadT}秒` : ''}（画面への反映は呼び出し側）`);
}
