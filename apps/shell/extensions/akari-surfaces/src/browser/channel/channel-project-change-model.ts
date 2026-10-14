export interface ChannelProjectChange {
    channel: string;
    project: string;
    kind: 'upsert' | 'remove';
    title: boolean;
    card: boolean;
}

export function classifyChannelProjectChange(relative: string, type: number, currentProjectRelative?: string): ChannelProjectChange | undefined {
    const parts = relative.split('/');
    if (parts.length < 4 || parts[0] !== 'channels' || parts[2] !== 'videos' || !parts[1] || !parts[3]) return undefined;
    const [channel, project] = [parts[1], parts[3]];
    const rest = parts.slice(4).join('/');
    const own = currentProjectRelative === parts.slice(0, 4).join('/');
    if (!rest) return type === 2 ? { channel, project, kind: 'remove', title: false, card: false }
        : type === 1 ? { channel, project, kind: 'upsert', title: true, card: true } : undefined;
    if (rest.endsWith('.tmp') || /\.tmp\./.test(rest)) return undefined;
    if (rest === '.akari/intake.json') return { channel, project, kind: 'upsert', title: true, card: false };
    if (rest.startsWith('.git/') || rest.startsWith('node_modules/')) return undefined;
    if (/^\.akari\/(cache|history|work|sidecars|events)\//.test(rest)
        || /^\.akari\/(lint\.json|saved-by\.json)$/.test(rest)
        || /^\.akari\/reports\/(create-project-report|edit-lint-report)\.html?$/i.test(rest)) return undefined;
    if (own) return /^(planning\/.*\.md|assets\/.*\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|heic|svg)|exports\/.*\.(mp4|mov|m4v|webm|mkv)|analysis-report\.html)$/i.test(rest)
        ? { channel, project, kind: 'upsert', title: false, card: true } : undefined;
    const card = rest === 'edit.json' || rest === 'analysis-report.html'
        || /^(planning\/.*\.md|assets\/.*\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|flac|ogg|png|jpe?g|webp|gif|heic|svg)|exports\/.*\.(mp4|mov|m4v|webm|mkv)|\.akari\/reports\/.*\.html?)$/i.test(rest);
    return card ? { channel, project, kind: 'upsert', title: false, card: true } : undefined;
}
