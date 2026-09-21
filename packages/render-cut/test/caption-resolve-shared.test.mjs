import assert from "node:assert/strict";
import test from "node:test";

import { resolveCaptionPlan } from "../src/caption-resolve.mjs";

// 4 経路（render-cut 内部 / preview-server / gpu-export / osr-export）が通る単一入口の回帰。
// 2026-09-20 の 2 件の不具合を、経路ごとではなくここで押さえる:
//   - preview-server が射影前の v2 を渡して display_cues が 0 件になった
//   - gpu-export / osr-export が display_policy を見ずに旧経路で字幕を作り直していた

const POLICY = {
  mode: "single_line_sequential",
  algorithm: "a4-ja-two-fragment-v1",
  unit_metric: "ascii-half-other-one-v1",
  max_line_units: 19,
  minimum_fragment_duration_seconds: 0.72,
  locale: "ja",
  lines: 1,
  wrap: "multi",
};

const output = { width: 1920, height: 1080, fps: 30 };

// 読点を含み、19 units に収まる本文。旧経路は「、」の直後で必ず割るので 2 行になる。
const COMMA_TEXT = "実際に動くのは、入力8B・出力16Bだけ。";

const captionsRoot = (extra = {}) => ({
  display_policy: POLICY,
  captions: [
    { id: "c-0001", start: 0.5, end: 4.0, time_domain: "output", text: COMMA_TEXT },
  ],
  ...extra,
});

// 射影済み（renderer 互換）の edit。cuts を持つのが要件。
const projectedEdit = (cuts = [{ id: "cut-1", src: "base", in: 0, out: 30, at: 0, track: 0 }]) => ({
  version: 1,
  output,
  sources: [{ id: "base", path: "assets/base.png" }],
  cuts,
  overlays: [],
});

const lineCount = html => (String(html).match(/class="akari-caption__line"/gu) ?? []).length;

test("射影済み edit なら display_policy が解決され、読点で行が割れない", () => {
  const plan = resolveCaptionPlan({ captionsRoot: captionsRoot(), edit: projectedEdit() });

  assert.ok(plan.layout, "display_policy 宣言があるので layout が返る");
  assert.equal(plan.layout.schema, "caption-layout/v1");
  assert.ok(plan.overlays.length > 0, "display cue が 1 件も出ないのは退行");
  for (const overlay of plan.overlays) {
    assert.equal(lineCount(overlay.html), 1, `1 行で収まるべき本文が ${lineCount(overlay.html)} 行に割れた`);
  }
});

test("射影前の v2 を渡すと、0 件を返さずに落ちる", () => {
  // これが preview-server が踏んだ形: tracks はあるが cuts が無い。
  // 旧実装は cuts = [] として扱い、occurrence 0 → display_cues 0 を「正常」として返していた。
  const rawV2 = {
    version: 2,
    output,
    sources: [{ id: "base", path: "assets/base.png" }],
    tracks: [{ lane: "visual", items: [{ id: "base-1", source: { id: "base", in: 0, out: 30 }, at: 0, duration: 30 }] }],
  };

  assert.throws(
    () => resolveCaptionPlan({ captionsRoot: captionsRoot(), edit: rawV2 }),
    /unprojected v2 edit/u,
  );
});

test("空のタイムライン（射影後 cuts: []）は誤検知しない", () => {
  const plan = resolveCaptionPlan({
    captionsRoot: captionsRoot(),
    edit: { ...projectedEdit([]), tracks: [{ lane: "visual", items: [] }] },
  });
  assert.ok(plan.layout, "cuts: [] は射影済みなので通す");
});

test("display_policy 未宣言なら旧経路へフォールバックする（opt-in 互換）", () => {
  const plan = resolveCaptionPlan({
    captionsRoot: { captions: captionsRoot().captions },
    edit: projectedEdit(),
  });

  assert.equal(plan.layout, null, "policy が無いのに解決してはいけない");
  assert.equal(plan.overlays.length, 1);
  // 旧経路は「、」の直後で必ず割る。ここが 1 になったら旧経路を通っていない。
  assert.equal(lineCount(plan.overlays[0].html), 2);
});

test("captions.json が無いプロジェクトは空の計画を返す", () => {
  const plan = resolveCaptionPlan({ captionsRoot: undefined, edit: projectedEdit() });
  assert.deepEqual(plan.overlays, []);
  assert.deepEqual(plan.captions, []);
  assert.equal(plan.layout, null);
});

test("edit 側で除外した cue は解決結果に含まれない", () => {
  const root = captionsRoot();
  root.captions.push({ id: "c-0002", start: 5.0, end: 7.0, time_domain: "output", text: "消える字幕" });

  // 除外は tracks[].items[].source（kind: "captions"）の exclude[] で宣言する。
  // renderer 互換 edit は cuts を導出したあとも tracks を保つので、ここから読める。
  const withExclusion = {
    ...projectedEdit(),
    tracks: [{
      lane: "visual",
      items: [{ id: "caption-track", source: { kind: "captions", exclude: ["c-0002"] } }],
    }],
  };

  const plan = resolveCaptionPlan({ captionsRoot: root, edit: withExclusion });
  const ids = new Set(plan.overlays.map(overlay => overlay.generatedFrom));
  assert.ok(!ids.has("c-0002"), "除外指定した cue が解決結果に残っている");
  assert.ok(ids.has("c-0001"), "除外していない cue まで落ちている");
});

test("単語帳の保護語は extra_protected_terms として解決へ届く", () => {
  const longTerm = "入力8B・出力16B";
  const root = {
    display_policy: { ...POLICY, break_hints: { protected_terms: [] } },
    captions: [{ id: "c-0001", start: 0.5, end: 4.0, time_domain: "output", text: COMMA_TEXT }],
  };

  // 保護語を明示的に渡した場合と渡さない場合で、解決が通ること自体は変わらない。
  // ここで押さえたいのは「引数が解決へ到達し、不正値がカーネルで弾かれる」経路の存在。
  const plan = resolveCaptionPlan({ captionsRoot: root, edit: projectedEdit(), extraProtectedTerms: [longTerm] });
  assert.ok(plan.layout, "保護語つきでも解決できる");

  assert.throws(
    () => resolveCaptionPlan({ captionsRoot: root, edit: projectedEdit(), extraProtectedTerms: [""] }),
    /extra_protected_terms/u,
    "不正な保護語はカーネルまで届いて弾かれる",
  );
});

test('source speech and output text both become concurrent overlays with or without display_policy', async () => {
  const { readFile } = await import('node:fs/promises');
  const fixture = JSON.parse(await readFile(new URL('./fixtures/captions-overlap.json', import.meta.url), 'utf8'));
  const edit = { ...projectedEdit([{ src: 'a', in: 0, out: 6, at: 0, track: 0 }]), sources: [{ id: 'a', path: 'assets/base.mp4' }] };
  for (const display_policy of [undefined, POLICY]) {
    const plan = resolveCaptionPlan({ captionsRoot: { ...fixture, display_policy }, edit });
    const visible = plan.overlays.filter(row => row.start <= 3 && 3 < row.start + row.duration);
    assert.equal(visible.length, 2);
    assert.deepEqual(visible.map(row => row.generatedFrom).sort(), ['c-0002', 'c-0004']);
    assert.match(visible.find(row => row.generatedFrom === 'c-0004').html, /上に置いた文字/u);
    assert.match(visible.find(row => row.generatedFrom === 'c-0002').html, /二行目の字幕/u);
  }
});
