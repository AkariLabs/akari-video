// Exercises the pure edit-asset-path helper (apps/shell/extensions/akari-preview/src/common/
// edit-asset-path.ts) against its compiled output, independent of the Electron/Theia runtime.
// Run: `npm run build` (or `tsc -b`) in this extension first, then `node --test test/*.test.mjs`
// from apps/shell/extensions/akari-preview/ — see package.json's "test" script for the combined
// command. createRequire is used (not a static ESM import) so this doesn't depend on Node's
// cjs-module-lexer correctly inferring named exports from the tsc-emitted CommonJS output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    classifyEditAssetPath,
    windowsDriveToFileUriString,
    uncToFileUriString
} = require('../lib/common/edit-asset-path.js');

test('classifyEditAssetPath: file: scheme', () => {
    assert.equal(classifyEditAssetPath('file:///Users/a/clip.mp4'), 'file-uri');
    assert.equal(classifyEditAssetPath('file://server/share/clip.mp4'), 'file-uri');
});

test('classifyEditAssetPath: Windows drive-letter absolute (P0 case)', () => {
    assert.equal(classifyEditAssetPath('C:\\Users\\a\\clip.mp4'), 'windows-drive');
    assert.equal(classifyEditAssetPath('C:/Users/a/clip.mp4'), 'windows-drive');
    assert.equal(classifyEditAssetPath('D:\\media\\clip.mov'), 'windows-drive');
    assert.equal(classifyEditAssetPath('z:\\lowercase-drive.mp4'), 'windows-drive');
});

test('classifyEditAssetPath: UNC path (P0 case)', () => {
    assert.equal(classifyEditAssetPath('\\\\server\\share\\path\\clip.mp4'), 'unc');
    assert.equal(classifyEditAssetPath('\\\\my-nas\\Media Library\\clip.mp4'), 'unc');
});

test('classifyEditAssetPath: POSIX absolute', () => {
    assert.equal(classifyEditAssetPath('/Users/a/clip.mp4'), 'posix-absolute');
    assert.equal(classifyEditAssetPath('/Volumes/External/clip.mov'), 'posix-absolute');
});

test('classifyEditAssetPath: relative (edit.json canon)', () => {
    assert.equal(classifyEditAssetPath('assets/clip.mp4'), 'relative');
    assert.equal(classifyEditAssetPath('../assets/clip.mp4'), 'relative');
    assert.equal(classifyEditAssetPath('clip.mp4'), 'relative');
});

test('classifyEditAssetPath: drive-relative "C:foo" (no separator) is not absolute', () => {
    // Windows drive-relative paths (no \ or / right after the colon) resolve against the
    // process's per-drive working directory, not a fixed absolute location — deliberately not
    // treated as absolute here, matching the P0 regex the task contract specifies.
    assert.equal(classifyEditAssetPath('C:foo\\bar.mp4'), 'relative');
});

test('windowsDriveToFileUriString: canonical form, colon left unencoded', () => {
    assert.equal(windowsDriveToFileUriString('C:\\Users\\a\\clip.mp4'), 'file:///C:/Users/a/clip.mp4');
    assert.equal(windowsDriveToFileUriString('C:/Users/a/clip.mp4'), 'file:///C:/Users/a/clip.mp4');
});

test('windowsDriveToFileUriString: percent-encodes spaces and other special characters', () => {
    assert.equal(
        windowsDriveToFileUriString('C:\\Users\\a\\my clip (final).mp4'),
        'file:///C:/Users/a/my%20clip%20(final).mp4'
    );
});

test('windowsDriveToFileUriString: bare drive root', () => {
    assert.equal(windowsDriveToFileUriString('D:\\'), 'file:///D:/');
});

test('uncToFileUriString: canonical form (server becomes authority)', () => {
    assert.equal(
        uncToFileUriString('\\\\server\\share\\path\\clip.mp4'),
        'file://server/share/path/clip.mp4'
    );
});

test('uncToFileUriString: percent-encodes spaces in share/path segments', () => {
    assert.equal(
        uncToFileUriString('\\\\my-nas\\Media Library\\clip.mp4'),
        'file://my-nas/Media%20Library/clip.mp4'
    );
});
