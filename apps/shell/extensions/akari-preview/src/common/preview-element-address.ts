import { t } from './preview-text';
import { resolveElementAddresses } from '../../../../../../packages/overlay-runtime/src/parts.mjs';

export function assertPreviewElementAddress(html: string, ref: string, tag: string): void {
    const result = resolveElementAddresses(html, [ref]);
    const span = result.found[ref];
    if (!span) throw new Error(t('preview.elementEditor.validation.couldNotResolveItemAddressError', { p1: (ref) }));
    const opening = html.slice(span.start, span.end);
    const actual = opening.match(/^<\s*([a-zA-Z][a-zA-Z0-9:-]*)/u)?.[1]?.toLowerCase();
    if (actual !== tag) throw new Error(t('preview.elementEditor.validation.itemTagMismatchError', { p1: (ref), p2: (tag), p3: (actual ?? '?') }));
}
