import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { injectable } from '@theia/core/shared/inversify';
import { AkariVoiceDictionaryService, VoiceEntry } from '../common/voice-dictionary-protocol';

interface DictionaryModule {
    voiceDictionaryPaths(options: object): { user: string; builtin: string; stats: string };
    loadVoiceDictionary(options: object): { entries: Array<VoiceEntry & { layer: string }>; layers: unknown[]; conflicts: Array<{ winner: string; shadowed: string }> };
    addUserEntry(entry: Partial<VoiceEntry>, options: object): Promise<{ ok: boolean; entry?: VoiceEntry; errors?: string[] }>;
    updateUserEntry(id: string, patch: Partial<VoiceEntry>, options: object): Promise<{ ok: boolean; entry?: VoiceEntry; errors?: string[] }>;
    removeUserEntry(id: string, options: object): Promise<{ ok: boolean; errors?: string[] }>;
    recordReverted(id: string, options: object): Promise<unknown> | void;
    expandSnippet(text: string, resolved: object, options: object): { expanded: string; entryId: string; trigger: string } | undefined;
    applyVoiceDictionary(text: string, resolved: object, options: object): { applied: Array<{ id: string }> };
    sharedHistory(options: object): { list(): Promise<any[]>; clear(): Promise<void>; setEnabled(on: boolean): void };
}

function upwardFile(relative: string): string | undefined {
    let cursor = __dirname;
    for (;;) {
        const candidate = join(cursor, relative);
        try { if (statSync(candidate).isFile()) return candidate; } catch { /* 探索を続ける */ }
        const parent = dirname(cursor);
        if (parent === cursor) return undefined;
        cursor = parent;
    }
}

@injectable()
export class AkariVoiceDictionaryServiceImpl implements AkariVoiceDictionaryService {
    constructor(protected readonly env: NodeJS.ProcessEnv = process.env) { }

    protected async module(): Promise<DictionaryModule> {
        const resource = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
        const candidate = resource && join(resource, 'packages/akari-ear/src/index.mjs');
        const file = candidate && existsSync(candidate) ? candidate : upwardFile('packages/akari-ear/src/index.mjs');
        if (!file) throw new Error('辞書の部品が見つかりません');
        const importEsm = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<DictionaryModule>;
        return importEsm(pathToFileURL(file).href);
    }

    async list(): ReturnType<AkariVoiceDictionaryService['list']> {
        const module = await this.module();
        const paths = module.voiceDictionaryPaths({ env: this.env });
        const read = (file: string): VoiceEntry[] => {
            try { return JSON.parse(readFileSync(file, 'utf8')).entries ?? []; } catch { return []; }
        };
        const resolved = module.loadVoiceDictionary({ env: this.env });
        let stats: Record<string, number> = {};
        try { stats = JSON.parse(readFileSync(paths.stats, 'utf8')); } catch { /* 初回 */ }
        const healthy = (layer: string) => !resolved.layers.some(item => {
            const state = item as { layer?: string; error?: string };
            return state.layer === layer && !!state.error;
        });
        const user = healthy('user') ? read(paths.user) : [];
        const builtin = (healthy('builtin') ? read(paths.builtin) : [])
            .map(entry => ({ ...entry, hits: Math.max(0, stats[entry.id] ?? 0) }));
        const overriddenIds = [...new Set(resolved.conflicts.filter(item => builtin.some(entry => entry.id === item.shadowed)).map(item => item.shadowed))];
        return { builtin, user, overriddenIds, layers: resolved.layers };
    }

    async upsert(entry: Partial<VoiceEntry>): ReturnType<AkariVoiceDictionaryService['upsert']> {
        try {
            const module = await this.module();
            const listed = await this.list();
            if (entry.id && listed.builtin.some(item => item.id === entry.id)) return { ok: false, errors: ['同梱の項目は直接編集できません'] };
            const result = entry.id
                ? await module.updateUserEntry(entry.id, entry, { env: this.env })
                : await module.addUserEntry(entry, { env: this.env });
            return result;
        } catch { return { ok: false, errors: ['辞書を保存できません'] }; }
    }

    async remove(id: string): ReturnType<AkariVoiceDictionaryService['remove']> {
        try { return await (await this.module()).removeUserEntry(id, { env: this.env }); }
        catch { return { ok: false, errors: ['辞書を更新できません'] }; }
    }

    async history(): ReturnType<AkariVoiceDictionaryService['history']> {
        const module = await this.module();
        const resolved = module.loadVoiceDictionary({ env: this.env });
        const rows = await module.sharedHistory({ env: this.env }).list();
        return rows.map(row => ({ ...row, ...module.applyVoiceDictionary(row.raw, resolved, { final: true }) }));
    }
    async setHistoryEnabled(on: boolean): Promise<void> {
        (await this.module()).sharedHistory({ env: this.env }).setEnabled(on);
    }
    async clearHistory(): Promise<void> { await (await this.module()).sharedHistory({ env: this.env }).clear(); }
    async revert(entryId: string): Promise<void> { await (await this.module()).recordReverted(entryId, { env: this.env }); }
    async expand(text: string, target: 'note' | 'task' | 'partner' | 'jev'): ReturnType<AkariVoiceDictionaryService['expand']> {
        const module = await this.module();
        return module.expandSnippet(text, module.loadVoiceDictionary({ env: this.env }), { target });
    }
    async countHistoryMatches(entryId: string): Promise<number> {
        const module = await this.module();
        const resolved = module.loadVoiceDictionary({ env: this.env });
        const rows = await module.sharedHistory({ env: this.env }).list();
        return rows.filter(row => module.applyVoiceDictionary(row.raw, resolved, { final: true })
            .applied.some(item => item.id === entryId)).length;
    }
}
