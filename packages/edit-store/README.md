# edit-store — AI のスクリプト API

`edit-store` は、AI が AKARI Video プロジェクトを `openProject → 直す → save()` の 3 段で編集するためのスクリプト API です。人間が `edit.json`、`captions.json`、`motion/*.json` を直接編集する前提は置きません。

```js
import { openProject } from '@akari-video/edit-store/lib/project';

const p = await openProject('/path/to/project');
p.edit.update('title', { opacity: 0.8 });
const result = await p.save();
console.log(result.written);
```

## API

```ts
openProject(dir: string, opts?: { editFile?: string }): Promise<Project>

project.edit.find(id: string): ProjectItemV2 | undefined
project.edit.walk(fn: (item, parent, track) => void): void
project.edit.parentOf(id: string): ProjectItemV2 | undefined
project.edit.update(id: string, patch: Partial<ProjectItemV2>): ProjectItemV2
project.edit.move(id: string, target: { track?: string; parent?: string; index?: number }): ProjectItemV2
project.edit.insert(targetId: string, item: ProjectItemV2, index?: number): ProjectItemV2
project.edit.remove(id: string): ProjectItemV2
project.edit.detach(id: string, target: { track: 'above' | string }): ProjectItemV2
project.edit.group(ids: string[], options?: { name?: string }): {
  group: ProjectItemV2;
  changedOrderIds: string[];
}
project.edit.ungroup(id: string): ProjectItemV2[]

project.captions: { rows: CaptionRecord[]; defaultTextStyle?: CaptionTextStyle }
project.motion(groupId: string): Promise<MotionFileV0>
project.save(): Promise<{ written: string[]; findings: EditLintFinding[] }>
```

操作対象、親、段、グループ、袋はすべて id で指定します。cut 番号や layer 番号のような、配列 index を対象識別子にする API はありません。`move` / `insert` の省略可能な `index` は、id で特定した置き先内部での挿入順だけを指定します。

`save()` は正規直列化後のバイトが元ファイルと異なるファイルだけを同期 lint に通し、全候補を一度に原子的保存します。error があれば何も書きません。

## 正規形

```jsonc
{
  "version": 2,
  "output": { "width": 1920, "height": 1080, "fps": 30 },
  "sources": [
    { "id": "main", "path": "assets/talk.mp4" }
  ],
  "tracks": [
    { "id": "v1", "lane": "visual", "items": [
      { "id": "c1", "at": 0, "duration": 195, "source": { "kind": "media", "src": "main", "in": 12, "out": 18.5 } },
      { "id": "c2", "at": 195, "duration": 210, "source": { "kind": "media", "src": "main", "in": 40, "out": 47 } }
    ] },
    { "id": "v2", "lane": "visual", "items": [
      { "id": "s01", "name": "オープニング", "at": 0, "duration": 120, "source": { "kind": "html", "path": "overlays/s01.html", "exclude": ["C"] }, "items": [
        { "id": "s01.B", "at": 6, "duration": 114, "transform": { "y": -40 }, "source": { "kind": "html", "path": "overlays/s01.html", "part": "B" } }
      ] }
    ] },
    { "id": "v3", "lane": "visual", "items": [
      { "id": "s01.C", "at": 30, "duration": 60, "keyframes": { "path": "motion/s01.json", "count": 14 }, "source": { "kind": "html", "path": "overlays/s01.html", "part": "C" } }
    ] },
    { "id": "v4", "lane": "visual", "items": [
      { "id": "captions", "name": "字幕", "at": 0, "duration": 405, "source": { "kind": "captions", "path": "captions.json", "exclude": [] }, "items": [] }
    ] }
  ]
}
```

## AI の読み方

1. `edit.json` / `captions.json` / `motion/*.json` を全文 Read しない。`grep -n '"id": "<id>"'` → 該当行だけ Read → Edit。木の構造を見たいときは `grep -n '"kind": "group"\|"items": \['` のように外枠だけ読む。
2. 書き込みは (a) edit-store のスクリプト API 経由、または (b) 該当行の直接 Edit + 保存時 lint（write-gate 相当を CLI で通す）。どちらでも lint ゲートは必ず通る。
3. 一括操作（「1:00 以降の字幕を 0.5 秒ずらす」等）は AI がスクリプトを書く。前もって一括コマンドを用意しない。
4. 動きを書くときは L0 プリセット / L2 アニメーターを既定にする（数個の値で済む）。L1 の手打ちキーフレームは主に人間がフォーカスモードで作る。
5. 観察・手術のための CLI コマンド（`akari edit tree` / `move` / `group` …）は作らない（ファイルが API）。

## 例

60 秒以降に始まる字幕だけを 0.5 秒後ろへずらします。

```sh
node examples/shift-captions-after.mjs <project> 60 0.5
```

グループ `g1` の子の親相対 `at` / `duration` と、親の `duration` を半分にします。

```sh
node examples/speed-up-group.mjs <project> g1
```

どちらも最後に `save()` を呼び、書いたプロジェクト相対パスの配列を stdout へ出します。
