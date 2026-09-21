import { captionFor } from '../exec-support/caption_shift_emphasis_shift.mjs';
export default { id: 'caption_shift', apply(env, d) {
        const fail = reason => env.log.push(`caption_shift → 未適用（${reason}）`);
        const cap = captionFor(env.captions, d.target);
        if (!cap || env.captionsSource == null) return fail('対象の字幕行が一意に確認できない');
        if (!['earlier', 'later'].includes(d.direction)) return fail('移動方向が不明');
        const seconds = d.seconds ?? 0.3;
        if (!Number.isFinite(seconds) || seconds < 0) return fail('秒数が不正');
        if (typeof env.editStore.shiftCaptionLine !== 'function') return fail('shiftCaptionLine がない');
        const delta = (d.direction === 'earlier' ? -1 : 1) * seconds;
        try {
            const next = env.editStore.shiftCaptionLine(env.captionsSource, cap.id, delta, delta);
            const parsed = env.editStore.parseCaptions(next);
            if (!captionFor(parsed.captions, d.target)) return fail('変更後の字幕行を parseCaptions で確認できない');
            env.editStore.readEditV2(JSON.parse(env.source));
            env.captionsSource = next;
            env.log.push(`caption_shift ${cap.id} → ${delta}秒（開始・終了を同量移動）`);
        } catch (error) { fail(error.message); }
    } };
