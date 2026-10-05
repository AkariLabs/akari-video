// F-50: akari-preview-open-handler.ts から機械移設した this 非依存の関数（本文は無改変。インデント 4 を除き、宣言行に export を足しただけ）。
import URI from '@theia/core/lib/common/uri';
import { resolveReviewPreviewEditUri } from '../common/review-preview-state';
import type { PreviewWidgetMarker } from './preview-host-types';

export function normalizeReviewEditUri(value: string): string | undefined {
    try {
        return new URI(value).normalizePath().toString();
    } catch {
        return undefined;
    }
}

export function reviewEditUriForPreview(widget: PreviewWidgetMarker): string | undefined {
    return resolveReviewPreviewEditUri({
        editUri: widget.akariPreviewEditUri?.normalizePath().toString(),
        relatedEditUri: widget.akariPreviewRelatedEditUri?.normalizePath().toString()
    });
}

export function previewProxyUri(sourceUri: URI): URI {
    const base = sourceUri.path.base;
    const proxyBase = /\.mov$/i.test(base)
        ? base.replace(/\.mov$/i, '.preview.webm')
        : `${base}.preview.webm`;
    return sourceUri.parent.resolve(proxyBase);
}
