import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const path = fileURLToPath(new URL('../src/browser/akari-annotations-contribution.ts', import.meta.url));
const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
const helper = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'shouldSkipSceneEditSearch');
const contribution = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariAnnotationsContribution');
assert.ok(helper);
assert.ok(contribution);
const methods = ['resolveProjectLocations', 'findFirstNamed'].map(name => {
    const member = contribution.members.find(node => node.name?.getText(source) === name);
    assert.ok(member, name);
    return member.getText(source);
});
const code = ts.transpileModule(`${helper.getText(source).replace(/^export /u, '')}\nclass Resolver { ${methods.join('\n')} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;
const { Resolver, shouldSkipSceneEditSearch } = new Function(
    'isSkippedSearchDirectory', 'sortTimelineEditFileNames', 'isTimelineEditFileName', 'timelineSlugFromEditFileName',
    'timelineDisplayName', 'timelineCaptionsFileName', 'timelineReviewFileName',
    `${code}\nreturn { Resolver, shouldSkipSceneEditSearch };`
)(name => name.startsWith('.') || name === 'node_modules', names => names.sort(), name => name === 'edit.json',
    () => undefined, () => 'Timeline', () => 'captions.json', () => 'review.json');

class FakeUri {
    constructor(value) { this.value = value; }
    get path() { return { base: this.value.split('/').at(-1) }; }
    get parent() { return new FakeUri(this.value.slice(0, this.value.lastIndexOf('/'))); }
    resolve(name) { return new FakeUri(`${this.value}/${name}`); }
    toString() { return this.value; }
}

function fixture(files, root = '/root') {
    const directories = new Set([root]);
    for (const file of files) {
        const parts = file.split('/');
        for (let i = 1; i < parts.length; i++) directories.add(`${root}/${parts.slice(0, i).join('/')}`);
    }
    const allFiles = new Set(files.map(file => `${root}/${file}`));
    const entries = [...directories, ...allFiles];
    const resolver = new Resolver();
    resolver.workspaceService = { roots: Promise.resolve([{ resource: new FakeUri(root) }]) };
    resolver.findFirstCanonicalAnalysis = async () => undefined;
    resolver.fileService = { resolve: async uri => {
        const key = uri.toString();
        if (allFiles.has(key)) return { resource: uri, isFile: true, isDirectory: false };
        if (!directories.has(key)) throw new Error(`Unknown path: ${key}`);
        const children = entries.filter(entry => entry !== key && entry.slice(0, entry.lastIndexOf('/')) === key)
            .map(entry => ({ resource: new FakeUri(entry), isFile: allFiles.has(entry), isDirectory: directories.has(entry) }));
        return { resource: uri, isFile: false, isDirectory: true, children };
    } };
    return resolver;
}

test('pure scene search decision distinguishes a direct edit from a scene root', () => {
    const file = name => ({ name, isFile: true, isDirectory: false });
    const dir = name => ({ name, isFile: false, isDirectory: true });
    assert.equal(shouldSkipSceneEditSearch([file('edit.json')]), false);
    assert.equal(shouldSkipSceneEditSearch([dir('scenes')]), true);
    assert.equal(shouldSkipSceneEditSearch([file('edit.json'), dir('scenes')]), false);
});

test('one-project root, scene-owning root, and scene folder resolve their own timelines', async () => {
    const cases = [
        ['/single', ['edit.json'], '/single/edit.json'],
        ['/project', ['scenes/s01/edit.json', 'scenes/s02/edit.json'], undefined],
        ['/project/scenes/s01', ['edit.json', 'assets/clip.mp4'], '/project/scenes/s01/edit.json']
    ];
    for (const [root, files, expected] of cases) {
        const locations = await fixture(files, root).resolveProjectLocations();
        assert.equal(locations.length, 1);
        assert.equal(locations[0].editUri?.toString(), expected);
    }
});
