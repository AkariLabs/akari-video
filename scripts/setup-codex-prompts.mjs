#!/usr/bin/env node
// Codex のスラッシュメニューに AKARI Video スキルを出すためのカスタムプロンプトを
// ~/.codex/prompts/ に生成する（/prompts:<スキル名> で起動できるようになる）。
// 本文は「プロジェクト内の SKILL.md を読んで従う」薄いスタブのみ — スキル正本は
// あくまで各プロジェクト / リポジトリ側にあり、ここにロジックは置かない。
// 再実行すると本スクリプト生成分（マーカー入り）だけを書き直す。
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const promptsDir = join(homedir(), '.codex', 'prompts');
const MARKER = '<!-- generated: akari-video scripts/setup-codex-prompts.mjs -->';

const skillNames = readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

mkdirSync(promptsDir, { recursive: true });

let written = 0;
for (const name of skillNames) {
    const skill = readFileSync(join(root, 'skills', name, 'SKILL.md'), 'utf8');
    const description = (skill.match(/^description:\s*(.*)$/m)?.[1] ?? '').trim();
    const short = description.length > 80 ? `${description.slice(0, 80)}…` : description;

    const destination = join(promptsDir, `${name}.md`);
    if (existsSync(destination) && !readFileSync(destination, 'utf8').includes(MARKER)) {
        console.warn(`スキップ（手書きの既存プロンプトを保護）: ${destination}`);
        continue;
    }

    writeFileSync(destination, [
        '---',
        `description: AKARI Video スキル — ${short}`,
        'argument-hint: 追加の指示（任意）',
        '---',
        MARKER,
        '',
        `AKARI Video のスキル「${name}」を実行してください。`,
        '',
        '現在のプロジェクト / リポジトリのルートを起点に、次の順で最初に見つかった SKILL.md を読み、',
        'その手順に厳密に従ってください。',
        '',
        `1. \`.codex/skills/${name}/SKILL.md\``,
        `2. \`.agents/skills/${name}/SKILL.md\``,
        `3. \`.claude/skills/${name}/SKILL.md\``,
        `4. \`skills/${name}/SKILL.md\``,
        '',
        'どこにも見つからない場合は、AKARI Video のプロジェクト（またはリポジトリ）内で',
        '実行する必要がある旨を伝えて停止してください。',
        '',
        '追加の指示: $ARGUMENTS',
        ''
    ].join('\n'), 'utf8');
    written += 1;
}

console.log(`setup-codex-prompts: ${written} / ${skillNames.length} 件を ${promptsDir} に生成`);
