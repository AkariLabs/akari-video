import { cliText } from './i18n.mjs';
import { runPlaybookCommand } from './playbook-command.mjs';

/** The template spelling shares export and list implementations with playbook. */
export async function runTemplateCommand(args, options = {}) {
    const usage = cliText('cli.template.help.usage');
    const log = options.log ?? console.log;
    const error = options.error ?? console.error;
    const [action, ...rest] = args;
    if (action === '--help' || action === '-h' || args.includes('--help') || args.includes('-h')) {
        log(usage);
        return { exitCode: 0 };
    }
    if (action !== 'export' && action !== 'list') {
        error(usage);
        return { exitCode: 1 };
    }
    return runPlaybookCommand([action === 'export' ? 'template' : 'list', ...rest], {
        ...options, usage, listDepth: action === 'list' ? 3 : undefined, suppressTemplateAliasNotice: true
    });
}
