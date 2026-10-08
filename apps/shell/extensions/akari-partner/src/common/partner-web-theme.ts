export function resolvePartnerWebTheme(preference: unknown, currentThemeType: unknown): 'dark' | 'light' | 'system' {
    if (preference === 'system') return 'system';
    return currentThemeType === 'light' || currentThemeType === 'hcLight' ? 'light' : 'dark';
}
