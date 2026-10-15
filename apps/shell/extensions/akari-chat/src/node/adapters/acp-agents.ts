import { t } from '@akari-video/i18n';
import { spawn } from 'child_process';
import { constants } from 'fs';
import { access } from 'fs/promises';
import { homedir } from 'os';
import { join } from 'path';

export interface AcpAgentDefinition {
    id: string;
    name: string;
    executable: string;
    args: string[];
    extraDirs: string[];
    installHint: string;
    loginHint: string;
    modelArgs?: (id: string) => string[];
}

export const acpAgents: AcpAgentDefinition[] = [
    {
        id: 'opencode', name: 'opencode', executable: 'opencode', args: ['acp'],
        extraDirs: ['.opencode/bin'],
        installHint: t('chat.acpAgents.ui.installOpencodeMessage'),
        loginHint: 'opencode auth login'
    },
    {
        id: 'gemini', name: 'Gemini CLI', executable: 'gemini', args: ['--acp'],
        extraDirs: [], installHint: t('chat.acpAgents.ui.installGeminiCliMessage'),
        loginHint: 'gemini'
    },
    {
        id: 'copilot', name: 'Copilot CLI', executable: 'copilot', args: ['--acp'],
        extraDirs: [], installHint: t('chat.acpAgents.ui.installCopilotCliMessage'),
        loginHint: 'copilot login'
    },
    {
        id: 'grok', name: 'Grok Build', executable: 'grok', args: ['agent', 'stdio'],
        extraDirs: ['.grok/bin'],
        installHint: t('chat.acpAgents.ui.installGrokMessage'),
        loginHint: 'grok login'
    }
];

export interface AcpDetectionEnvironment {
    home?: string;
    path?: string;
    platform?: NodeJS.Platform;
    pathext?: string;
}

export function acpCandidates(agent: AcpAgentDefinition, environment: AcpDetectionEnvironment = {}): string[] {
    const home = environment.home ?? homedir();
    const platform = environment.platform ?? process.platform;
    const pathValue = environment.path ?? process.env.PATH ?? '';
    const suffixes = platform === 'win32'
        ? (environment.pathext ?? process.env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').filter(Boolean).map(value => value.toLowerCase())
        : [''];
    const directories = [join(home, '.local', 'bin'), ...agent.extraDirs.map(value => join(home, value)),
        ...pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean)];
    return [...new Set(directories.flatMap(directory => suffixes.map(suffix => join(directory, agent.executable + suffix))))];
}

export async function findAcpExecutable(agent: AcpAgentDefinition, environment: AcpDetectionEnvironment = {}): Promise<string | undefined> {
    for (const candidate of acpCandidates(agent, environment)) {
        try {
            await access(candidate, constants.X_OK);
            return candidate;
        } catch {
            // Continue searching the catalog's candidate locations.
        }
    }
    return undefined;
}

export async function acpVersion(executable: string): Promise<string | undefined> {
    return new Promise(resolve => {
        const child = spawn(executable, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'], shell: false });
        child.stdout.setEncoding('utf8');
        let output = '';
        let settled = false;
        const finish = (value?: string): void => {
            if (settled) { return; }
            settled = true;
            clearTimeout(timeout);
            resolve(value);
        };
        const timeout = setTimeout(() => { child.kill(); finish(); }, 10000);
        child.stdout.on('data', chunk => { output = (output + chunk).slice(0, 4096); });
        child.on('error', () => finish());
        child.on('close', () => finish(output.trim().split(/\r?\n/)[0] || undefined));
    });
}
