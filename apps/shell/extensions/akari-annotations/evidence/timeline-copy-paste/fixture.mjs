// タイムラインのコピー / 貼り付け / 複製 L1 用の作業場フィクスチャ生成（検証専用）。
// 実素材は fieldtest から複製するだけで、元のプロジェクトは読むだけ。
import { cp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const FPS = 30;

/**
 * 段の並びは「配列先頭 = 画面最下段」。cuts（v-main）・overlay 3 段（html 先頭 = overlays 判定）・
 * captions・audio(sfx) を用意し、契約の (a)〜(g) を 1 プロジェクトで踏めるようにする。
 * テロップ（ATF）は退役済みで保存後 lint がフッターを占有するため、時刻トラックは html を使う。
 */
export function fixtureEdit() {
    return {
        version: 2,
        output: { width: 1280, height: 720, fps: FPS },
        sources: [
            { id: 'a', path: 'assets/take-a.mp4' },
            { id: 'b', path: 'assets/take-b.mp4' },
            { id: 'se', path: 'assets/se.mp3' }
        ],
        tracks: [
            { id: 'a1', lane: 'audio', items: [
                { id: 'sfx-1', at: 30, duration: 45, role: 'sfx',
                    source: { kind: 'media', src: 'se', in: 0, out: 1.5 } }
            ] },
            { id: 'v-main', lane: 'visual', items: [
                { id: 'cut-a', at: 0, duration: 180, source: { kind: 'media', src: 'a', in: 0, out: 6 } },
                { id: 'cut-b', at: 180, duration: 150, source: { kind: 'media', src: 'b', in: 0, out: 5 } }
            ] },
            { id: 'v-ovl1', lane: 'visual', items: [
                { id: 'ovl-1', at: 15, duration: 45,
                    source: { kind: 'html', path: 'overlays/card-1.html', exclude: [] } }
            ] },
            { id: 'v-ovl2', lane: 'visual', items: [
                { id: 'ovl-2', at: 60, duration: 45,
                    source: { kind: 'html', path: 'overlays/card-2.html', exclude: [] } }
            ] },
            { id: 'v-ovl3', lane: 'visual', items: [
                { id: 'ovl-3', at: 105, duration: 45,
                    source: { kind: 'html', path: 'overlays/card-3.html', exclude: [] } }
            ] },
            { id: 'v-caps', lane: 'visual', items: [
                { id: 'caps', name: '字幕', at: 0, duration: 330,
                    source: { kind: 'captions', path: 'captions.json', exclude: [] } }
            ] }
        ]
    };
}

export async function createFixtureProject(root, fieldtestRoot) {
    const assets = path.join(root, 'assets');
    await mkdir(assets, { recursive: true });
    const source = path.join(fieldtestRoot, '2026-08-31-object-tree-manual-test/assets');
    await cp(path.join(source, 'take-a.mp4'), path.join(assets, 'take-a.mp4'));
    await cp(path.join(source, 'take-b.mp4'), path.join(assets, 'take-b.mp4'));
    await cp(path.join(source, 'bgm.mp3'), path.join(assets, 'se.mp3'));
    await mkdir(path.join(root, 'overlays'), { recursive: true });
    for (const index of [1, 2, 3]) {
        // overlay HTML は「均衡した単一ルート要素」であること（edit-lint overlays.html-root）。
        await writeFile(path.join(root, `overlays/card-${index}.html`),
            `<div style="position:absolute;left:80px;top:${120 * index}px;color:#fff;font:48px sans-serif">CARD ${index}</div>\n`);
    }
    await writeFile(path.join(root, 'edit.json'), JSON.stringify(fixtureEdit(), null, 2) + '\n');
    await writeFile(path.join(root, 'captions.json'), JSON.stringify([
        { id: 'c-0001', start: 0.4, end: 1.8, text: 'コピーの検証', speaker: null, sourceRef: null, edited: false }
    ], null, 2) + '\n');
    return root;
}
