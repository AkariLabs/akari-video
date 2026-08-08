import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveLauncherAssets } from './repo-assets.mjs';

const usage = '使い方: akari new <target-dir> [--template <path>]';

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

async function directoryHasFile(directory, relativeFile) {
    if (!directory) return false;
    try {
        return (await fs.stat(path.join(directory, relativeFile))).isFile();
    } catch {
        return false;
    }
}

export async function runNewCommand(args, options = {}) {
    const log = options.log ?? ((line) => console.log(line));
    const logError = options.logError ?? ((line) => console.error(line));
    const cwd = options.cwd ?? process.cwd();
    const assets = options.assets ?? resolveLauncherAssets();

    if (args.includes('--help') || args.includes('-h')) {
        log(usage);
        return { exitCode: 0 };
    }

    let parsed;
    try {
        parsed = parseArguments(args);
    } catch (error) {
        logError(error instanceof Error ? error.message : String(error));
        return { exitCode: 1 };
    }

    const { target, template } = parsed;
    const targetDir = path.resolve(cwd, target);
    const templateDir = template ? path.resolve(cwd, template) : assets.templateDir;

    if (!templateDir) {
        logError('プロジェクト雛形が見つかりません。');
        return { exitCode: 1 };
    }

    try {
        const templateStat = await fs.stat(templateDir);
        if (!templateStat.isDirectory()) {
            throw new Error('not a directory');
        }
    } catch {
        logError(`雛形が見つかりません: ${templateDir}`);
        return { exitCode: 1 };
    }

    const skillsSourceDir = assets.skillsSourceDir;
    const hasSkills = await directoryHasFile(skillsSourceDir, 'analyze-footage/SKILL.md');
    if (!hasSkills) {
        logError(`スキル正本が見つからないため、スキル同梱をスキップします: ${skillsSourceDir ?? '未検出'}`);
    }
    const schemasSourceDir = assets.schemasSourceDir;
    const hasSchemas = await directoryHasFile(schemasSourceDir, 'analysis.schema.json');

    if (!assets.scaffoldModulePath && !options.createProject) {
        logError('プロジェクト作成モジュールが見つかりません。');
        return { exitCode: 1 };
    }

    try {
        const createProject = options.createProject ?? await defaultCreateProject(assets.scaffoldModulePath);
        const result = await createProject(targetDir, templateDir, hasSkills
            ? { skillsSourceDir, schemasSourceDir: hasSchemas ? schemasSourceDir : undefined }
            : {});
        log(`プロジェクトを作成しました: ${result.destination}`);
        log(`コピー: ${result.copy.copiedFiles.length} 件`);
        log(`フォールバック補完: ${result.fallback.writtenFiles.length} 件`);
        log(`シンボリックリンクのスキップ: ${result.copy.skippedSymlinks.length} 件`);
        log(`スキル同梱: ${hasSkills ? `実施（${skillsSourceDir}）` : 'スキップ'}`);
        log(`git: ${result.git.action}`);
        log(`作成結果レポート: ${result.reportPath}`);
        return { exitCode: 0, result };
    } catch (error) {
        logError(error instanceof Error ? error.message : String(error));
        return { exitCode: 1 };
    }
}

async function defaultCreateProject(scaffoldModulePath) {
    const { createProject } = await import(pathToFileURL(scaffoldModulePath).href);
    return createProject;
}
