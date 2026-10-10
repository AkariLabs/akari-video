import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { normalizePeopleFile, normalizeWordBook, PeopleFile, WordBookFile, photoPath, uniqueFileName, voiceSamplePath } from './channel-people-model';
import { normalizeNotesFile, NotesFile, renderNotesMarkdown } from './channel-notes-model';
import { normalizePacksFile, PacksFile } from './memory-pack-model';

export type { WordBookEntry, WordBookFile } from './channel-people-model';

export class ChannelMemoryFiles {
    constructor(protected readonly files: FileService) {}

    channelDir(root: URI, channel: string): URI { return root.resolve('channels').resolve(channel); }

    async readJson<T>(uri: URI): Promise<T | undefined> {
        const text = await this.readText(uri);
        if (text === undefined) return undefined;
        try { return JSON.parse(text) as T; } catch { return undefined; }
    }

    async writeJson(uri: URI, value: unknown): Promise<void> {
        await this.writeText(uri, `${JSON.stringify(value, null, 2)}\n`);
    }

    async readText(uri: URI): Promise<string | undefined> {
        try { return (await this.files.readFile(uri)).value.toString(); } catch { return undefined; }
    }

    async writeText(uri: URI, text: string): Promise<void> {
        if (!await this.files.exists(uri.parent)) await this.files.createFolder(uri.parent);
        await this.files.writeFile(uri, BinaryBuffer.fromString(text));
    }

    async copyInto(source: File, target: URI): Promise<void> {
        if (!await this.files.exists(target.parent)) await this.files.createFolder(target.parent);
        const buf = await source.arrayBuffer();
        await this.files.writeFile(target, BinaryBuffer.wrap(new Uint8Array(buf)));
    }

    async copyPersonPhoto(dir: URI, id: string, file: File, taken: string[]): Promise<string> {
        const path = photoPath(id, uniqueFileName(file.name, taken.map(item => item.split(/[\\/]/).pop() || '')));
        await this.copyInto(file, dir.resolve(path));
        return path;
    }

    async copyVoiceSample(dir: URI, id: string, file: File, taken: string[]): Promise<string> {
        const path = voiceSamplePath(id, uniqueFileName(file.name, taken.map(item => item.split(/[\\/]/).pop() || '')));
        await this.copyInto(file, dir.resolve(path));
        return path;
    }

    async readWordBook(dir: URI): Promise<WordBookFile> {
        return normalizeWordBook(await this.readJson(dir.resolve('.akari/memory/word-book.json')));
    }

    async writeWordBook(dir: URI, book: WordBookFile): Promise<void> {
        await this.writeJson(dir.resolve('.akari/memory/word-book.json'), book);
    }

    async readPeople(dir: URI): Promise<PeopleFile> {
        return normalizePeopleFile(await this.readJson(dir.resolve('people.json')));
    }

    async writePeople(dir: URI, file: PeopleFile): Promise<void> {
        await this.writeJson(dir.resolve('people.json'), file);
    }

    async readPacks(dir: URI): Promise<PacksFile> {
        return normalizePacksFile(await this.readJson(dir.resolve('packs.json')));
    }

    async writePacks(dir: URI, file: PacksFile): Promise<void> {
        await this.writeJson(dir.resolve('packs.json'), file);
    }

    async readNotes(dir: URI): Promise<NotesFile> {
        return normalizeNotesFile(await this.readJson(dir.resolve('notes.json')));
    }

    async writeNotes(dir: URI, file: NotesFile): Promise<void> {
        await this.writeJson(dir.resolve('notes.json'), file);
        await this.writeText(dir.resolve('notes.md'), renderNotesMarkdown(file));
    }
}
