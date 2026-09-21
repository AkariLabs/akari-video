import { audioTarget } from '../exec-support/audio_ops_sfx.mjs';
import { isAudioItem } from '../exec-support/audio_ops_sfx.mjs';
import { unapplied } from '../exec-support/audio_ops_sfx.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'audio_duck', apply(env,d) {
        const item=audioTarget(env,d);
        if (!isAudioItem(env,item) || item.role !== 'bgm') return unapplied(env,'audio_duck','audio lane のBGMを指定する必要がある');
        patchItem(env,item.id,{ducking:true,duck_db:-12,duck_attack:0.3,duck_release:0.8});
        env.log.push(`audio_duck: ${item.id} ducking=true、duck_db=-12（発話区間の鍵と再生は消費側で解決）`);
    } };
