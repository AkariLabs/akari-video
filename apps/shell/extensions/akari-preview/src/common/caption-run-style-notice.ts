/** User-facing names for look fields that cannot be represented by a caption run. */
export function captionRunOmittedNotice(keys: readonly string[]): string | undefined {
    if (!keys.length) return undefined;
    const names: Record<string, string> = {
        animation: '動き', background: '座布団', shadow: '影', glow: '光',
        font_family: '書体', fontFamily: '書体', line_height: '行間', lineHeight: '行間',
        text_transform: '文字の変形', reference_height_px: '大きさの基準',
        size_px: '大きさ', sizePx: '大きさ', position: '位置', layout: '配置',
        'stroke.method': '縁取りの方式'
    };
    const labels = [...new Set(keys.map(key => names[key] ?? 'その他の見た目'))];
    return `文字範囲に使えない見た目を省きました: ${labels.join('・')}`;
}
