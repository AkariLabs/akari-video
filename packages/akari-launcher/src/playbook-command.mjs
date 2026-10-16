import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { cliText } from './i18n.mjs';
import { resolveLauncherAssets } from './repo-assets.mjs';

const usage = () => cliText('cli.playbook.help.usage');
const safeChannel = value => typeof value === 'string' && value.trim() && value.length <= 64
    && value !== '.' && !value.includes('..') && !/[/\\<>:"|?*\x00-\x1f]/.test(value);

function parse(args) {
    const action = args[0];
    if (action === '--help' || action === '-h' || args.includes('--help') || args.includes('-h')) return { action: 'help' };
    if (!['list', 'apply'].includes(action)) throw new Error(usage());
    const result = { action, id: action === 'apply' ? args[1] : null };
    if (action === 'apply' && (!result.id || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(result.id))) throw new Error(usage());
    for (let i = action === 'apply' ? 2 : 1; i < args.length; i++) {
        const arg = args[i];
        if ((action === 'list' && arg === '--json') || (action === 'apply' && arg === '--dry-run')) {
            result[arg.slice(2).replace('-', '')] = true;
        } else if ((action === 'list' && ['--category', '--tag', '--channel'].includes(arg))
            || (action === 'apply' && arg === '--into')) {
            if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(usage());
            result[arg.slice(2)] = args[++i];
        } else throw new Error(usage());
    }
    if (action === 'apply' && !result.into) throw new Error(usage());
    if (result.channel && !safeChannel(result.channel)) throw new Error(usage());
    return result;
}

export async function runPlaybookCommand(args, options = {}) {
    const log = options.log ?? console.log;
    const error = options.error ?? console.error;
    let parsed;
    try { parsed = parse(args); }
    catch (cause) { error(cause.message); return { exitCode: 1 }; }
    if (parsed.action === 'help') { log(usage()); return { exitCode: 0 }; }
    try {
        const env = options.env ?? process.env;
        const cwd = options.cwd ?? process.cwd();
        const assets = options.assets ?? resolveLauncherAssets();
        if (!assets.scaffoldModulePath) throw new Error(cliText('cli.playbook.error.scaffoldMissing'));
        const scaffold = await import(pathToFileURL(assets.scaffoldModulePath).href);
        const akariHome = env.AKARI_HOME || path.join(options.home ?? os.homedir(), '.akari');
        const projectDir = parsed.into ? path.resolve(cwd, parsed.into) : null;
        let root = null;
        if (assets.creatorRootModulePath) {
            const creator = await import(pathToFileURL(assets.creatorRootModulePath).href);
            root = await creator.resolveCreatorRoot({ cwd: projectDir ?? cwd, env });
            if (root?.error) throw root.error;
        }
        let channel = parsed.channel;
        if (!channel && projectDir && root) {
            const segments = path.relative(root.rootDir, projectDir).split(path.sep);
            channel = segments[0] === 'channels' && root.manifest?.channels?.includes(segments[1])
                ? segments[1] : root.manifest?.channels?.[0];
        }
        const channelDir = root && channel
            ? path.join(root.rootDir, 'channels', channel, 'playbooks') : undefined;
        const entries = await scaffold.listPlaybooks({ akariHome, channelDir,
            category: parsed.category, tag: parsed.tag,
            onWarning: (dir, cause) => error(cliText('cli.playbook.warning.broken', { dir, message: cause.message })) });
        if (parsed.action === 'list') {
            if (parsed.json) log(JSON.stringify(entries));
            else for (const entry of entries) log(cliText('cli.playbook.list.row', { id: entry.id, name: entry.name,
                category: entry.category, source: entry.source,
                duration: entry.targetDurationSec ?? cliText('cli.playbook.list.durationUnknown') }));
            return { exitCode: 0, entries };
        }
        const entry = entries.find(item => item.id === parsed.id);
        if (!entry) throw new Error(cliText('cli.playbook.error.notFound', { id: parsed.id }));
        const result = await scaffold.applyPlaybookToExisting({ projectDir, playbookDir: entry.dir, dryRun: parsed.dryrun });
        log(cliText(parsed.dryrun ? 'cli.playbook.apply.dryRun' : 'cli.playbook.apply.applied', {
            name: entry.name, changes: result.changes.join('、') || cliText('cli.playbook.apply.noChanges'), report: result.reportPath
        }));
        return { exitCode: 0, ...result };
    } catch (cause) { error(cause.message); return { exitCode: 1 }; }
}
