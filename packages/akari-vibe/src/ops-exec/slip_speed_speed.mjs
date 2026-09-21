import { mediaTarget } from '../exec-support/slip_speed_slip.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'speed', apply(env, d) {
        const item = mediaTarget(env, d);
        if (!item) return;
        const current = item.source.speed ?? 1;
        const level = Math.max(0, Math.min(2, Math.round(d.amount ?? 1)));
        const step = [1.1, 1.25, 2][level];
        const rate = d.speed_mode === 'reset' ? 1 : d.speed_mode === 'set' ? d.speed_rate :
            d.speed_mode === 'faster' ? current * step : d.speed_mode === 'slower' ? current / step : null;
        if (!Number.isFinite(rate) || rate <= 0) {
            env.log.push('speed → 未適用（有効な速度モードと正の倍率が必要）'); return;
        }
        const duration = secondsToFrames(env.edit, (item.source.out - item.source.in) / rate);
        if (!Number.isSafeInteger(duration) || duration < 1) {
            env.log.push('speed → 未適用（変更後の尺が有効な整数フレームにならない）'); return;
        }
        patchItem(env, item.id, { source: { ...item.source, speed: rate }, duration });
        env.log.push(`speed ${item.id} → ${rate}倍、duration=${duration}f（at/source.in/out 維持）`);
    } };
