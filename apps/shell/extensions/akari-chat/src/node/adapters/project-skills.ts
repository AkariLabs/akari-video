import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import type { ChatCommand } from '../../common/chat-protocol';

export async function projectSkills(cwd: string, roots = ['.agents/skills']): Promise<ChatCommand[]> {
    const found = new Map<string, ChatCommand>();
    for (const root of roots) {
        let entries: string[];
        try { entries = await fs.readdir(join(cwd, root)); } catch { continue; }
        for (const entry of entries) {
            try {
                const source = await fs.readFile(join(cwd, root, entry, 'SKILL.md'), 'utf8');
                const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] || '';
                const name = /^name:\s*["']?([^\r\n"']+)/m.exec(frontmatter)?.[1]?.trim() || entry;
                const description = /^description:\s*["']?([^\r\n"']+)/m.exec(frontmatter)?.[1]?.trim();
                if (/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) found.set(name, { name, description, kind: 'skill' });
            } catch { /* 壊れたスキルは読み飛ばす。 */ }
        }
    }
    return [...found.values()];
}

export async function pluginSkills(cwd: string): Promise<ChatCommand[]> {
    const home = process.env.HOME || homedir();
    try {
        const settings = JSON.parse(await fs.readFile(join(home, '.claude', 'settings.json'), 'utf8'));
        const installed = JSON.parse(await fs.readFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
        if (installed.version !== 2 || !installed.plugins || !settings.enabledPlugins) return [];
        const commands = new Map<string, ChatCommand>();
        for (const [key, enabled] of Object.entries(settings.enabledPlugins)) {
            if (enabled !== true || !/^[^@/]+@[^@/]+$/.test(key)) continue;
            const plugin = key.split('@')[0];
            const records = installed.plugins[key];
            if (!Array.isArray(records)) continue;
            for (const record of records) {
                if (!record || typeof record.installPath !== 'string' ||
                    !(record.scope === 'user' || (record.scope === 'project' &&
                        typeof record.projectPath === 'string' && resolve(record.projectPath) === resolve(cwd)))) continue;
                for (const command of await projectSkills(record.installPath, ['skills'])) {
                    const name = `${plugin}:${command.name}`;
                    commands.set(name, { ...command, name });
                }
            }
        }
        return [...commands.values()];
    } catch { return []; }
}
