import type { PartnerAgentId } from './akari-partner-protocol';

export type PartnerPermissionMode = 'auto' | 'ask' | 'bypass';
export type PartnerAppliedPermissionMode = PartnerPermissionMode | 'default';

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
    const table = mode === 'bypass' ? BYPASS_ARGS : AUTO_ARGS;
    return (Object as ObjectConstructor & { hasOwn(value: object, key: PropertyKey): boolean }).hasOwn(table, agent)
        ? [...table[agent]!] : [];
}

export function partnerPermissionEnv(agent: PartnerAgentId, mode: PartnerPermissionMode): Record<string, string> {
    return agent === 'deepseek' && mode === 'bypass' ? { DSH_PERMISSION_MODE: 'danger-full-access' } : {};
}

export function appliedPartnerPermissionMode(agent: PartnerAgentId, mode: PartnerPermissionMode,
    args: readonly string[], env: Record<string, string> = partnerPermissionEnv(agent, mode)): PartnerAppliedPermissionMode {
    if (agent === 'pi') return 'bypass';
    if (args.length === 0 && Object.keys(env).length === 0) return 'default';
    if (mode === 'bypass' || (mode === 'auto' && ['copilot', 'antigravity', 'commandcode'].includes(agent))) return 'bypass';
    return 'auto';
}
