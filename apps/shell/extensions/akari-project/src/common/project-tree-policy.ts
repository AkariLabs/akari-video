export interface ProjectTreePolicy {
    hidden: string[];
    sidecarSuffixes: string[];
}

export interface ProjectRole {
    path: string;
    label: string;
}

export function shouldShowProjectPath(relativePath: string | undefined, policy: ProjectTreePolicy, developerMode: boolean): boolean {
    if (developerMode || !relativePath) {
        return true;
    }
    const segments = relativePath.split('/');
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
