import { audioCandidates } from '../exec-support/audio_ops_sfx.mjs';
import { candidateContext } from '../exec-support/candidates.mjs';
import { audioSummary } from '../exec-support/audio_ops_sfx.mjs';
import { insertAudio } from '../exec-support/audio_ops_sfx.mjs';
import { unapplied } from '../exec-support/audio_ops_sfx.mjs';
export default { id: 'audio_bgm_pick', apply(env,d) {
        if(d.audio_bgm_action === 'suggest') {
            const candidates=audioCandidates('bgm',{text:d.audioQuery ?? '',ctx:env.ctx},env.context);
            env.lastCandidates = candidateContext('bgm', candidates);
            env.log.push(`audio_bgm_pick: 候補を提示済み（未挿入）。${candidates.map((a,i) => `候補${i+1}=${a.id} / ${audioSummary(a)}`).join('、')}`);
        } else if(d.audio_bgm_action === 'insert') insertAudio(env,d,'bgm');
        else unapplied(env,'audio_bgm_pick','候補提示か挿入かが未指定');
    } };
