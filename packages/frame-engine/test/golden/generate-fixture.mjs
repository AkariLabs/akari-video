import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const output = resolve(directory, '.generated/source.mp4');
const sourceB = resolve(directory, '.generated/source-b.mp4');
const still = resolve(directory, '.generated/still.png');
const matteColor = resolve(directory, '.generated/matte-color.mp4');
const matteAlpha = resolve(directory, '.generated/matte-alpha.webm');
const matteMask = resolve(directory, '.generated/matte-mask.mp4');
const colorPatches = resolve(directory, '.generated/color-patches.mp4');
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

function probeStream(file, entries = 'codec_name,profile,pix_fmt,color_range,width,height,r_frame_rate,nb_frames,start_pts') {
  return JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0', '-show_entries', `stream=${entries}`,
    '-of', 'json', file
  ], { encoding: 'utf8' })).streams?.[0];
}

let matteColorValid = isWebCodecsCompatibleH264(matteColor) && everyPixelChanges(matteColor);
try {
  const duration = Number(execFileSync(ffprobe, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', matteColor
  ], { encoding: 'utf8' }).trim());
  matteColorValid = matteColorValid && duration >= 12.9;
} catch { matteColorValid = false; }
if (!matteColorValid) {
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', "nullsrc=size=320x180:rate=30,geq=lum='48+mod(2*X+3*Y+7*N,160)':cb='96+mod(N,48)':cr='160-mod(N,48)'",
    '-t', '13', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-threads', '1',
    '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '0',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', matteColor
  ], { stdio: 'inherit' });
}

let alphaValid = false;
try {
  const stream = JSON.parse(execFileSync(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-count_frames', '-show_entries', 'stream=codec_name,pix_fmt,nb_read_frames:stream_tags=alpha_mode', '-of', 'json', matteAlpha
  ], { encoding: 'utf8' })).streams?.[0];
  const alphaMode = Object.entries(stream?.tags ?? {}).find(([key]) => key.toLowerCase() === 'alpha_mode')?.[1];
  alphaValid = stream?.codec_name === 'vp9' && String(alphaMode) === '1' && Number(stream.nb_read_frames) === 390;
} catch { alphaValid = false; }
if (!alphaValid) {
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=13',
    '-f', 'lavfi', '-i', "nullsrc=size=320x180:rate=30:duration=13,geq=lum='if(between(X,mod(5*N,288),mod(5*N,288)+31),255,0)'",
    '-filter_complex', '[0:v][1:v]alphamerge,format=yuva420p',
    '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0',
    '-b:v', '0', '-crf', '20', '-g', '30', '-row-mt', '1', '-threads', '4', matteAlpha
  ], { stdio: 'inherit' });
}

const maskScript = resolve(directory, '../../../../skills/analyze-footage/bin/person-matte/mask-from-alpha.mjs');
const converted = JSON.parse(execFileSync(process.execPath, [
  maskScript, '--input', matteAlpha, '--out', matteMask, '--force'
], { encoding: 'utf8' }).trim());
if (!converted.ok) throw new Error(`matte mask conversion failed: ${converted.reason}`);
const colorProbe = probeStream(matteColor);
const maskProbe = probeStream(matteMask);
if (maskProbe.codec_name !== 'h264'
  || maskProbe.color_range !== 'pc'
  || !['yuv420p', 'yuvj420p'].includes(maskProbe.pix_fmt)
  || maskProbe.width !== colorProbe.width
  || maskProbe.height !== colorProbe.height
  || maskProbe.r_frame_rate !== colorProbe.r_frame_rate
  || Number(maskProbe.nb_frames) !== Number(colorProbe.nb_frames)
  || Number(maskProbe.start_pts) !== 0) {
  throw new Error(`matte mask fixture does not match color fixture: ${JSON.stringify({ colorProbe, maskProbe })}`);
}

function assertSafeDecodeTail(file, label) {
  const keyframeTimes = execFileSync(ffprobe, [
    '-v', 'error', '-skip_frame', 'nokey', '-select_streams', 'v:0',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', file
  ], { encoding: 'utf8' })
    .trim().split(/\s+/u).map(Number).filter(Number.isFinite);
  const lastKeyframe = keyframeTimes.at(-1);
  const safeLimit = Number(lastKeyframe) - 1;
  if (!(safeLimit > 300 / 30)) {
    throw new Error(`${label} safe decode tail ${safeLimit}s does not cover 300 frames at 30fps`);
  }
}
assertSafeDecodeTail(matteColor, 'matte-color.mp4');
assertSafeDecodeTail(matteAlpha, 'matte-alpha.webm');
assertSafeDecodeTail(matteMask, 'matte-mask.mp4');

const patchColors = [
  [0, 0, 0], [255, 255, 255], [255, 0, 0],
  [0, 255, 0], [0, 0, 255], [0, 255, 255],
  [255, 0, 255], [255, 255, 0], [128, 128, 128],
];
const patchFrames = 15;
const paddingFrames = 60;
const colorPatchFrameCount = patchColors.length * patchFrames + paddingFrames;
const lastPatchSampleSeconds = ((patchColors.length - 1) * patchFrames + 7) / 30;
const colorPatchTailMarginSeconds = 0.25;

function colorPatchesValid() {
  if (!existsSync(colorPatches)) return false;
  try {
    const stream = probeStream(
      colorPatches,
      'codec_name,profile,pix_fmt,color_range,color_space,color_primaries,color_transfer,width,height,nb_frames',
    );
    if (stream.codec_name !== 'h264'
      || !['Baseline', 'Constrained Baseline', 'Main', 'High'].includes(stream.profile)
      || stream.pix_fmt !== 'yuv420p'
      || stream.color_range !== 'tv'
      || stream.color_space !== 'bt709'
      || stream.color_primaries !== 'bt709'
      || stream.color_transfer !== 'bt709'
      || stream.width !== 320
      || stream.height !== 180
      || Number(stream.nb_frames) !== colorPatchFrameCount) return false;
    const raw = execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', colorPatches,
      '-vf', 'scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24',
      '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1',
    ], { maxBuffer: 320 * 180 * 3 * (colorPatchFrameCount + 1) });
    const stride = 320 * 180 * 3;
    return patchColors.every((expected, index) => {
      const frame = index * patchFrames + 7;
      const offset = frame * stride + ((90 * 320 + 160) * 3);
      return expected.every((value, channel) => Math.abs(raw[offset + channel] - value) <= 2);
    });
  } catch {
    return false;
  }
}

if (!colorPatchesValid()) {
  const inputs = patchColors.flatMap(([r, g, b]) => [
    '-f', 'lavfi', '-i',
    `nullsrc=s=320x180:r=30:d=0.5,format=gbrp,geq=r=${r}:g=${g}:b=${b}`,
  ]).concat([
    '-f', 'lavfi', '-i',
    'nullsrc=s=320x180:r=30:d=2,format=gbrp,geq=r=0:g=0:b=0',
  ]);
  execFileSync(ffmpeg, [
    '-hide_banner', '-loglevel', 'error', '-y', ...inputs,
    '-filter_complex', `${Array.from({ length: patchColors.length + 1 }, (_value, index) => `[${index}:v]`).join('')}concat=n=10:v=1:a=0,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p[v]`,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '6',
    '-threads', '1', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0', '-bf', '0',
    '-pix_fmt', 'yuv420p', '-color_range', 'tv', '-color_primaries', 'bt709',
    '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-x264-params', 'colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited',
    '-movflags', '+faststart', colorPatches,
  ], { stdio: 'inherit' });
  if (!colorPatchesValid()) throw new Error('color-patches.mp4 failed BT.709 limited self-verification');
}

function assertColorPatchSafeDecodeTail() {
  const keyframeTimes = execFileSync(ffprobe, [
    '-v', 'error', '-skip_frame', 'nokey', '-select_streams', 'v:0',
    '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'csv=p=0', colorPatches,
  ], { encoding: 'utf8' })
    .trim().split(/\s+/u).map(Number).filter(Number.isFinite);
  const lastKeyframe = keyframeTimes.at(-1);
  const safeLimit = Number(lastKeyframe) - 1;
  const requiredLimit = lastPatchSampleSeconds + colorPatchTailMarginSeconds;
  if (!(safeLimit >= requiredLimit)) {
    throw new Error(
      `color-patches.mp4 safe decode tail ${safeLimit}s is before required ${requiredLimit}s`,
    );
  }
}
assertColorPatchSafeDecodeTail();

process.stdout.write(`${output}\n${sourceB}\n${still}\n${matteColor}\n${matteAlpha}\n${matteMask}\n${colorPatches}\n`);
