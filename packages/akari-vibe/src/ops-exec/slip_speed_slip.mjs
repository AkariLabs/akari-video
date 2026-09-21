import { mediaTarget } from '../exec-support/slip_speed_slip.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'slip', apply(env, d) {
        const item = mediaTarget(env, d);
        if (!item) return;
        if (!['earlier', 'later'].includes(d.direction)) {
            env.log.push('slip → 未適用（素材区間をずらす向きが不明）'); return;
        }
        const seconds = d.seconds ?? [0.25, 1, 3][Math.max(0, Math.min(2, Math.round(d.amount ?? 1)))];
        if (!Number.isFinite(seconds) || seconds < 0) {
            env.log.push('slip → 未適用（秒数が不正）'); return;
        }
        const delta = seconds * (d.direction === 'earlier' ? -1 : 1);
        // Existing ranges prove availability, but their maximum is NOT the media EOF.
        const ends = env.editStore.allLocations(env.edit).map(x => x.item.source)
            .filter(s => s.kind === 'media' && s.src === item.source.src && Number.isFinite(s.out)).map(s => s.out);
        const knownEnd = Math.max(...ends);
        const shift = Math.max(-item.source.in, delta);
        if (item.source.out + shift > knownEnd) {
            env.log.push(`slip ${item.id} → 未適用（素材終端未確認、確認済み使用範囲 ${knownEnd}秒を超える）`); return;
        }
        patchItem(env, item.id, { source: { ...item.source, in: item.source.in + shift, out: item.source.out + shift } });
        env.log.push(`slip ${item.id} → source ${item.source.in + shift}〜${item.source.out + shift}秒、at/duration 維持${shift !== delta ? '（素材先頭で clamp）' : ''}`);
    } };
