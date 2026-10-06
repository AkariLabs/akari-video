import { cp, copyFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const base = process.argv[2] || await mkdtemp(join(tmpdir(), 'tl-transport-keys-'));
const workspace = join(base, 'tl-transport-keys-workspace');
const userData = join(base, 'tl-transport-keys-user-data');
const config = join(base, 'tl-transport-keys-config');
const akariHome = join(base, 'tl-transport-keys-home');
const template = fileURLToPath(new URL('../../../../../../templates/project-default/', import.meta.url));
const video = fileURLToPath(new URL('../../../akari-preview/evidence/preview-audio-wiring/fixture/fixture-video.mp4', import.meta.url));

await mkdir(base, { recursive: true });
await cp(template, workspace, { recursive: true });
await Promise.all([userData, config, akariHome, join(workspace, 'assets')].map(directory =>
    mkdir(directory, { recursive: true })));
await copyFile(video, join(workspace, 'assets', 'clip.mp4'));

const cuts = [0, 180, 360, 540].map((at, index) => ({
    id: `cut-${index + 1}`, at, duration: 180,
    source: { kind: 'media', src: 'clip', in: 0, out: 6 }
}));
const edit = {
    version: 2,
    output: { width: 640, height: 360, fps: 30 },
    sources: [{ id: 'clip', path: 'assets/clip.mp4' }],
    tracks: [
        { id: 'main', lane: 'visual', items: cuts },
        { id: 'locked', lane: 'visual', items: [{
            id: 'locked-clip', at: 30, duration: 30,
            source: { kind: 'media', src: 'clip', in: 0, out: 1 }
        }] }
    ]
};
await writeFile(join(workspace, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
console.log(JSON.stringify({ base, workspace, userData, config, akariHome, port: 9464 }));
