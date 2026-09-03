import assert from "node:assert/strict";
import test from "node:test";

import { stripHtmlComments } from "../src/html-scan.mjs";

test("stripHtmlComments removes only complete HTML comments", () => {
  const html = `<div>before</div>
<!-- data-akari-3d-scene
<script>ignored()</script> -->
<style>/* <!-- keep CSS comments --> */ .x { color: red; }</style>
<script type="application/json">{"note":"<!-- keep JSON text -->"}</script>`;
  assert.equal(
    stripHtmlComments(html),
    `<div>before</div>

<style>/* <!-- keep CSS comments --> */ .x { color: red; }</style>
<script type="application/json">{"note":"<!-- keep JSON text -->"}</script>`,
  );
  assert.equal(stripHtmlComments("<div><!-- unfinished"), "<div><!-- unfinished");
  assert.equal(
    stripHtmlComments("<!-- <script type=\"application/json\">{}</script> -->"),
    "",
  );
});
