/**
 * プロジェクト内 `.akari/connections.json` の `akari-cloud` プロバイダを
 * 「接続済み（doctor.status = ok）」に倒すための純ロジック。
 *
 * ホーム v2 の接続ゲートが読む SSOT は、この doctor.status
 * （`skills/manage-connections/bin/doctor.mjs` が書く語彙をそのまま使う。
 * 新しい語彙は足さない）。ここは新しい判定基準を作らず、実際に PTY 接続が
 * 成立した瞬間に同じフィールドを実態へ追従させるだけ。
 *
 * ファイル I/O は `ConnectionsFileAccess` として外に出してあり、フロントエンドは
 * Theia の `FileService`、テストは実ファイル / メモリで同じロジックを回せる。
 */

export const CONNECTIONS_RELATIVE_PATH = '.akari/connections.json';
export const CLOUD_PROVIDER_ID = 'akari-cloud';

/** doctor.detail の文言（既存の実装から不変で引き継ぐ）。 */
export const CLOUD_CONNECTED_DETAIL = 'AI パートナーの接続を確認しました（ローカル CLI 接続の成立で判定、v0）。';

export interface CloudDoctorEntry {
    last_checked: string;
    status: 'ok';
    detail: string;
}

export interface ConnectionsFileAccess {
    /** ファイルが無い・読めない場合は `undefined` を返す（例外を投げない）。 */
    read(): Promise<string | undefined>;
    write(text: string): Promise<void>;
}

/**
 * - `missing`: connections.json 自体が無い（**何も作らない** — 無関係フォルダへ
 *   `.akari/` をスキャフォールドしないため。ゲートはアプリ単位マーカーが救う）
 * - `skipped`: 壊れた JSON など、安全に直せない中身だったので触らなかった
 * - `updated`: 既存の `akari-cloud` エントリの doctor を ok にした（従来の挙動）
 * - `added`: `akari-cloud` エントリが無かったので追加して ok にした
 */
export type CloudConnectionRepairOutcome = 'missing' | 'skipped' | 'updated' | 'added';

export interface CloudConnectionPatch {
    registry: Record<string, unknown>;
    added: boolean;
}

function createCloudDoctor(nowIso: string): CloudDoctorEntry {
    return {
        last_checked: nowIso,
        status: 'ok',
        detail: CLOUD_CONNECTED_DETAIL
    };
}

/**
 * 追加する `akari-cloud` エントリ。形は
 * internal `planning/contract-2026-07-17-manage-connections.md` §3 のスキーマ
 * （実体は `packages/schemas/connections.schema.json`）に従い、
 * `templates/project-default/.akari/connections.json` の同 ID エントリと同一にする
 * （雛形と後付け修復で中身が食い違わないようにするため）。
 */
function createCloudProviderEntry(doctor: CloudDoctorEntry): Record<string, unknown> {
    return {
        id: CLOUD_PROVIDER_ID,
        kind: 'genai',
        auth: 'login',
        env: null,
        models: {
            default: null,
            allowed: []
        },
        notes: {
            description: 'Akari Cloud のログイン認証で生成機能を利用する接続。工程 42 の生成で使う。',
            workflows: ['42 AI 生成素材'],
            billing: 'Akari Cloud の契約と各生成機能の料金に従う。有償操作は事前承認が必要。',
            quota: '契約プランの利用上限。doctor では照会しない。',
            scopes: ['生成機能'],
            setup_url: null
        },
        doctor
    };
}

/**
 * パース済みレジストリを受け取り、`akari-cloud` の doctor を ok にした結果を返す。
 * レジストリの体を成していない値（object 以外）には触らず `undefined` を返す。
 */
export function withCloudConnectionOk(registry: unknown, nowIso: string): CloudConnectionPatch | undefined {
    if (!registry || typeof registry !== 'object' || Array.isArray(registry)) {
        return undefined;
    }
    const next = registry as Record<string, unknown>;
    const doctor = createCloudDoctor(nowIso);
    const providers: unknown[] = Array.isArray(next.providers) ? next.providers as unknown[] : [];
    const existing = providers.find(candidate =>
        !!candidate && typeof candidate === 'object' && (candidate as { id?: unknown }).id === CLOUD_PROVIDER_ID
    );
    if (existing) {
        (existing as { doctor?: unknown }).doctor = doctor;
        return { registry: next, added: false };
    }
    providers.push(createCloudProviderEntry(doctor));
    next.providers = providers;
    return { registry: next, added: true };
}

/**
 * 「読めたときだけ直す」までを含めた修復手順。読めなかった（= ファイルが無い）
 * ときに書き込みを一切行わないことが、この関数の一番大事な性質。
 */
export async function repairCloudConnection(
    access: ConnectionsFileAccess,
    nowIso: string
): Promise<CloudConnectionRepairOutcome> {
    const raw = await access.read();
    if (raw === undefined) {
        return 'missing';
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return 'skipped';
    }
    const patch = withCloudConnectionOk(parsed, nowIso);
    if (!patch) {
        return 'skipped';
    }
    await access.write(`${JSON.stringify(patch.registry, null, 2)}\n`);
    return patch.added ? 'added' : 'updated';
}
