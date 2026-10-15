import { projectLocation } from '../../common/project-location';

export type ChannelScope = 'channel' | 'project';

export function channelFromProjectPath(relative: string | undefined): string | undefined {
    return projectLocation(relative)?.channel;
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
