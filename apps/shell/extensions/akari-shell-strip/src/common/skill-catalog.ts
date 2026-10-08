export interface SkillEntry { name: string; description: string }

export function parseFrontmatter(content: string): SkillEntry | undefined {
    const lines = content.split(/\r?\n/);
    if (lines[0]?.trim() !== '---') return undefined;
    let name: string | undefined;
    let description: string | undefined;
    let closed = false;
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '---') { closed = true; break; }
        const match = /^([a-zA-Z_-]+):\s?(.*)$/.exec(line);
        if (match?.[1] === 'name') name = match[2].trim();
        if (match?.[1] === 'description') description = match[2].trim();
    }
    return closed && name ? { name, description: description ?? '' } : undefined;
}
