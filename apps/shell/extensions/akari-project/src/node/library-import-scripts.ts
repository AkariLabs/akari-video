import { resolve } from 'path';
import { pathToFileURL } from 'url';

const moduleUrl = (src: string, path: string): string => JSON.stringify(pathToFileURL(resolve(src, path)).toString());
// Use stdin for plans: a 5,000-file plan exceeds OS command-line limits.
export function libraryImportScript(src: string, operation: 'plan' | 'apply'): string {
    return `
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { planAdd, applyAdd } from ${moduleUrl(src, 'add.mjs')};
let input = ''; for await (const chunk of process.stdin) input += chunk;
const result = await ${operation === 'plan' ? 'planAdd' : 'applyAdd'}(JSON.parse(input));
for (const item of result.duplicates) {
    try { const meta = JSON.parse(await readFile(join(item.libraryDir, 'meta.json'), 'utf8'));
        if (typeof meta.title === 'string') item.title = meta.title;
    } catch { /* Missing metadata keeps the existing id visible. */ }
}
process.stdout.write(JSON.stringify(result));
`;
}

export function libraryPacksScript(src: string): string {
    return `
import { resolveAssetLibraryRoots } from ${moduleUrl(src, '../../creator-root/src/index.mjs')};
process.stdout.write(JSON.stringify(resolveAssetLibraryRoots(process.env).read));
`;
}

/** Temporary preview only; never creates library entries or writes beside the source. */
export function libraryImportWaveformScript(src: string): string {
    return `
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateWaveformPreview } from ${moduleUrl(src, '../../audio-library-setup/shared/waveform-preview.mjs')};
let input = ''; for await (const chunk of process.stdin) input += chunk;
const temporary = await mkdtemp(join(tmpdir(), 'akari-import-waveform-'));
try {
    const output = join(temporary, 'preview.png');
    const result = generateWaveformPreview(JSON.parse(input), output);
    process.stdout.write(JSON.stringify(result.ok ? { image: 'data:image/png;base64,' + (await readFile(output)).toString('base64') } : { error: result.reason }));
} finally { await rm(temporary, { recursive: true, force: true }); }
`;
}
