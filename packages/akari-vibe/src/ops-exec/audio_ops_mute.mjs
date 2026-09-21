import { audioTarget } from '../exec-support/audio_ops_sfx.mjs';
import { isAudioItem } from '../exec-support/audio_ops_sfx.mjs';
import { patchItem } from '../ops/_knobs.mjs';
import { unapplied } from '../exec-support/audio_ops_sfx.mjs';
export default { id: 'audio_mute', apply(env,d) {
        const item=audioTarget(env,d);
        if (isAudioItem(env,item)) patchItem(env,item.id,{mute:true});
        else if(item?.source.kind === 'media' && item.audio !== false) patchItem(env,item.id,{source:{...item.source,mute:true}});
        else return unapplied(env,'audio_mute','音声を持つ対象が無い、または音声が分離済み');
        env.log.push(`audio_mute: ${item.id} mute=true（item と尺を保持）`);
    } };
