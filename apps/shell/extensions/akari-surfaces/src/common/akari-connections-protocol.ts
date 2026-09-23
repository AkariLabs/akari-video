export const AKARI_CONNECTIONS_SERVICE_PATH = '/services/akari-surfaces-connections';
export const AkariConnectionsService = Symbol('AkariConnectionsService');

export const TRANSCRIBE_BACKENDS = ['speech-analyzer', 'whisper-cpp', 'cloud:scribe', 'cloud:groq'] as const;
export type TranscribeBackend = 'auto' | typeof TRANSCRIBE_BACKENDS[number];

export interface ConnectionDoctor {
    status: 'ok' | 'unauthorized' | 'unconfigured' | 'unchecked' | 'setup_required';
    detail: string;
    last_checked: string | null;
}

export interface ConnectionRow {
    id: string;
    label: string;
    description: string;
    setup_url: string | null;
    env_name: string;
    configured: boolean;
    masked_tail: string | null;
    source?: 'primary' | 'legacy';
    doctor: ConnectionDoctor;
}

export interface ConnectionsList {
    providers: ConnectionRow[];
    credentials: { exists: boolean; secure_permissions: boolean; path: string };
    store: { exists: boolean; connected: boolean };
}

export interface SetCredentialResult {
    ok: boolean;
    masked_tail: string | null;
    doctor: ConnectionDoctor;
}

export type GenerationDefaultsSource = 'project' | 'workspace' | 'default';
export type GenerationKind = 'image' | 'video';

export interface GenerationDefaults { still: string | null; video: string | null }

export interface GenerationDefaultsResult {
    effective: GenerationDefaults;
    source: { still: GenerationDefaultsSource; video: GenerationDefaultsSource };
    workspacePath: string | null;
}

export interface GenerationCatalogPrice {
    unit: string;
    by_resolution: Record<string, number>;
    audio_multiplier: number | null;
}

export interface GenerationCatalogModel {
    id: string;
    kind: GenerationKind;
    family: string;
    provider: string;
    price: GenerationCatalogPrice | null;
    as_of: string;
    resolutions: string[] | null;
    audio_out: boolean | 'always';
}

export interface GenerationCatalog { models: GenerationCatalogModel[] }

/**
 * 残高の口（2026-09-22 各社の公式ドキュメントで確認）。`balance` が true のサービスだけ「残高を見る」を出し、
 * 押したときだけ node 側（readBalance）が登録済みのキーで問い合わせる。キーはレンダラーへ渡さない。
 * `balance` が false のサービスは公式に API キーで残高を取る口が無いので、管理画面（billing_url）へのリンクだけ出す。
 */
export const PROVIDER_BALANCE_SUPPORT: Readonly<Record<string, { balance: boolean; docs: readonly string[]; billing_url: string }>> = {
    // GET /api/v1/credits は Management key なら口座残高を返す。通常キーの 401/403 は
    // GET /api/v1/key に切り替え、口座残高と混同しない表示にする。
    openrouter: {
        balance: true, billing_url: 'https://openrouter.ai/settings/credits',
        docs: ['https://openrouter.ai/docs/api_reference/limits', 'https://openrouter.ai/docs/api-reference/get-credits']
    },
    // GET https://api.fal.ai/v1/account/billing?expand=credits（Authorization: Key …）→ credits.current_balance / currency。ADMIN スコープのキーが要る。
    fal: {
        balance: true, billing_url: 'https://fal.ai/dashboard/usage-billing/billing',
        docs: ['https://fal.ai/docs/platform-apis/v1/account/billing']
    },
    // GET https://api.elevenlabs.io/v1/user/subscription（xi-api-key）→ character_limit - character_count。
    elevenlabs: {
        balance: true, billing_url: 'https://elevenlabs.io/app/subscription',
        docs: ['https://elevenlabs.io/docs/api-reference/user/subscription/get']
    },
    // API リファレンスに残高・使用量の口が無い（使用量は console のみ）。
    groq: {
        balance: false, billing_url: 'https://console.groq.com/settings/billing',
        docs: ['https://console.groq.com/docs/api-reference', 'https://console.groq.com/docs/spend-limits']
    },
    // GET /v1/account は type / username / name / github_url だけで残高を返さない。
    replicate: {
        balance: false, billing_url: 'https://replicate.com/account/billing',
        docs: ['https://replicate.com/docs/reference/http']
    }
};

export function providerHasBalanceEndpoint(id: string): boolean {
    return PROVIDER_BALANCE_SUPPORT[id]?.balance === true;
}

/** 残高の問い合わせ結果。表示用の 1 行だけを返す（生の応答・キーは返さない）。 */
export interface ProviderBalanceResult {
    ok: boolean;
    /** ok のとき: 口座残高かキーの上限かを明示した 1 行。 */
    display?: string;
    /** OpenRouter の通常キーで口座残高が読めないときに案内する管理画面。 */
    account_url?: string;
    /** 失敗のとき: 1 行のエラー。 */
    error?: string;
    checked_at: string;
}

export interface AkariConnectionsService {
    listConnections(): Promise<ConnectionsList>;
    setCredential(id: string, value: string): Promise<SetCredentialResult>;
    migrateCredential(id: string): Promise<{ ok: boolean }>;
    deleteCredential(id: string): Promise<{ ok: boolean }>;
    checkConnection(id: string): Promise<{ doctor: ConnectionDoctor }>;
    readGenerationDefaults(): Promise<GenerationDefaultsResult>;
    setGenerationDefaults(update: { still?: string; video?: string }): Promise<GenerationDefaultsResult>;
    readGenerationCatalog(): Promise<GenerationCatalog>;
    /** 押したときだけ呼ぶ。登録済みのキーで各社の公式の口へ問い合わせる（自動では呼ばない）。 */
    readBalance(id: string): Promise<ProviderBalanceResult>;
}
