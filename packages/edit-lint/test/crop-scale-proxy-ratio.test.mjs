import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { findCropScaleProxyRatioFindings, lintProject } from "../src/edit-lint.mjs";
import { resolveFfmpeg, resolveFfprobe } from "../../media-bin/src/index.mjs";

// 申し送り: コミット 36deabb5 で「書き出しがプレビュー用プロキシを優先」が直った結果、
// 回避策期間に保存された edit.json（crop を持つ cut の scale へ原本/プロキシの寸法比を入れて
// 自己整合させていた）は、原本を復号する現在の書き出しで構図が寸法比の分だけ膨らむ。
// 偶然比が一致する正当なズームもあり得るため warning で知らせるだけにする。
const CHECK = "media.crop-scale-proxy-ratio";

function entry(overrides = {}) {
  return {
    item: {
      id: "split-right",
      crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
      transform: { x: 480, y: 0, scale: 2, rotate: 0 },
      ...overrides,
    },
    sourceId: "zoom",
    itemPath: "edit.json#tracks[1].items[0]",
  };
}

const ratio2 = () => ({
  ratio: 2,
  original: { width: 3840, height: 2160 },
  proxy: { width: 1920, height: 1080 },
});

test("回避策期間の値（crop 付き cut の scale = 原本/プロキシ比）を warning で知らせる", () => {
  const findings = findCropScaleProxyRatioFindings([entry()], () => ratio2());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].check, CHECK);
  assert.equal(findings[0].path, "edit.json#tracks[1].items[0].transform.scale");
  // 「なぜ疑わしいか」と「どう直すか」の両方が読み取れること。
  assert.match(findings[0].message, /3840x2160 ÷ 1920x1080 = 2/u);
  assert.match(findings[0].message, /回避策の値/u);
  assert.match(findings[0].message, /原本基準（通常 1）へ戻して/u);
});

test("同じ素材・同じ scale の item は 1 件へまとめ、素材が違えば別件で出す", () => {
  // 半々配置の案件は同じ手当てが 100 件近く並ぶ（実機 2026-09-15 は 95 件）。
  const entries = Array.from({ length: 95 }, (unused, index) => ({
    ...entry(),
    itemPath: `edit.json#tracks[1].items[${index}]`,
  }));
  entries.push({
    ...entry({ transform: { scale: 3 } }),
    sourceId: "naka",
    itemPath: "edit.json#tracks[0].items[0]",
  });
  const ratios = {
    zoom: ratio2(),
    naka: { ratio: 3, original: { width: 3840, height: 2160 }, proxy: { width: 1280, height: 720 } },
  };
  const findings = findCropScaleProxyRatioFindings(entries, sourceId => ratios[sourceId] ?? null);
  assert.deepEqual(findings.map(finding => finding.path), [
    "edit.json#tracks[1].items[0].transform.scale",
    "edit.json#tracks[0].items[0].transform.scale",
  ]);
  assert.match(findings[0].message, /素材 zoom の crop を持つ item 95 件/u);
  assert.match(findings[1].message, /素材 naka の crop を持つ item 1 件/u);
});

test("浮動小数の丸め差は同じ値として拾う（原本 ÷ プロキシをそのまま書いた値）", () => {
  const findings = findCropScaleProxyRatioFindings(
    [entry({ transform: { scale: 2.0000001 } })],
    () => ratio2(),
  );
  assert.equal(findings.length, 1);
});

test("比と一致しない scale（正当なズーム）は知らせない", () => {
  assert.deepEqual(
    findCropScaleProxyRatioFindings([entry({ transform: { scale: 1.5 } })], () => ratio2()),
    [],
  );
});

test("crop の無い cut は対象外", () => {
  const item = entry();
  delete item.item.crop;
  assert.deepEqual(findCropScaleProxyRatioFindings([item], () => ratio2()), []);
});

test("scale の宣言が無い cut は対象外", () => {
  assert.deepEqual(findCropScaleProxyRatioFindings([entry({ transform: { x: 480 } })], () => ratio2()), []);
  const noTransform = entry();
  delete noTransform.item.transform;
  assert.deepEqual(findCropScaleProxyRatioFindings([noTransform], () => ratio2()), []);
});

test("proxy 宣言が無い / 寸法が読めない source は対象外（誤検知を出さない）", () => {
  assert.deepEqual(findCropScaleProxyRatioFindings([entry()], () => null), []);
  assert.deepEqual(findCropScaleProxyRatioFindings([entry()], () => undefined), []);
});

test("等寸プロキシ（比 1）は既定値 scale=1 と区別できないので対象外", () => {
  const equalSize = () => ({
    ratio: 1,
    original: { width: 1920, height: 1080 },
    proxy: { width: 1920, height: 1080 },
  });
  assert.deepEqual(
    findCropScaleProxyRatioFindings([entry({ transform: { scale: 1 } })], equalSize),
    [],
  );
});

function mediaBinaries() {
  try {
    return { ffmpeg: resolveFfmpeg(), ffprobe: resolveFfprobe() };
  } catch {
    return null;
  }
}

function makeClip(ffmpeg, filePath, size) {
  const result = spawnSync(ffmpeg, [
    "-y", "-v", "error",
    "-f", "lavfi", "-i", `color=c=black:s=${size}:r=30:d=1`,
    "-pix_fmt", "yuv420p", filePath,
  ], { encoding: "utf8" });
  return result.status === 0;
}

function editWith({ proxy, scale }) {
  return {
    version: 2,
    output: { width: 1280, height: 720, fps: 30, geometry: "source" },
    sources: [{ id: "zoom", path: "assets/zoom.mp4", proxy }],
    tracks: [{
      id: "v1",
      lane: "visual",
      items: [{
        id: "split-right",
        at: 0,
        duration: 30,
        crop: { x: 0.25, y: 0, w: 0.5, h: 1 },
        transform: { x: 320, y: 0, scale, rotate: 0 },
        source: { kind: "media", src: "zoom", in: 0, out: 1 },
      }],
    }],
  };
}

// ffprobe が無いと寸法が読めないので、検査は --media 指定時だけ動く（media.* 系と同じ扱い）。
// ここは実 ffmpeg / ffprobe で端から端まで通す確認。用意できない機械では skip する。
test("--media で実 ffprobe を通し、原本 1280x720 / プロキシ 640x360 の案件を拾う", async (t) => {
  const binaries = mediaBinaries();
  if (binaries === null) return t.skip("ffmpeg / ffprobe が無い");
  const root = await mkdtemp(join(tmpdir(), "edit-lint-crop-scale-proxy-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await mkdir(join(root, ".akari", "work", "proxy"), { recursive: true });
    const original = join(root, "assets", "zoom.mp4");
    const proxy = join(root, ".akari", "work", "proxy", "zoom.mp4");
    if (!makeClip(binaries.ffmpeg, original, "1280x720")
      || !makeClip(binaries.ffmpeg, proxy, "640x360")) {
      return t.skip("ffmpeg で検証用クリップを作れない");
    }
    const lintOptions = {
      media: true,
      ffprobeCommand: binaries.ffprobe,
      checkedAt: "2000-01-01T00:00:00.000Z",
      writeReports: false,
    };
    const relativeProxy = ".akari/work/proxy/zoom.mp4";

    await writeFile(join(root, "edit.json"),
      `${JSON.stringify(editWith({ proxy: relativeProxy, scale: 2 }), null, 2)}\n`, "utf8");
    const workaround = (await lintProject(root, lintOptions)).findings
      .filter(finding => finding.check === CHECK);
    assert.equal(workaround.length, 1, JSON.stringify(workaround, null, 2));
    assert.equal(workaround[0].severity, "warning");
    assert.match(workaround[0].message, /1280x720 ÷ 640x360 = 2/u);

    // 正当なズーム（比と一致しない scale）。
    await writeFile(join(root, "edit.json"),
      `${JSON.stringify(editWith({ proxy: relativeProxy, scale: 1.5 }), null, 2)}\n`, "utf8");
    assert.deepEqual(
      (await lintProject(root, lintOptions)).findings.filter(finding => finding.check === CHECK),
      [],
    );

    // proxy 宣言が無い source。
    await writeFile(join(root, "edit.json"),
      `${JSON.stringify(editWith({ proxy: null, scale: 2 }), null, 2)}\n`, "utf8");
    assert.deepEqual(
      (await lintProject(root, lintOptions)).findings.filter(finding => finding.check === CHECK),
      [],
    );

    // --media 無しでは寸法を読まないので出ない（media.* 系の既存の扱いに合わせる）。
    await writeFile(join(root, "edit.json"),
      `${JSON.stringify(editWith({ proxy: relativeProxy, scale: 2 }), null, 2)}\n`, "utf8");
    const withoutMedia = await lintProject(root, {
      checkedAt: "2000-01-01T00:00:00.000Z", writeReports: false,
    });
    assert.deepEqual(withoutMedia.findings.filter(finding => finding.check === CHECK), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
