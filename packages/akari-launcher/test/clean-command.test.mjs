import assert from 'node:assert/strict';
import {
  access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, utimes, writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import test from 'node:test';

import {
  cleanHelp, formatBytes, formatClassification, parseArguments, runCleanCommand,
} from '../src/clean-command.mjs';
import { CLEAN_MANIFEST, classifyProject } from '../src/clean-manifest.mjs';

const NOW = new Date('2026-09-02T12:00:00.000Z');
const OLD = new Date('2026-08-31T12:00:00.000Z');
const RECENT = new Date('2026-09-02T11:50:00.000Z');

async function put(root, relative, content = 'x') {
  const target = join(root, ...relative.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function setTreeTime(target, time) {
  const stat = await lstat(target);
  if (stat.isSymbolicLink()) return;
  if (stat.isDirectory()) {
    for (const name of await readdir(target)) await setTreeTime(join(target, name), time);
  }
  await utimes(target, time, time);
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function snapshot(root) {
  const rows = [];
  async function walk(directory, relative = '') {
    const names = (await readdir(directory)).sort();
    for (const name of names) {
      const target = join(directory, name);
      const rel = relative ? `${relative}/${name}` : name;
      const stat = await lstat(target);
      if (stat.isSymbolicLink()) rows.push([rel, 'link', await readlink(target)]);
      else if (stat.isDirectory()) {
        rows.push([rel, 'directory']);
        await walk(target, rel);
      } else rows.push([rel, 'file', (await readFile(target)).toString('base64')]);
    }
  }
  await walk(root);
  return rows;
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'akari-clean-'));
  await put(root, 'edit.json', '{"version":2}\n');
  await put(root, '.akari/render-tmp/recent/leftover.bin', 'recent');
  await put(root, '.akari/render-tmp/stale/leftover.bin', 'stale');
  await put(root, '.akari/cache/thumbnails/x.jpg', 'cache');
  await put(root, '.akari/diffs/1700000000000/before/edit.json', 'before');
  await put(root, 'exports/a.mp4', 'master');
  await put(root, 'exports/a.mp4.gpu-video.mp4', 'middle');
  await put(root, 'exports/run.json', '{}\n');
  await put(root, 'motion/camera.json', '{}\n');
  await put(root, '.akari/reports/lint.html', '<p>ok</p>');
  await put(root, '.akari/work/tmp/scratch.bin', 'scratch');
  await put(root, '.akari/work/keep/camera-plan.json', '{}\n');
  await put(root, '.akari/work/reframe/plan.json', '{}\n');
  await put(root, 'mystery.bin', 'mystery');

  await put(root, 'assets/generated/existing.mp4', 'generated-a');
  await put(root, 'assets/generated/existing.mp4.meta.json', `${JSON.stringify({
    version: 1,
    provenance: {
      origin: '.akari/work/keep/camera-plan.json',
      generator: 'camera-planner',
      inputs: ['assets/source.mp4'],
      created_at: '2026-08-31T00:00:00.000Z',
    },
  })}\n`);
  await put(root, 'assets/generated/missing.mp4', 'generated-b');
  await put(root, 'assets/generated/missing.mp4.meta.json', `${JSON.stringify({
    version: 1,
    provenance: { origin: 'planning/missing.json', generator: 'image-tool', inputs: [] },
  })}\n`);

  await setTreeTime(root, OLD);
  await setTreeTime(join(root, '.akari', 'render-tmp', 'recent'), RECENT);
  return root;
}

async function withFixture(callback) {
  const root = await fixture();
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('宣言表は全行が pattern / class / reason / regenerated_by を持つ', () => {
  assert.ok(CLEAN_MANIFEST.length > 20);
  for (const row of CLEAN_MANIFEST) {
    assert.deepEqual(Object.keys(row), ['pattern', 'class', 'reason', 'regenerated_by']);
    assert.ok(['disposable', 'keep', 'undecided'].includes(row.class));
  }
});

test('fixture をクラス順・パス順に分類し、60 分以内の run を判断保留へ移す', async () => {
  await withFixture(async (root) => {
    const result = await classifyProject(root, { now: NOW });
    assert.deepEqual({
      disposable: result.disposable.map((entry) => entry.path),
      keep: result.keep.map((entry) => entry.path),
      undecided: result.undecided.map((entry) => entry.path),
    }, {
      disposable: [
        '.akari/cache/thumbnails',
        '.akari/diffs/1700000000000',
        '.akari/render-tmp/stale',
        '.akari/work/tmp',
        'exports/a.mp4.gpu-video.mp4',
        'exports/run.json',
      ],
      keep: [
        '.akari/reports',
        '.akari/work/keep',
        'assets/generated/existing.mp4',
        'assets/generated/missing.mp4',
        'edit.json',
        'exports/a.mp4',
        'motion',
      ],
      undecided: [
        '.akari/render-tmp/recent',
        '.akari/work/reframe',
        'mystery.bin',
      ],
    });
    assert.deepEqual(
      result.undecided.find((entry) => entry.path.endsWith('/recent')),
      {
        path: '.akari/render-tmp/recent', class: 'undecided', reason: '実行中の可能性',
        files: 1, bytes: 6, held_reason: '実行中の可能性',
      },
    );
    for (const className of ['disposable', 'keep', 'undecided']) {
      assert.deepEqual(result.totals[className], {
        files: result[className].reduce((sum, entry) => sum + entry.files, 0),
        bytes: result[className].reduce((sum, entry) => sum + entry.bytes, 0),
      });
    }
  });
});

test('generated asset の sidecar を同じ保持行へまとめ、origin の実在を記録する', async () => {
  await withFixture(async (root) => {
    const result = await classifyProject(root, { now: NOW });
    const existing = result.keep.find((entry) => entry.path.endsWith('/existing.mp4'));
    const missing = result.keep.find((entry) => entry.path.endsWith('/missing.mp4'));
    assert.equal(existing.files, 2);
    assert.deepEqual(existing.provenance, {
      origin: '.akari/work/keep/camera-plan.json',
      generator: 'camera-planner',
      inputs: ['assets/source.mp4'],
      created_at: '2026-08-31T00:00:00.000Z',
      origin_exists: true,
    });
    assert.equal(missing.provenance.origin_exists, false);
  });
});

test('既定の非 TTY 実行は一覧後に exit 2 となり、1 バイトも変更しない', async () => {
  await withFixture(async (root) => {
    const before = await snapshot(root);
    const errors = [];
    const result = await runCleanCommand([root], {
      now: NOW, isTTY: false, log: () => {}, error: (line) => errors.push(line),
    });
    assert.equal(result.exitCode, 2);
    assert.match(errors.join('\n'), /--yes/u);
    assert.deepEqual(await snapshot(root), before);
  });
});

test('--dry-run は一覧だけで exit 0 となり、1 バイトも変更しない', async () => {
  await withFixture(async (root) => {
    const before = await snapshot(root);
    const result = await runCleanCommand([root, '--dry-run'], {
      now: NOW, isTTY: false, log: () => {}, error: () => {},
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(await snapshot(root), before);
  });
});

test('--yes は disposable だけを消し、keep・undecided・recent を残す', async () => {
  await withFixture(async (root) => {
    const result = await runCleanCommand([root, '--yes'], {
      now: NOW, isTTY: false, log: () => {}, error: () => {},
    });
    assert.equal(result.exitCode, 0);
    for (const entry of result.classification.disposable) assert.equal(await exists(join(root, ...entry.path.split('/'))), false, entry.path);
    for (const relative of [
      'edit.json', 'exports/a.mp4', 'motion/camera.json', '.akari/reports/lint.html',
      '.akari/work/keep/camera-plan.json', '.akari/work/reframe/plan.json',
      '.akari/render-tmp/recent/leftover.bin', 'assets/generated/existing.mp4', 'mystery.bin',
    ]) assert.equal(await exists(join(root, ...relative.split('/'))), true, relative);
  });
});

test('TTY の prompt が n を返すと何も消さない', async () => {
  await withFixture(async (root) => {
    const before = await snapshot(root);
    const result = await runCleanCommand([root], {
      now: NOW, isTTY: true, prompt: () => 'n', log: () => {}, error: () => {},
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(await snapshot(root), before);
  });
});

test('.akari-keep は同じディレクトリの .akari-disposable より優先する', async () => {
  await withFixture(async (root) => {
    await put(root, '.akari/work/marked/.akari-disposable', '');
    await put(root, '.akari/work/marked/.akari-keep', '');
    await put(root, '.akari/work/marked/valuable.json', '{}\n');
    await setTreeTime(join(root, '.akari', 'work', 'marked'), OLD);
    const result = await classifyProject(root, { now: NOW });
    assert.ok(result.keep.some((entry) => entry.path === '.akari/work/marked'));
    assert.ok(!result.disposable.some((entry) => entry.path.startsWith('.akari/work/marked')));
  });
});

test('.akari-disposable だけを持つ work ディレクトリは削除可能になる', async () => {
  await withFixture(async (root) => {
    await put(root, '.akari/work/marked/.akari-disposable', '');
    await put(root, '.akari/work/marked/output.bin', 'derived');
    await setTreeTime(join(root, '.akari', 'work', 'marked'), OLD);
    const result = await classifyProject(root, { now: NOW });
    assert.ok(result.disposable.some((entry) => entry.path === '.akari/work/marked'));
  });
});

test('work/tmp は削除され、目印なしの work/reframe は残る', async () => {
  await withFixture(async (root) => {
    const result = await runCleanCommand([root, '--yes'], {
      now: NOW, log: () => {}, error: () => {},
    });
    assert.equal(result.exitCode, 0);
    assert.equal(await exists(join(root, '.akari', 'work', 'tmp')), false);
    assert.equal(await exists(join(root, '.akari', 'work', 'reframe', 'plan.json')), true);
  });
});

test('プロジェクト外を指す symlink は判断保留で、参照先を数えず削除しない', async (t) => {
  const root = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'akari-clean-outside-'));
  try {
    const outsideFile = await put(outside, 'valuable.bin', 'outside');
    const linkPath = join(root, '.akari', 'cache', 'outside-link');
    try {
      await symlink(outsideFile, linkPath, 'file');
    } catch (error) {
      if (error?.code === 'EPERM' || error?.code === 'EACCES') {
        t.skip('この環境ではシンボリックリンクを作成できません');
        return;
      }
      throw error;
    }
    const classification = await classifyProject(root, { now: NOW });
    const linkEntry = classification.undecided.find((entry) => entry.path.endsWith('outside-link'));
    assert.equal(linkEntry.path, '.akari/cache/outside-link');
    assert.equal(linkEntry.class, 'undecided');
    assert.equal(linkEntry.reason, 'シンボリックリンク（参照先は調べません）');
    assert.equal(linkEntry.files, 1);
    assert.ok(linkEntry.bytes >= 0);
    const result = await runCleanCommand([root, '--yes'], { now: NOW, log: () => {}, error: () => {} });
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(outsideFile, 'utf8'), 'outside');
    assert.equal(await exists(linkPath), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('削除失敗は exit 1・失敗パスを stderr に出し、残りも続行する', async () => {
  await withFixture(async (root) => {
    const calls = [];
    const errors = [];
    const result = await runCleanCommand([root, '--yes'], {
      now: NOW,
      log: () => {},
      error: (line) => errors.push(line),
      remove: async (target) => {
        calls.push(target);
        if (calls.length === 1) throw Object.assign(new Error('locked'), { code: 'EPERM' });
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(calls.length, result.classification.disposable.length);
    assert.equal(result.failures.length, 1);
    assert.match(errors.join('\n'), /EPERM/u);
    assert.match(errors.join('\n'), /終了してから再実行/u);
  });
});

test('edit.json が無いプロジェクトは exit 2', async () => {
  const root = await mkdtemp(join(tmpdir(), 'akari-clean-no-edit-'));
  try {
    const errors = [];
    const result = await runCleanCommand([root, '--dry-run'], {
      log: () => {}, error: (line) => errors.push(line),
    });
    assert.equal(result.exitCode, 2);
    assert.match(errors.join('\n'), /edit\.json が見つかりません/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('未知フラグは exit 2 で help も stderr に出す', async () => {
  const errors = [];
  const result = await runCleanCommand(['--erase-all'], {
    log: () => {}, error: (line) => errors.push(line),
  });
  assert.equal(result.exitCode, 2);
  assert.match(errors.join('\n'), /未知のオプション/u);
  assert.match(errors.join('\n'), /使い方: akari clean/u);
});

test('--json は分類結果だけを stdout に出す', async () => {
  await withFixture(async (root) => {
    const lines = [];
    const result = await runCleanCommand([root, '--dry-run', '--json'], {
      now: NOW, log: (line) => lines.push(line), error: () => {},
    });
    assert.equal(result.exitCode, 0);
    assert.equal(lines.length, 1);
    assert.deepEqual(JSON.parse(lines[0]), result.classification);
    assert.ok(Array.isArray(JSON.parse(lines[0]).disposable));
  });
});

test('人向け一覧は 3 見出し・合計容量・由来警告を決定的に表示する', async () => {
  await withFixture(async (root) => {
    const lines = [];
    const result = await runCleanCommand([root, '--dry-run'], {
      now: NOW, log: (line) => lines.push(line), error: () => {},
    });
    assert.equal(result.exitCode, 0);
    assert.ok(lines.includes('削除可能:'));
    assert.ok(lines.includes('保持:'));
    assert.ok(lines.includes('判断保留:'));
    assert.ok(lines.some((line) => line.startsWith('削除可能 合計 ')));
    assert.ok(lines.some((line) => line.includes('由来: .akari/work/keep/camera-plan.json')));
    assert.ok(lines.includes('[警告] 由来の計画ファイルが見当たりません: planning/missing.json'));
  });
});

test('引数省略時は cwd、位置引数 2 個はエラー、help は自己完結する', () => {
  const cwd = path.resolve('fixture-project');
  assert.equal(parseArguments([], cwd).projectRoot, cwd);
  assert.equal(parseArguments(['one', 'two'], cwd).ok, false);
  assert.match(cleanHelp().join('\n'), /--dry-run/u);
});

test('容量は B / KB / MB / GB を小数 1 桁で表示する', () => {
  assert.equal(formatBytes(12), '12 B');
  assert.equal(formatBytes(1024), '1.0 KB');
  assert.equal(formatBytes(1024 ** 2 * 1.5), '1.5 MB');
  assert.equal(formatBytes(1024 ** 3 * 2), '2.0 GB');
  assert.match(formatClassification({
    disposable: [], keep: [], undecided: [], totals: { disposable: { files: 0, bytes: 0 } },
  }).at(-1), /0 B/u);
});
