import type { AkariPlaybookListEntry } from '../../common/akari-new-project-protocol';

export type ChannelChoice = { kind: 'channel'; name: string } | { kind: 'new' } | { kind: 'standalone' };

export function channelChoices(channels: string[]): ChannelChoice[] {
    return [...channels.map(name => ({ kind: 'channel' as const, name })), { kind: 'new' }, { kind: 'standalone' }];
}

export function showStandaloneExplanation(channel: string | undefined): boolean {
    return channel === undefined;
}

export function playbookFrames(entry: AkariPlaybookListEntry): string[] {
    return (entry.frameUris ?? []).slice(0, 5);
}

export function playbookCover(entry: AkariPlaybookListEntry): string | undefined {
    return entry.coverUri ?? playbookFrames(entry)[0];
}
