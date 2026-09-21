import { editStore } from '../edit-store.mjs';
import { noteBodyFrom, readReview } from '../exec-support/review_note.mjs';
import { view } from '../v2/model.mjs';
import { regionOf } from '../exec-support/review_note.mjs';
import { refsOf } from '../exec-support/review_note.mjs';
import { targetItem } from '../ops/_knobs.mjs';
export default { id: 'review_note', apply(env, d) {
        // review_note never writes edit.json, but validates it even on failure.
        editStore.readEditV2(JSON.parse(env.source));
        try {
            const review = readReview(env.reviewSource);
            if (env.reviewSource == null) env.reviewSource = JSON.stringify(review, null, 2) + '\n';
            const text = env.ctx?.rawText ?? env.rawText ?? d.review_note_text;
            if (typeof text !== 'string' || !text.trim()) throw new Error('発話原文が無い（resolve または ctx.rawText が必要）');
            const body = noteBodyFrom(text);
            if (body !== text) env.log.push(`review_note 本文: 発話「${text}」→「${body}」`);
            const segments = view(env.edit).segments;
            const hits = segments.filter(s => env.playheadT >= s.at && env.playheadT < s.end);
            if (!hits.length) throw new Error('再生位置に source へ変換できる区間が無い');
            if (hits.length > 1) env.log.push('review_note 時間アンカー: 重なる区間の先頭を採用');
            const segment = hits[0];
            const sourceT = segment.source.in + (env.playheadT - segment.at)
                * (segment.source.out - segment.source.in) / segment.duration;
            if (!Number.isFinite(sourceT) || sourceT < 0) throw new Error('source 秒が不正');
            const region = regionOf(env, segment);
            const refs = /^(item|person)_/.test(d.target ?? '')
                ? refsOf(targetItem(env, d.target), env.log) : null;
            const ids = new Set(review.annotations.map(a => a?.id));
            let n = 1;
            const idFor = value => `a-${String(value).padStart(4, '0')}`;
            while (ids.has(idFor(n))) n++;
            const annotation = {
                id: idFor(n), createdAt: new Date().toISOString(),
                src: segment.source.src ?? null, sourceT, sourceRange: null,
                targetKind: region != null ? 'region' : refs ? 'asset' : 'instant',
                region, strokes: null, refs, insertPosition: null,
                intent: 'fix', text: body, timelineT: null, target: null,
                input: 'voice', audio: null, poses: null, status: 'open', response: null,
            };
            review.annotations.push(annotation);
            env.reviewSource = JSON.stringify(review, null, 2) + '\n';
            env.log.push(`review_note → env.reviewSource に1件追加（計${review.annotations.length}件・ファイル保存は未接続） ${JSON.stringify(annotation)}`);
        } catch (error) {
            env.log.push(`review_note → 未適用（${error.message}）`);
        }
    } };
