import { createHash } from 'crypto';
import * as path from 'path';

export type DeepSeekProvider = 'deepseek-official' | 'opencode-go';
export interface DeepSeekConnection {
    provider: DeepSeekProvider;
    note: string;
    guidance?: string;
    secret?: { OPENCODE_GO_API_KEY: string };
}

export function detectDeepSeekConnection(input: {
    env: NodeJS.ProcessEnv;
    homeDir: string;
    readFile: (file: string) => string;
}): DeepSeekConnection {
    if (input.env.DEEPSEEK_API_KEY?.trim()) {
        return { provider: 'deepseek-official', note: '接続先: DeepSeek 公式 API（DEEPSEEK_API_KEY を使います）' };
    }
    try {
        const auth = JSON.parse(input.readFile(path.join(input.homeDir, '.local', 'share', 'opencode', 'auth.json')));
        const key = auth?.['opencode-go']?.key;
        if (typeof key === 'string' && key.trim()) {
            return {
                provider: 'opencode-go',
                note: '接続先: OpenCode Go（opencode の契約を使います）',
                secret: { OPENCODE_GO_API_KEY: key }
            };
        }
    } catch { /* Optional local credential. */ }
    return {
        provider: 'deepseek-official',
        note: '接続先: 未設定（DeepSeek の鍵か OpenCode Go のログインがあれば自動で使います）',
        guidance: '右上の Settings → Models で DeepSeek の鍵を入れるか、opencode で OpenCode Go にログインすると自動で使われます'
    };
}

export function buildDshSessionId(workspaceRootFsPath: string): string {
    return 'akari-' + createHash('sha256').update(workspaceRootFsPath).digest('hex').slice(0, 16);
}

export function buildDshPatchYaml(input: {
    pluginPath: string;
    provider: DeepSeekProvider;
    appVersion: string;
    sessionId: string;
}): string {
    if (!path.isAbsolute(input.pluginPath) && !path.win32.isAbsolute(input.pluginPath)) throw new Error('Plugin path must be absolute');
    if (!/^akari-[0-9a-f]{16}$/.test(input.sessionId)) throw new Error('Invalid dsh session id');
    if (!/^[0-9A-Za-z.+-]{1,40}$/.test(input.appVersion)) throw new Error('Invalid app version');
    const quotedPath = JSON.stringify(input.pluginPath);
    const base = `- insert:
    - id: akari-cwd-workspace
      name: ${quotedPath}
- id: agent-default-model
  config: { provider: ${input.provider}, model: deepseek-v4-pro }
`;
    if (input.provider !== 'opencode-go') return base;
    return base + `- id: llm-pi-ai
  config:
    providers:
      opencode-go:
        displayName: OpenCode Go
        apiKeyEnv: OPENCODE_GO_API_KEY
        api: openai-completions
        baseURL: https://opencode.ai/zen/go/v1
        headers: { User-Agent: ${JSON.stringify('akari-video/' + input.appVersion)}, x-opencode-session: ${input.sessionId} }
        compat: { thinkingFormat: deepseek }
        models: [{ id: deepseek-v4-pro, name: DeepSeek V4 Pro (OpenCode Go), contextWindow: 131072 }]
`;
}
