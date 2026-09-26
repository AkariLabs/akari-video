/* eslint-disable @typescript-eslint/no-var-requires */
import { PartnerAgentId } from '../common/akari-partner-protocol';

/** Self-contained so bootstrapRunner can receive this function through stdin. */
export function partnerCliCandidates(agent: PartnerAgentId, options: {
    homeDir: string;
    platform: NodeJS.Platform;
    env: NodeJS.ProcessEnv;
    includePath?: boolean;
    nativeOnly?: boolean;
}): string[] {
    const path = require('path') as typeof import('path');
    const { homeDir, platform, env } = options;
    const names: Record<PartnerAgentId, string> = {
        claude: 'claude', codex: 'codex', opencode: 'opencode', commandcode: 'command-code',
        pi: 'pi', devin: 'devin', copilot: 'copilot', cursor: 'cursor-agent', antigravity: 'agy', grok: 'grok'
    };
    const name = names[agent];
    const win = platform === 'win32';
    const pathExtensions = (env.PATHEXT || '').split(';').map(extension => extension.trim().toLowerCase()).filter(Boolean);
    const suffixes = win ? options.nativeOnly ? ['.exe'] : pathExtensions.length ? pathExtensions : ['.exe', '.cmd', '.bat'] : [''];
    const local = path.join(homeDir, '.local', 'bin');
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    const candidates = suffixes.map(suffix => path.join(local, name + suffix));
    const extra: string[] = [];
    if (agent === 'claude') {
        extra.push(path.join(homeDir, '.claude', 'bin'), path.join(homeDir, '.claude', 'local'));
    } else if (agent === 'codex' && win) {
        extra.push(path.join(localAppData, 'AKARI Video', 'codex', 'current', 'bin'));
    } else if (agent === 'opencode') {
        extra.push(path.join(homeDir, '.opencode', 'bin'));
    } else if (agent === 'grok') {
        extra.push(path.join(homeDir, '.grok', 'bin'));
    } else if (agent === 'commandcode' || agent === 'pi') {
        if (win) {
            extra.push(path.join(homeDir, '.local'), path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'npm'));
        } else {
            extra.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
        }
    } else if (win && agent === 'antigravity') {
        extra.push(path.join(localAppData, 'agy', 'bin'));
    } else if (win && agent === 'devin') {
        extra.push(path.join(localAppData, 'devin', 'cli', 'bin'));
    }
    for (const directory of extra) {
        for (const suffix of suffixes) { candidates.push(path.join(directory, name + suffix)); }
    }
    if (options.includePath !== false) {
        for (const directory of (env.PATH || '').split(win ? ';' : ':').filter(Boolean)) {
            for (const suffix of suffixes) { candidates.push(path.join(directory, name + suffix)); }
        }
    }
    return [...new Set(candidates)];
}
