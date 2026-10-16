import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validatePlaybookFiles } from '../../schemas/validate-playbook.mjs';
import { applyPlaybook, createProject } from '../src/index.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

test('applyPlaybook copies both sources, creates three empty edit placeholders and a review sheet', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-playbook-'));
  try {
    const projectDir = join(scratch, 'new');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    const result = await applyPlaybook({ projectDir, playbookDir: join(fixtures, 'playbook-sample'),
      now: new Date('2026-10-15T00:00:00Z'), hasTool: async name => name !== 'voicevox' });
    assert.equal(result.placeholdersAdded, 3);
    assert.deepEqual(result.missingTools, ['voicevox']);
    const validation = await validatePlaybookFiles(result.playbookJsonPath);
    assert.equal(validation.ok, true, validation.errors.join('; '));
    const book = JSON.parse(await readFile(result.playbookJsonPath, 'utf8'));
    assert.equal(book.provenance.appliedFrom.playbookVersion, 1);
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    // r2（2026-10-15 司令塔の裁定）: 音の仮枠は別の段（playbook-placeholders-audio）で頭から並走する
    assert.equal(edit.tracks[0].items.length, 2);
    assert.equal(edit.tracks[0].lane, 'visual');
    const audioTrack = edit.tracks.find(track => track.id === 'playbook-placeholders-audio');
    assert.equal(audioTrack?.items.find(item => item.id === 'playbook-bgm')?.source.kind, 'group');
    assert.equal(audioTrack?.items.find(item => item.id === 'playbook-bgm')?.at, 0);
    assert.deepEqual([edit.output.width, edit.output.height], [1080, 1920]);
    assert.equal(edit.output.caption_style_uid, undefined);
    assert.equal(edit.audio?.role_gains_db, undefined);
    const sheet = await readFile(result.sheetPath, 'utf8');
    assert.match(sheet, /要る道具/);
    assert.match(sheet, /仮枠/);
    assert.match(sheet, /voicevox: 無い/);
    assert.match(sheet, /AKARI 1\.4\.0/);
    assert.match(sheet, /適用元/);
    const rows = ['名前と目的', '深さ', '流れ（確認点つき）', '設定値の数と主な値',
      '仮枠（役割・種類・見本の有無）', '使った部品（入手先・ライセンス・Pro 要否）',
      '要る道具（持っていないものを明記）', 'ライセンス', '出どころ'];
    assert.deepEqual([...sheet.matchAll(/<dt>(.*?)<\/dt>/g)].map(match => match[1]), rows);
    const creationReport = await readFile(join(projectDir, '.akari', 'reports', 'create-project-report.html'), 'utf8');
    assert.equal(sheet.match(/<style>[\s\S]*?<\/style>/)?.[0], creationReport.match(/<style>[\s\S]*?<\/style>/)?.[0]);
    assert.doesNotMatch(sheet, /<script/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('作り方の目標尺は intake に入り、未配線の設定はレポートで明示する', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-playbook-settings-'));
  try {
    const projectDir = join(scratch, 'new');
    const report = await createProject(projectDir, join(repo, 'templates', 'project-default'), {
      beforeCommit: async destination => {
        const intakePath = join(destination, '.akari', 'intake.json');
        const intake = JSON.parse(await readFile(intakePath, 'utf8'));
        intake.target.keep_length = true;
        await writeFile(intakePath, JSON.stringify(intake));
        return applyPlaybook({ projectDir: destination,
          playbookDir: join(fixtures, 'playbook-sample'), hasTool: async () => true });
      }
    });
    const intake = JSON.parse(await readFile(join(projectDir, '.akari', 'intake.json'), 'utf8'));
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    assert.equal(intake.target.duration_s, 60);
    assert.equal(intake.target.keep_length, false);
    for (const key of ['target_duration_sec', 'caption_style_uid', 'caption_position', 'default_transition']) {
      assert.equal(Object.hasOwn(edit.output, key), false, key);
    }
    assert.equal(edit.audio?.role_gains_db, undefined);
    const creationReport = await readFile(report.reportPath, 'utf8');
    const sheet = await readFile(join(projectDir, '.akari', 'reports', 'playbook-sheet.html'), 'utf8');
    for (const key of ['captions.styleUid', 'captions.position', 'transitions.default', 'audio.roles']) {
      assert.match(creationReport, new RegExp(`${key.replace('.', '\\.')}: まだ効かない`));
    }
    assert.equal(creationReport.match(/captions\.styleUid: まだ効かない/g)?.length, 1);
    assert.match(sheet, /captions:.*まだ効かない/);
    assert.match(sheet, /transitions:.*まだ効かない/);
    assert.match(sheet, /audio:.*まだ効かない/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('アプリ経路では作成済みレポートに未配線の設定を一度だけ追記する', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-playbook-app-report-'));
  try {
    const projectDir = join(scratch, 'new');
    const report = await createProject(projectDir, join(repo, 'templates', 'project-default'));
    assert.doesNotMatch(await readFile(report.reportPath, 'utf8'), /captions\.styleUid: まだ効かない/);
    await applyPlaybook({ projectDir, playbookDir: join(fixtures, 'playbook-sample'), hasTool: async () => true });
    const html = await readFile(report.reportPath, 'utf8');
    assert.equal(html.match(/captions\.styleUid: まだ効かない/g)?.length, 1);
    assert.ok(html.indexOf('captions.styleUid: まだ効かない') < html.indexOf('</main>'));
    assert.equal(html.match(/data-akari-playbook-inactive/g)?.length, 1);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('記録 → 取り込み → 記録で設定値を保つ', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-playbook-roundtrip-'));
  try {
    const original = join(scratch, 'original');
    await cp(join(fixtures, 'finished-project-sample'), original, { recursive: true });
    const recorder = join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs');
    const record = project => spawnSync(process.execPath, [recorder, project,
      '--name', '縦の解説', '--category', 'explainer'], { encoding: 'utf8' });
    assert.equal(record(original).status, 0);
    const firstPath = join(original, 'planning', 'playbook.json');
    const first = JSON.parse(await readFile(firstPath, 'utf8'));
    first.settings.targetDurationSec = 47;
    first.settings.captions = { styleUid: 'st_01HZ', position: 'lower' };
    first.settings.transitions = { default: 'dissolve' };
    first.settings.audio = { roles: { voice: -14, bgm: -24 } };
    await writeFile(firstPath, JSON.stringify(first));
    const next = join(scratch, 'next');
    await createProject(next, join(repo, 'templates', 'project-default'));
    await applyPlaybook({ projectDir: next, playbookDir: join(original, 'planning'), hasTool: async () => true });
    assert.equal(record(next).status, 0);
    const again = JSON.parse(await readFile(join(next, 'planning', 'playbook.json'), 'utf8'));
    assert.deepEqual(again.settings, first.settings);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('record helper groups two sources with the same role into one placeholder', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-playbook-'));
  try {
    const project = join(scratch, 'finished');
    await cp(join(fixtures, 'finished-project-sample'), project, { recursive: true });
    const recorded = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--name', '縦の解説', '--category', 'explainer'], { encoding: 'utf8' });
    assert.equal(recorded.status, 0, recorded.stderr);
    const result = await validatePlaybookFiles(join(project, 'planning', 'playbook.json'));
    assert.equal(result.ok, true, result.errors.join('; '));
    const book = JSON.parse(await readFile(join(project, 'planning', 'playbook.json'), 'utf8'));
    const talk = book.placeholders.filter(item => item.role === '話している本人の寄り');
    assert.equal(talk.length, 1);
    assert.equal(talk[0].durationHintSec, 25);
    assert.equal(talk[0].sample, undefined);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

test('applyPlaybook places audio at zero on a separate visual track for the full picture duration', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-playbook-tracks-'));
  try {
    const projectDir = join(scratch, 'new');
    await createProject(projectDir, join(repo, 'templates', 'project-default'));
    await applyPlaybook({ projectDir, playbookDir: join(fixtures, 'playbook-sample'), hasTool: async () => true });
    const edit = JSON.parse(await readFile(join(projectDir, 'edit.json'), 'utf8'));
    const visual = edit.tracks.find(track => track.id === 'playbook-placeholders');
    const audio = edit.tracks.find(track => track.id === 'playbook-placeholders-audio');
    assert.equal(edit.tracks.length, 2);
    assert.equal(visual.name, '仮枠（映像）');
    assert.equal(audio.name, '仮枠（音）');
    assert.deepEqual(visual.items.map(item => [item.id, item.at, item.duration]),
      [['playbook-talking-head', 0, 1200], ['playbook-screen', 1200, 600]]);
    assert.equal(audio.lane, 'visual');
    assert.deepEqual(audio.items.map(item => [item.id, item.at, item.duration]), [['playbook-bgm', 0, 1800]]);
    const lint = spawnSync(process.execPath, [join(repo, 'packages', 'edit-lint', 'bin', 'edit-lint.mjs'), projectDir, '--json'],
      { encoding: 'utf8' });
    assert.equal(lint.status, 0, lint.stderr);
    const findings = JSON.parse(lint.stdout).findings;
    assert.equal(findings.find(finding => finding.check === 'intake.status')?.severity, 'info');
    assert.equal(findings.filter(finding => finding.severity !== 'info').length, 0, JSON.stringify(findings));
  } finally { await rm(scratch, { recursive: true, force: true }); }
});

const ffmpeg = 'ffmpeg';
const ffmpegAvailable = spawnSync(ffmpeg, ['-version'], { stdio: 'ignore' }).status === 0;

test('record helper creates a frame strip and installs a shelf copy', { skip: !ffmpegAvailable }, async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'akari-record-preview-'));
  try {
    const project = join(scratch, 'finished');
    await cp(join(fixtures, 'finished-project-sample'), project, { recursive: true });
    await mkdir(join(project, 'exports'));
    const output = join(project, 'exports', 'sample.mp4');
    const generated = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'testsrc=size=640x360:rate=15', '-t', '6', '-c:v', 'mpeg4', '-q:v', '5', output], { encoding: 'utf8' });
    assert.equal(generated.status, 0, generated.stderr);
    const recorded = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--name', '縦の解説', '--category', 'explainer'],
    { encoding: 'utf8', env: { ...process.env, AKARI_HOME: join(scratch, 'akari-home'), AKARI_FFMPEG: ffmpeg } });
    assert.equal(recorded.status, 0, recorded.stderr);
    const book = JSON.parse(await readFile(join(project, 'planning', 'playbook.json'), 'utf8'));
    assert.ok(book.preview.frames.length >= 3);
    assert.ok(book.preview.frames.every(frame => frame.startsWith('playbook-preview/frames/')));
    const installedRun = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--install'], { encoding: 'utf8', env: { ...process.env, AKARI_HOME: join(scratch, 'akari-home') } });
    assert.equal(installedRun.status, 0, installedRun.stderr);
    const shelf = join(scratch, 'akari-home', 'playbooks', book.id);
    const installed = JSON.parse(await readFile(join(shelf, 'playbook.json'), 'utf8'));
    assert.equal(installed.playbookVersion, book.playbookVersion);
    assert.ok(installed.preview.frames.every(frame => frame.startsWith('preview/frames/')));
    for (const frame of installed.preview.frames) await readFile(join(shelf, frame));
    const dimensions = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(shelf, installed.preview.frames[0])],
    { encoding: 'utf8' });
    assert.equal(dimensions.status, 0, dimensions.stderr);
    assert.equal(dimensions.stdout.trim(), '360,640');
    const frameDirectory = join(project, 'planning', 'playbook-preview', 'frames');
    await writeFile(join(frameDirectory, '05.png'), 'stale frame');
    const rerecorded = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--name', '縦の解説', '--category', 'explainer'], { encoding: 'utf8' });
    assert.equal(rerecorded.status, 0, rerecorded.stderr);
    assert.ok(!(await readdir(frameDirectory)).includes('05.png'));
    const failedPreview = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--name', '縦の解説', '--category', 'explainer'],
    { encoding: 'utf8', env: { ...process.env, AKARI_FFMPEG: join(scratch, 'missing-ffmpeg') } });
    assert.equal(failedPreview.status, 0, failedPreview.stderr);
    assert.match(failedPreview.stderr, /WARN: 見本のコマを作れませんでした/);
    const withoutPreview = JSON.parse(await readFile(join(project, 'planning', 'playbook.json'), 'utf8'));
    assert.equal(withoutPreview.preview, undefined);
    assert.match(await readFile(join(project, 'planning', 'playbook.md'), 'utf8'), /見本のコマはまだ（書き出し後に記録し直す）/);
    assert.deepEqual((await readdir(frameDirectory)).filter(file => file.endsWith('.png')), []);
    const failedProbe = spawnSync(process.execPath, [join(repo, 'skills', 'record-playbook', 'bin', 'record-playbook.mjs'),
      project, '--name', '縦の解説', '--category', 'explainer'],
    { encoding: 'utf8', env: { ...process.env, AKARI_FFPROBE: join(scratch, 'missing-ffprobe') } });
    assert.equal(failedProbe.status, 0, failedProbe.stderr);
    assert.match(failedProbe.stderr, /WARN: 見本のコマを作れませんでした/);
  } finally { await rm(scratch, { recursive: true, force: true }); }
});
