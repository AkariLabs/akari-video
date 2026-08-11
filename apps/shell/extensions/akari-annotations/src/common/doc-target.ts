/**
 * review.json の target 文字列（contract-2026-07-26-doc-image-annotations §1）のパースと、
 * 分析レポートの blocks マニフェスト（packages/analysis-report/render-analysis-report.mjs の
 * buildBlocksManifest 出力）からの block-id 収集。両方とも純関数 — レポート面（webview）と
 * 注釈パネル・レビューボードの双方から同じ実装を共有する。
 */

export interface DocTarget {
    /** プロジェクト相対パス（レポート HTML 等）。 */
    path: string;
    blockId: string;
}

export interface ImageTarget {
    /** プロジェクト相対パス。 */
    path: string;
}

export interface CanvasTarget {
    /** `c-` + ゼロ埋め連番（review/canvas/<id>/ のディレクトリ名と一致）。 */
    id: string;
}

export interface UiTarget {
    /**
     * docs/contract-2026-08-11-review-session-ui-events.md §2 と同一の id 空間
     * （`panel:<id>` / `tab:<id>` / `timeline:cut:<n>` / `timeline:overlay:<id>` / `asset:<path>`）。
     */
    id: string;
}

const DOC_TARGET_PATTERN = /^doc:(.+)#(.+)$/;
const IMAGE_TARGET_PATTERN = /^image:(.+)$/;
/** contract-2026-07-26-canvas-surface §4: canvas:<c-NNNN>。 */
const CANVAS_TARGET_PATTERN = /^canvas:(c-\d{4,})$/;
/** docs/contract-2026-08-11-review-session-ui-events.md §6: ui:<element-id>。 */
const UI_TARGET_PATTERN = /^ui:(.+)$/;

export function parseDocTarget(target: string | null | undefined): DocTarget | undefined {
    if (typeof target !== 'string') {
        return undefined;
    }
    const match = DOC_TARGET_PATTERN.exec(target);
    return match ? { path: match[1], blockId: match[2] } : undefined;
}

export function parseImageTarget(target: string | null | undefined): ImageTarget | undefined {
    if (typeof target !== 'string') {
        return undefined;
    }
    const match = IMAGE_TARGET_PATTERN.exec(target);
    return match ? { path: match[1] } : undefined;
}

export function parseCanvasTarget(target: string | null | undefined): CanvasTarget | undefined {
    if (typeof target !== 'string') {
        return undefined;
    }
    const match = CANVAS_TARGET_PATTERN.exec(target);
    return match ? { id: match[1] } : undefined;
}

export function parseUiTarget(target: string | null | undefined): UiTarget | undefined {
    if (typeof target !== 'string') {
        return undefined;
    }
    const match = UI_TARGET_PATTERN.exec(target);
    return match ? { id: match[1] } : undefined;
}

/**
 * blocks マニフェスト（`{version, byRef, questions, provenance}` 等・ネスト形状は
 * render-analysis-report.mjs 側の関心事）から block-id を全数収集する。形状に依存せず
 * 文字列の葉を再帰的に集める汎用実装にして、マニフェストの形状変化に追従できるようにする
 * （SSOT は render-analysis-report.mjs 側 — ここではミラーしない）。
 */
export function collectBlockIds(manifest: unknown): Set<string> {
    const ids = new Set<string>();
    const visit = (node: unknown): void => {
        if (typeof node === 'string') {
            ids.add(node);
        } else if (Array.isArray(node)) {
            node.forEach(visit);
        } else if (node && typeof node === 'object') {
            Object.values(node as Record<string, unknown>).forEach(visit);
        }
    };
    visit(manifest);
    return ids;
}

/** report.html の生テキストから `<script id="akari-analysis-report-blocks">` の中身を取り出す。 */
export function extractBlocksManifest(reportHtml: string): unknown | undefined {
    const match = /<script[^>]*id=["']akari-analysis-report-blocks["'][^>]*>([\s\S]*?)<\/script>/.exec(reportHtml);
    if (!match) {
        return undefined;
    }
    try {
        return JSON.parse(match[1]);
    } catch {
        return undefined;
    }
}
