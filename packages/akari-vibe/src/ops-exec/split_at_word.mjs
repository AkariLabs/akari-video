import { findWordMatches } from '../exec-support/split_at_word.mjs';
import { view } from '../v2/model.mjs';
import { secondsToFrames } from '../ops/_knobs.mjs';
import { writeEdit } from '../ops/_knobs.mjs';
import { splitItem } from '../v2/mutations.mjs';
export default { id: 'split_at_word', apply(env, d) {
        const skip = reason => env.log.push(`split_at_word ${d.split_at_word_segment ?? ''} → 未適用（${reason}）`);
        if (d.split_at_word_segment === 'ambiguous') return skip('セリフ候補を絞れない');
        if (!['before', 'after'].includes(d.split_at_word_side)) return skip('語の前後が未確定');
        const hit = findWordMatches(d.split_at_word_text ?? '', env.context)
            .find(h => h.segment.id === d.split_at_word_segment);
        if (!hit) return skip('指定セリフに一致する語が見つからない');
        if (hit.matches.length !== 1) return skip('同じセリフ内の語の出現位置が複数ある');
        const { segment } = hit, word = hit.matches[0];
        if (!Number.isFinite(word.start) || !Number.isFinite(word.end) || word.end <= word.start) return skip('語時刻が不正');
        if (segment.timeDomain !== 'source' || !segment.src) return skip('語時刻の source 秒・素材 ID が未指定');
        const sourceT = d.split_at_word_side === 'before' ? word.start : word.end;
        try {
            const candidates = view(env.edit).segments.filter(s => s.source.src === segment.src
                && sourceT >= s.source.in && sourceT <= s.source.out);
            if (!candidates.length) return skip('指定語の時刻を含むカットが無い');
            if (candidates.length > 1) return skip('カット端または同じ素材区間の再利用でカットが一意でない');
            const s = candidates[0], item = s.raw;
            if (s.source.freeze || item.anchor || item.keyframes || item.motion || item.animator?.length || s.source.transition_out)
                return skip('止め絵・アンカー・キーフレーム・トランジション付き分割は未対応');
            const span = s.source.out - s.source.in;
            if (!(span > 0)) return skip('素材区間の長さが不正');
            const outputT = s.at + (sourceT - s.source.in) / span * (s.end - s.at);
            const outputFrame = secondsToFrames(env.edit, outputT);
            const location = env.editStore.locate(env.edit, item.id);
            const absoluteFrame = env.editStore.absoluteAt(location);
            // splitItem takes parent-local frames, whereas view() is output time.
            const localFrame = item.at + outputFrame - absoluteFrame;
            if (localFrame <= item.at || localFrame >= item.at + item.duration) return skip('分割位置がカット端に当たる');
            writeEdit(env, splitItem(env.edit, { itemId: item.id, atFrames: localFrame }));
            env.playheadT = outputFrame / env.edit.output.fps;
            env.log.push(`split_at_word ${segment.id}「${word.text}」${d.split_at_word_side} source=${sourceT}秒 → ${item.id} @ ${env.playheadT}秒`);
        } catch (error) { skip(`分割できない: ${error.message}`); }
    } };
