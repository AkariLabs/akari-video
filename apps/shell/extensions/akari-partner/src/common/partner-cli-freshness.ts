import { compareVersions } from './extension-freshness';

/**
 * CLI エージェント（Codex など）の「最新版があるか」を判断する純粋ロジック。
 * Codex は導入後に自動更新されず通知も出ないため、設定画面から更新できるよう
 * 取得元の表・`--version` 出力の解釈・更新要否の判定をここに集める。
 * ネットワークは fetch を注入して呼ぶ（テストでスタブ可能。失敗は常に「不明」= undefined）。
 */
export type PartnerLatestSource =
    | { kind: 'github'; repo: string }
    | { kind: 'npm'; packageName: string }
    /** Claude Code の公式ネイティブ導入は自分で更新するため、こちらからは調べない。 */
    | { kind: 'self-updating' };

/** 取得元の表。載っていない CLI（ベンダースクリプト任せのもの）は最新版を調べず、更新ボタンも出さない。 */
export const PARTNER_LATEST_SOURCES: Readonly<Record<string, PartnerLatestSource>> = {
    claude: { kind: 'self-updating' },
    muse: { kind: 'self-updating' },
    codex: { kind: 'github', repo: 'openai/codex' },
    opencode: { kind: 'github', repo: 'sst/opencode' },
    copilot: { kind: 'github', repo: 'github/copilot-cli' },
    commandcode: { kind: 'npm', packageName: 'command-code' },
    pi: { kind: 'npm', packageName: '@earendil-works/pi-coding-agent' },
    deepseek: { kind: 'npm', packageName: '@deepseek-ai/dsh' }
};

/** "codex-cli 0.46.0" / "2.0.14 (Claude Code)" / "v1.2.3-beta.1" から版の部分だけを取り出す。 */
export function extractCliVersion(output: string | undefined): string | undefined {
    const match = /(?:^|[^0-9A-Za-z.])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)(?![0-9A-Za-z])/.exec(output ?? '');
    return match?.[1];
}

/** GitHub のタグ名（`rust-v0.46.0` / `v1.2.3`）と npm の version をそろえて版文字列にする。 */
export function parseLatestVersion(source: PartnerLatestSource, body: unknown): string | undefined {
    if (!body || typeof body !== 'object') { return undefined; }
    if (source.kind === 'github') {
        const tag = (body as { tag_name?: unknown }).tag_name;
        const match = typeof tag === 'string' ? /^(?:[A-Za-z][A-Za-z-]*-)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)$/.exec(tag) : null;
        return match?.[1];
    }
    if (source.kind === 'npm') {
        const version = (body as { version?: unknown }).version;
        return typeof version === 'string' ? extractCliVersion(version) : undefined;
    }
    return undefined;
}

export function latestVersionUrl(source: PartnerLatestSource): string | undefined {
    if (source.kind === 'github') { return `https://api.github.com/repos/${source.repo}/releases/latest`; }
    if (source.kind === 'npm') { return `https://registry.npmjs.org/${source.packageName.replace('/', '%2F')}/latest`; }
    return undefined;
}

export type FetchLike = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) =>
    Promise<{ ok: boolean; json(): Promise<unknown> }>;

export interface LatestVersionLookupOptions {
    fetchImpl: FetchLike;
    now?: () => number;
    ttlMs?: number;
    timeoutMs?: number;
}

/** 最新版の問い合わせ。約 3 秒で打ち切り、結果は 1 時間メモリに保持する。決して throw しない。 */
export function createLatestVersionLookup(options: LatestVersionLookupOptions): (agent: string) => Promise<string | undefined> {
    const { fetchImpl, now = Date.now, ttlMs = 3_600_000, timeoutMs = 3000 } = options;
    const cache = new Map<string, { at: number; version: string | undefined }>();
    const pending = new Map<string, Promise<string | undefined>>();
    return async agent => {
        const source = PARTNER_LATEST_SOURCES[agent];
        const url = source && latestVersionUrl(source);
        if (!source || !url) { return undefined; }
        const hit = cache.get(agent);
        if (hit && now() - hit.at < ttlMs) { return hit.version; }
        const running = pending.get(agent);
        if (running) { return running; }
        const task = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeoutMs);
            try {
                const response = await fetchImpl(url, {
                    signal: controller.signal,
                    headers: { Accept: 'application/json', 'User-Agent': 'akari-video' }
                });
                const version = response.ok ? parseLatestVersion(source, await response.json()) : undefined;
                // 失敗（undefined）も同じ時間だけ覚え、オフライン中に毎回 3 秒待たせない。
                cache.set(agent, { at: now(), version });
                return version;
            } catch {
                cache.set(agent, { at: now(), version: undefined });
                return undefined;
            } finally {
                clearTimeout(timer);
                pending.delete(agent);
            }
        })();
        pending.set(agent, task);
        return task;
    };
}

export interface PartnerCliFreshness {
    latestVersion?: string;
    updateAvailable: boolean;
    selfUpdating: boolean;
}

export function decidePartnerCliUpdate(agent: string, installedVersion: string | undefined, latestVersion: string | undefined): PartnerCliFreshness {
    const selfUpdating = PARTNER_LATEST_SOURCES[agent]?.kind === 'self-updating';
    const installed = extractCliVersion(installedVersion);
    // 版が読めない・最新版が不明なときは「更新あり」にしない（誤案内より沈黙）。
    const updateAvailable = !selfUpdating && Boolean(installed && latestVersion) && compareVersions(latestVersion!, installed!) > 0;
    return { latestVersion: selfUpdating ? undefined : latestVersion, updateAvailable, selfUpdating };
}

/**
 * 見つかった実体が AKARI の導入先（= 同じ経路で入れ直せる場所）か。Homebrew / システム npm など
 * PATH 上の別管理コピーは false にして、更新は元の方法で行うよう案内する。
 */
export function isAppManagedCliPath(executable: string, options: { homeDir: string; platform: NodeJS.Platform; env: NodeJS.ProcessEnv }): boolean {
    const { homeDir, platform, env } = options;
    const win = platform === 'win32';
    const sep = win ? '\\' : '/';
    const normalize = (value: string): string => {
        const text = (win ? value.replace(/\//g, '\\') : value).replace(/[\\/]+$/, '');
        return win ? text.toLowerCase() : text;
    };
    const join = (...parts: string[]): string => parts.join(sep);
    const localAppData = env.LOCALAPPDATA || join(homeDir, 'AppData', 'Local');
    const dirs = [
        join(homeDir, '.local', 'bin'), join(homeDir, '.opencode', 'bin'), join(homeDir, '.grok', 'bin'),
        ...(win ? [join(homeDir, '.local'), join(localAppData, 'AKARI Video', 'codex', 'current', 'bin'),
            join(localAppData, 'agy', 'bin'), join(localAppData, 'devin', 'cli', 'bin'),
            join(localAppData, 'Programs', 'muse')] : [])
    ].map(normalize);
    const slash = Math.max(executable.lastIndexOf('/'), win ? executable.lastIndexOf('\\') : -1);
    return dirs.includes(normalize(executable.slice(0, Math.max(slash, 0))));
}
