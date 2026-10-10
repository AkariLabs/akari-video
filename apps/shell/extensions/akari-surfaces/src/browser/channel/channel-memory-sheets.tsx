import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { ChannelMemoryFiles } from './channel-memory-files';
import { ChannelPeopleSheet } from './channel-people-sheet';
import { ChannelNotesSheet } from './channel-notes-sheet';
import { MemoryPackCatalog } from './memory-pack-catalog';
import { normalizeNotesFile, notesCount } from './channel-notes-model';
import { VoiceProfileOption } from './channel-people-model';

export type ChannelMemorySheetKind = 'people' | 'notes' | 'packs';

export function ChannelMemorySheets(props: { open?: ChannelMemorySheetKind; channel?: string; root?: URI; files: ChannelMemoryFiles;
    onClose: () => void; onOpen: (kind: ChannelMemorySheetKind) => void; onTypePrompt: (text: string) => void; onChanged: () => void;
    onToast?: (text: string) => void; hasProKey: boolean; onNeedPro: (feature: string) => void;
    loadVoiceProfiles?: () => Promise<VoiceProfileOption[]>; onOpenSettings?: (section: string) => void }): React.ReactElement | null {
    if (!props.open || !props.root || !props.channel) return null;
    const dir = props.files.channelDir(props.root, props.channel);
    if (props.open === 'packs') return <MemoryPackCatalog channel={props.channel} dir={dir} files={props.files}
        onClose={props.onClose} onOpenPeople={() => props.onOpen('people')} onChanged={props.onChanged} onToast={props.onToast}
        hasProKey={props.hasProKey} onNeedPro={props.onNeedPro} />;
    if (props.open === 'notes') return <ChannelNotesSheet channel={props.channel} dir={dir} files={props.files} onClose={props.onClose}
        onOpenPacks={() => props.onOpen('packs')} onTypePrompt={props.onTypePrompt} onChanged={props.onChanged}
        hasProKey={props.hasProKey} onNeedPro={props.onNeedPro} />;
    if (props.open !== 'people') return null;
    return <ChannelPeopleSheet channel={props.channel} dir={dir} files={props.files} onClose={props.onClose}
        onOpenPacks={() => props.onOpen('packs')} onTypePrompt={props.onTypePrompt} onChanged={props.onChanged}
        loadVoiceProfiles={props.loadVoiceProfiles} onOpenSettings={props.onOpenSettings} />;
}

export async function readChannelMemoryCounts(files: ChannelMemoryFiles, dir: URI): Promise<{ people: number; notes: number; packs: number }> {
    const [people, book, notes, packs] = await Promise.all([
        files.readPeople(dir), files.readWordBook(dir), files.readJson(dir.resolve('notes.json')),
        files.readJson<{ imported?: unknown }>(dir.resolve('packs.json'))
    ]);
    return { people: people.entries.length, notes: notesCount(normalizeNotesFile(notes), book),
        packs: Array.isArray(packs?.imported) ? packs.imported.length : 0 };
}
