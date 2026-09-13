import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
    AkariConnectionsService, ConnectionDoctor, ConnectionsList, GenerationCatalog, GenerationCatalogModel,
    GenerationDefaultsResult, SetCredentialResult
} from '../common/akari-connections-protocol';
import {
    checkCredential, ConnectionProvider, credentialEnvName, credentialsFilePath, DoctorAdapter,
    formatConnections, readCredentials, setCredentialAndCheck, writeCredential
} from '../common/credentials-file';

// tsc's CommonJS transform must not turn ESM imports into require().
const importEsm = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
interface Registry { providers: ConnectionProvider[] }
interface ResolverModule {
    resolveConnections(options: { projectRoot: string; env: NodeJS.ProcessEnv }): Promise<{
        effective: Registry; layers: { project: { exists: boolean }; workspace: unknown };
    }>;
}

interface ConnectionsDocument {
    providers: unknown[];
    defaults?: { generate?: { still?: string | null; video?: string | null } };
    policy: { currency: string; monthly_budget: number | null; approval_threshold: number | null };
    memory?: unknown[];
}

class GenerationDefaultsServiceError extends Error { }

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) { return false; }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
    if (Object.keys(value).some(key => !allowed.includes(key))) { throw new Error('connections.json に未定義の欄があります。'); }
}

function assertNullableNonNegativeNumber(value: unknown): void {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
        throw new Error('connections.json の予算欄が不正です。');
    }
}

function assertValidConnectionsDocument(value: unknown): void {
    if (!isPlainObject(value)) { throw new Error('connections.json のルートが不正です。'); }
    assertOnlyKeys(value, ['providers', 'defaults', 'policy', 'memory']);
    if (!Object.prototype.hasOwnProperty.call(value, 'providers') || !Array.isArray(value.providers)) {
        throw new Error('connections.json の providers が不正です。');
    }
    if (!Object.prototype.hasOwnProperty.call(value, 'policy') || !isPlainObject(value.policy)) {
        throw new Error('connections.json の policy が不正です。');
    }
    assertOnlyKeys(value.policy, ['currency', 'monthly_budget', 'approval_threshold']);
    if (Object.keys(value.policy).length !== 3 || typeof value.policy.currency !== 'string' || !/^[A-Z]{3}$/.test(value.policy.currency)) {
        throw new Error('connections.json の policy が不正です。');
    }
    assertNullableNonNegativeNumber(value.policy.monthly_budget);
    assertNullableNonNegativeNumber(value.policy.approval_threshold);
    if (Object.prototype.hasOwnProperty.call(value, 'memory') && !Array.isArray(value.memory)) {
        throw new Error('connections.json の memory が不正です。');
    }
    if (!Object.prototype.hasOwnProperty.call(value, 'defaults')) { return; }
    if (!isPlainObject(value.defaults)) { throw new Error('connections.json の defaults が不正です。'); }
    assertOnlyKeys(value.defaults, ['generate']);
    if (!Object.prototype.hasOwnProperty.call(value.defaults, 'generate')) { return; }
    if (!isPlainObject(value.defaults.generate)) { throw new Error('connections.json の defaults.generate が不正です。'); }
    assertOnlyKeys(value.defaults.generate, ['still', 'video']);
    for (const key of ['still', 'video']) {
        if (!Object.prototype.hasOwnProperty.call(value.defaults.generate, key)) { continue; }
        const field = value.defaults.generate[key];
        if (field !== null && (typeof field !== 'string' || field.trim().length === 0)) {
            throw new Error('connections.json の既定モデルが不正です。');
        }
    }
}

@injectable()
export class AkariConnectionsServiceImpl implements AkariConnectionsService {
    protected readonly doctors = new Map<string, ConnectionDoctor>();
    protected pending: Promise<unknown> = Promise.resolve();
    protected registryPromise: Promise<Registry> | undefined;
    protected catalogPromise: Promise<GenerationCatalogModel[]> | undefined;

    protected async loadModule<T>(relativeTarget: string): Promise<T> {
        for (const start of [__dirname, process.cwd()]) {
            let directory = start;
            for (;;) {
                const candidate = path.resolve(directory, relativeTarget);
                let found = false;
                try { found = (await fs.stat(candidate)).isFile(); } catch { /* Try the parent. */ }
                if (found) { return importEsm<T>(pathToFileURL(candidate).toString()); }
                const parent = path.dirname(directory);
                if (parent === directory) { break; }
                directory = parent;
            }
        }
        throw new Error('接続確認の実装が見つかりません。');
    }

    protected async resolveRepoFile(relativeTarget: string): Promise<string | undefined> {
        for (const start of [__dirname, process.cwd()]) {
            let directory = start;
            for (;;) {
                const candidate = path.resolve(directory, relativeTarget);
                try { if ((await fs.stat(candidate)).isFile()) { return candidate; } } catch { /* Try the parent. */ }
                const parent = path.dirname(directory);
                if (parent === directory) { break; }
                directory = parent;
            }
        }
        return undefined;
    }

    protected async catalogModels(): Promise<GenerationCatalogModel[]> {
        if (!this.catalogPromise) {
            this.catalogPromise = (async () => {
                const catalogPath = await this.resolveRepoFile('packages/schemas/gen-models.json');
                if (!catalogPath) { throw new Error('生成モデルのカタログが見つかりません。'); }
                const parsed = JSON.parse(await fs.readFile(catalogPath, 'utf8')) as { models?: unknown[] };
                if (!Array.isArray(parsed.models)) { throw new Error('生成モデルのカタログが見つかりません。'); }
                return parsed.models.filter((value): value is Record<string, unknown> =>
                    isPlainObject(value) && (value.kind === 'image' || value.kind === 'video')).map(value => {
                    const rawPrice = isPlainObject(value.price) ? value.price : null;
                    const rawRates = rawPrice && isPlainObject(rawPrice.by_resolution) ? rawPrice.by_resolution : {};
                    const byResolution: Record<string, number> = {};
                    for (const [key, rate] of Object.entries(rawRates)) {
                        if (typeof rate === 'number') { byResolution[key] = rate; }
                    }
                    return {
                        id: String(value.id), kind: value.kind as 'image' | 'video', family: String(value.family), provider: String(value.provider),
                        price: rawPrice ? {
                            unit: typeof rawPrice.unit === 'string' ? rawPrice.unit : '',
                            by_resolution: byResolution,
                            audio_multiplier: typeof rawPrice.audio_multiplier === 'number' ? rawPrice.audio_multiplier : null
                        } : null,
                        as_of: String(value.as_of),
                        resolutions: Array.isArray(value.resolutions) ? value.resolutions.filter(item => typeof item === 'string') : null,
                        audio_out: value.audio_out === 'always' ? 'always' : value.audio_out === true
                    };
                });
            })();
        }
        try { return await this.catalogPromise; } catch (error) {
            this.catalogPromise = undefined;
            throw error;
        }
    }

    async readGenerationCatalog(): Promise<GenerationCatalog> {
        try { return { models: await this.catalogModels() }; }
        catch { throw new Error('生成モデルのカタログを読み込めません。'); }
    }

    protected async workspaceRoot(): Promise<string | undefined> {
        const creatorRoot = await this.loadModule<{ resolveCreatorRoot(options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{
            rootDir: string; manifest?: unknown
        } | null> }>('packages/creator-root/src/index.mjs');
        const resolved = await creatorRoot.resolveCreatorRoot({ cwd: process.cwd(), env: process.env });
        return resolved?.manifest ? resolved.rootDir : undefined;
    }

    protected workspaceConnectionsPath(rootDir: string): string {
        return path.join(rootDir, '.akari', 'connections.json');
    }

    protected async readGenerationDefaultsUnlocked(): Promise<GenerationDefaultsResult> {
        const [creatorRoot, resolver] = await Promise.all([
            this.loadModule<{
                DEFAULT_CONNECTIONS_REGISTRY: ConnectionsDocument;
                resolveCreatorRoot(options: { cwd: string; env: NodeJS.ProcessEnv }): Promise<{ rootDir: string; manifest?: unknown } | null>;
            }>('packages/creator-root/src/index.mjs'),
            this.loadModule<{ mergeGenerationDefaults(base: unknown, overlay: unknown): { generate: { still: string | null; video: string | null } } }>(
                'skills/manage-connections/bin/resolve-connections.mjs')
        ]);
        const readLayer = async (filePath: string): Promise<ConnectionsDocument | null> => {
            try {
                const value: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
                return isPlainObject(value) ? value as unknown as ConnectionsDocument : null;
            } catch { return null; }
        };
        const resolved = await creatorRoot.resolveCreatorRoot({ cwd: process.cwd(), env: process.env });
        const rootDir = resolved?.manifest ? resolved.rootDir : undefined;
        const workspacePath = rootDir ? this.workspaceConnectionsPath(rootDir) : null;
        const [workspace, project] = await Promise.all([
            workspacePath ? readLayer(workspacePath) : Promise.resolve(null),
            readLayer(path.join(process.cwd(), '.akari', 'connections.json'))
        ]);
        const merged = resolver.mergeGenerationDefaults(
            resolver.mergeGenerationDefaults(creatorRoot.DEFAULT_CONNECTIONS_REGISTRY.defaults, workspace?.defaults), project?.defaults);
        const sourceFor = (field: 'still' | 'video'): 'project' | 'workspace' | 'default' => {
            const projectValue = project?.defaults?.generate?.[field];
            if (typeof projectValue === 'string' && projectValue.trim()) { return 'project'; }
            const workspaceValue = workspace?.defaults?.generate?.[field];
            return typeof workspaceValue === 'string' && workspaceValue.trim() ? 'workspace' : 'default';
        };
        return {
            effective: merged.generate,
            source: { still: sourceFor('still'), video: sourceFor('video') },
            workspacePath
        };
    }

    async readGenerationDefaults(): Promise<GenerationDefaultsResult> {
        return this.serialize(() => this.readGenerationDefaultsUnlocked());
    }

    async setGenerationDefaults(update: { still?: string; video?: string }): Promise<GenerationDefaultsResult> {
        return this.serialize(async () => {
            try {
                const fields = (['still', 'video'] as const).filter(field => typeof update[field] === 'string');
                if (fields.length === 0) { return this.readGenerationDefaultsUnlocked(); }
                const models = await this.catalogModels();
                for (const field of fields) {
                    const kind = field === 'still' ? 'image' : 'video';
                    if (!models.some(model => model.kind === kind && model.id === update[field])) {
                        throw new GenerationDefaultsServiceError(`カタログにないモデルです。 (${update[field]})`);
                    }
                }
                const rootDir = await this.workspaceRoot();
                if (!rootDir) { throw new GenerationDefaultsServiceError('作業場が見つかりません。'); }
                const filePath = this.workspaceConnectionsPath(rootDir);
                let document: ConnectionsDocument;
                try {
                    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'));
                    assertValidConnectionsDocument(parsed);
                    document = parsed as ConnectionsDocument;
                } catch (error) {
                    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                        throw new GenerationDefaultsServiceError('既存の connections.json を読めません。');
                    }
                    document = {
                        providers: [],
                        policy: { currency: 'JPY', monthly_budget: null, approval_threshold: null },
                        memory: []
                    };
                }
                const next = JSON.parse(JSON.stringify(document)) as ConnectionsDocument;
                next.defaults ??= {};
                next.defaults.generate ??= {};
                for (const field of fields) { next.defaults.generate[field] = update[field]; }
                assertValidConnectionsDocument(next);
                const temporary = path.join(path.dirname(filePath), `.connections.json.${process.pid}.${Date.now()}.tmp`);
                try {
                    await fs.mkdir(path.dirname(filePath), { recursive: true });
                    await fs.writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
                    await fs.rename(temporary, filePath);
                } catch {
                    try { await fs.unlink(temporary); } catch { /* Nothing to clean up. */ }
                    throw new Error('生成の既定モデルを保存できません。');
                }
                return await this.readGenerationDefaultsUnlocked();
            } catch (error) {
                if (error instanceof GenerationDefaultsServiceError) { throw error; }
                throw new Error('生成の既定モデルを保存できません。');
            }
        });
    }

    protected async registry(): Promise<Registry> {
        if (!this.registryPromise) {
            this.registryPromise = (async () => {
                const [creatorRoot, resolver] = await Promise.all([
                    this.loadModule<{ DEFAULT_CONNECTIONS_REGISTRY: Registry }>('packages/creator-root/src/index.mjs'),
                    this.loadModule<ResolverModule>('skills/manage-connections/bin/resolve-connections.mjs')
                ]);
                // The resolver has no machine-only option. A nonexistent, isolated context
                // suppresses project/workspace and machine-pointer overlays without writing any files.
                const isolated = path.join(os.tmpdir(), `akari-connections-defaults-${randomUUID()}`);
                const resolved = await resolver.resolveConnections({ projectRoot: isolated, env: { AKARI_HOME: isolated } });
                return resolved.layers.project.exists || resolved.layers.workspace
                    ? creatorRoot.DEFAULT_CONNECTIONS_REGISTRY : resolved.effective;
            })();
        }
        try { return await this.registryPromise; } catch {
            this.registryPromise = undefined;
            throw new Error('接続一覧を読み込めません。');
        }
    }

    protected async provider(id: string): Promise<ConnectionProvider> {
        const provider = (await this.registry()).providers.find(item => item.id === id && item.auth === 'env-key' && item.id !== 'akari-cloud');
        if (!provider) { throw new Error('未対応の接続です。'); }
        return provider;
    }

    protected serialize<T>(operation: () => Promise<T>): Promise<T> {
        const result = this.pending.then(operation);
        this.pending = result.catch(() => undefined);
        return result;
    }

    async listConnections(): Promise<ConnectionsList> {
        return this.serialize(async () => {
            try {
                const registry = await this.registry();
                const filePath = credentialsFilePath();
                const state = readCredentials(filePath);
                const storePath = path.join(process.env.AKARI_HOME || path.join(os.homedir(), '.akari'), 'store-credentials.json');
                const store = { exists: false, connected: false };
                try {
                    store.exists = (await fs.stat(storePath)).isFile();
                    if (store.exists) {
                        const parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
                        store.connected = typeof parsed?.token === 'string';
                    }
                } catch { /* Same disconnected fallback as home; never return Store credentials. */ }
                return {
                    providers: formatConnections(registry.providers, state, this.doctors),
                    credentials: { exists: state.exists, secure_permissions: state.secure_permissions, path: filePath }, store
                };
            } catch { throw new Error('接続一覧を読み込めません。'); }
        });
    }

    async setCredential(id: string, value: string): Promise<SetCredentialResult> {
        return this.serialize(async () => {
            try {
                const provider = await this.provider(id);
                const filePath = credentialsFilePath();
                return await setCredentialAndCheck(filePath, credentialEnvName(provider), value, () => this.inspect(provider, filePath));
            } catch { throw new Error('資格情報を登録できません。入力と保存先の権限を確認してください。'); }
        });
    }

    async deleteCredential(id: string): Promise<{ ok: boolean }> {
        return this.serialize(async () => {
            try {
                const provider = await this.provider(id);
                writeCredential(credentialsFilePath(), credentialEnvName(provider), null);
                this.doctors.delete(id);
                return { ok: true };
            } catch { throw new Error('資格情報を削除できません。'); }
        });
    }

    async checkConnection(id: string): Promise<{ doctor: ConnectionDoctor }> {
        return this.serialize(async () => {
            try { return { doctor: await this.inspect(await this.provider(id), credentialsFilePath()) }; }
            catch { throw new Error('接続を確認できません。'); }
        });
    }

    protected async inspect(provider: ConnectionProvider, filePath: string): Promise<ConnectionDoctor> {
        let doctor: ConnectionDoctor;
        try {
            const module = await this.loadModule<{ adapters: Record<string, DoctorAdapter> }>('skills/manage-connections/bin/doctor.mjs');
            doctor = await checkCredential(filePath, credentialEnvName(provider), module.adapters[provider.id]);
        } catch {
            doctor = { status: 'unchecked', detail: '接続を確認できませんでした。', last_checked: new Date().toISOString() };
        }
        this.doctors.set(provider.id, doctor);
        return doctor;
    }
}
