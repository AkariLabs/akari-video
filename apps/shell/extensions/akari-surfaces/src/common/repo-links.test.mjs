import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import test from 'node:test';
import { AKARI_VIDEO_LICENSE_URL, AKARI_VIDEO_NEW_ISSUE_URL, AKARI_VIDEO_REPO_URL } from '../../lib/common/repo-links.js';

const repoRoot = fileURLToPath(new URL('../../../../../../', import.meta.url));
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const ignoredDirectories = new Set(['node_modules', 'lib', 'generated']);
const directories = path => existsSync(path)
    ? readdirSync(path, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => join(path, entry.name))
    : [];

test('public repository links point to the canonical AkariLabs repository and its LICENSE', () => {
    assert.equal(AKARI_VIDEO_REPO_URL, 'https://github.com/AkariLabs/akari-video');
    assert.equal(AKARI_VIDEO_NEW_ISSUE_URL, 'https://github.com/AkariLabs/akari-video/issues/new');
    assert.equal(AKARI_VIDEO_LICENSE_URL, 'https://github.com/AkariLabs/akari-video/blob/main/LICENSE');
    assert.ok(existsSync(join(repoRoot, 'LICENSE')), 'repository LICENSE exists');
});

test('application and package sources contain no obsolete akari-video GitHub owner', () => {
    const roots = [
        ...directories(join(repoRoot, 'apps')).flatMap(app =>
            directories(join(app, 'extensions')).map(extension => join(extension, 'src'))),
        ...directories(join(repoRoot, 'packages')).map(pkg => join(pkg, 'src'))
    ];
    const hits = [];
    function visit(directory) {
        if (!existsSync(directory)) { return; }
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
            const path = join(directory, entry.name);
            if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) {
                visit(path);
            } else if (entry.isFile() && sourceExtensions.has(entry.name.slice(entry.name.lastIndexOf('.')))
                && /github\.com\/akari-video\//i.test(readFileSync(path, 'utf8'))) {
                hits.push(relative(repoRoot, path));
            }
        }
    }
    for (const root of roots) { visit(root); }
    assert.deepEqual(hits, [], `obsolete repository URLs in: ${hits.join(', ')}`);
});

test('settings dialog uses shared repository links', () => {
    const dialog = readFileSync(new URL('../browser/akari-settings-dialog.ts', import.meta.url), 'utf8');
    assert.doesNotMatch(dialog, /['"`]https:\/\/github\.com\/(?:AkariLabs\/akari-video|akari-video\/)/i);
    assert.match(dialog, /from ['"]\.\.\/common\/repo-links['"]/);
});
