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
        pi: 'pi', deepseek: 'dsh', devin: 'devin', copilot: 'copilot', cursor: 'cursor-agent', antigravity: 'agy', grok: 'grok', muse: 'muse'
    };
    const name = names[agent];
    const win = platform === 'win32';
    const pathExtensions = (env.PATHEXT || '').split(';').map(extension => extension.trim().toLowerCase()).filter(Boolean);
    const suffixes = win
        ? agent === 'claude'
            ? options.nativeOnly ? ['.exe'] : ['.exe', '.cmd', '.bat']
            : agent === 'muse' && !options.nativeOnly ? ['.cmd', ...pathExtensions.filter(extension => extension !== '.cmd')]
            : options.nativeOnly ? ['.exe'] : pathExtensions.length ? pathExtensions : ['.exe', '.cmd', '.bat']
        : [''];
    const local = path.join(homeDir, '.local', 'bin');
    const localAppData = env.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local');
    // Windows の Codex は導入・更新が AKARI の管理フォルダへ入る（mac は ~/.local/bin/codex が管理先への
    // リンク）。~/.local/bin に古い codex.exe が残っていると、設定から更新しても起動されるのは古い版の
    // ままになり、新しいモデルが選べない。管理フォルダを先に見る。
    const managedFirst = agent === 'codex' && win ? [path.join(localAppData, 'AKARI Video', 'codex', 'current', 'bin')] : [];
    const candidates = [...managedFirst.flatMap(directory => suffixes.map(suffix => path.join(directory, name + suffix))),
        ...suffixes.map(suffix => path.join(local, name + suffix))];
    const extra: string[] = [];
    if (agent === 'claude') {
        extra.push(path.join(homeDir, '.claude', 'bin'), path.join(homeDir, '.claude', 'local'));
        if (win) {
            extra.push(path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'npm'));
        }
    } else if (agent === 'opencode') {
        extra.push(path.join(homeDir, '.opencode', 'bin'));
    } else if (agent === 'grok') {
        extra.push(path.join(homeDir, '.grok', 'bin'));
    } else if (agent === 'commandcode' || agent === 'pi' || agent === 'deepseek') {
        if (win) {
            extra.push(path.join(homeDir, '.local'), path.join(env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'npm'));
        } else {
            extra.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin');
        }
    } else if (win && agent === 'antigravity') {
        extra.push(path.join(localAppData, 'agy', 'bin'));
    } else if (win && agent === 'devin') {
        extra.push(path.join(localAppData, 'devin', 'cli', 'bin'));
    } else if (win && agent === 'muse') {
        extra.push(path.join(localAppData, 'Programs', 'muse'));
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
