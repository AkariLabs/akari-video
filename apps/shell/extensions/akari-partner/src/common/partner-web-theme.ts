export function resolvePartnerWebTheme(currentThemeType: unknown): 'dark' | 'light' {
    return currentThemeType === 'light' || currentThemeType === 'hcLight' ? 'light' : 'dark';
}
