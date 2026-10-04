import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const source = ts.createSourceFile('service.ts',
    readFileSync(new URL('../src/node/akari-project-service.ts', import.meta.url), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const service = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariProjectServiceImpl');
const method = service.members.find(member => member.name?.getText(source) === 'resolveDeclaredAssetPaths');
const code = ts.transpileModule('class Harness { ' + method.getText(source) + ' }',
    { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } }).outputText;
const Harness = new Function('isAbsolute', 'join', 'pathToFileURL', code + '\nreturn Harness;')(
    isAbsolute, join, pathToFileURL);
const resolverSrc = fileURLToPath(new URL('../../../../../packages/asset-resolver/src/', import.meta.url));

async function fixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'resolve-declared-'));
    const project = join(root, 'project');
    const library = join(root, 'library');
    const home = join(root, 'home');
    await mkdir(join(project, '.akari'), { recursive: true });
    await mkdir(home);
    const names = ['AKARI_HOME', 'AKARI_LIBRARY_ROOT', 'HOME', 'USERPROFILE', 'TEMP', 'TMP'];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    Object.assign(process.env, {
        AKARI_HOME: home, AKARI_LIBRARY_ROOT: library,
        HOME: home, USERPROFILE: home, TEMP: home, TMP: home,
    });
    t.after(async () => {
        for (const name of names) {
            if (previous[name] === undefined) delete process.env[name];
            else process.env[name] = previous[name];
        }
        await rm(root, { recursive: true, force: true });
    });
    const references = [{ category: 'still', id: 'sample' }, { category: 'audio', id: 'music' }];
    await writeFile(join(project, '.akari', 'asset-references.json'), JSON.stringify({ version: 0, references }));
    const assets = [
        ['assets/still/sample/broll.png', 'still/sample/broll.png'],
        ['assets/audio/music/sound.wav', 'audio/music/sound.wav'],
    ];
    for (const [, relative] of assets) {
        const actual = join(library, relative);
        await mkdir(join(actual, '..'), { recursive: true });
        await writeFile(actual, relative);
    }
    const instance = new Harness();
    let scriptCalls = 0;
    let findCalls = 0;
    instance.isReadableFile = async path => stat(path).then(value => value.isFile()).catch(() => false);
    instance.findAssetResolverSrcDir = async () => { findCalls++; return resolverSrc; };
    instance.runResolverScript = async () => { scriptCalls++; throw new Error('子プロセスは不要'); };
    return {
        project, library, instance, assets,
        get scriptCalls() { return scriptCalls; },
        get findCalls() { return findCalls; },
        setResolverDir(path) { instance.findAssetResolverSrcDir = async () => { findCalls++; return path; }; },
        setScriptResult(result) { instance.runResolverScript = async () => { scriptCalls++; return result; }; },
    };
}

test('参照台帳の素材を実 resolver で解決し、子プロセスを起こさない', async t => {
    const f = await fixture(t);
    const [declared, relative] = f.assets[0];
    const result = await f.instance.resolveDeclaredAssetPaths(f.project,
        [declared, declared, 'assets/still/unlisted/missing.png', 'assets/still/sample/../../outside.png']);
    assert.deepEqual([...result], [[declared, join(f.library, relative)]]);
    assert.equal(f.scriptCalls, 0);
    assert.equal(f.instance.assetResolverImports.size, 1);
});

test('複数件を同時に頼んでも in-process の Promise を共有する', async t => {
    const f = await fixture(t);
    const [first, second] = await Promise.all(f.assets.map(([declared]) =>
        f.instance.resolveDeclaredAssetPaths(f.project, [declared])));
    assert.equal(first.get(f.assets[0][0]), join(f.library, f.assets[0][1]));
    assert.equal(second.get(f.assets[1][0]), join(f.library, f.assets[1][1]));
    assert.equal(f.scriptCalls, 0);
    assert.equal(f.instance.assetResolverImports.size, 1);
});

test('ESM の import が失敗した場合だけ従来の script に戻る', async t => {
    const f = await fixture(t);
    const [declared, relative] = f.assets[0];
    f.setResolverDir(join(f.library, 'missing-resolver'));
    f.setScriptResult({ code: 0, stdout: JSON.stringify({ [declared]: join(f.library, relative) }), stderr: '' });
    assert.equal((await f.instance.resolveDeclaredAssetPaths(f.project, [declared])).get(declared),
        join(f.library, relative));
    assert.equal(f.scriptCalls, 1);
});

test('全素材がローカルにあれば resolver も script も呼ばない', async t => {
    const f = await fixture(t);
    const declared = 'assets/still/sample/local.png';
    const local = join(f.project, declared);
    await mkdir(join(local, '..'), { recursive: true });
    await writeFile(local, 'local');
    assert.deepEqual([...await f.instance.resolveDeclaredAssetPaths(f.project, [declared, local])], []);
    assert.equal(f.findCalls, 0);
    assert.equal(f.scriptCalls, 0);
});
