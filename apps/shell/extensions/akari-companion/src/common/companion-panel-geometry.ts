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
