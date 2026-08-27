import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const output = resolve(directory, '.generated/source.mp4');
const sourceB = resolve(directory, '.generated/source-b.mp4');
const still = resolve(directory, '.generated/still.png');
mkdirSync(dirname(output), { recursive: true });

function tool(name) {
  const homebrew = `/opt/homebrew/bin/${name}`;
  if (existsSync(homebrew)) return homebrew;
  return execFileSync('/usr/bin/env', ['which', name], { encoding: 'utf8' }).trim();
}

const ffmpeg = tool('ffmpeg');
const ffprobe = tool('ffprobe');
let valid = false;
try {
  execFileSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output
  ], { stdio: 'ignore' });
  const duration = Number(execFileSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', output
  ], { encoding: 'utf8' }).trim());
  valid = duration >= 7.9;
} catch {
  valid = false;
}

if (!valid) {
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=8,hue=h=60*t:s=1',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-threads', '1',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', output
  ], { stdio: 'inherit' });
}

function everyPixelChanges(path) {
  if (!existsSync(path)) return false;
  try {
    const raw = execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', path, '-frames:v', '2',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
    ], { maxBuffer: 320 * 180 * 3 * 3 });
    const stride = 320 * 180 * 3;
    if (raw.length < stride * 2) return false;
    for (let pixel = 0; pixel < 320 * 180; pixel += 1) {
      const offset = pixel * 3;
      if (raw[offset] === raw[stride + offset]
        && raw[offset + 1] === raw[stride + offset + 1]
        && raw[offset + 2] === raw[stride + offset + 2]) return false;
    }
    return true;
  } catch { return false; }
}

function isWebCodecsCompatibleH264(path) {
  if (!existsSync(path)) return false;
  try {
    const probe = JSON.parse(execFileSync(ffprobe, [
      '-v', 'error', '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,profile,pix_fmt', '-of', 'json', path
    ], { encoding: 'utf8' }));
    const stream = probe.streams?.[0];
    return stream?.codec_name === 'h264'
      && ['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(stream?.profile)
      && stream?.pix_fmt === 'yuv420p';
  } catch { return false; }
}

if (!everyPixelChanges(sourceB) || !isWebCodecsCompatibleH264(sourceB)) {
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', "nullsrc=size=320x180:rate=30,geq=lum='64+mod(3*X+5*Y,80)+40*mod(N,2)':cb='128':cr='128'", '-t', '8',
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-threads', '1',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', sourceB
  ], { stdio: 'inherit' });
  if (!everyPixelChanges(sourceB)) throw new Error('source-b.mp4 does not change every pixel between frames 0 and 1');
  if (!isWebCodecsCompatibleH264(sourceB)) throw new Error('source-b.mp4 is not baseline/main/high yuv420p H.264');
}

if (!existsSync(still)) {
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=240x160:rate=1,drawgrid=w=24:h=16:t=2:c=yellow',
    '-frames:v', '1', '-threads', '1', still
  ], { stdio: 'inherit' });
}

process.stdout.write(`${output}\n${sourceB}\n${still}\n`);
