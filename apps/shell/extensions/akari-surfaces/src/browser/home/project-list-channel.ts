export interface ListChannelRequest {
    scope: 'channel' | 'project';
    override: string | undefined;
    workspaceChannel: string | undefined;
    channels: readonly string[];
    lastChannel: string | null;
    fallback: string;
}

export function resolveListChannel({ scope, override, workspaceChannel, channels, lastChannel, fallback }: ListChannelRequest): string {
    if (scope === 'project') {
        if (override !== undefined && channels.includes(override)) return override;
        if (workspaceChannel) return workspaceChannel;
    }
    if (lastChannel && channels.includes(lastChannel)) return lastChannel;
    return channels[0] ?? fallback;
}
