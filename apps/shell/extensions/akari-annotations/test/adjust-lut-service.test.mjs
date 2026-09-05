import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';

test('LUT import validates inputs, preserves bytes and never overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adjust-luts-'));
  try {
    const service = new AkariAnnotationsServiceImpl();
    const project = join(root, 'project');
    await mkdir(project);
    const projectRootUri = pathToFileURL(project).toString();
    assert.deepEqual(await service.listAdjustLuts({ projectRootUri }), { refs: [] });
    const sourcePath = join(root, 'My look.CUBE');
    const data = '# title\nLUT_3D_SIZE 2\n0 0 0\n';
    await writeFile(sourcePath, data);
    const request = { projectRootUri, sourcePath };
    assert.deepEqual(await service.importAdjustLut(request), { ref: 'assets/luts/My-look.cube' });
    assert.deepEqual(await service.importAdjustLut(request), { ref: 'assets/luts/My-look-2.cube' });
    assert.equal(await readFile(join(project, 'assets/luts/My-look.cube'), 'utf8'), data);
    for (const [name, text] of [['bad.txt', data], ['large.cube', 'x'.repeat(9 * 1024 * 1024)],
      ['size.cube', 'LUT_3D_SIZE 66'], ['missing.cube', '# no header'],
      ['late.cube', '\n'.repeat(64) + 'LUT_3D_SIZE 2']]) {
      const invalid = join(root, name);
      await writeFile(invalid, text);
      await assert.rejects(service.importAdjustLut({ projectRootUri, sourcePath: invalid }), /[ぁ-んァ-ヶ一-龠]/u);
    }
    await assert.rejects(service.importAdjustLut({ projectRootUri, sourcePath: 'relative.cube' }), /絶対パス/u);
    await assert.rejects(service.importAdjustLut({ projectRootUri: '', sourcePath }), /ルート/u);
    await writeFile(join(project, 'assets/luts/Z.CUBE'), data);
    await writeFile(join(project, 'assets/luts/skip.txt'), data);
    await mkdir(join(project, 'assets/luts/folder.cube'));
    assert.deepEqual((await service.listAdjustLuts({ projectRootUri })).refs,
      ['assets/luts/My-look-2.cube', 'assets/luts/My-look.cube', 'assets/luts/Z.CUBE']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('LUT import rejects a project assets junction escaping the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'adjust-lut-escape-'));
  try {
    const project = join(root, 'project');
    const outside = join(root, 'outside');
    await mkdir(project);
    await mkdir(outside);
    await symlink(outside, join(project, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
    const sourcePath = join(root, 'source.cube');
    await writeFile(sourcePath, 'LUT_3D_SIZE 2');
    await assert.rejects(new AkariAnnotationsServiceImpl().importAdjustLut({
      projectRootUri: pathToFileURL(project).toString(), sourcePath
    }), /プロジェクト外/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
