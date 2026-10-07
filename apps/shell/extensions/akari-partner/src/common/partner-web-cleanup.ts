function normalizedWorkspacePath(value: string): string | undefined {
    let path = value;
    if (/^file:\/\//i.test(value)) {
        try {
            const uri = new URL(value);
            path = decodeURIComponent(uri.pathname);
            if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
            if (uri.hostname && uri.hostname !== 'localhost') path = `//${uri.hostname}${path}`;
        } catch { return undefined; }
    }
    path = path.replace(/\\/g, '/');
    while (path.length > 1 && path.endsWith('/') && !/^[A-Za-z]:\/$/.test(path)) path = path.slice(0, -1);
    return /^[A-Za-z]:\//.test(path) || path.startsWith('//') ? path.toLowerCase() : path;
}

export function shouldDisposeWebWidget(input: {
    hasLaunch: boolean;
    starting: boolean;
    launchCwd?: string;
    roots: readonly string[];
}): boolean {
    if (input.starting) return false;
    if (!input.hasLaunch) return true;
    const cwd = input.launchCwd && normalizedWorkspacePath(input.launchCwd);
    return !cwd || !input.roots.some(root => normalizedWorkspacePath(root) === cwd);
}
