// 字幕貼り付けの採番 L1 用フィクスチャ生成（検証専用）。元の fieldtest は読むだけ。
//
// 親票（timeline-copy-paste）のフィクスチャは captions.json の行に `src` が無く、
// sources が 2 本以上ある edit では caption-display が MISSING_SOURCE で落ちて
// 字幕チップが出なかった。ここでは全行に `src` を付ける。
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FPS = 30;

/** cuts 1 段（take-a / take-b）+ 字幕バッグ 1 段。字幕は take-a（0〜6 秒）の中に置く。 */
export function fixtureEdit() {
    return {
        version: 2,
        output: { width: 1280, height: 720, fps: FPS },
        sources: [
            { id: 'a', path: 'assets/take-a.mp4' },
            { id: 'b', path: 'assets/take-b.mp4' }
        ],
        tracks: [
            { id: 'v-main', lane: 'visual', items: [
                { id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6 } },
                { id: 'cut-b', at: 180, duration: 150, source: { kind: 'media', src: 'b', in: 0, out: 5 } }
            ] },
            { id: 'v-caps', lane: 'visual', items: [
                { id: 'caps', name: '字幕', at: 0, duration: 330,
                    source: { kind: 'captions', path: 'captions.json', exclude: [] } }
            ] }
        ]
    };
}

/** c-0001 〜 c-0006。貼り付け後の新しい行が c-0007 になることを実機で見るための並び。 */
export function fixtureCaptions() {
    return Array.from({ length: 6 }, (_, index) => ({
        id: `c-${String(index + 1).padStart(4, '0')}`,
        start: Number((0.4 + index * 0.8).toFixed(3)),
        end: Number((1.0 + index * 0.8).toFixed(3)),
        text: `字幕 ${index + 1}`,
        speaker: null,
        sourceRef: null,
        edited: false,
        src: 'a'
    }));
}

export async function createFixtureProject(root, fieldtestRoot) {
    const assets = path.join(root, 'assets');
    await mkdir(assets, { recursive: true });
    const source = path.join(fieldtestRoot, '2026-08-31-object-tree-manual-test/assets');
    await cp(path.join(source, 'take-a.mp4'), path.join(assets, 'take-a.mp4'));
    await cp(path.join(source, 'take-b.mp4'), path.join(assets, 'take-b.mp4'));
    await writeFile(path.join(root, 'edit.json'), JSON.stringify(fixtureEdit(), null, 2) + '\n');
    await writeFile(path.join(root, 'captions.json'), JSON.stringify(fixtureCaptions(), null, 2) + '\n');
    return root;
}
