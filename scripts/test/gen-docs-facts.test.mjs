import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { uiKeys } from '../docs-facts/keys.mjs';
import { snippets } from '../docs-facts/snippets.mjs';

const generator = resolve(dirname(fileURLToPath(import.meta.url)), '../gen-docs-facts.mjs');
const write = (root, path, value) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, value);
};
const run = (root, ...args) => spawnSync(process.execPath, [generator, '--root', root, ...args], { encoding: 'utf8' });
const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'docs-facts-'));
  const values = {
    'home.startButton': ['＋ 新しい動画を始める', '+ Start a new video'],
    'home.newProjectHeading': ['新しいプロジェクト', 'New project'],
    'settings.stableOnly': ['安定版だけ', 'Stable only'],
    'settings.prereleaseToo': ['プレリリースも', 'Include prereleases'],
    'library.myStyles': ['マイスタイル', 'My Styles'],
    'library.motionParts': ['オーバーレイ', 'Overlay'],
    'library.captionStyle': ['字幕スタイル', 'Caption styles'],
    'library.captionStyleSingular': ['字幕スタイル', 'Caption style'],
    'library.channelSettings': ['ブランドキット', 'Brand kit'],
    'annotation.handToAi': ['AI に渡す', 'Hand to AI'],
  };
  const catalogs = { ja: {}, en: {} };
  for (const [fact, key] of Object.entries(uiKeys)) {
    catalogs.ja[key] = values[fact][0];
    catalogs.en[key] = values[fact][1];
  }
  for (const lang of ['ja', 'en']) {
    for (const file of ['surfaces', 'project', 'transcript', 'annotations']) {
      write(root, `packages/i18n/locales/${lang}/${file}.json`, `${JSON.stringify(Object.fromEntries(Object.entries(catalogs[lang]).filter(([key]) => key.startsWith(`${file === 'project' ? 'project' : file === 'annotations' ? 'annotations' : file === 'transcript' ? 'transcript' : 'surfaces'}.`))))}\n`);
    }
    write(root, `packages/i18n/locales/${lang}/cli.json`, `${JSON.stringify({
      'cli.new.help.usage': 'Usage: akari new <dir> [--scaffold <path>] [--template <path>]',
      'cli.template.help.usage': 'Usage: akari template export <project> | akari template list',
      'cli.playbook.template.usage': 'akari playbook template <project>',
    })}\n`);
  }
  write(root, 'packages/akari-launcher/src/new-command.mjs', "if (argument === '--template' || argument === '--scaffold') {}\n");
  write(root, 'packages/akari-launcher/src/template-command.mjs', "if (action !== 'export' && action !== 'list') {}\naction === 'export' ? 'template' : 'list';\n");
  write(root, 'packages/akari-launcher/src/connect-command.mjs', "import path from 'node:path';\nexport function connectPaths(env = {}, home) { return { primary: path.join(env.AKARI_HOME || path.join(home, '.akari'), 'credentials.env'), legacy: path.join(home, '.config', 'akari-video', 'credentials.env') }; }\n");
  write(root, 'apps/shell/package.json', '{"version":"1.2.3"}\n');
  write(root, 'skills/demo/SKILL.md', '---\nname: demo\ndescription: Demo skill\n---\n\n# Demo\n');
  write(root, 'README.md', 'Before <!-- F ui.home.startButton -->old<!-- /F --> after. Path <!-- F paths.credentials -->`old`<!-- /F --> and <!-- F paths.credentials.legacy -->`old`<!-- /F -->.\n<!-- BEGIN GENERATED facts:shipped-note -->\n> [!NOTE]\n> old\n<!-- END GENERATED facts:shipped-note -->\nTail.\n');
  write(root, 'README.ja.md', '前 <!-- F ui.home.startButton -->旧<!-- /F --> 後。\n<!-- BEGIN GENERATED facts:shipped-note -->\nold\n<!-- END GENERATED facts:shipped-note -->\n末尾。\n');
  write(root, 'docs/getting-started.ja.md', '文章 <!-- F ui.home.startButton -->旧<!-- /F --> 続き。\n<!-- BEGIN GENERATED facts:stamp -->\n<!-- END GENERATED facts:stamp -->\n');
  mkdirSync(join(root, 'docs/guides'), { recursive: true });
  mkdirSync(join(root, 'docs/how-to'), { recursive: true });
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'fixture'], { env: { ...process.env, GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z', GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z' } });
  execFileSync('git', ['-C', root, 'tag', 'v1.2.3']);
  return { root, catalogs };
};
const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test('generated Japanese spacing and one CLI alias notice', () => {
  const facts = {
    meta: { shippedTag: 'v1.5.0' },
    cli: { new: { scaffold: '--scaffold', alias: '--template' }, template: { export: 'akari template export', list: 'akari template list', alias: 'akari playbook template' } },
    shipped: [
      { lang: 'ja', key: 'library.myStyles', shipped: 'マイスタイル', current: '自分のスタイル' },
      { lang: 'en', key: 'library.myStyles', shipped: 'My Styles', current: 'My styles' },
      { lang: 'ja', key: 'cli.new.usage', shipped: 'akari new --template', current: 'akari new --scaffold' },
      { lang: 'ja', key: 'cli.template.usage', shipped: null, current: 'akari template export | akari template list' },
      { lang: 'en', key: 'cli.new.usage', shipped: 'akari new --template', current: 'akari new --scaffold' },
      { lang: 'en', key: 'cli.template.usage', shipped: null, current: 'akari template export | akari template list' },
    ],
  };
  const ja = snippets['shipped-note'](facts, 'ja');
  const en = snippets['shipped-note'](facts, 'en');
  assert.match(ja, /では「マイスタイル」→「自分のスタイル」と表示/);
  assert.match(ja, /では `--template` を使い、次の版から `--scaffold` も使えます/);
  assert.equal(ja.split('旧名は別名として残ります。').length - 1, 1);
  assert.match(en, /“My Styles” → “My styles”/);
  assert.equal(en.split('remain aliases.').length - 1, 1);
});

test('inline and block markers are replaced from facts', () => {
  const { root } = fixture();
  try {
    assert.equal(run(root).status, 0);
    const doc = readFileSync(join(root, 'README.md'), 'utf8');
    assert.match(doc, /<!-- F ui.home.startButton -->\+ Start a new video<!-- \/F -->/);
    assert.match(doc, /<!-- F paths.credentials -->`~\/\.akari\/credentials\.env`<!-- \/F -->/);
    assert.match(doc, /<!-- F paths.credentials.legacy -->`~\/\.config\/akari-video\/credentials\.env`<!-- \/F -->/);
    assert.match(doc, /<!-- BEGIN GENERATED facts:shipped-note -->\n<!-- END GENERATED facts:shipped-note -->/);
    assert.doesNotMatch(doc, /^>/m);
  } finally { cleanup(root); }
});

test('a second generation is byte identical', () => {
  const { root } = fixture();
  try {
    assert.equal(run(root).status, 0);
    const first = readFileSync(join(root, 'docs/facts.json'), 'utf8');
    const document = readFileSync(join(root, 'README.ja.md'), 'utf8');
    assert.equal(run(root).status, 0);
    assert.equal(readFileSync(join(root, 'docs/facts.json'), 'utf8'), first);
    assert.equal(readFileSync(join(root, 'README.ja.md'), 'utf8'), document);
    assert.equal(run(root, '--check').status, 0);
  } finally { cleanup(root); }
});

test('check reports the changed marker line without writing', () => {
  const { root } = fixture();
  try {
    run(root);
    const path = join(root, 'docs/getting-started.ja.md');
    const edited = readFileSync(path, 'utf8').replace('＋ 新しい動画を始める', '＋ 新しい動画を始めろ');
    writeFileSync(path, edited);
    const result = run(root, '--check');
    assert.equal(result.status, 1);
    assert.match(result.stderr, /docs\/getting-started\.ja\.md:1/);
    assert.equal(readFileSync(path, 'utf8'), edited);
  } finally { cleanup(root); }
});

test('unknown fact and mismatched blocks report their line', () => {
  const { root } = fixture();
  try {
    write(root, 'README.md', 'Intro\n<!-- F ui.noSuchFact -->x<!-- /F -->\n');
    let result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /README\.md:2: unknown fact/);
    write(root, 'README.md', 'Intro\n<!-- BEGIN GENERATED facts:stamp -->\n');
    result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /README\.md:2: mismatched or missing END/);
    write(root, 'README.md', '> <!-- BEGIN GENERATED facts:stamp -->\n<!-- END GENERATED facts:stamp -->\n');
    result = run(root);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BEGIN\/END prefixes differ/);
  } finally { cleanup(root); }
});

test('shipped note appears only when tagged UI differs', () => {
  const { root, catalogs } = fixture();
  try {
    assert.equal(run(root).status, 0);
    assert.doesNotMatch(readFileSync(join(root, 'README.ja.md'), 'utf8'), /配布中の v1/);
    catalogs.ja['project.library.pane.myStylesLabel'] = '自分のスタイル';
    write(root, 'packages/i18n/locales/ja/project.json', `${JSON.stringify(Object.fromEntries(Object.entries(catalogs.ja).filter(([key]) => key.startsWith('project.'))))}\n`);
    assert.equal(run(root).status, 0);
    assert.match(readFileSync(join(root, 'README.ja.md'), 'utf8'), /マイスタイル.*自分のスタイル/);
    assert.doesNotMatch(readFileSync(join(root, 'README.ja.md'), 'utf8'), /--scaffold|akari template export/);
    const facts = JSON.parse(readFileSync(join(root, 'docs/facts.json'), 'utf8'));
    assert.ok(facts.shipped.some((row) => row.key === 'library.myStyles' && row.shipped === 'マイスタイル'));
  } finally { cleanup(root); }
});

test('CLI usage differs only when the tagged catalog differs', () => {
  const { root } = fixture();
  try {
    const path = join(root, 'packages/i18n/locales/ja/cli.json');
    const catalog = JSON.parse(readFileSync(path, 'utf8'));
    catalog['cli.new.help.usage'] = '使い方: akari new <dir> [--scaffold <path>] [--template <path>]';
    catalog['cli.template.help.usage'] = '使い方: akari template export <project> | akari template list';
    writeFileSync(path, `${JSON.stringify(catalog)}\n`);
    assert.equal(run(root).status, 0);
    const note = readFileSync(join(root, 'README.ja.md'), 'utf8');
    assert.match(note, /akari new.*使い方/);
    assert.match(note, /テンプレートの CLI の使い方/);
    assert.doesNotMatch(note, /マイスタイル|オーバーレイ/);
    const facts = JSON.parse(readFileSync(join(root, 'docs/facts.json'), 'utf8'));
    assert.ok(facts.shipped.some((row) => row.key === 'cli.new.usage'));
    assert.ok(facts.shipped.some((row) => row.key === 'cli.template.usage'));
  } finally { cleanup(root); }
});

test('a CLI usage absent from the shipped tag is recorded as null', () => {
  const { root } = fixture();
  try {
    const path = join(root, 'packages/i18n/locales/ja/cli.json');
    const current = readFileSync(path, 'utf8');
    const old = JSON.parse(current);
    delete old['cli.template.help.usage'];
    writeFileSync(path, `${JSON.stringify(old)}\n`);
    execFileSync('git', ['-C', root, 'add', 'packages/i18n/locales/ja/cli.json']);
    execFileSync('git', ['-C', root, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-qm', 'older CLI']);
    execFileSync('git', ['-C', root, 'tag', 'v1.2.4']);
    writeFileSync(path, current);
    const result = run(root, '--print');
    assert.equal(result.status, 0);
    const row = JSON.parse(result.stdout).shipped.find((item) => item.lang === 'ja' && item.key === 'cli.template.usage');
    assert.equal(row.shipped, null);
  } finally { cleanup(root); }
});

test('CLI snippet keeps shell code formatting and splits alternatives', () => {
  const { root } = fixture();
  try {
    write(root, 'docs/guides/usage.md', '<!-- BEGIN GENERATED facts:cli.template -->\n<!-- END GENERATED facts:cli.template -->\n');
    assert.equal(run(root).status, 0);
    const rendered = readFileSync(join(root, 'docs/guides/usage.md'), 'utf8');
    assert.match(rendered, /```sh\nakari template export <project>\nakari template list\n```/);
    assert.doesNotMatch(rendered, /Usage:| \| /);
  } finally { cleanup(root); }
});

test('text outside both marker types is unchanged', () => {
  const { root } = fixture();
  try {
    const before = readFileSync(join(root, 'README.md'), 'utf8');
    assert.equal(run(root).status, 0);
    const after = readFileSync(join(root, 'README.md'), 'utf8');
    const strip = (text) => text.replace(/<!-- F [\w.-]+ -->[\s\S]*?<!-- \/F -->/g, '<inline>').replace(/<!-- BEGIN GENERATED facts:[\w.-]+ -->[\s\S]*?<!-- END GENERATED facts:[\w.-]+ -->/g, '<block>');
    assert.equal(strip(after), strip(before));
  } finally { cleanup(root); }
});

test('a release tag whose parent is reachable outranks the prerelease tag', () => {
  const { root } = fixture();
  try {
    execFileSync('git', ['-C', root, 'tag', 'v1.5.0-beta.6']);
    const tree = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
    const parent = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const releaseCommit = execFileSync('git', ['-C', root, 'commit-tree', tree, '-p', parent, '-m', 'release'], {
      encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com', GIT_AUTHOR_DATE: '2026-02-03T23:30:00-08:00', GIT_COMMITTER_DATE: '2026-02-03T23:30:00-08:00' },
    }).trim();
    execFileSync('git', ['-C', root, 'tag', 'v1.5.0', releaseCommit]);
    const result = run(root, '--print');
    assert.equal(result.status, 0);
    const facts = JSON.parse(result.stdout);
    assert.equal(facts.meta.version, '1.5.0');
    assert.equal(facts.meta.shippedTag, 'v1.5.0');
    assert.equal(facts.meta.releaseDate, '2026-02-04');
  } finally { cleanup(root); }
});

test('a source archive without git tags uses the shell version and no date', () => {
  const { root } = fixture();
  try {
    rmSync(join(root, '.git'), { recursive: true, force: true });
    const result = run(root, '--print');
    assert.equal(result.status, 0);
    const facts = JSON.parse(result.stdout);
    assert.equal(facts.meta.version, '1.2.3');
    assert.equal(facts.meta.releaseDate, null);
    assert.equal(facts.meta.shippedTag, null);
    assert.deepEqual(facts.shipped, []);
  } finally { cleanup(root); }
});
