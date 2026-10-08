import type { PartnerAgentId } from './akari-partner-protocol';

export type PartnerPermissionMode = 'auto' | 'ask' | 'bypass';

export function normalizePartnerPermissionMode(value: unknown): PartnerPermissionMode {
    return value === 'ask' || value === 'bypass' ? value : 'auto';
}

const AUTO_ARGS: Partial<Record<PartnerAgentId, string[]>> = {
    claude: ['--permission-mode', 'auto'], codex: ['--approve-for-me'],
    grok: ['--permission-mode', 'auto'], devin: ['--permission-mode', 'smart'],
    cursor: ['--auto-review'], copilot: ['--allow-all'],
    antigravity: ['--dangerously-skip-permissions'], commandcode: ['--yolo'], pi: ['--approve']
};
const BYPASS_ARGS: Partial<Record<PartnerAgentId, string[]>> = {
    claude: ['--dangerously-skip-permissions'], codex: ['--dangerously-bypass-approvals-and-sandbox'],
    grok: ['--always-approve'], devin: ['--permission-mode', 'bypass'],
    cursor: ['--yolo'], copilot: ['--allow-all'], antigravity: ['--dangerously-skip-permissions'],
    commandcode: ['--yolo'], opencode: ['--auto'], pi: ['--approve']
};

export function partnerPermissionArgs(agent: PartnerAgentId, mode: PartnerPermissionMode): string[] {
    if (mode === 'ask') return [];
    return [...((mode === 'bypass' ? BYPASS_ARGS[agent] : AUTO_ARGS[agent]) ?? [])];
}

export function partnerPermissionEnv(agent: PartnerAgentId, mode: PartnerPermissionMode): Record<string, string> {
    return agent === 'deepseek' && mode === 'bypass' ? { DSH_PERMISSION_MODE: 'danger-full-access' } : {};
}

export function appliedPartnerPermissionMode(agent: PartnerAgentId, mode: PartnerPermissionMode, args: readonly string[]): PartnerPermissionMode {
    if (mode === 'ask' || (partnerPermissionArgs(agent, mode).length > 0 && args.length === 0)) return 'ask';
    if (mode === 'bypass' || (mode === 'auto' && ['copilot', 'antigravity', 'commandcode', 'pi'].includes(agent))) return 'bypass';
    return 'auto';
}
