import { t } from '../common/partner-text';
import { createHash } from 'crypto';
import * as path from 'path';

export type DeepSeekProvider = 'deepseek-official' | 'opencode-go';
export interface DeepSeekConnection {
    provider: DeepSeekProvider;
    note: string;
    detail: string;
    guidance?: string;
    secret?: { OPENCODE_GO_API_KEY: string };
}

export function detectDeepSeekConnection(input: {
    env: NodeJS.ProcessEnv;
    homeDir: string;
    readFile: (file: string) => string;
}): DeepSeekConnection {
    if (input.env.DEEPSEEK_API_KEY?.trim()) {
        return { provider: 'deepseek-official', note: t('partner.partnerSetup.deepSeekPatch.destinationOfficialDeepseekApiUsesDeepseekApiKeyText'),
            detail: t('partner.partnerSetup.deepSeekPatch.officialApiDetail') };
    }
    try {
        const auth = JSON.parse(input.readFile(path.join(input.homeDir, '.local', 'share', 'opencode', 'auth.json')));
        const key = auth?.['opencode-go']?.key;
        if (typeof key === 'string' && key.trim()) {
            return {
                provider: 'opencode-go',
                note: t('partner.partnerSetup.deepSeekPatch.destinationOpencodeGoUsesOpencodeCredentialsText'),
                detail: t('partner.partnerSetup.deepSeekPatch.openCodeGoDetail'),
                secret: { OPENCODE_GO_API_KEY: key }
            };
        }
    } catch { /* Optional local credential. */ }
    return {
        provider: 'deepseek-official',
        note: t('partner.partnerSetup.deepSeekPatch.automaticConnectionNotConfiguredNote'),
        detail: t('partner.partnerSetup.deepSeekPatch.notConfiguredDetail'),
        guidance: t('partner.partnerSetup.deepSeekPatch.addDeepseekKeySettingsModelsSignOpencodeGoOpencodeUseText')
    };
}

// A `models` list replaces dsh's installed OpenCode Go catalog wholesale, so every DeepSeek model the picker should offer must be listed.
const OPENCODE_GO_MODELS = [
    { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash (OpenCode Go)' },
    { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro (OpenCode Go)' }
];

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
        models:
${OPENCODE_GO_MODELS.map(model => `          - { id: ${model.id}, name: ${model.name}, contextWindow: 131072 }\n`).join('')}`;
}
