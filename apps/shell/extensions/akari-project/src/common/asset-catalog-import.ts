export type AssetCatalogImportFailureReason = 'no-project' | 'not-found' | 'locked' | 'failed';

export type AssetCatalogImportResult =
    | {
        ok: true;
        id: string;
        category: string;
        dir: string;
        files: string[];
        alreadyPresent: boolean;
    }
    | {
        ok: false;
        reason: AssetCatalogImportFailureReason;
        message: string;
    };

export interface AssetCatalogImportRequest {
    assetId: string;
}

export interface AssetCatalogImportItem {
    id: string;
    category: string;
    state?: 'cached' | 'available' | 'locked';
}

export interface AssetCatalogDirectoryEntry {
    name: string;
    isFile: boolean;
}

export interface AssetCatalogImportDependencies {
    getWorkspaceRoot(): string | undefined;
    getCatalogItems(): Promise<readonly AssetCatalogImportItem[]>;
    resolveAsset(id: string, projectRoot: string): Promise<{ success: true } | { success: false; error: string }>;
    fileExists(projectRoot: string, relativePath: string): Promise<boolean>;
    readDirectory(projectRoot: string, relativePath: string): Promise<readonly AssetCatalogDirectoryEntry[]>;
}

export type AssetCatalogImporter = (request: AssetCatalogImportRequest | undefined) => Promise<AssetCatalogImportResult>;

const MAX_FILES = 32;

function failure(reason: AssetCatalogImportFailureReason, message: string): AssetCatalogImportResult {
    return { ok: false, reason, message };
}

function isSafePathSegment(value: string): boolean {
    return value.length > 0 && value !== '.' && value !== '..' && !/[\\/]/.test(value);
}

function directFileName(value: string): string {
    return value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
}

async function listImportedFiles(
    dependencies: AssetCatalogImportDependencies,
    projectRoot: string,
    dir: string
): Promise<string[]> {
    const entries = await dependencies.readDirectory(projectRoot, dir);
    return entries
        .filter(entry => entry.isFile)
        .map(entry => directFileName(entry.name))
        .filter(isSafePathSegment)
        .sort((left, right) => left.localeCompare(right))
        .slice(0, MAX_FILES)
        .map(name => `${dir}/${name}`);
}

async function importAsset(
    dependencies: AssetCatalogImportDependencies,
    projectRoot: string,
    assetId: string
): Promise<AssetCatalogImportResult> {
    try {
        const items = await dependencies.getCatalogItems();
        const item = items.find(candidate => candidate.id === assetId);
        if (!item) {
            return failure('not-found', 'カタログに指定された素材が見つかりません。');
        }
        if (!isSafePathSegment(item.category) || !isSafePathSegment(item.id)) {
            return failure('failed', '素材の配置先を決定できませんでした。');
        }

        const dir = `assets/${item.category}/${item.id}`;
        if (await dependencies.fileExists(projectRoot, `${dir}/meta.json`)) {
            return {
                ok: true,
                id: item.id,
                category: item.category,
                dir,
                files: await listImportedFiles(dependencies, projectRoot, dir),
                alreadyPresent: true
            };
        }

        // resolver の composeState() は取得済みを先に判定し、未購入だけを locked にする。
        // RPC は resolver のエラーコードを返さないため、文言ではなくこの状態を根拠にする。
        if (item.state === 'locked') {
            return failure('locked', 'この素材は購入後に利用できます。');
        }

        const outcome = await dependencies.resolveAsset(item.id, projectRoot);
        if (outcome.success === false) {
            return failure('failed', '素材を取り込めませんでした。');
        }
        return {
            ok: true,
            id: item.id,
            category: item.category,
            dir,
            files: await listImportedFiles(dependencies, projectRoot, dir),
            alreadyPresent: false
        };
    } catch {
        return failure('failed', '素材を取り込めませんでした。');
    }
}

/** 同じプロジェクト・同じ id の実行中 Promise を共有する取り込み関数を作る。 */
export function createAssetCatalogImporter(dependencies: AssetCatalogImportDependencies): AssetCatalogImporter {
    const inFlight = new Map<string, Promise<AssetCatalogImportResult>>();
    return request => {
        const projectRoot = dependencies.getWorkspaceRoot();
        if (!projectRoot) {
            return Promise.resolve(failure('no-project', '先にプロジェクトを開いてください。'));
        }
        const assetId = typeof request?.assetId === 'string' ? request.assetId : '';
        const key = `${projectRoot}\0${assetId}`;
        const current = inFlight.get(key);
        if (current) {
            return current;
        }
        const pending = importAsset(dependencies, projectRoot, assetId);
        inFlight.set(key, pending);
        void pending.finally(() => {
            if (inFlight.get(key) === pending) {
                inFlight.delete(key);
            }
        });
        return pending;
    };
}
