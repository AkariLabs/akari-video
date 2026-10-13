export type PresenceChange = 'edit' | 'count' | undefined;

export function classifyPresenceChange(relative: string, type: number, known: boolean): PresenceChange {
    if (relative === 'edit.json') return 'edit';
    if (type === 0 || relative.endsWith('.tmp') || /\.tmp\./.test(relative)) return undefined;
    if (['planning', 'assets', 'exports', '.akari/reports'].includes(relative)) return 'count';
    const counted = relative === 'analysis-report.html'
        || /^planning\/(?:[^/]+\/){0,3}[^/]+\.md$/i.test(relative)
        || /^assets\/[^/]+\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|heic|svg)$/i.test(relative)
        || /^exports\/[^/]+\.(mp4|mov|m4v|webm|mkv)$/i.test(relative)
        || /^\.akari\/reports\/(?!create-project-report|edit-lint-report)[^/]+\.html?$/i.test(relative);
    return counted && (type === 1 ? !known : known) ? 'count' : undefined;
}
