import { resolveElementAddresses } from '../../../../../../packages/overlay-runtime/src/parts.mjs';

export function assertPreviewElementAddress(html: string, ref: string, tag: string): void {
    const result = resolveElementAddresses(html, [ref]);
    const span = result.found[ref];
    if (!span) throw new Error(`要素の番地を解決できません: ${ref}`);
    const opening = html.slice(span.start, span.end);
    const actual = opening.match(/^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/u)?.[1]?.toLowerCase();
    if (actual !== tag) throw new Error(`要素のタグが一致しません: ${ref} (${tag} / ${actual ?? '?'})`);
}
