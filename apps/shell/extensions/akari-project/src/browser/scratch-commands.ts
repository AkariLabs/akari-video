import { injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';

export const SCRATCH_LIST_COMMAND = 'akari.scratch.list';

@injectable()
export class ScratchCommands implements CommandContribution {
    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: SCRATCH_LIST_COMMAND }, { execute: async (args?: unknown) => {
            if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args)
                || Object.keys(args).some(key => key !== 'status')
                || (args as { status?: unknown }).status !== undefined && (args as { status?: unknown }).status !== 'ready')) return [];
            const items = await window.electronAkariProject?.scratch?.list() ?? [];
            return (args as { status?: string } | undefined)?.status === 'ready' ? items.filter(item => item.status === 'ready') : items;
        } });
    }
}
