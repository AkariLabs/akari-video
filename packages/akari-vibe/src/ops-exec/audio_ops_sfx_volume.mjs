import { audioTarget } from '../exec-support/audio_ops_sfx.mjs';
import { isAudioItem } from '../exec-support/audio_ops_sfx.mjs';
import { unapplied } from '../exec-support/audio_ops_sfx.mjs';
import { audioAssets } from '../exec-support/audio_ops_sfx.mjs';
import { patchItem } from '../ops/_knobs.mjs';
export default { id: 'audio_sfx_volume', apply(env,d) {
        const item=audioTarget(env,d);
        if (!isAudioItem(env,item) || (item.role ?? 'sfx') !== 'sfx') return unapplied(env,'audio_sfx_volume','選択中の効果音 item が edit に存在しない。lastOp の説明だけから item を復元しない');
        const asset=audioAssets.find(a => a.id === d.audio_sfx_id && a.id.startsWith('sfx-'));
        const source=env.edit.sources.find(s => s.id === item.source.src);
        if (!asset || !(item.source.src === asset.id || source?.path.includes(`/${asset.id}/`))) return unapplied(env,'audio_sfx_volume','選択 item と音源 Choice の対応が未確認');
        if (!['bigger','smaller'].includes(d.direction)) return unapplied(env,'audio_sfx_volume','音量の向きが未指定');
        const gain=Math.max(-60,Math.min(12,(item.gain_db ?? 0)+(d.direction === 'bigger' ? 4 : -4)));
        patchItem(env,item.id,{gain_db:gain}); env.log.push(`audio_sfx_volume: ${item.id} gain_db=${gain}`);
    } };
