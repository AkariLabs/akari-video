import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPartMask,
  expandBagOverlays,
  projectBagChildren,
  scanHtmlParts,
} from "../src/parts.mjs";

test("scanHtmlParts は引用符・大小文字を受理し、コメント/script/style を無視して重複を保つ", () => {
  const html = [
    '<!-- <div data-akari-part="comment"> -->',
    '<SCRIPT>const x = `<b data-akari-part="script">`;</SCRIPT>',
    '<style>.x::before{content:"<i data-akari-part=style>"}</style>',
    '<div DATA-AKARI-PART="A"></div>',
    "<p data-akari-part='B'></p>",
    '<span data-akari-part=C></span>',
    '<em data-akari-part="A"></em>',
  ].join("");
  assert.deepEqual(scanHtmlParts(html), [
    { id: "A", order: 0 },
    { id: "B", order: 1 },
    { id: "C", order: 2 },
    { id: "A", order: 3 },
  ]);
});

test("projectBagChildren は exclude 後の写しを同じ part の明示子で置換する", () => {
  const explicit = {
    id: "bag.B", at: 2, duration: 8,
    source: { kind: "html", html: "card.html", part: "B" },
  };
  const bag = {
    id: "bag", at: 1, duration: 10,
    source: { kind: "html", html: "card.html", exclude: ["C"] },
    children: [explicit],
  };
  const children = projectBagChildren(bag, ["A", "B", "C"].map((id, order) => ({ id, order })));
  assert.equal(children.length, 2);
  assert.deepEqual(children.map(child => child.id), ["bag#A", "bag.B"]);
  assert.equal(children[0].at, 1);
  assert.equal(children[0].duration, 10);
  assert.equal(children[0].source.part, "A");
  assert.equal(children[1], explicit);
});

test("applyPartMask は visibility マスク、style 追記、textContent 相当の置換を行う", () => {
  const input = '<section><p data-akari-part="A">元</p><p data-akari-part="B" style="font-weight:700">本文<strong>子</strong></p></section>';
  const [html, result] = applyPartMask(input, "B", {
    style: { color: "red", content: 'a;"b' },
    text: '<img src=x onerror="alert(1)">&',
  });
  assert.deepEqual(result, { missing: false });
  assert.match(html, /^<div data-akari-part-mask="B"><style>/u);
  assert.match(html, /visibility:hidden !important/u);
  assert.doesNotMatch(html, /display\s*:\s*none/iu);
  assert.match(html, /style="font-weight:700;color:red;content:a\\3B \\22 b"/u);
  assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;&amp;/u);
  assert.doesNotMatch(html, /<strong>子<\/strong>/u);

  const missingInput = '<div data-akari-part="A">A</div>';
  const [missingHtml, missing] = applyPartMask(missingInput, "Z", { text: "x" });
  assert.equal(missingHtml, missingInput);
  assert.deepEqual(missing, { missing: true });

  const hostileId = 'x</style><script>alert(1)</script>';
  const [hostileHtml] = applyPartMask(`<div data-akari-part="${hostileId}">x</div>`, hostileId);
  const maskStyle = hostileHtml.match(/^<div[^>]*><style>([\s\S]*?)<\/style>/u)?.[1] ?? '';
  assert.doesNotMatch(maskStyle, /[<>]/u);
});

test("expandBagOverlays は全写しを無加工 1 件へ統合し、名札なしもバイト不変", () => {
  const labeled = '<div data-akari-part="A">A</div><div data-akari-part="B">B</div>';
  const plain = "<div>plain</div>\n";
  const internal = {
    tracks: [{ id: "v1", items: [
      htmlItem("all", 0, 30, "labeled.html"),
      htmlItem("plain", 30, 30, "plain.html"),
    ] }],
  };
  const records = expandBagOverlays(internal, reference => ({ "labeled.html": labeled, "plain.html": plain })[reference]);
  assert.equal(records.length, 2);
  assert.equal(records[0].html, "labeled.html");
  assert.equal(records[1].html, "plain.html");
});

test("expandBagOverlays は切り詰めのない非整数秒 duration/start を宣言値のまま保つ", () => {
  const start = 264 / 30;
  const duration = 96 / 30;
  assert.equal(Object.is((start + duration) - start, duration), false, "fixture must expose subtraction drift");

  const plain = "<div>plain</div>";
  const plainRecords = expandBagOverlays({
    tracks: [{ id: "v1", items: [htmlItem("plain-fraction", start, duration, "plain.html")] }],
  }, () => plain);
  assert.equal(Object.is(plainRecords[0].start, start), true);
  assert.equal(Object.is(plainRecords[0].duration, duration), true);

  const bag = htmlItem("bag-fraction", 8, 10, "card.html", { source: { exclude: ["B"] } });
  bag.children = [htmlItem("bag-fraction.A", start, duration, "card.html", {
    parentId: "bag-fraction",
    source: { part: "A" },
  })];
  const bagRecords = expandBagOverlays({ tracks: [{ id: "v1", items: [bag] }] },
    () => '<div data-akari-part="A">A</div><div data-akari-part="B">B</div>');
  const explicit = bagRecords.find(record => record.id === "bag-fraction.A");
  assert.equal(Object.is(explicit.start, start), true);
  assert.equal(Object.is(explicit.duration, duration), true);
});

test("expandBagOverlays は袋、分離部品、hidden、純グループ合成と親クリップを射影する", () => {
  const card = '<div data-akari-part="A">A</div><div data-akari-part="B">B</div><div data-akari-part="C">C</div>';
  const plain = "<div>plain</div>";
  const bag = htmlItem("bag", 0, 4, "card.html", {
    source: { exclude: ["C"] },
    declaration: { transform: { x: 7 }, opacity: 0.75, vars: { "--a": "parent" } },
  });
  bag.children = [htmlItem("bag.B", 0.2, 3.8, "card.html", {
    parentId: "bag",
    source: { part: "B", style: { color: "red" }, text: "差し替え" },
    declaration: { transform: { y: -40 }, vars: { "--b": "child" } },
  })];
  const detached = htmlItem("bag.C", 0, 4, "card.html", { source: { part: "C" } });
  const hidden = htmlItem("hidden", 0, 4, "plain.html", { declaration: { hidden: true } });
  const group = {
    id: "g", at: 1, duration: 2, source: { kind: "group" },
    declaration: { transform: { x: 100, y: 50, scale: 2, rotate: 90 }, opacity: 0.5, blend: "screen" },
    children: [htmlItem("g.child", 1.5, 3, "plain.html", {
      declaration: { transform: { x: 10, y: 5, scale: 0.5, rotate: -15 }, opacity: 0.8 },
    })],
  };
  const internal = { tracks: [{ id: "v1", items: [bag, hidden, group] }, { id: "v2", items: [detached] }] };
  const records = expandBagOverlays(internal, reference => reference === "card.html" ? card : plain);

  assert.deepEqual(records.map(record => record.id), ["bag#A", "bag.B", "g.child", "bag.C"]);
  assert.equal(records.filter(record => record.html.includes("data-akari-part-mask")).length, 3);
  const explicit = records.find(record => record.id === "bag.B");
  assert.equal(explicit.start, 0.2);
  assert.equal(explicit.duration, 3.8);
  assert.deepEqual(explicit.transform, { x: 7, y: -40, scale: 1, rotate: 0 });
  assert.deepEqual(explicit.vars, { "--a": "parent", "--b": "child" });
  assert.match(explicit.html, /color:red/u);
  assert.match(explicit.html, /差し替え/u);

  const grouped = records.find(record => record.id === "g.child");
  assert.equal(grouped.start, 1.5);
  assert.equal(grouped.duration, 1.5, "child end is clipped to the group end");
  assert.ok(Math.abs(grouped.transform.x - 90) < 1e-9);
  assert.ok(Math.abs(grouped.transform.y - 70) < 1e-9);
  assert.equal(grouped.transform.scale, 1);
  assert.equal(grouped.transform.rotate, 75);
  assert.equal(grouped.opacity, 0.4);
  assert.equal(grouped.blend, "screen");
});

function htmlItem(id, at, duration, html, overrides = {}) {
  return {
    id,
    at,
    duration,
    source: { kind: "html", html, ...(overrides.source ?? {}) },
    declaration: { id, html, start: at, duration, track: 0, ...(overrides.declaration ?? {}) },
    children: [],
    ...(overrides.parentId !== undefined ? { parentId: overrides.parentId } : {}),
  };
}
