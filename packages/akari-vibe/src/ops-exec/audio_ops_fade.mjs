import { audioTarget } from '../exec-support/audio_ops_sfx.mjs';
import { isAudioItem } from '../exec-support/audio_ops_sfx.mjs';
import { unapplied } from '../exec-support/audio_ops_sfx.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'audio_fade', apply(env,d) {
        const item=audioTarget(env,d);
        if (!isAudioItem(env,item)) return unapplied(env,'audio_fade','audio lane の対象 item が必要');
        if (!['in','out'].includes(d.audio_fade_dir)) return unapplied(env,'audio_fade','フェードの向きが未指定');
        const seconds=d.seconds ?? 1;
        if (!Number.isFinite(seconds) || seconds < 0 || item.duration <= 0) return unapplied(env,'audio_fade','フェード秒数または音源尺が未確定');
        // fade fields are seconds (schema), unlike item.at/duration.
        const fade=Math.min(seconds,item.duration/env.edit.output.fps/2);
        patchItem(env,item.id,{[`fade_${d.audio_fade_dir}`]:fade});
        env.log.push(`audio_fade: ${item.id} fade_${d.audio_fade_dir}=${fade}秒`);
    } };
