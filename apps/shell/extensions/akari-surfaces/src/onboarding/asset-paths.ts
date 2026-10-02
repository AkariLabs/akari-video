import { dirname, join } from 'path';

const WELCOME_IMAGE = join('src', 'onboarding', 'welcome.webp');
export const BEFORE_AFTER_IMAGE = join('src', 'onboarding', 'before-after.webp');

/** The backend bundle and the extension source live in different places inside an asar and a checkout. */
export function welcomeImageCandidates(backendDir: string, cwd: string, resourcesPath?: string): string[] {
    const candidates: string[] = [];
    if (resourcesPath) candidates.push(join(resourcesPath, 'app.asar', 'node_modules', 'akari-surfaces', WELCOME_IMAGE));
    for (const start of [backendDir, cwd]) {
        let current = start;
        for (let index = 0; index < 12; index++) {
            candidates.push(join(current, 'node_modules', 'akari-surfaces', WELCOME_IMAGE));
            candidates.push(join(current, 'extensions', 'akari-surfaces', WELCOME_IMAGE));
            const parent = dirname(current);
            if (parent === current) break;
            current = parent;
        }
    }
    return [...new Set(candidates)];
}
