/** 声から変更できる表示設定。実キーへの対応はここだけで管理する。 */
export const JEV_SETTING_KEYS = [
    'appearance.zoom', 'appearance.themeMode',
    'timeline.visualThumbnails', 'timeline.trackRippleDisplay'
] as const;

export type JevSettingKey = typeof JEV_SETTING_KEYS[number];

export const JEV_SETTING_REAL_KEYS: Record<JevSettingKey, readonly string[]> = {
    'appearance.zoom': ['akari.appearance.zoom'],
    'appearance.themeMode': ['akari.appearance.themeMode', 'workbench.colorTheme'],
    'timeline.visualThumbnails': ['akari.timeline.visualThumbnails'],
    'timeline.trackRippleDisplay': ['akari.timeline.trackRippleDisplay']
};

export function isJevSettingKey(key: string): key is JevSettingKey {
    return (JEV_SETTING_KEYS as readonly string[]).includes(key);
}

export function validateSettingValue(key: string, value: unknown):
    { ok: true; value: number | string | boolean } | { ok: false; reason: string } {
    if (!isJevSettingKey(key)) return { ok: false, reason: '許可されていない設定です' };
    if (key === 'appearance.zoom') {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 60 || value > 200) {
            return { ok: false, reason: '大きさは 60〜200 の数値にしてください' };
        }
        return { ok: true, value: Math.min(200, Math.max(60, Math.round(value / 10) * 10)) };
    }
    if (key === 'appearance.themeMode') {
        return value === 'dark' || value === 'light' || value === 'system'
            ? { ok: true, value } : { ok: false, reason: 'テーマの値が正しくありません' };
    }
    if (key === 'timeline.visualThumbnails') {
        return typeof value === 'boolean'
            ? { ok: true, value } : { ok: false, reason: '真偽値が必要です' };
    }
    return value === 'tag' || value === 'switches'
        ? { ok: true, value } : { ok: false, reason: '表示の値が正しくありません' };
}
