export type ChannelScope = 'channel' | 'project';

export function channelFromProjectPath(relative: string | undefined): string | undefined {
    const parts = relative?.split('/').filter(Boolean);
    return parts?.length === 4 && parts[0] === 'channels' && parts[2] === 'videos' ? parts[1] : undefined;
}

export function resolveCurrentChannel(scope: ChannelScope, channels: string[], workspaceChannel: string | undefined, readLastChannel: () => string | null): string | undefined {
    if (scope === 'project') return workspaceChannel;
    const saved = readLastChannel();
    return saved && channels.includes(saved) ? saved : channels[0];
}

export function saveViewingChannel(name: string, channels: string[], writeLastChannel: (name: string) => void): boolean {
    if (!channels.includes(name)) return false;
    writeLastChannel(name);
    return true;
}
