import crypto from 'node:crypto';

export const sha256Text = text => crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex');

function instructionFor(input) {
    const editChanged = input.next.editText !== undefined;
    const captionsChanged = input.next.captionsText !== undefined;
    return {
        projectSessionId: input.projectSessionId,
        label: input.label,
        ...(editChanged ? { edit: { baseSha256: input.before.editHash, nextText: input.next.editText } } : {}),
        ...(captionsChanged ? { captions: { baseSha256: input.before.captionsHash, nextText: input.next.captionsText } } : {}),
    };
}

export async function sendApplyEdit(input, link, { rebuild, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    task = () => {}, log = () => {}, banner = () => {} } = {}) {
    let current = input;
    let staleRetries = 0;
    let busyRetries = 0;
    while (true) {
        const result = await link.sendInstruction('applyEdit', instructionFor(current));
        if (result.ok) return { ok: true, result, input: current };
        if (result.error === 'stale' && staleRetries++ === 0 && rebuild) {
            current = await rebuild(result.value ?? {});
            continue;
        }
        if (result.error === 'busy' && busyRetries++ === 0) {
            await sleep(500);
            continue;
        }
        if (result.error === 'stale') task('[要確認] 編集がほかの変更と衝突（再送 1 回失敗）');
        else if (result.error === 'rejected') task(`[要確認] 編集が検査で拒否された${result.value?.reasons?.length ? `: ${result.value.reasons.join(' / ')}` : ''}`);
        else if (result.error === 'too-large') task('[要確認] 文書が大きすぎて送れない');
        else if (['invalid-args', 'not-allowed'].includes(result.error)) {
            log(`companion applyEdit ${result.error}`); task('[要確認] companion の編集指示が不正');
        } else if (result.error === 'busy') task('[要確認] companion が処理中のため編集できない');
        else if (result.error === 'stale-session') log('companion applyEdit stale-session');
        else if (['not-connected', 'timeout'].includes(result.error)) banner(result.error === 'timeout' ? 'シェルから応答がありません' : 'シェルに接続されていません');
        else log(`companion applyEdit ${result.error ?? 'unknown-error'}`);
        return { ok: false, result, input: current };
    }
}
