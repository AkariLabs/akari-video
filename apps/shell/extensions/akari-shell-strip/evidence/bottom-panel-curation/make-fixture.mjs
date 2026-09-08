// L1 fixture builder (wrapper-authored, verification-only; not product source).
// templates/project-default を <dest> へ複写し、edit.json / assets/source.mp4 を置く。
import { cpSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../../../../../..');
const dest = process.argv[2];
if (!dest) { throw new Error('usage: make-fixture.mjs <dest>'); }
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(path.join(REPO, 'templates/project-default'), dest, { recursive: true });
mkdirSync(path.join(dest, 'assets'), { recursive: true });

const ffmpeg = path.join(REPO, 'packages/media-bin/vendor/darwin-arm64/ffmpeg');
const source = path.join(dest, 'assets/source.mp4');
if (existsSync(ffmpeg)) {
    execFileSync(ffmpeg, ['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30', '-t', '2',
        '-pix_fmt', 'yuv420p', source], { stdio: 'ignore' });
}
writeFileSync(path.join(dest, 'edit.json'), JSON.stringify({
    version: 2,
    output: { width: 1920, height: 1080, fps: 30 },
    sources: [{ id: 'source', path: 'assets/source.mp4' }],
    tracks: [{ id: 'video', kind: 'video', clips: [{ id: 'c1', source: 'source', t: 0, in: 0, duration: 2 }] }]
}, null, 2) + '\n');
console.log(dest);
