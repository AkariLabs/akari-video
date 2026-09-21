import os from 'node:os';
import { computeKeywordHits } from '../../src/keyword-hits.mjs';
import { roleKey } from '../../src/v2/telop.mjs';
import { view } from '../../src/v2/model.mjs';

export const truncatePrivateText = value => {
    const chars = Array.from(String(value ?? ''));
    return chars.length > 20 ? chars.slice(0, 20).join('') + '…' : chars.join('');
};

const secretPath = value => /(?:\/Users\/|\/home\/|[A-Za-z]:\\)/.test(value);
// 伏せるのは「機械や人を特定できるもの」だけ。プロジェクトの中の相対パス（captions.json・
// .akari/work/... など）は文書の構造そのもので、伏せると edit v2 の検査に落ちる（2026-09-20 実機で観測）。
const privateKey = key => /(?:uri|projectName|projectRoot|userName|rootFsPath|editPath|captionsPath)$/i.test(key);
const locationKey = key => /^(?:rootFsPath|editPath|captionsPath)$/i.test(key);
const projectRelative = value => !secretPath(value) && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value);

function redactTree(value, key = '') {
    if (typeof value === 'string') {
        const user = os.homedir().split(/[\\/]/).filter(Boolean).at(-1);
        if (key.toLowerCase().endsWith('path') && projectRelative(value)) return value;  // プロジェクト内の相対パスは残す
        if (privateKey(key) || secretPath(value) || (user && value.includes(user))) return '[REDACTED]';
        return value;
    }
    if (Array.isArray(value)) return value.map(row => redactTree(row, key));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([childKey]) => !locationKey(childKey))
        .map(([childKey, child]) => [childKey, redactTree(child, childKey)]));
}

function truncateEditText(edit) {
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        if (value.source?.kind === 'telop') {
            const key = roleKey(value, 'text') ?? (Object.hasOwn(value.source.params ?? {}, 'text') ? 'text' : null);
            if (key && typeof value.source.params?.[key] === 'string') value.source.params[key] = truncatePrivateText(value.source.params[key]);
        }
        if (value.source?.kind === 'caption' && typeof value.source.params?.text === 'string') {
            value.source.params.text = truncatePrivateText(value.source.params.text);
        }
        if (typeof value.caption?.text === 'string') value.caption.text = truncatePrivateText(value.caption.text);
        for (const child of Object.values(value)) visit(child);
    };
    visit(edit);
    return edit;
}

function redactCaptions(captionsSource) {
    if (typeof captionsSource !== 'string' || captionsSource.length === 0) return captionsSource;
    try {
        const captions = JSON.parse(captionsSource);
        const rows = Array.isArray(captions) ? captions : captions.captions;
        if (Array.isArray(rows)) for (const row of rows) if (typeof row?.text === 'string') row.text = truncatePrivateText(row.text);
        return JSON.stringify(redactTree(captions));
    } catch {
        return secretPath(captionsSource) ? '[REDACTED]' : truncatePrivateText(captionsSource);
    }
}

function sourceAt(edit, playheadT) {
    if (!Number.isFinite(playheadT)) return null;
    try {
        return view(edit).segments.find(segment => playheadT >= segment.at && playheadT < segment.end)?.raw?.source?.src ?? null;
    } catch {
        // 伏せる前の edit に絶対パス等があり strict な edit 読込が止まっても、平坦な main cut は安全に特定する。
        const fps = edit?.output?.fps;
        if (!Number.isFinite(fps) || fps <= 0) return null;
        const items = (edit?.tracks ?? []).filter(track => track?.lane === 'visual')
            .flatMap(track => track?.items ?? []).filter(item => item?.source?.kind === 'media');
        return items.find(item => playheadT >= item.at / fps && playheadT < (item.at + item.duration) / fps)?.source?.src ?? null;
    }
}

export function redactJudgeRequest(request) {
    const keywordHits = computeKeywordHits(request.text, request.context?.transcript ?? []);
    const edit = truncateEditText(structuredClone(request.edit));
    const context = structuredClone(request.context ?? {});
    context.transcript = (context.transcript ?? []).map(row => ({ ...row, text: truncatePrivateText(row.text) }));
    const currentSource = sourceAt(request.edit, request.ctx?.playheadT);
    context.vision = (context.vision ?? []).filter(row => currentSource != null && row?.src === currentSource)
        .map(row => ({ id: row.id, label: row.label, srcRange: row.srcRange, box: row.box }));
    if (context.labels) {
        context.labels = Object.fromEntries(Object.entries(context.labels).map(([key, label]) => [key,
            String(label).replace(/「([^」]*)」/g, (_, text) => `「${truncatePrivateText(text)}」`)]));
    }
    return redactTree({ ...request, edit, context, captionsSource: redactCaptions(request.captionsSource), keywordHits });
}
