import { captionFor } from '../exec-support/caption_shift_emphasis_shift.mjs';
import { measuredAnchor } from '../exec-support/caption_shift_emphasis_word.mjs';
export default { id: 'caption_emphasis', apply(env, d) {
        const fail = reason => env.log.push(`caption_emphasis → 未適用（${reason}）`);
        const cap = captionFor(env.captions, d.target), word = d.caption_emphasis_word;
        if (!cap || env.captionsSource == null) return fail('対象の字幕行が一意に確認できない');
        if (typeof word !== 'string' || !word.trim() || word === 'none' || !cap.text.includes(word)) return fail('強調語が対象の字幕本文にない');
        try {
            const raw = JSON.parse(env.captionsSource), root = Array.isArray(raw) ? { captions: raw } : raw;
            // Current parseCaptions omits words/src despite the d.ts fields.
            // Read those two fields from the same uniquely identified raw row.
            const rows = root.captions.filter(c => c.id === cap.id);
            if (rows.length !== 1) return fail('元の字幕行が一意でない');
            const row = rows[0];
            if (row.words != null && (!Array.isArray(row.words) || row.words.some(w => !w || typeof w.text !== 'string' || !Number.isFinite(w.start) || !Number.isFinite(w.end) || w.end <= w.start))) return fail('実測 words の形式が不正');
            if (row.src != null && (typeof row.src !== 'string' || !row.src.trim())) return fail('字幕の src が不正');
            const anchor = measuredAnchor({ ...cap, words: row.words, src: row.src }, word, env.segments);
            const entries = root.emphasis_words ?? [];
            if (!Array.isArray(entries)) return fail('既存 emphasis_words が配列でない');
            if (entries.some(e => e.word === word && e.t_start === anchor.t_start && e.t_end === anchor.t_end && e.src === anchor.src)) {
                env.log.push(`caption_emphasis ${cap.id} → 「${word}」は追加済み`); return;
            }
            const ids = new Set(entries.map(e => e.id));
            let n = 1;
            while (ids.has(`e-${String(n).padStart(4, '0')}`) && n <= 9999) n++;
            if (n > 9999) return fail('強調語 ID の空きがない');
            root.emphasis_words = [...entries, { id: `e-${String(n).padStart(4, '0')}`, ...anchor, word, emotion: 'emphasis' }];
            const next = JSON.stringify(root, null, 2) + '\n';
            const parsed = env.editStore.parseCaptions(next);
            if (!captionFor(parsed.captions, d.target)) return fail('変更後の字幕行を parseCaptions で確認できない');
            env.editStore.readEditV2(JSON.parse(env.source));
            env.captionsSource = next;
            env.log.push(`caption_emphasis ${cap.id} → 「${word}」を emphasis_words に追加`);
        } catch (error) { fail(error.message); }
    } };
