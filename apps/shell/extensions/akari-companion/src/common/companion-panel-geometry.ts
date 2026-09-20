export const PANEL_MIN_WIDTH = 44;
export const PANEL_MAX_WIDTH = 720;
export const PANEL_MIN_HEIGHT = 44;
export const PANEL_MAX_HEIGHT = 360;
export const PANEL_DEFAULT_WIDTH = 360;
export const PANEL_DEFAULT_HEIGHT = 200;

export interface PanelSize { width: number; height: number; }

export function clampPanelSize(
    width: number | undefined,
    height: number | undefined,
    fallback: PanelSize = { width: PANEL_DEFAULT_WIDTH, height: PANEL_DEFAULT_HEIGHT }
): PanelSize {
    const w = typeof width === 'number' && Number.isFinite(width) ? width : fallback.width;
    const h = typeof height === 'number' && Number.isFinite(height) ? height : fallback.height;
    return {
        width: Math.min(PANEL_MAX_WIDTH, Math.max(PANEL_MIN_WIDTH, Math.round(w))),
        height: Math.min(PANEL_MAX_HEIGHT, Math.max(PANEL_MIN_HEIGHT, Math.round(h)))
    };
}

/** x が無ければ画面幅の中央。あれば画面内に収まるよう丸める。 */
export function clampPanelX(x: number | undefined, viewportWidth: number, width: number): number {
    const max = Math.max(0, viewportWidth - width);
    const fallback = Math.round(max / 2);
    const raw = typeof x === 'number' && Number.isFinite(x) ? Math.round(x) : fallback;
    return Math.min(max, Math.max(0, raw));
}

/** y が無ければ上の縁。あれば画面内に収まるよう丸める。 */
export function clampPanelY(y: number | undefined, viewportHeight: number, height: number): number {
    const max = Math.max(0, viewportHeight - height);
    const raw = typeof y === 'number' && Number.isFinite(y) ? Math.round(y) : 0;
    return Math.min(max, Math.max(0, raw));
}

export interface AnchorRect { left: number; right: number; bottom: number; }
export interface PanelPosition { x: number; y: number; }

/**
 * 既定の置き場所 = 呼び出しボタンの真下・右端そろえ。
 * 利用者が動かしていないあいだはここへ戻るので、位置が毎回変わらない。
 */
export function anchoredPanelPosition(
    anchor: AnchorRect,
    size: PanelSize,
    viewport: { width: number; height: number },
    gap = 6
): PanelPosition {
    return {
        x: clampPanelX(Math.round(anchor.right - size.width), viewport.width, size.width),
        y: clampPanelY(Math.round(anchor.bottom + gap), viewport.height, size.height)
    };
}

export type PanelMode = 'tab' | 'pill';

export function normalizePanelMode(mode: unknown, fallback: PanelMode = 'tab'): PanelMode {
    return mode === 'tab' || mode === 'pill' ? mode : fallback;
}

export interface CompanionManifestPanel {
    port: number;
    panelPath?: string;
    panel?: { width: number; height: number };
}

export type ParsedManifestPanel = Omit<CompanionManifestPanel, 'port'>;

/** 宛先と同じ origin の相対パスだけを許す（`//host/...` のプロトコル相対も拒む）。 */
export function isSameOriginPanelPath(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 512
        && value.startsWith('/') && !value.startsWith('//');
}

/** 壊れた値や無い値は省き、接続そのものは失敗させない。 */
export function parseManifestPanel(raw: unknown): ParsedManifestPanel {
    const source = raw as {
        panelPath?: unknown;
        panel?: { width?: unknown; height?: unknown };
    } | null | undefined;
    const result: ParsedManifestPanel = {};
    if (source && isSameOriginPanelPath(source.panelPath)) {
        result.panelPath = source.panelPath;
    }
    const panel = source?.panel;
    if (panel && typeof panel === 'object'
        && typeof panel.width === 'number' && Number.isFinite(panel.width)
        && typeof panel.height === 'number' && Number.isFinite(panel.height)) {
        result.panel = { width: panel.width, height: panel.height };
    }
    return result;
}
