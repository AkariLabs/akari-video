import { promises as fs } from 'fs';
import { join } from 'path';

export type ChatCommand = { name: string; description?: string; kind: 'skill' | 'command' };

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
