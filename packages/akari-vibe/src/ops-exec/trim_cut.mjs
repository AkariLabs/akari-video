import { targetItem } from '../ops/_knobs.mjs';
import { view } from '../v2/model.mjs';
import { MOVE_STEP } from '../ops/_helpers.mjs';
import { targets } from '../ops/_helpers.mjs';
import { framesToSeconds } from '../ops/_knobs.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
export default { id: 'trim_cut', apply(env, d) {
        const skip = reason => env.log.push(`trim_cut ${d.target ?? 'none'} → 未適用（${reason}）`);
        if (!['head', 'tail'].includes(d.trim_edge) || !['shorten', 'extend'].includes(d.trim_dir)) {
            skip('端または向きが未指定'); return;
        }
        const item = targetItem(env, d.target);
        const cut = item && view(env.edit).segments.find(s => s.itemId === item.id);
        if (!cut || item.source.kind !== 'media' || d.target?.startsWith('person_')) {
            skip('対象が映像カットではない'); return;
        }
        const source = item.source, speed = source.speed ?? 1;
        if (source.freeze || !Number.isFinite(speed) || speed <= 0) {
            skip('止め絵または不正な再生速度のトリムは未対応'); return;
        }
        // judge の preparse が全角小数も含めて発話から seconds を抽出済み。
        // 秒数なしは既存の時間微調整 MOVE_STEP と揃え、少し/通常/大幅 = 0.5/1/2 素材秒。
        const seconds = d.seconds ?? MOVE_STEP[targets(env, d).level];
        if (!Number.isFinite(seconds) || seconds <= 0) { skip('秒数が正の有限値ではない'); return; }
        const change = seconds * (d.trim_dir === 'extend' ? 1 : -1);
        const nextIn = source.in - (d.trim_edge === 'head' ? change : 0);
        const nextOut = source.out + (d.trim_edge === 'tail' ? change : 0);
        if (nextIn < 0) { skip('延長すると素材の先頭を越える'); return; }
        if (d.trim_edge === 'tail' && d.trim_dir === 'extend') {
            // lab 専用の受け口。呼び出し側が実測した素材長（秒）を source.src をキーに渡す。
            // v2 sources の型には素材長が無いため、他カットの out を全長と推測しない。
            const maxOut = env.context?.trim_cutSourceDurations?.[source.src];
            if (!Number.isFinite(maxOut) || maxOut < source.out) { skip('素材長が不明または不正で out 延長の上限を確認できない'); return; }
            if (nextOut > maxOut) { skip('延長すると素材の末尾を越える'); return; }
        }
        const durationSeconds = (nextOut - nextIn) / speed;
        // in/out の減算誤差だけを許容（1フレームちょうどを誤って拒否しない）。
        if (durationSeconds < framesToSeconds(env.edit, 1) - 1e-12) { skip('短縮後の長さが1フレーム未満'); return; }
        const duration = secondsToFrames(env.edit, durationSeconds);
        if (!Number.isSafeInteger(duration) || duration < 1) { skip('フレーム数が不正'); return; }
        const edit = structuredClone(env.edit), found = env.editStore.locate(edit, item.id);
        const delta = duration - item.duration, end = item.at + item.duration;
        found.item.source.in = nextIn;
        found.item.source.out = nextOut;
        found.item.duration = duration;
        // rippleRemoveItem と同じく、同じトラックで旧終端以降に始まる item のみ移動。
        for (const next of found.items) if (next.id !== item.id && next.at >= end) next.at += delta;
        try { writeEdit(env, edit); }
        catch (error) { skip(`v2 検証に失敗: ${error.message}`); return; }
        const deltaSeconds = framesToSeconds(edit, delta);
        if (env.playheadT >= cut.end) env.playheadT += deltaSeconds;
        else if (env.playheadT >= cut.at) {
            env.playheadT = d.trim_edge === 'head'
                ? Math.max(cut.at, env.playheadT + deltaSeconds)
                : Math.min(env.playheadT, cut.at + framesToSeconds(edit, duration));
        }
        env.log.push(`trim_cut ${item.id} ${d.trim_edge}/${d.trim_dir} ${seconds}秒 → in=${nextIn}, out=${nextOut}, duration=${duration}f（整数フレームへ丸め、同一トラック後続 ${delta >= 0 ? '+' : ''}${delta}f）`);
    } };
