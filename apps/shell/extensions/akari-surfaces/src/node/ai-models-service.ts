import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AI_MODEL_KINDS, AiModelCatalog, AiModelKind, AiModelPreferences, AiModelPreferencesDocument, AiModelSetId, AkariAiModelsService } from '../common/ai-models-protocol';
import { applyAiModelSet } from '../common/ai-models-model';
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
const empty = (): AiModelPreferencesDocument => ({ version: 1, favorites: {}, defaults: {} });
@injectable()
export class AkariAiModelsServiceImpl implements AkariAiModelsService {
    protected catalogPromise?: Promise<AiModelCatalog>;
    protected writing: Promise<unknown> = Promise.resolve();
    /** 一時リポでの契約テスト用。通常は上方探索を使う。 */
    repoRoot?: string;
    protected async resolveRepoFile(relativeTarget: string): Promise<string> {
        for (const start of [this.repoRoot, __dirname, process.cwd()].filter((value): value is string => !!value)) {
            let directory = start;
            for (;;) {
                const candidate = path.resolve(directory, relativeTarget);
                try {
                    if ((await fs.stat(candidate)).isFile()) {
                        return candidate;
                    }
                }
                catch { /* 親を探す。 */ }
                const parent = path.dirname(directory);
                if (parent === directory) {
                    break;
                }
                directory = parent;
            }
        }
        throw new Error(`AI モデルのデータが見つかりません: ${relativeTarget}`);
    }

    async getAiModelCatalog(): Promise<AiModelCatalog> {
        this.catalogPromise ??= (async () => {
            const [modulePath, makersPath, setsPath] = await Promise.all([
                this.resolveRepoFile('packages/generate/src/ai-models.mjs'),
                this.resolveRepoFile('packages/schemas/ai-makers.json'),
                this.resolveRepoFile('packages/schemas/ai-model-sets.json')
            ]);
            const [module, makers, sets] = await Promise.all([
                importEsm<{
                    loadAiModels(options: {
                        repoRoot: string;
                    }): Promise<AiModelCatalog['models']>;
                }>(pathToFileURL(modulePath).href),
                fs.readFile(makersPath, 'utf8').then(JSON.parse), fs.readFile(setsPath, 'utf8').then(JSON.parse)
            ]);
            if (sets.version !== 1 || !sets.sets) {
                throw new Error('AI モデルのセットが不正です。');
            }
            return { models: await module.loadAiModels({ repoRoot: path.resolve(path.dirname(modulePath), '../../..') }), makers, sets: sets.sets };
        })();
        try {
            return await this.catalogPromise;
        }
        catch (error) {
            this.catalogPromise = undefined;
            throw error;
        }
    }

    protected appPath(): string { return path.join(process.env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'ai-models.json'); }
    protected projectPath(projectRootUri?: string): string | undefined {
        if (!projectRootUri) {
            return undefined;
        }
        const root = projectRootUri.startsWith('file:') ? fileURLToPath(projectRootUri) : projectRootUri;
        return path.join(root, '.akari', 'ai-models.json');
    }

    protected async projectAvailable(projectRootUri?: string): Promise<boolean> {
        const file = this.projectPath(projectRootUri);
        if (!file) {
            return false;
        }
        try {
            return (await fs.stat(path.dirname(file))).isDirectory();
        }
        catch {
            return false;
        }
    }

    protected async read(file: string | undefined): Promise<AiModelPreferencesDocument> {
        if (!file) {
            return empty();
        }
        try {
            const value = JSON.parse(await fs.readFile(file, 'utf8'));
            if (value?.version !== 1 || !value.defaults || typeof value.defaults !== 'object') {
                return empty();
            }
            const result = empty();
            for (const kind of AI_MODEL_KINDS) {
                if (typeof value.defaults[kind] === 'string') {
                    result.defaults[kind] = value.defaults[kind];
                }
                if (Array.isArray(value.favorites?.[kind])) {
                    result.favorites[kind] = value.favorites[kind].filter((id: unknown): id is string => typeof id === 'string');
                }
            }
            return result;
        }
        catch {
            return empty();
        }
    }

    protected async write(file: string, value: AiModelPreferencesDocument, project: boolean): Promise<void> {
        const dir = path.dirname(file);
        await fs.mkdir(dir, { recursive: true });
        const temp = path.join(dir, `.ai-models.${process.pid}.${randomUUID()}.tmp`);
        try {
            const document = project ? { version: 1, defaults: value.defaults } : value;
            await fs.writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
            await fs.rename(temp, file);
        }
        catch (error) {
            await fs.unlink(temp).catch(() => undefined);
            throw error;
        }
    }

    protected enqueue<T>(action: () => Promise<T>): Promise<T> {
        const result = this.writing.then(action, action);
        this.writing = result.catch(() => undefined);
        return result;
    }

    async getAiModelPreferences(options: {
        projectRootUri?: string;
    } = {}): Promise<AiModelPreferences> {
        const catalog = await this.getAiModelCatalog();
        const projectAvailable = await this.projectAvailable(options.projectRootUri);
        const [app, project] = await Promise.all([
            this.read(this.appPath()),
            this.read(projectAvailable ? this.projectPath(options.projectRootUri) : undefined)
        ]);
        const base = applyAiModelSet(catalog.sets.normal, catalog.models);
        const available = new Map(catalog.models.filter(model => model.callable).map(model => [model.id, model]));
        const result: AiModelPreferences = { favorites: {}, defaults: {}, source: {}, appDefaults: {}, projectDefaults: {}, projectAvailable };
        for (const kind of AI_MODEL_KINDS) {
            result.favorites[kind] = (app.favorites[kind] || base.favorites[kind] || []).filter(id => available.get(id)?.kind === kind);
            const appId = app.defaults[kind];
            const projectId = project.defaults[kind];
            if (appId && available.get(appId)?.kind === kind) {
                result.appDefaults[kind] = appId;
            }
            if (projectId && available.get(projectId)?.kind === kind) {
                result.projectDefaults[kind] = projectId;
            }
            result.defaults[kind] = result.projectDefaults[kind] || result.appDefaults[kind] || base.defaults[kind];
            result.source[kind] = result.projectDefaults[kind] ? 'project' : result.appDefaults[kind] ? 'app' : 'set';
        }
        return result;
    }

    async toggleFavorite(kind: AiModelKind, id: string): Promise<AiModelPreferences> {
        return this.enqueue(async () => {
            const model = (await this.getAiModelCatalog()).models.find(row => row.id === id && row.kind === kind && row.callable);
            if (!model) {
                throw new Error('このモデルはまだ選べません。');
            }
            const app = await this.read(this.appPath());
            const favorites = new Set(app.favorites[kind] || (await this.getAiModelPreferences()).favorites[kind] || []);
            if (favorites.has(id)) {
                favorites.delete(id);
            }
            else {
                favorites.add(id);
            }
            app.favorites[kind] = [...favorites];
            await this.write(this.appPath(), app, false);
            return this.getAiModelPreferences();
        });
    }

    async setDefault(kind: AiModelKind, id: string | null, options: {
        projectRootUri?: string;
    } = {}): Promise<AiModelPreferences> {
        return this.enqueue(async () => {
            if (options.projectRootUri && !(await this.projectAvailable(options.projectRootUri))) {
                throw new Error('AKARI の動画プロジェクトを開いてください。');
            }
            if (id && !(await this.getAiModelCatalog()).models.some(row => row.id === id && row.kind === kind && row.callable)) {
                throw new Error('このモデルはまだ選べません。');
            }
            const projectPath = this.projectPath(options.projectRootUri);
            const file = projectPath || this.appPath();
            const document = await this.read(file);
            if (id) {
                document.defaults[kind] = id;
            }
            else {
                delete document.defaults[kind];
            }
            await this.write(file, document, !!projectPath);
            return this.getAiModelPreferences(options);
        });
    }

    async applySet(set: AiModelSetId, options: {
        projectRootUri?: string;
    } = {}): Promise<AiModelPreferences> {
        return this.enqueue(async () => {
            if (options.projectRootUri && !(await this.projectAvailable(options.projectRootUri))) {
                throw new Error('AKARI の動画プロジェクトを開いてください。');
            }
            const catalog = await this.getAiModelCatalog();
            if (!catalog.sets[set]) {
                throw new Error('おすすめのセットが見つかりません。');
            }
            const selected = applyAiModelSet(catalog.sets[set], catalog.models);
            const projectPath = this.projectPath(options.projectRootUri);
            if (projectPath) {
                const app = await this.read(this.appPath());
                app.favorites = selected.favorites;
                await this.write(projectPath, selected, true);
                await this.write(this.appPath(), app, false);
            }
            else {
                await this.write(this.appPath(), selected, false);
            }
            return this.getAiModelPreferences(options);
        });
    }
}
