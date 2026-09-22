// 右レールの 5 パネルのアイコン（task 2026-09-22-right-rail-regroup 指示4）。
// 形は内部リポの試作 planning/notes-2026-09-22-right-rail-prototype.html の線画 SVG をそのまま使う
// （カット = ハサミ / 台本 = 紙 / 注釈 = 吹き出し / インスペクター = つまみ / 音声メーター = レベルのバー）。
// akari-* 拡張は tsc -b だけでビルドされ CSS アセットのコピー工程を持たないため、パートナーの
// ブランドアイコン（partner-terminal-style.ts）と同じく mask-image の style 要素として注入する。
// レール（縦バー）では Theia の sidepanel.css が mask アイコンの枠（48px）・大きさ（24px）・色
// （activityBar の inactive / active）を当てるので、ここでは形だけを渡す。それ以外の場所では currentColor。

/** 各 widget の title.iconClass に入れる値。 */
export const RIGHT_RAIL_ICON_CLASS = {
    daihon: 'akari-rail-icon akari-rail-icon-daihon',
    cuts: 'akari-rail-icon akari-rail-icon-cuts',
    review: 'akari-rail-icon akari-rail-icon-review',
    inspector: 'akari-rail-icon akari-rail-icon-inspector',
    audioMeter: 'akari-rail-icon akari-rail-icon-audio-meter'
} as const;

/** 試作の path データ（viewBox 0 0 24 24・線画）。 */
export const RIGHT_RAIL_ICON_PATHS: Record<keyof typeof RIGHT_RAIL_ICON_CLASS, string> = {
    daihon: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M10 12h5M10 16h5"/>',
    cuts: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8 8.5L19 18M8 15.5L19 6"/>',
    review: '<path d="M5 5h14v10H10l-5 4z"/>',
    inspector: '<path d="M5 6h9M18 6h1M5 12h3M12 12h7M5 18h11M20 18h-1"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    audioMeter: '<path d="M6 20V10M10 20V4M14 20v-7M18 20V8"/>'
};

export function rightRailIconSvg(paths: string): string {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#fff" '
        + `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

const toBase64 = (text: string): string => typeof btoa === 'function' ? btoa(text) : Buffer.from(text, 'utf8').toString('base64');

export function rightRailIconCss(): string {
    const rules = (Object.keys(RIGHT_RAIL_ICON_CLASS) as (keyof typeof RIGHT_RAIL_ICON_CLASS)[]).map(key => {
        const name = RIGHT_RAIL_ICON_CLASS[key].split(' ')[1];
        const url = `url("data:image/svg+xml;base64,${toBase64(rightRailIconSvg(RIGHT_RAIL_ICON_PATHS[key]))}")`;
        return `.${name} { mask-image: ${url}; -webkit-mask-image: ${url}; }`;
    }).join('\n');
    return `
.akari-rail-icon {
    display: inline-block;
    width: 18px;
    height: 18px;
    flex: none;
    background-color: currentColor;
    mask-repeat: no-repeat;
    mask-position: 50% 50%;
    mask-size: contain;
    -webkit-mask-repeat: no-repeat;
    -webkit-mask-position: 50% 50%;
    -webkit-mask-size: contain;
}
${rules}
`;
}

export function installRightRailIconStyle(): void {
    if (typeof document === 'undefined' || document.getElementById('akari-right-rail-icons')) {
        return;
    }
    const style = document.createElement('style');
    style.id = 'akari-right-rail-icons';
    style.textContent = rightRailIconCss();
    document.head.appendChild(style);
}
