import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uiKeys } from '../docs-facts/keys.mjs';

const script = resolve(dirname(fileURLToPath(import.meta.url)), '../release/docs-facts-release.mjs');
const genDocsFacts = resolve(dirname(fileURLToPath(import.meta.url)), '../gen-docs-facts.mjs');
const write = (root, path, value) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, value);
};
const git = (root, ...argv) => execFileSync('git', ['-C', root, ...argv], { encoding: 'utf8' }).trim();
const run = (root, ...args) => spawnSync(process.execPath, [script, '--root', root, ...args], { encoding: 'utf8' });
const commit = (root, message) => {
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-03-04T05:06:07Z', GIT_AUTHOR_DATE: '2026-03-04T05:06:07Z' } });
};
// commit-tree も作者の識別情報を要る（CI の runner には無い）ので commit と同じく -c で渡す
const commitTree = (root, parent, message) => git(root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit-tree', 'HEAD^{tree}', '-p', parent, '-m', message);

const oldValues = {
  'home.startButton': ['＋ 新しい動画を始める', '+ Start a new video'],
  'home.newProjectHeading': ['新しいプロジェクト', 'New project'],
  'settings.stableOnly': ['安定版だけ', 'Stable only'],
  'settings.prereleaseToo': ['プレリリースも', 'Include prereleases'],
  'library.myStyles': ['マイスタイル', 'My Styles'],
  'library.motionParts': ['オーバーレイ', 'Overlay'],
  'library.captionStyle': ['字幕スタイル', 'Caption styles'],
  'library.captionStyleSingular': ['テンプレ', 'Caption style'],
  'library.channelSettings': ['ブランドキット', 'Brand kit'],
  'annotation.handToAi': ['AI に渡す', 'Hand to AI'],
};
const newValues = {
  ...oldValues,
  'library.myStyles': ['自分のスタイル', 'My styles'],
  'library.motionParts': ['動く部品', 'Motion parts'],
};

const writeI18n = (root, values) => {
  const catalogs = { ja: {}, en: {} };
  for (const [fact, [ja, en]] of Object.entries(values)) {
    const key = uiKeys[fact];
    catalogs.ja[key] = ja;
    catalogs.en[key] = en;
  }
  for (const lang of ['ja', 'en']) {
    const buckets = { surfaces: {}, project: {}, transcript: {}, annotations: {} };
    for (const [key, value] of Object.entries(catalogs[lang])) buckets[key.split('.')[0]][key] = value;
    for (const [top, obj] of Object.entries(buckets)) {
      write(root, `packages/i18n/locales/${lang}/${top}.json`, `${JSON.stringify(obj)}\n`);
    }
    write(root, `packages/i18n/locales/${lang}/cli.json`, `${JSON.stringify({
      'cli.new.help.usage': 'Usage: akari new <dir> [--scaffold <path>] [--template <path>]',
      'cli.template.help.usage': 'Usage: akari template export <project> | akari template list',
      'cli.playbook.template.usage': 'akari playbook template <project>',
    })}\n`);
  }
};

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-facts-release-'));
  writeI18n(root, oldValues);
  write(root, 'packages/akari-launcher/src/new-command.mjs', "if (argument === '--template' || argument === '--scaffold') {}\n");
  write(root, 'packages/akari-launcher/src/template-command.mjs', "if (action !== 'export' && action !== 'list') {}\naction === 'export' ? 'template' : 'list';\n");
  write(root, 'packages/akari-launcher/src/connect-command.mjs', "import path from 'node:path';\nexport function connectPaths(env = {}, home) { return { primary: path.join(env.AKARI_HOME || path.join(home, '.akari'), 'credentials.env'), legacy: path.join(home, '.config', 'akari-video', 'credentials.env') }; }\n");
  write(root, 'apps/shell/package.json', '{"version":"1.2.3"}\n');
  write(root, 'skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n');
  write(root, 'README.md', 'Before <!-- F ui.home.startButton -->old<!-- /F --> after.\n<!-- BEGIN GENERATED facts:shipped-note -->\n> [!NOTE]\n> old\n<!-- END GENERATED facts:shipped-note -->\nTail.\n');
  write(root, 'README.ja.md', '前 <!-- F ui.home.startButton -->旧<!-- /F --> 後。\n<!-- BEGIN GENERATED facts:shipped-note -->\nold\n<!-- END GENERATED facts:shipped-note -->\n末尾。\n');
  write(root, 'docs/getting-started.ja.md', '文章 <!-- F ui.home.startButton -->旧<!-- /F --> 続き。\n<!-- BEGIN GENERATED facts:stamp -->\n<!-- END GENERATED facts:stamp -->\n');
  mkdirSync(join(root, 'docs/guides'), { recursive: true });
  mkdirSync(join(root, 'docs/how-to'), { recursive: true });
  execFileSync('git', ['init', '-q', root]);
  commit(root, 'fixture');
  execFileSync('git', ['-C', root, 'tag', 'v1.0.0']);
  // facts.json を追跡対象にするため、一度生成器を走らせてからコミットする（実リポの状態を再現）。
  const gen = spawnSync(process.execPath, [genDocsFacts, '--root', root], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  commit(root, 'facts');
  return root;
};
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test('a stable tag whose parent is reachable produces stamp and shipped-note diffs', () => {
  const root = fixture();
  try {
    const parent = git(root, 'rev-parse', 'HEAD');
    const release = commitTree(root, parent, 'release');
    execFileSync('git', ['-C', root, 'tag', 'v1.1.0', release]);
    writeI18n(root, newValues);
    commit(root, 'rename');
    const summary = join(root, 'summary.md');
    const outDir = join(root, 'out');
    const result = run(root, '--dry-run', '--tag', 'v1.1.0', '--summary', summary, '--out-dir', outDir);
    assert.equal(result.status, 0);
    const text = readFileSync(summary, 'utf8');
    assert.match(text, /docs\/facts\.json/);
    assert.match(text, /README\.ja\.md/);
    assert.match(text, /getting-started\.ja\.md/);
    assert.match(text, /名前が変わった言葉/);
    assert.match(text, /マイスタイル → 自分のスタイル/);
  } finally { cleanup(root); }
});

test('a tag whose parent is not on HEAD fails', () => {
  const root = fixture();
  try {
    const parent = git(root, 'rev-parse', 'HEAD');
    const side1 = commitTree(root, parent, 'side1');
    const side2 = execFileSync('git', ['-C', root, 'commit-tree', 'HEAD^{tree}', '-p', side1, '-m', 'side2'], { encoding: 'utf8' }).trim();
    execFileSync('git', ['-C', root, 'tag', 'v1.1.0', side2]);
    const result = run(root, '--dry-run', '--tag', 'v1.1.0');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /親が/);
  } finally { cleanup(root); }
});
