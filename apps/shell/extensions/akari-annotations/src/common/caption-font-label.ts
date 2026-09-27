export function filterCaptionPanelFonts<T extends { title: string; displayName?: string;
    family: string; tags: readonly string[] }>(fonts: readonly T[], query: string,
    selected: ReadonlySet<string>): T[] {
    const needle = query.trim().toLocaleLowerCase();
    return fonts.filter(font => (!needle
        || `${font.displayName ?? ''} ${font.title} ${font.family}`.toLocaleLowerCase().includes(needle))
        && [...selected].every(tag => font.tags.includes(tag)));
}
