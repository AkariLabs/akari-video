import { injectable } from '@theia/core/shared/inversify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { AkariConnectionsService, ConnectionDoctor, ConnectionsList, SetCredentialResult } from '../common/akari-connections-protocol';
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

@injectable()
export class AkariConnectionsServiceImpl implements AkariConnectionsService {
    protected readonly doctors = new Map<string, ConnectionDoctor>();
    protected pending: Promise<unknown> = Promise.resolve();
    protected registryPromise: Promise<Registry> | undefined;

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
