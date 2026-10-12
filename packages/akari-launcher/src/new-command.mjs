import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { resolveLauncherAssets } from './repo-assets.mjs';
import { cliText } from './i18n.mjs';

const usage = (lang) => cliText('cli.new.help.usage', {}, lang);
const languageTagPattern = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

function parseArguments(args) {
    let target;
    let template;
    let lang;

    for (let index = 0; index < args.length; index += 1) {
        const argument = args[index];
        if (argument === '--template') {
            const value = args[index + 1];
            if (!value || value.startsWith('--')) {
                throw new Error(`${usage()}\n${cliText('cli.new.error.templateMissing', {})}`);
            }
            template = value;
            index += 1;
        } else if (argument === '--lang') {
            const value = args[index + 1];
            if (!value || !languageTagPattern.test(value)) {
                throw new Error(`${usage()}\n${cliText('cli.new.error.invalidLanguage', {})}`);
            }
            lang = value;
            index += 1;
        } else if (argument.startsWith('-')) {
            throw new Error(`${usage()}\n${cliText('cli.new.error.unknownOption', { option: argument })}`);
        } else if (target === undefined) {
            target = argument;
        } else {
            throw new Error(`${usage()}\n${cliText('cli.new.error.multipleTargets', {})}`);
        }
    }

    if (target === undefined) {
        throw new Error(usage());
    }
    return { target, template, lang };
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
    const text = (key, params) => cliText(key, params);
    const log = options.log ?? ((line) => console.log(line));
    const logError = options.logError ?? ((line) => console.error(line));
    const cwd = options.cwd ?? process.cwd();
    const assets = options.assets ?? resolveLauncherAssets();

    if (args.includes('--help') || args.includes('-h')) {
        log(usage());
        return { exitCode: 0 };
    }

    let parsed;
    try {
        parsed = parseArguments(args);
    } catch (error) {
        logError(error instanceof Error ? error.message : String(error));
        return { exitCode: 1 };
    }

    const { target, template, lang } = parsed;
    const targetDir = path.resolve(cwd, target);
    const templateDir = template ? path.resolve(cwd, template) : assets.templateDir;

    if (!templateDir) {
        logError(text('cli.new.error.templateUnavailable'));
        return { exitCode: 1 };
    }

    try {
        const templateStat = await fs.stat(templateDir);
        if (!templateStat.isDirectory()) {
            throw new Error('not a directory');
        }
    } catch {
        logError(text('cli.new.error.templateNotFound', { path: templateDir }));
        return { exitCode: 1 };
    }

    const skillsSourceDir = assets.skillsSourceDir;
    const hasSkills = await directoryHasFile(skillsSourceDir, 'analyze-footage/SKILL.md');
    if (!hasSkills) {
        logError(text('cli.new.warning.skillsMissing', { path: skillsSourceDir ?? text('cli.new.label.undetected') }));
    }
    const schemasSourceDir = assets.schemasSourceDir;
    const hasSchemas = await directoryHasFile(schemasSourceDir, 'analysis.schema.json');

    if (!assets.scaffoldModulePath && !options.createProject) {
        logError(text('cli.new.error.scaffoldMissing'));
        return { exitCode: 1 };
    }

    try {
        const createProject = options.createProject ?? await defaultCreateProject(assets.scaffoldModulePath);
        const result = await createProject(targetDir, templateDir, hasSkills
            ? { skillsSourceDir, schemasSourceDir: hasSchemas ? schemasSourceDir : undefined }
            : {});
        if (lang) {
            const intakePath = path.join(targetDir, '.akari', 'intake.json');
            const intake = JSON.parse(await fs.readFile(intakePath, 'utf8'));
            intake.language = lang;
            await fs.writeFile(intakePath, `${JSON.stringify(intake, null, 2)}\n`, 'utf8');
        }
        log(text('cli.new.result.created', { path: result.destination }));
        log(text('cli.new.result.copied', { count: result.copy.copiedFiles.length, n: result.copy.copiedFiles.length }));
        log(text('cli.new.result.fallback', { count: result.fallback.writtenFiles.length, n: result.fallback.writtenFiles.length }));
        log(text('cli.new.result.symlinks', { count: result.copy.skippedSymlinks.length, n: result.copy.skippedSymlinks.length }));
        log(text('cli.new.result.skills', { status: hasSkills ? text('cli.new.label.included', { path: skillsSourceDir }) : text('cli.new.label.skipped') }));
        log(`git: ${result.git.action}`);
        log(text('cli.new.result.report', { path: result.reportPath }));
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
