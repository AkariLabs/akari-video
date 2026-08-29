import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveLauncherAssets } from '../src/repo-assets.mjs';

const ASSET_MARKERS = {
  skillsSourceDir: ['skills', 'analyze-footage', 'SKILL.md'],
  templateDir: ['templates', 'project-default', 'CLAUDE.md'],
  schemasSourceDir: ['packages', 'schemas', 'analysis.schema.json'],
  doctorScript: ['skills', 'manage-connections', 'bin', 'doctor.mjs'],
  scaffoldModulePath: ['packages', 'project-scaffold', 'src', 'index.mjs'],
  creatorRootModulePath: ['packages', 'creator-root', 'src', 'index.mjs'],
  audioFetchScriptPath: ['packages', 'audio-library-setup', 'bin', 'fetch-akari-sounds.mjs'],
  assetResolverCliPath: ['packages', 'asset-resolver', 'bin', 'akari-assets.mjs'],
  beatmapScript: ['packages', 'akari-tools', 'bin', 'beatmap.mjs'],
  probeFrameScript: ['packages', 'akari-tools', 'bin', 'probe-frame.mjs'],
  renderWhenIdleScript: ['packages', 'akari-tools', 'bin', 'render-when-idle.sh'],
  eyeBarScript: ['packages', 'akari-tools', 'bin', 'eye-bar.mjs'],
  mediaScript: ['packages', 'akari-tools', 'bin', 'media.mjs']
};

async function withRoots(run) {
  const root = await mkdtemp(path.join(tmpdir(), 'akari-repo-assets-'));
  const candidateRoot = path.join(root, 'candidate');
  const vendorRoot = path.join(root, 'vendor');
  await mkdir(candidateRoot, { recursive: true });
  await mkdir(vendorRoot, { recursive: true });
  try {
    await run({ candidateRoot, vendorRoot });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeMarker(root, segments) {
  const filePath = path.join(root, ...segments);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, '', 'utf8');
}

async function writeAllMarkers(root) {
  await Promise.all(Object.values(ASSET_MARKERS).map(segments => writeMarker(root, segments)));
}

test('resolveLauncherAssets: candidate の schemas と vendor の template/scaffold を資産単位で合成する', async () => {
  await withRoots(async ({ candidateRoot, vendorRoot }) => {
    await writeMarker(candidateRoot, ASSET_MARKERS.schemasSourceDir);
    await writeMarker(vendorRoot, ASSET_MARKERS.templateDir);
    await writeMarker(vendorRoot, ASSET_MARKERS.scaffoldModulePath);

    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot });

    assert.equal(assets.repoRoot, candidateRoot);
    assert.equal(assets.schemasSourceDir, path.join(candidateRoot, 'packages', 'schemas'));
    assert.equal(assets.templateDir, path.join(vendorRoot, 'templates', 'project-default'));
    assert.equal(assets.scaffoldModulePath, path.join(vendorRoot, ...ASSET_MARKERS.scaffoldModulePath));
  });
});

test('resolveLauncherAssets: candidate が完全なら全フィールドを candidate から採る', async () => {
  await withRoots(async ({ candidateRoot, vendorRoot }) => {
    await writeAllMarkers(candidateRoot);
    await writeAllMarkers(vendorRoot);

    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot });

    assert.equal(assets.repoRoot, candidateRoot);
    for (const [field, value] of Object.entries(assets)) {
      if (field !== 'repoRoot') {
        assert.ok(value.startsWith(candidateRoot), `${field} は candidate 側であること`);
      }
    }
  });
});

test('resolveLauncherAssets: candidate が空なら全フィールドと repoRoot を vendor から採る', async () => {
  await withRoots(async ({ candidateRoot, vendorRoot }) => {
    await writeAllMarkers(vendorRoot);

    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot });

    assert.equal(assets.repoRoot, vendorRoot);
    for (const [field, value] of Object.entries(assets)) {
      if (field !== 'repoRoot') {
        assert.ok(value.startsWith(vendorRoot), `${field} は vendor 側であること`);
      }
    }
  });
});

test('resolveLauncherAssets: candidate と vendor が空なら全資産フィールドは null', async () => {
  await withRoots(async ({ candidateRoot, vendorRoot }) => {
    const assets = resolveLauncherAssets({ candidateRoot, vendorRoot });

    assert.equal(assets.repoRoot, vendorRoot);
    for (const [field, value] of Object.entries(assets)) {
      if (field !== 'repoRoot') {
        assert.equal(value, null, `${field} は null であること`);
      }
    }
  });
});
