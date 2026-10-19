import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uiKeys } from '../docs-facts/keys.mjs';

const generator = resolve(dirname(fileURLToPath(import.meta.url)), '../release/gen-update-post.mjs');
const write = (root, path, value) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, value);
};
const run = (root, ...args) => spawnSync(process.execPath, [generator, '--root', root, ...args], { encoding: 'utf8' });
const commit = (root, message) => {
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', message], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-03-04T05:06:07Z', GIT_AUTHOR_DATE: '2026-03-04T05:06:07Z' } });
};

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
  const root = mkdtempSync(join(tmpdir(), 'gen-update-post-'));
  writeI18n(root, oldValues);
  write(root, 'packages/akari-launcher/src/new-command.mjs', "if (argument === '--template' || argument === '--scaffold') {}\n");
  write(root, 'packages/akari-launcher/src/template-command.mjs', "if (action !== 'export' && action !== 'list') {}\naction === 'export' ? 'template' : 'list';\n");
  write(root, 'packages/akari-launcher/src/connect-command.mjs', "import path from 'node:path';\nexport function connectPaths(env = {}, home) { return { primary: path.join(env.AKARI_HOME || path.join(home, '.akari'), 'credentials.env'), legacy: path.join(home, '.config', 'akari-video', 'credentials.env') }; }\n");
  write(root, 'apps/shell/package.json', '{"version":"1.2.3"}\n');
  write(root, 'skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n');
  execFileSync('git', ['init', '-q', root]);
  commit(root, 'fixture');
  execFileSync('git', ['-C', root, 'tag', 'v1.0.0']);
  return root;
};
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test('a diff and a new skill produce the full post', () => {
  const root = fixture();
  try {
    writeI18n(root, newValues);
    write(root, 'skills/record-playbook/SKILL.md', '---\nname: record-playbook\ndescription: Record a playbook\n---\n\n# record-playbook\n');
    commit(root, 'rename and add skill');
    const result = run(root, '--tag', 'v2.0.0', '--previous', 'v1.0.0');
    assert.equal(result.status, 0);
    const expected = [
      '🚀 AKARI Video v2.0.0 リリース！',
      '',
      '（ここに見どころを 3〜5 個。1 つ 2 行まで。絵文字 + 短い見出し + 説明の形）',
      '',
      '📝 名前が変わった言葉（v1.0.0 → v2.0.0）',
      '・マイスタイル → 自分のスタイル',
      '・オーバーレイ → 動く部品',
      '',
      '🧩 新しいスキル',
      '・record-playbook',
      'スキルは全部で 2 本です',
      '',
      '📦 ダウンロード / 詳細',
      'https://github.com/AkariLabs/akari-video/releases/tag/v2.0.0',
      '',
      '💬 フィードバックは Issues か、このサーバーでどうぞ！',
    ].join('\n') + '\n';
    assert.equal(result.stdout, expected);
  } finally { cleanup(root); }
});

test('no diff and no new skill omit both sections', () => {
  const root = fixture();
  try {
    write(root, 'notes.txt', 'nothing\n');
    commit(root, 'no-op');
    const result = run(root, '--tag', 'v1.1.0', '--previous', 'v1.0.0');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /🚀 AKARI Video v1\.1\.0 リリース！/);
    assert.doesNotMatch(result.stdout, /名前が変わった言葉/);
    assert.doesNotMatch(result.stdout, /新しいスキル/);
    assert.match(result.stdout, /📦 ダウンロード \/ 詳細/);
    assert.match(result.stdout, /💬 フィードバック/);
  } finally { cleanup(root); }
});

test('a missing --previous picks the highest lower stable tag', () => {
  const root = fixture();
  try {
    execFileSync('git', ['-C', root, 'tag', 'v1.4.1']);
    writeI18n(root, newValues);
    commit(root, 'rename');
    execFileSync('git', ['-C', root, 'tag', 'v1.5.0-beta.6']);
    const result = run(root, '--tag', 'v2.0.0');
    assert.equal(result.status, 0);
    assert.match(result.stdout, /📝 名前が変わった言葉（v1\.4\.1 → v2\.0\.0）/);
    assert.doesNotMatch(result.stdout, /v1\.5\.0-beta\.6 → /);
  } finally { cleanup(root); }
});
