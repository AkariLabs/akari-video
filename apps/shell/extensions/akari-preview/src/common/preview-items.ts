// 内部表現（packages/edit-store の tracks[].items[]）→ プレビュー要約の橋。
//
// loadPreviewModel から切り出した純関数（Theia の DI に依存しない）ので、
// 「どのアイテムが要約のどのバケットへ、どの順で入るか」をそのまま単体テストできる。
// これは edit-summary-fields.ts と同じ狙い（配線そのものを検査可能にする）。

import { InternalEdit, InternalItem, readInternalEdit } from '@akari-video/edit-store';

/**
 * preview 用の正規化読込。timeline.tracks 未宣言時は captions.json と埋め込み字幕の
 * どちらも captions 段の導出条件にする。
 */
export function readPreviewInternalEdit(source: string, hasExternalCaptions: boolean): InternalEdit {
    const raw = JSON.parse(source) as { captions?: unknown };
    const hasInline = Array.isArray(raw?.captions) && raw.captions.length > 0;
    return readInternalEdit(source, { hasCaptions: hasExternalCaptions || hasInline });
}

/** プレビュー要約が持つ 3 つのバケット（旧 edit.json の種別別配列に対応）。 */
export type PreviewItemBucket = 'cuts' | 'overlays' | 'layers';

export interface PreviewItemWarningState {
    warnedKinds: Set<string>;
    warn: (message: string) => void;
}

/**
 * 内部表現のアイテムを要約の 3 バケットへ振り分ける。**種別ごとの分岐はここ 1 箇所
 * （`source.kind` の switch）に集約**し、以降は宣言レコードだけを読む。
 * 並びは宣言順（`legacy.index`）を保つ — 要約の配列順は差分更新の比較対象だから。
 */
export function collectItems(
    internal: InternalEdit,
    bucket: PreviewItemBucket,
    warningState: PreviewItemWarningState = {
        warnedKinds: new Set<string>(),
        warn: message => console.warn(message)
    }
): InternalItem[] {
    const items: InternalItem[] = [];
    for (const track of internal.tracks) {
        for (const item of track.items) {
            let resolved: PreviewItemBucket | undefined;
            const kind = String(item.source.kind);
            switch (kind) {
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
                case 'captions':
                case 'group':
                    // captions は専用描画、group は現行の各 projection が子を扱う。
                    resolved = undefined;
                    break;
                default:
                    resolved = undefined;
                    if (!warningState.warnedKinds.has(kind)) {
                        warningState.warnedKinds.add(kind);
                        warningState.warn(`[akari-preview] unknown source.kind "${kind}" skipped`);
                    }
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
