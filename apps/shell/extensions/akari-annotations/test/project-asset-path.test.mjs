import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { referencedLibraryMediaFile, resolveProjectMediaFile, projectOutputPath } from '../lib/node/project-asset-path.js';
import { extractSourceFrame } from '../lib/node/media-cache.js';
import { AkariAnnotationsServiceImpl } from '../lib/node/akari-annotations-service.js';
import { ImageAiService } from '../lib/node/image-ai-service.js';

const declared = 'assets/still/bg-aurora-mesh/bg.png';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');

test('台帳に載ったライブラリ素材を読み、プロジェクトの meta に draft を保存する', async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'libcanvas-fx3-path-'));
  const home = path.join(temporary, 'home');
  const project = path.join(temporary, 'project');
  const library = path.join(temporary, 'library');
  const libraryFile = path.join(library, 'still/bg-aurora-mesh/bg.png');
  const env = { ...process.env, AKARI_HOME: home };
  const previousHome = process.env.AKARI_HOME;
  try {
    await mkdir(path.dirname(libraryFile), { recursive: true });
    await mkdir(path.join(project, '.akari'), { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(path.join(home, 'library-location.json'), JSON.stringify({ version: 0, root: library, state: 'done' }));
    await writeFile(libraryFile, png);
    await writeFile(path.join(project, '.akari/asset-references.json'), JSON.stringify({ version: 0, references: [
      { id: 'bg-aurora-mesh', category: 'still' }
    ] }));
    await writeFile(path.join(project, 'edit.json'), JSON.stringify({ version: 2, sources: [
      { id: 'image', path: declared }
    ], tracks: [{ lane: 'visual', items: [{ id: 'clip', source: { kind: 'media', src: 'image' } }] }] }));

    assert.equal(await resolveProjectMediaFile(project, declared, env), await realpath(libraryFile));
    await assert.rejects(resolveProjectMediaFile(project, '../outside.png', env));
    await assert.rejects(resolveProjectMediaFile(project, '/tmp/outside.png', env));
    await assert.rejects(resolveProjectMediaFile(project, 'assets/still/other/bg.png', env), { code: 'ENOENT' });
    const outside = path.join(temporary, 'outside.png');
    await writeFile(outside, png);
    await symlink(outside, path.join(library, 'still/bg-aurora-mesh/escape.png'));
    await assert.rejects(resolveProjectMediaFile(project, 'assets/still/bg-aurora-mesh/escape.png', env));
    await mkdir(path.join(library, 'still/another'), { recursive: true });
    await writeFile(path.join(library, 'still/another/other.png'), png);
    await symlink(path.join(library, 'still/another/other.png'), path.join(library, 'still/bg-aurora-mesh/other.png'));
    await assert.rejects(resolveProjectMediaFile(project, 'assets/still/bg-aurora-mesh/other.png', env));
    await symlink(path.join(library, 'still/bg-aurora-mesh'), path.join(project, 'assets'), 'dir').catch(() => {});
    await assert.rejects(projectOutputPath(project, 'assets/still/bg-aurora-mesh/bad.meta.json'));
    await rm(path.join(project, 'assets'), { force: true });

    process.env.AKARI_HOME = home;
    const inspected = await new ImageAiService(undefined, async () => undefined)
      .inspect(pathToFileURL(project).href, 'clip');
    assert.equal(inspected.binding.sourcePath, declared);
    assert.equal(inspected.binding.inputSha256, createHash('sha256').update(png).digest('hex'));
    const service = new AkariAnnotationsServiceImpl();
    const result = await service.writeGenerationDraft({ projectRootUri: pathToFileURL(project).href,
      itemId: 'clip', modelId: 'fal:h3-i2v', inputs: { prompt: 'move', first_frame: { path: declared },
        reference_images: [], reference_videos: [], reference_audios: [] }, output: { duration_s: 5 } });
    assert.equal(result.path, `${declared}.meta.json`);
    const meta = JSON.parse(await readFile(path.join(project, result.path), 'utf8'));
    assert.equal(meta.next.inputs.first_frame.path, declared);
    assert.equal(meta.next.inputs.first_frame.sha256, createHash('sha256').update(png).digest('hex'));
    const sidecars = await service.readGenerationSidecars({ projectRootUri: pathToFileURL(project).href,
      sourcePaths: [declared] });
    assert.equal(sidecars.entries[0]?.binding?.matches, true);
    await assert.rejects(stat(`${libraryFile}.meta.json`), { code: 'ENOENT' });
    assert.deepEqual(await extractSourceFrame(project, declared, 0), {
      relativePath: declared, sha256: createHash('sha256').update(png).digest('hex')
    });

    const libraryUri = pathToFileURL(await realpath(libraryFile)).href;
    assert.equal(await referencedLibraryMediaFile(project, libraryFile, env), await realpath(libraryFile));
    assert.equal(await service.resolveMediaUri(pathToFileURL(project).href, libraryUri), await realpath(libraryFile));
    const unlisted = path.join(library, 'still/not-in-ledger/other.png');
    await mkdir(path.dirname(unlisted), { recursive: true });
    await writeFile(unlisted, png);
    assert.equal(await referencedLibraryMediaFile(project, unlisted, env), null);
    assert.equal(await service.resolveMediaUri(pathToFileURL(project).href, pathToFileURL(unlisted).href), unlisted);

    // Stub binary locations force the read-only RPCs to return unavailable without invoking ffmpeg/ffprobe.
    const previousFfmpeg = process.env.AKARI_FFMPEG_BIN;
    const previousFfprobe = process.env.AKARI_FFPROBE_BIN;
    process.env.AKARI_FFMPEG_BIN = path.join(temporary, 'missing-ffmpeg');
    process.env.AKARI_FFPROBE_BIN = path.join(temporary, 'missing-ffprobe');
    try {
      const projectRootUri = pathToFileURL(project).href;
      assert.equal((await service.getAudioDuration({ projectRootUri, audioUri: libraryUri })).status, 'unavailable');
      assert.equal((await service.getClipThumbnail({ projectRootUri, videoUri: libraryUri, atSeconds: 0 })).status, 'unavailable');
      assert.equal((await service.getClipFilmstripChunk({ projectRootUri, videoUri: libraryUri,
        chunkIndex: 0, frameWidth: 80, fps: 1 })).status, 'unavailable');
    } finally {
      if (previousFfmpeg === undefined) delete process.env.AKARI_FFMPEG_BIN;
      else process.env.AKARI_FFMPEG_BIN = previousFfmpeg;
      if (previousFfprobe === undefined) delete process.env.AKARI_FFPROBE_BIN;
      else process.env.AKARI_FFPROBE_BIN = previousFfprobe;
    }

    await writeFile(`${libraryFile}.meta.json`, await readFile(path.join(project, result.path), 'utf8'));
    const externalSidecar = await service.readGenerationSidecars({ projectRootUri: pathToFileURL(project).href,
      sourcePaths: [libraryUri] });
    assert.equal(externalSidecar.entries[0]?.binding?.matches, true);

    const local = path.join(project, declared);
    await writeFile(local, Buffer.from('local'));
    assert.equal(await resolveProjectMediaFile(project, declared, env), await realpath(local));
    await symlink(outside, path.join(project, 'assets/still/bg-aurora-mesh/linked.png'));
    await assert.rejects(resolveProjectMediaFile(project, 'assets/still/bg-aurora-mesh/linked.png', env));
  } finally {
    if (previousHome === undefined) delete process.env.AKARI_HOME;
    else process.env.AKARI_HOME = previousHome;
    await rm(temporary, { recursive: true, force: true });
  }
});
