#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createProject } from '../../../packages/project-scaffold/src/index.mjs';

const usage = '使い方: node skills/create-project/bin/create-project.mjs <target-dir> [--template <path>]';

function parseArguments(args) {
    let target;
    let template;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--template') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error(`${usage}\n--template にはパスが必要です。`);
            }
            template = value;
            index += 1;
        } else if (argument.startsWith('-')) {
            throw new Error(`${usage}\n不明なオプションです: ${argument}`);
        } else if (target === undefined) {
            target = argument;
        } else {
            throw new Error(`${usage}\n作成先は 1 つだけ指定してください。`);
        }
    }

    if (target === undefined) {
        throw new Error(usage);
    }
    return { target, template };
}

async function main() {
    const { target, template } = parseArguments(process.argv.slice(2));
    const targetDir = path.resolve(process.cwd(), target);
    const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
    const templateDir = template
        ? path.resolve(process.cwd(), template)
        : path.resolve(scriptDirectory, '../../../templates/project-default');

    try {
        const templateStat = await fs.stat(templateDir);
        if (!templateStat.isDirectory()) {
            throw new Error('not a directory');
        }
    } catch {
        throw new Error(`雛形が見つかりません: ${templateDir}`);
    }

    const result = await createProject(targetDir, templateDir);
    console.log(`プロジェクトを作成しました: ${result.destination}`);
    console.log(`コピー: ${result.copy.copiedFiles.length} 件`);
    console.log(`フォールバック補完: ${result.fallback.writtenFiles.length} 件`);
    console.log(`シンボリックリンクのスキップ: ${result.copy.skippedSymlinks.length} 件`);
    console.log(`git: ${result.git.action}`);
    console.log(`作成結果レポート: ${result.reportPath}`);
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
