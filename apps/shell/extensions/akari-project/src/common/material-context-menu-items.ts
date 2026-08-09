/**
 * 素材パネルの右クリックメニュー（素材カード / できたもの行）の項目構成を組み立てる
 * 純関数（task 2026-08-09-material-context-menu-mvp 指示2、2026-08-10-material-menu-r2 で拡張）。
 * DOM に一切依存しないため node --test で検証できる。呼び出し側
 * （akari-role-buckets-widget.tsx）が id ごとに実処理へディスパッチする。
 *
 * 対象種別: 素材（未整理を除く。assetGroup も同じ 'material'）/ 未整理 / 4 種の
 * できたもの行（data / plan / export / report）。破壊操作（rename/delete）と
 * 「エージェントに頼む」は司令塔裁定により素材・未整理・export のみに出す
 * （data/plan/report は契約ファイル保護のため開く系のみ）。
 */
export type MaterialContextMenuTarget = 'material' | 'unorganized' | 'data' | 'plan' | 'export' | 'report';

export interface MaterialContextMenuItem {
    readonly id: string;
    readonly label: string;
    readonly danger?: boolean;
}

/**
 * 素材カードの文脈（task 2026-08-10-material-menu-r2）。省略時は「タイムラインに追加」
 * 「素材の情報を表示」のどちらも出さない（後方互換 — 前タスクの項目列と完全一致させる）。
 */
export interface MaterialContextMenuContext {
    readonly materialKind?: 'video' | 'audio' | 'image' | 'other';
}

/** rename / delete / ask-agent を出す対象（司令塔裁定1）。 */
const DESTRUCTIVE_CAPABLE_TARGETS: ReadonlySet<MaterialContextMenuTarget> = new Set(['material', 'unorganized', 'export']);

/**
 * `isOSX` は呼び出し側から bool として渡す（このファイル自身は `@theia/core` の
 * `isOSX` を import しない — DOM/Electron 非依存を保つため）。
 */
export function buildMaterialContextMenuItems(
    target: MaterialContextMenuTarget,
    isOSX: boolean,
    context?: MaterialContextMenuContext
): MaterialContextMenuItem[] {
    const items: MaterialContextMenuItem[] = [
        { id: 'open', label: '開く' }
    ];
    if (context && target === 'material' && (context.materialKind === 'video' || context.materialKind === 'audio')) {
        // video/audio の素材カードのみ（task 2026-08-10-material-menu-r2 司令塔裁定1）。
        items.push({ id: 'add-to-timeline', label: 'タイムラインに追加' });
    }
    items.push({ id: 'reveal', label: isOSX ? 'Finder で表示' : 'フォルダを開く' });
    if (isOSX) {
        // 「ファイルをコピー」は v0 = macOS のみ（司令塔裁定2）。非 macOS では出さない。
        items.push({ id: 'copy-file', label: 'ファイルをコピー' });
    }
    items.push({ id: 'copy-path', label: 'パスをコピー' });
    if (context && target === 'material') {
        // assets/ 配下の素材カード全部（素材グループ含む）。未整理・できたもの行には出さない
        // （task 2026-08-10-material-menu-r2 司令塔裁定3）。
        items.push({ id: 'show-info', label: '素材の情報を表示' });
    }
    if (DESTRUCTIVE_CAPABLE_TARGETS.has(target)) {
        items.push(
            { id: 'rename', label: '名前を変更…' },
            { id: 'delete', label: '削除…', danger: true },
            { id: 'ask-agent', label: 'エージェントに頼む…' }
        );
    }
    if (target === 'unorganized') {
        items.push({ id: 'move-to-assets', label: 'assets へ移動' });
    }
    return items;
}
