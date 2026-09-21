import path from 'node:path';
import fs from 'node:fs';
import { resourcesRoot } from '../resources-root.mjs';
export const PUBLIC_REPO = resourcesRoot();
export function metadata(source) {
    const front = source.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
    if (!front) throw new Error('frontmatter が無い');
    const lines = front.split(/\r?\n/);
    const scalar = (key) => {
        const matches = lines.flatMap((line, i) => line.startsWith(`${key}:`) ? [i] : []);
        if (matches.length !== 1) throw new Error(`${key} が無いか重複している`);
        const i = matches[0];
        let value = lines[i].slice(key.length + 1).trim();
        const continuation = [];
        for (let j = i + 1; j < lines.length && /^(?:\s|$)/.test(lines[j]); j++) continuation.push(lines[j].trim());
        if (/^[>|][-+]?$/.test(value)) value = continuation.join(' ');
        else if (continuation.length) value += ` ${continuation.join(' ')}`;
        if (value.startsWith('"')) value = JSON.parse(value);
        else if (value.startsWith("'")) {
            if (!value.endsWith("'")) throw new Error(`${key} の引用符が閉じていない`);
            value = value.slice(1, -1).replaceAll("''", "'");
        }
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} が空`);
        return value.trim();
    };
    const name = scalar('name');
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name === 'none') throw new Error('name が選択肢キーとして不正');
    return { name, description: scalar('description') };
}
export function loadSkills() {
    try {
        if (!PUBLIC_REPO) throw new Error('公開資源がありません');
        const directory = path.join(PUBLIC_REPO, 'skills');
        const skills = new Map();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
            const file = path.join(directory, entry.name, 'SKILL.md');
            let source;
            try { source = fs.readFileSync(file, 'utf8'); }
            catch (error) { if (error.code === 'ENOENT') continue; throw error; }
            const skill = metadata(source);
            if (skills.has(skill.name)) throw new Error(`name 重複: ${skill.name}`);
            const description = skill.description.replace(/\s+/g, ' ');
            // Put usage triggers before prerequisites for every skill, keeping
            // the original order within each group and preserving punctuation.
            const sentences = description.match(/[^。]+。|[^。]+$/g) ?? [];
            const isUsage = sentence => /使う|発動|求められた/.test(sentence);
            const reordered = [...sentences.filter(isUsage), ...sentences.filter(sentence => !isUsage(sentence))].join('');
            const chars = Array.from(reordered);
            skills.set(skill.name, `${skill.name}: ${chars.slice(0, 240).join('')}${chars.length > 240 ? '…' : ''}`);
        }
        if (!skills.size) throw new Error('SKILL.md が見つからない');
        return { skills };
    } catch (error) {
        return { skills: new Map(), error: `skills を読み込めない: ${error.code ?? error.message}` };
    }
}
export const catalog = loadSkills();
