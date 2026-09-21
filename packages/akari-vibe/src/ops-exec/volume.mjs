import { audioTarget } from '../exec-support/audio_ops_sfx.mjs';
import sfxVolume from './audio_ops_sfx_volume.mjs';
import { itemForKey } from '../v2/model.mjs';
import { targets } from '../ops/_helpers.mjs';
import { isAudioItem } from '../exec-support/audio_ops_sfx.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'volume', apply(env, d) {
        const target = audioTarget(env, d);
        if (target?.role === 'sfx' || d.volumeKind === 'sfx') return sfxVolume.apply(env, d);
        const item = target ?? ((!d.target || d.target === 'none') ? itemForKey(env.edit,'item_bgm') : null), {level}=targets(env,d);
        if (item && !isAudioItem(env, item)) { env.log.push('volume → 未適用（音声トラックではない）'); return; }
        if (!item) { env.log.push('volume: BGM が無い → 未適用'); return; }
        const db=[2,4,8][level]*(d.direction === 'bigger' ? 1 : -1), next=(item.gain_db ?? 0)+db;
        patchItem(env,item.id,{gain_db:next}); env.log.push(`BGM ${db>0?'+':''}${db}dB → ${next}dB`);
    } };
