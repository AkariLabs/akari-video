import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
import { resourcesRoot as publicRepo } from '../resources-root.mjs';

export function declarations(item) {
    if (item?.source?.kind !== 'html' || typeof item.source.path !== 'string') return [];
    const source = item.source.path;
    if (source.startsWith('PUBLIC_REPO/') && !publicRepo()) return [];
    const file = source.startsWith('PUBLIC_REPO/') ? path.resolve(publicRepo(), source.slice(12))
        : path.resolve(repo, source);
    try {
        const meta = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'meta.json'), 'utf8'));
        return (Array.isArray(meta.knobs) ? meta.knobs : []).filter(k => /^--[\w-]+$/.test(k.cssVar) && typeof k.label === 'string');
    } catch { return []; }
}

export function intentDeclaration(item, kind, { partId = '', text = '' } = {}) {
    const declared = declarations(item);
    if (kind === 'width') return declared.find(k => /width/i.test(k.cssVar) || /幅/.test(k.label)) ?? null;
    if (kind !== 'font-size') return null;
    const sizes = declared.filter(k => /font-size|(?:title|body).*size/i.test(k.cssVar)
        || /(?:文字|本文|見出し|名前|フォント).*サイズ/.test(k.label));
    if (/title|head/i.test(partId) || /見出し|タイトル/.test(text)) {
        return sizes.find(k => /title|見出し/i.test(`${k.cssVar} ${k.label}`)) ?? sizes[0] ?? null;
    }
    if (/line|body/i.test(partId)) return sizes.find(k => /body|本文/i.test(`${k.cssVar} ${k.label}`)) ?? sizes[0] ?? null;
    return sizes.find(k => /body|本文/i.test(`${k.cssVar} ${k.label}`))
        ?? sizes.find(k => /font-size/i.test(k.cssVar)) ?? sizes[0] ?? null;
}
