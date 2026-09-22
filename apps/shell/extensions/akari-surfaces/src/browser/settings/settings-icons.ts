/**
 * 設定ダイアログの線画アイコン（viewBox 24 x 24・stroke = currentColor）。
 *
 * 出典: 内部リポ planning/notes-2026-09-22-shell-ui-refresh-mock.html（モック 3 版）のアイコン定義をそのまま移植。
 * オーナー裁定（2026-09-22）「絶対に絵文字は使わない」— UI に出すアイコンはすべてここの SVG にし、
 * 絵文字・記号文字（チェック・下向き三角・外部リンク矢印・歯車・ベル等）を文字として出さない。
 */
export const SETTINGS_ICON_PATHS = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/>',
    play: '<path d="M8 5.5v13l10-6.5z"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    contrast: '<circle cx="12" cy="12" r="8"/><path d="M12 4v16a8 8 0 0 0 0-16z" fill="currentColor"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l8-8M16 7l3 3M14 9l2 2"/>',
    mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
    gauge: '<path d="M4.5 16a7.5 7.5 0 1 1 15 0"/><path d="M12 16l3.5-4.5"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 21h4"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L11 20a2.1 2.1 0 0 1-3-3l8.5-8.5a4 4 0 0 1-2-2z"/>',
    code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    circle: '<circle cx="12" cy="12" r="7"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    ext: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
    refresh: '<path d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4"/>',
    folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
    spark: '<path d="M12 3.5l1.9 5.6 5.6 1.9-5.6 1.9L12 18.5l-1.9-5.6L4.5 11l5.6-1.9z"/>',
    sliders: '<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
    gem: '<path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/>',
    film: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"/>',
    cube: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>',
    terminal: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10l3 2-3 2M12 15h5"/>',
    doc: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    store: '<path d="M4 9l1.5-5h13L20 9"/><path d="M4 9h16v2a3 3 0 0 1-5.3 1.9A3 3 0 0 1 12 14a3 3 0 0 1-2.7-1.1A3 3 0 0 1 4 11z"/><path d="M5.5 14v6h13v-6"/>'
} as const;

export type SettingsIconName = keyof typeof SETTINGS_ICON_PATHS;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** 線画アイコン 1 個。装飾なので支援技術からは隠す（意味は隣のラベルが持つ）。 */
export function settingsIcon(name: SettingsIconName, size: 'md' | 'sm' = 'md'): SVGSVGElement {
    const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', size === 'sm' ? 'akari-set-icon akari-set-icon-sm' : 'akari-set-icon');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    svg.setAttribute('data-akari-icon', name);
    // 固定の定数表だけを流し込む（利用者入力は通らない）。
    svg.innerHTML = SETTINGS_ICON_PATHS[name];
    return svg;
}
