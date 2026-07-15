export interface ProjectTreePolicy {
    hidden: string[];
    sidecarSuffixes: string[];
}

export interface ProjectRole {
    path: string;
    label: string;
}

const BUILT_IN_HIDDEN_ENTRIES = ['.gitkeep'];

export function shouldShowProjectPath(relativePath: string | undefined, policy: ProjectTreePolicy, developerMode: boolean): boolean {
    if (developerMode || !relativePath) {
        return true;
    }
    const segments = relativePath.split('/');
    if (BUILT_IN_HIDDEN_ENTRIES.some(entry => segments.includes(entry))) {
        return false;
    }
    if (policy.hidden.some(entry => relativePath === entry || segments.includes(entry))) {
        return false;
    }
    return !policy.sidecarSuffixes.some(suffix => relativePath.endsWith(suffix));
}

export function localizedRoleLabel(relativePath: string | undefined, roles: ProjectRole[], developerMode: boolean): string | undefined {
    if (developerMode || !relativePath) {
        return undefined;
    }
    return roles.find(role => role.path === relativePath)?.label;
}
