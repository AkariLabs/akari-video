// 内部表現（packages/edit-store の tracks[].items[]）→ プレビュー要約の橋。
//
// loadPreviewModel から切り出した純関数（Theia の DI に依存しない）ので、
// 「どのアイテムが要約のどのバケットへ、どの順で入るか」をそのまま単体テストできる。
// これは edit-summary-fields.ts と同じ狙い（配線そのものを検査可能にする）。

import { InternalEdit, InternalItem } from '@akari-video/edit-store';

/** プレビュー要約が持つ 3 つのバケット（旧 edit.json の種別別配列に対応）。 */
export type PreviewItemBucket = 'cuts' | 'overlays' | 'layers';

/**
 * 内部表現のアイテムを要約の 3 バケットへ振り分ける。**種別ごとの分岐はここ 1 箇所
 * （`source.kind` の switch）に集約**し、以降は宣言レコードだけを読む。
 * 並びは宣言順（`legacy.index`）を保つ — 要約の配列順は差分更新の比較対象だから。
 */
export function collectItems(internal: InternalEdit, bucket: PreviewItemBucket): InternalItem[] {
    const items: InternalItem[] = [];
    for (const track of internal.tracks) {
        for (const item of track.items) {
            let resolved: PreviewItemBucket | undefined;
            switch (item.source.kind) {
                case 'media':
                    // 「読んで重ねるだけの素材」は内部表現では 1 種別。旧宣言では
                    // cuts[] と layers[](kind: video) に分かれていたぶんだけ由来を見る。
                    resolved = item.legacy.collection === 'layers' ? 'layers'
                        : item.legacy.collection === 'cuts' ? 'cuts' : undefined;
                    break;
                case 'html':
                    resolved = 'overlays';
                    break;
                case 'telop':
                case 'filter':
                    resolved = 'layers';
                    break;
                default:
                    resolved = undefined;
                    break;
            }
            if (resolved === bucket) {
                items.push(item);
            }
        }
    }
    return items.sort((left, right) => left.legacy.index - right.legacy.index);
}

/** edit.json に埋め込まれた字幕（正本は captions.json）。 */
export function hasInlineCaptions(internal: InternalEdit): boolean {
    const captions = internal.declaration.captions;
    return Array.isArray(captions) && captions.length > 0;
}
