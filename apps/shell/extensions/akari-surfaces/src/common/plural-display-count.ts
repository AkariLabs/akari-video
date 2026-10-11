/** Keep a displayed decimal such as "1.0" in the English plural form. */
export function pluralCountForDisplay(value: string | number | null | undefined): number {
    return String(value).trim() === '1' ? 1 : 2;
}
