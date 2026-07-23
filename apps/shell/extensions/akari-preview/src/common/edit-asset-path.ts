/**
 * Pure, platform-independent classification and file-URI-string construction for edit.json
 * asset path values (edit.source.path, audio bgm/sfx/narration path, layers[].src, etc).
 *
 * Kept dependency-free (no `@theia/core` URI, no Node `path`/`fs`) so the branching logic can be
 * unit tested with `node --test` against the compiled output, independent of the Electron/Theia
 * runtime and of the host OS's own path conventions. `resolveEditAssetUri()` in
 * `akari-preview-open-handler.ts` is the single call site that wraps this into a `URI` object;
 * it used to duplicate this branching inline in two places (edit.source.path / edit.layers[].src
 * resolution and audio bgm/sfx/narration path resolution).
 */

export type EditAssetPathKind = 'file-uri' | 'windows-drive' | 'unc' | 'posix-absolute' | 'relative';

// Matches "C:\..." and "C:/..." (a bare drive letter followed by either separator).
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;

/**
 * Classifies an edit.json path value in the order the P0 fix requires: `file:` scheme first
 * (already a URI), then Windows drive-letter absolute, then UNC, then POSIX absolute, and
 * finally relative (resolved against the edit.json's parent directory by the caller).
 */
export function classifyEditAssetPath(pathValue: string): EditAssetPathKind {
    if (pathValue.startsWith('file:')) {
        return 'file-uri';
    }
    if (WINDOWS_DRIVE_PATTERN.test(pathValue)) {
        return 'windows-drive';
    }
    if (pathValue.startsWith('\\\\')) {
        return 'unc';
    }
    if (pathValue.startsWith('/')) {
        return 'posix-absolute';
    }
    return 'relative';
}

function encodeSegments(pathPart: string): string {
    return pathPart
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
}

/**
 * Converts a Windows drive-letter absolute path ("C:\Users\a\b.mp4" or "C:/Users/a/b.mp4") into
 * a canonical `file:///C:/...` URI string, percent-encoding everything but the drive letter and
 * colon (which stay literal, matching the de facto `file:///C:/...` convention used by browsers,
 * Node's `pathToFileURL`, and VS Code).
 */
export function windowsDriveToFileUriString(pathValue: string): string {
    const normalized = pathValue.replace(/\\/g, '/');
    const separatorIndex = normalized.indexOf('/');
    const drive = separatorIndex === -1 ? normalized : normalized.slice(0, separatorIndex);
    const rest = separatorIndex === -1 ? '' : normalized.slice(separatorIndex + 1);
    const encodedRest = encodeSegments(rest);
    return `file:///${drive}${encodedRest ? `/${encodedRest}` : '/'}`;
}

/**
 * Converts a UNC path ("\\server\share\path\clip.mp4") into a canonical
 * `file://server/share/path/clip.mp4` URI string (the server name becomes the URI authority).
 */
export function uncToFileUriString(pathValue: string): string {
    const withoutPrefix = pathValue.slice(2).replace(/\\/g, '/');
    return `file://${encodeSegments(withoutPrefix)}`;
}
