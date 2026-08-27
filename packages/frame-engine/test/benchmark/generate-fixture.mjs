import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import migrate from '../../../edit-store/lib/migrate/index.js';

const directory = dirname(fileURLToPath(import.meta.url));
const generated = resolve(directory, '.generated');
const fixture = resolve(generated, 'source-1080p.mp4');
const renderProject = resolve(generated, 'render-cut-project');
mkdirSync(renderProject, { recursive: true });

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}

const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');
let valid = false;
try {
  const probe = execFileSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height:format=duration', '-of', 'json', fixture
  ], { encoding: 'utf8' });
  const parsed = JSON.parse(probe);
  valid = parsed.streams?.[0]?.width === 1920 && parsed.streams?.[0]?.height === 1080
    && Number(parsed.format?.duration) >= 29.9;
} catch {
  valid = false;
}
if (!valid) {
  const common = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=30',
    '-an'
  ];
  const hardware = spawnSync(ffmpeg, [
    ...common, '-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8M', '-g', '60',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', fixture
  ], { stdio: 'inherit' });
  if (hardware.status !== 0) {
    execFileSync(ffmpeg, [
      ...common, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-threads', '4', '-g', '60',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
      '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', fixture
    ], { stdio: 'inherit' });
  }
}

const edit = JSON.parse(readFileSync(resolve(directory, 'edit.json'), 'utf8'));
edit.cuts = edit.cuts.map(({ src, ...cut }) => cut);
const migrated = migrate.migrateEditToV2(edit);
if (!migrated.ok) throw new Error(`benchmark edit migration failed: ${migrated.blockers.join(' / ')}`);
writeFileSync(resolve(renderProject, 'edit.json'), `${JSON.stringify(migrated.doc, null, 2)}\n`);
copyFileSync(fixture, resolve(renderProject, 'source-1080p.mp4'));
process.stdout.write(`${fixture}\n`);
