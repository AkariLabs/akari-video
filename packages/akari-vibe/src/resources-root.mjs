import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// packages/akari-vibe/src has the same position in a checkout and in Resources.
const relativeRoot = fileURLToPath(new URL('../../../', import.meta.url));
// Only the internal lab contains judge-server; exported bin/live/src trees do not.
const internalLab = fs.existsSync(new URL('../judge-server/', import.meta.url));
let defaultLabRoot;
export function labPublicRepo() {
    if (!internalLab) return null;
    // Resolve the account's home, not the temporary HOME used by offline checks.
    // Keep this Node-only lookup lazy: the judgment bundle uses a virtual FS and
    // never enters the internal-lab fallback.
    if (!defaultLabRoot) {
        try {
            const {publicRepo} = JSON.parse(fs.readFileSync(new URL('../lab-public-repo.local.json', import.meta.url), 'utf8'));
            if (typeof publicRepo !== 'string' || !publicRepo.trim()) return null;
            const os = process.getBuiltinModule('os');
            defaultLabRoot = path.resolve(os.userInfo().homedir, publicRepo);
        } catch { return null; }
    }
    return fs.existsSync(defaultLabRoot) ? defaultLabRoot : null;
}

export function resourcesRoot(env = process.env) {
    if (env.AKARI_PUBLIC_REPO && ['presets', 'skills', 'assets'].some(name => fs.existsSync(path.join(env.AKARI_PUBLIC_REPO, name)))) {
        return env.AKARI_PUBLIC_REPO;
    }
    // Internal assets alone do not make the internal repository a public root.
    if (fs.existsSync(path.join(relativeRoot, 'presets'))) return relativeRoot;
    return labPublicRepo();
}
export function resourcePath(...parts) {
    const root = resourcesRoot();
    return root ? path.join(root, ...parts) : null;
}
