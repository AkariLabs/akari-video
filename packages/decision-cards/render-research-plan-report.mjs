#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIME_BY_EXTENSION = new Map([
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

export function renderResearchPlanReport({ plan, planPath = "research-plan.json", generatedAt = new Date() }) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new TypeError("research-plan.json のルートは object である必要があります");
  }
  const structure = plainObject(plan.structure) ? plan.structure : {};
  const chapters = Array.isArray(structure.chapters) ? structure.chapters.filter(plainObject) : [];
  const shots = Array.isArray(structure.shots) ? structure.shots.filter(plainObject) : [];
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const reportTitle = selectedTopicTitle(plan) || "リサーチプラン";
  const generated = generatedAt instanceof Date ? generatedAt.toISOString() : String(generatedAt);

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'" />
  <title>${escapeHtml(reportTitle)} — AKARI Video ビジュアル絵コンテ</title>
  <style>${reportStyles()}</style>
</head>
<body>
  <a class="skip-link" href="#main-content">本文へ移動</a>
  <header class="report-header">
    <div class="report-header__inner">
      <p class="eyebrow">AKARI VIDEO / RESEARCH PLAN</p>
      <h1>${escapeHtml(reportTitle)}</h1>
      <dl class="report-meta" aria-label="レポート基本情報">
        <div><dt>レポート</dt><dd>ビジュアル絵コンテ</dd></div>
        <div><dt>生成日時</dt><dd><time datetime="${escapeHtml(generated)}">${escapeHtml(generated)}</time></dd></div>
        <div><dt>ショット</dt><dd>${shots.length} 件 / ${chapters.length} 章</dd></div>
      </dl>
    </div>
  </header>
  <main id="main-content">
    ${renderTopicSection(plan.topic)}
    ${renderCompetitorSection(plan.target)}
    ${renderStoryboardSection({ chapters, shots, chapterById, planPath })}
    ${renderShotListSection(plan.shot_list)}
  </main>
  <footer class="report-footer">research-plan.json から生成した読み取り専用レポートです。内容の変更はエージェント対話を通じて JSON へ反映します。</footer>
  <script>${tabScript()}</script>
</body>
</html>\n`;
}

export function renderResearchPlanReportFile(inputPath, outputPath = null) {
  const absoluteInput = path.resolve(inputPath);
  const plan = JSON.parse(fs.readFileSync(absoluteInput, "utf8"));
  const absoluteOutput = outputPath
    ? path.resolve(outputPath)
    : path.join(path.dirname(absoluteInput), "research-plan-report.html");
  fs.writeFileSync(
    absoluteOutput,
    renderResearchPlanReport({ plan, planPath: absoluteInput }),
    "utf8",
  );
  return absoluteOutput;
}

function renderTopicSection(topic) {
  const candidates = plainObject(topic) && Array.isArray(topic.candidates) ? topic.candidates : [];
  const rows = candidates.length
    ? candidates.map((candidate, index) => `<tr><th scope="row">${index + 1}</th><td>${escapeHtml(candidate.title || "名称未設定")}</td><td>${escapeHtml(candidate.category || "—")}</td><td>${escapeHtml(candidate.monetization_potential || "—")}</td><td>${escapeHtml(candidate.rationale || "—")}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty-cell">候補ネタはまだありません。</td></tr>`;
  return `<section class="report-section" aria-labelledby="heading-topics"><span class="section-kicker">SECTION 01</span><h2 id="heading-topics">1. 候補ネタランキング</h2><div class="table-scroll" tabindex="0"><table><thead><tr><th>順位</th><th>候補</th><th>型</th><th>収益性</th><th>根拠</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderCompetitorSection(target) {
  const competitors = plainObject(target) && Array.isArray(target.competitors) ? target.competitors : [];
  const rows = competitors.length
    ? competitors.map((competitor) => `<tr><th scope="row">${escapeHtml(competitor.name || "名称未設定")}</th><td>${escapeHtml(competitor.notes || "—")}</td><td>${escapeHtml(competitor.gap || "—")}</td></tr>`).join("")
    : `<tr><td colspan="3" class="empty-cell">競合分析はまだありません。</td></tr>`;
  const japanNotes = plainObject(target?.japan_sns) ? target.japan_sns.notes : null;
  return `<section class="report-section" aria-labelledby="heading-competitors"><span class="section-kicker">SECTION 02</span><h2 id="heading-competitors">2. 競合分析サマリー</h2><p class="notice"><strong>日本語 SNS:</strong> ${escapeHtml(japanNotes || "未調査")}</p><div class="table-scroll" tabindex="0"><table><thead><tr><th>競合</th><th>所見</th><th>機会</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function renderStoryboardSection({ chapters, shots, chapterById, planPath }) {
  return `<section class="report-section storyboard-section" aria-labelledby="heading-storyboard"><span class="section-kicker">SECTION 03 + 04</span><h2 id="heading-storyboard">3–4. ビジュアル絵コンテ</h2><p class="section-lead">カード面で画を追い、構造面で主軸と「挿入して戻る」カットアウェイを確認します。表示は読み取り専用です。</p>
    <div class="storyboard-tabs" role="tablist" aria-label="絵コンテ表示">
      <button type="button" role="tab" id="tab-storyboard-cards" aria-controls="storyboard-cards" aria-selected="true" data-storyboard-tab="cards">カード面</button>
      <button type="button" role="tab" id="tab-storyboard-structure" aria-controls="storyboard-structure" aria-selected="false" data-storyboard-tab="structure" tabindex="-1">構造面</button>
    </div>
    <div id="storyboard-cards" role="tabpanel" aria-labelledby="tab-storyboard-cards" data-storyboard-panel="cards">${renderCardView({ chapters, shots, chapterById, planPath })}</div>
    <div id="storyboard-structure" role="tabpanel" aria-labelledby="tab-storyboard-structure" data-storyboard-panel="structure" hidden>${renderStructureView({ chapters, shots, chapterById })}</div>
  </section>`;
}

function renderCardView({ chapters, shots, chapterById, planPath }) {
  if (shots.length === 0) return `<div class="empty-state" data-card-empty>ショット情報がありません。</div>`;
  const grouped = new Map();
  for (const chapter of chapters) grouped.set(chapter.id, []);
  grouped.set("__unassigned__", []);
  for (const shot of shots) {
    const sequence = shot.sequence || shot.chapter_id;
    const group = grouped.has(sequence) ? sequence : "__unassigned__";
    grouped.get(group).push(shot);
  }
  return [...grouped.entries()]
    .filter(([, groupShots]) => groupShots.length > 0)
    .map(([sequence, groupShots], groupIndex) => {
      const chapter = chapterById.get(sequence);
      const title = chapter?.title || "未割当";
      const sequenceLabel = sequence === "__unassigned__" ? "sequence なし" : sequence;
      return `<section class="sequence-group" data-sequence-group="${escapeHtml(sequenceLabel)}" aria-labelledby="sequence-heading-${groupIndex}"><header class="sequence-band"><span>${escapeHtml(sequenceLabel)}</span><h3 id="sequence-heading-${groupIndex}">${escapeHtml(title)}</h3><small>${groupShots.length} shots</small></header><div class="shot-grid">${groupShots.map((shot, shotIndex) => renderShotCard(shot, shotIndex, planPath)).join("")}</div></section>`;
    })
    .join("");
}

function renderShotCard(shot, shotIndex, planPath) {
  const shotId = shot.id || `shot-${shotIndex + 1}`;
  const image = imageDataUri(shot.image_path, planPath);
  const media = image
    ? `<img class="shot-image" data-shot-image src="${image}" alt="${escapeHtml(shot.description || shot.shot_type || "ショットの概念画像")}" />`
    : `<div class="shot-placeholder" data-shot-placeholder role="img" aria-label="概念画像なし"><strong>${escapeHtml(shot.shot_type || "shot")}</strong><span>${escapeHtml(shot.description || "画の説明なし")}</span></div>`;
  const camera = plainObject(shot.camera) ? shot.camera : null;
  const cameraLines = [];
  if (Array.isArray(camera?.movement) && camera.movement.length > 0) cameraLines.push(`movement: ${camera.movement.join(", ")}`);
  if (typeof camera?.path_hint === "string" && camera.path_hint.length > 0) cameraLines.push(`path: ${camera.path_hint}`);
  return `<article class="shot-card${shot.cutaway_of ? " shot-card--cutaway" : ""}" data-shot-id="${escapeHtml(shotId)}"${shot.cutaway_of ? ` data-cutaway-of="${escapeHtml(shot.cutaway_of)}"` : ""}>${media}<div class="shot-card__body"><div class="shot-card__meta"><span>${escapeHtml(shot.shot_type || "shot type 未設定")}</span>${shot.cutaway_of ? `<span class="cutaway-badge">↳ ${escapeHtml(shot.cutaway_of)} から挿入</span>` : ""}</div><h4>${escapeHtml(shotId)}</h4><p>${escapeHtml(shot.description || "説明なし")}</p>${cameraLines.length ? `<p class="camera-hint">${escapeHtml(cameraLines.join(" / "))}</p>` : ""}</div></article>`;
}

function renderStructureView({ chapters, shots, chapterById }) {
  const hasStructureFields = shots.some((shot) => hasOwn(shot, "sequence") || hasOwn(shot, "cutaway_of"));
  if (!hasStructureFields) {
    return `<div class="empty-state" data-structure-empty><strong>構造情報なし</strong><span>sequence / cutaway_of が無い旧形式です。カード面はこれまで通り表示できます。</span></div>`;
  }
  const mainShots = shots.filter((shot) => !shot.cutaway_of);
  if (mainShots.length === 0) return `<div class="empty-state" data-structure-empty>主軸ショットがありません。</div>`;
  const cutawaysByMain = new Map();
  for (const shot of shots.filter((candidate) => candidate.cutaway_of)) {
    const branch = cutawaysByMain.get(shot.cutaway_of) || [];
    branch.push(shot);
    cutawaysByMain.set(shot.cutaway_of, branch);
  }
  const left = 110;
  const gap = 250;
  const nodeWidth = 174;
  const mainY = 104;
  const cutawayY = 254;
  const cutawayGap = 116;
  const maxBranches = Math.max(0, ...mainShots.map((shot) => (cutawaysByMain.get(shot.id) || []).length));
  const width = Math.max(920, left * 2 + gap * Math.max(0, mainShots.length - 1) + nodeWidth);
  const height = maxBranches > 0 ? cutawayY + (maxBranches - 1) * cutawayGap + 118 : 246;
  const centers = mainShots.map((_, index) => left + index * gap + nodeWidth / 2);
  const chapterBands = contiguousChapterBands(mainShots).map((band) => {
    const x = left + band.start * gap - 18;
    const bandWidth = (band.end - band.start) * gap + nodeWidth + 36;
    const chapter = chapterById.get(band.sequence);
    return `<g data-flow-role="chapter-band" data-sequence="${escapeHtml(band.sequence || "unassigned")}"><rect class="chapter-band" x="${x}" y="18" width="${bandWidth}" height="52" rx="15"/><text class="chapter-band__id" x="${x + 18}" y="39">${escapeXml(band.sequence || "sequence なし")}</text><text class="chapter-band__title" x="${x + 18}" y="59">${escapeXml(chapter?.title || "未割当")}</text></g>`;
  }).join("");
  const axisLines = mainShots.slice(0, -1).map((_, index) => `<path class="main-line" data-flow-role="main-line" d="M ${centers[index] + nodeWidth / 2 - 7} ${mainY + 48} H ${centers[index + 1] - nodeWidth / 2 + 7}" marker-end="url(#arrow-main)"/>`).join("");
  const mainNodes = mainShots.map((shot, index) => flowNode(shot, left + index * gap, mainY, "main-node")).join("");
  const branches = mainShots.map((mainShot, mainIndex) => {
    const cutaways = cutawaysByMain.get(mainShot.id) || [];
    return cutaways.map((shot, branchIndex) => {
      const x = left + mainIndex * gap;
      const y = cutawayY + branchIndex * cutawayGap;
      const nextCenter = centers[mainIndex + 1] ?? centers[mainIndex];
      const returnX = mainIndex + 1 < centers.length ? nextCenter - nodeWidth / 2 + 7 : centers[mainIndex] + nodeWidth / 2 - 10;
      const returnY = mainIndex + 1 < centers.length ? mainY + 62 : mainY + 82;
      return `<path class="branch-line" data-flow-role="branch-line" data-from="${escapeHtml(mainShot.id || "")}" data-to="${escapeHtml(shot.id || "")}" d="M ${centers[mainIndex]} ${mainY + 96} V ${y - 14}" marker-end="url(#arrow-branch)"/>${flowNode(shot, x, y, "cutaway-node")}<path class="return-line" data-flow-role="return-line" data-from="${escapeHtml(shot.id || "")}" data-to="${escapeHtml(mainShots[mainIndex + 1]?.id || mainShot.id || "")}" d="M ${centers[mainIndex] + nodeWidth / 2 - 4} ${y + 48} C ${centers[mainIndex] + 132} ${y + 48}, ${returnX - 68} ${returnY}, ${returnX} ${returnY}" marker-end="url(#arrow-return)"/>`;
    }).join("");
  }).join("");
  return `<div class="flow-legend" aria-label="構造図の凡例"><span><i class="legend-main"></i>主軸</span><span><i class="legend-cutaway"></i>カットアウェイ</span><span><i class="legend-return"></i>主軸へ戻る</span></div><div class="flow-scroll" tabindex="0" role="region" aria-label="主軸ショットとカットアウェイの構造図。横にスクロールできます"><svg data-storyboard-flow viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="flow-title flow-desc"><title id="flow-title">絵コンテ構造</title><desc id="flow-desc">主軸ショットを左から右へ並べ、カットアウェイを下へ分岐し、次の主軸へ戻る線で示します。</desc><defs><marker id="arrow-main" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="arrow-main"/></marker><marker id="arrow-branch" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="arrow-branch"/></marker><marker id="arrow-return" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" class="arrow-return"/></marker></defs>${chapterBands}${axisLines}${mainNodes}${branches}</svg></div>`;
}

function flowNode(shot, x, y, role) {
  const isCutaway = role === "cutaway-node";
  const title = shot.id || "id なし";
  const lines = wrapLabel(shot.description || shot.shot_type || "説明なし", 16, 2);
  return `<g data-flow-role="${role}" data-shot-id="${escapeHtml(shot.id || "")}"><rect class="flow-node${isCutaway ? " flow-node--cutaway" : ""}" x="${x}" y="${y}" width="174" height="96" rx="14"/><text class="flow-node__type" x="${x + 14}" y="${y + 22}">${escapeXml(shot.shot_type || (isCutaway ? "cutaway" : "main"))}</text><text class="flow-node__id" x="${x + 14}" y="${y + 43}">${escapeXml(title)}</text><text class="flow-node__description" x="${x + 14}" y="${y + 65}">${lines.map((line, index) => `<tspan x="${x + 14}" dy="${index === 0 ? 0 : 17}">${escapeXml(line)}</tspan>`).join("")}</text></g>`;
}

function renderShotListSection(shotList) {
  const entries = Array.isArray(shotList) ? shotList.filter(plainObject) : [];
  const rows = entries.length
    ? entries.map((entry) => `<tr><th scope="row">${escapeHtml(entry.id || "—")}</th><td>${escapeHtml(entry.ref_shot_id || "—")}</td><td>${escapeHtml(entry.location || "—")}</td><td>${escapeHtml(Array.isArray(entry.checklist) ? entry.checklist.join(" / ") : "—")}</td><td>${escapeHtml(entry.status || "—")}</td></tr>`).join("")
    : `<tr><td colspan="5" class="empty-cell">撮影チェックリストはまだありません。</td></tr>`;
  return `<section class="report-section" aria-labelledby="heading-shot-list"><span class="section-kicker">SECTION 05</span><h2 id="heading-shot-list">5. 撮影チェックリスト</h2><div class="table-scroll" tabindex="0"><table><thead><tr><th>ID</th><th>ショット</th><th>場所</th><th>確認事項</th><th>状態</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function contiguousChapterBands(mainShots) {
  const bands = [];
  for (const [index, shot] of mainShots.entries()) {
    const sequence = shot.sequence || "";
    const last = bands.at(-1);
    if (last && last.sequence === sequence) last.end = index;
    else bands.push({ sequence, start: index, end: index });
  }
  return bands;
}

function selectedTopicTitle(plan) {
  const candidates = plainObject(plan.topic) && Array.isArray(plan.topic.candidates) ? plan.topic.candidates : [];
  return candidates.find((candidate) => candidate.id === plan.topic?.selected)?.title || candidates[0]?.title || null;
}

function imageDataUri(reference, planPath) {
  if (typeof reference !== "string" || reference.trim().length === 0) return null;
  const filePath = path.isAbsolute(reference) ? reference : path.resolve(path.dirname(planPath), reference);
  const mime = MIME_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
  if (!mime) return null;
  try {
    return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
  } catch {
    return null;
  }
}

function wrapLabel(value, width, maxLines) {
  const characters = [...String(value)];
  const lines = [];
  while (characters.length > 0 && lines.length < maxLines) lines.push(characters.splice(0, width).join(""));
  if (characters.length > 0) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, width - 1))}…`;
  return lines;
}

function tabScript() {
  return `(() => {
    const tabs = [...document.querySelectorAll('[data-storyboard-tab]')];
    const panels = [...document.querySelectorAll('[data-storyboard-panel]')];
    function show(name, focus = false) {
      for (const tab of tabs) {
        const active = tab.dataset.storyboardTab === name;
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
        if (active && focus) tab.focus();
      }
      for (const panel of panels) panel.hidden = panel.dataset.storyboardPanel !== name;
    }
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        const name = tab.dataset.storyboardTab;
        show(name);
        history.replaceState(null, '', name === 'structure' ? '#storyboard-structure' : '#storyboard-cards');
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        const index = tabs.indexOf(tab);
        const offset = event.key === 'ArrowRight' ? 1 : -1;
        const next = tabs[(index + offset + tabs.length) % tabs.length];
        show(next.dataset.storyboardTab, true);
      });
    }
    show(location.hash === '#storyboard-structure' ? 'structure' : 'cards');
  })();`;
}

function reportStyles() {
  return `:root{color-scheme:light;--page:#f2f4f8;--surface:#fff;--ink:#172033;--muted:#5b6579;--line:#d7dce6;--accent:#3157d5;--accent-dark:#173a9a;--cyan:#0f8095;--orange:#c2631b;--shadow:0 16px 40px rgba(25,38,74,.09)}*{box-sizing:border-box}html{background:var(--page);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic UI",Meiryo,sans-serif;line-height:1.6}body{margin:0;min-width:20rem}.skip-link{position:fixed;z-index:20;top:.5rem;left:.5rem;padding:.6rem .9rem;background:#fff;transform:translateY(-160%)}.skip-link:focus{transform:none}.report-header{color:#fff;background:radial-gradient(circle at 85% 20%,rgba(91,212,227,.34),transparent 30rem),linear-gradient(135deg,#101833,#243b7b)}.report-header__inner,main,.report-footer{width:min(78rem,calc(100% - 2rem));margin-inline:auto}.report-header__inner{padding:clamp(2.5rem,6vw,5rem) 0}.eyebrow,.section-kicker{font-size:.76rem;font-weight:850;letter-spacing:.14em}.eyebrow{color:#cbd8ff}.section-kicker{color:var(--accent-dark)}h1,h2,h3,h4{line-height:1.25;text-wrap:balance}h1{max-width:19ch;margin:.2rem 0;font-size:clamp(2.2rem,6vw,4.4rem);letter-spacing:-.04em}h2{margin:.25rem 0 1rem;font-size:clamp(1.55rem,3vw,2.25rem)}h3,h4{margin:0}.report-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem;margin:2rem 0 0}.report-meta>div{padding:1rem;border:1px solid rgba(255,255,255,.25);border-radius:12px;background:rgba(255,255,255,.08)}dt{font-size:.78rem;font-weight:800}dd{margin:.15rem 0 0}main{padding:2.2rem 0 4rem}.report-section{margin-top:1.5rem;padding:clamp(1.2rem,3vw,2rem);border:1px solid var(--line);border-radius:18px;background:var(--surface);box-shadow:var(--shadow)}.report-section:first-child{margin-top:0}.section-lead{max-width:74ch;color:var(--muted)}.notice{padding:1rem;border-left:5px solid var(--accent);border-radius:8px;background:#eef2ff}.table-scroll,.flow-scroll{max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:12px}table{width:100%;min-width:46rem;border-collapse:collapse;font-size:.9rem}th,td{padding:.75rem .85rem;border-top:1px solid var(--line);text-align:left;vertical-align:top}thead th{color:#fff;background:#27385f;border-top:0}.empty-cell{text-align:center;color:var(--muted)}.storyboard-tabs{display:inline-flex;gap:.35rem;margin:1rem 0;padding:.35rem;border:1px solid var(--line);border-radius:13px;background:#edf0f6}.storyboard-tabs button{min-width:8rem;padding:.65rem 1rem;border:0;border-radius:9px;color:var(--muted);background:transparent;font:inherit;font-weight:800;cursor:pointer}.storyboard-tabs button[aria-selected="true"]{color:#fff;background:var(--accent);box-shadow:0 5px 16px rgba(49,87,213,.25)}.storyboard-tabs button:focus-visible{outline:3px solid #ffb000;outline-offset:2px}.sequence-group{margin-top:1.25rem;border:1px solid var(--line);border-radius:15px;overflow:hidden}.sequence-band{display:flex;align-items:baseline;gap:.8rem;padding:.75rem 1rem;color:#fff;background:linear-gradient(100deg,#243b7b,#2d7694)}.sequence-band span,.sequence-band small{font-size:.75rem;font-weight:800;letter-spacing:.08em}.sequence-band small{margin-left:auto}.shot-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1rem;padding:1rem;background:#f7f8fb}.shot-card{overflow:hidden;border:1px solid var(--line);border-radius:13px;background:#fff}.shot-card--cutaway{border-color:#e3a168;box-shadow:inset 4px 0 0 #d47a2d}.shot-image,.shot-placeholder{width:100%;aspect-ratio:16/9}.shot-image{display:block;object-fit:cover;background:#17223b}.shot-placeholder{display:grid;align-content:center;gap:.55rem;padding:1rem;color:#fff;background:linear-gradient(145deg,#263653,#51647d);text-align:center}.shot-placeholder strong{font-size:1.12rem;text-transform:uppercase}.shot-placeholder span{color:#e2e9f3;font-size:.88rem}.shot-card__body{padding:1rem}.shot-card__meta{display:flex;flex-wrap:wrap;gap:.4rem;margin-bottom:.55rem;color:var(--accent-dark);font-size:.74rem;font-weight:800}.shot-card p{margin:.45rem 0 0}.cutaway-badge{color:#8b3f0b}.camera-hint{padding-top:.55rem;border-top:1px solid var(--line);color:var(--muted);font-size:.78rem}.empty-state{display:grid;min-height:15rem;place-content:center;gap:.55rem;padding:2rem;border:2px dashed var(--line);border-radius:14px;color:var(--muted);text-align:center}.empty-state strong{color:var(--ink);font-size:1.25rem}.flow-legend{display:flex;flex-wrap:wrap;gap:1rem;margin:.4rem 0 .8rem;color:var(--muted);font-size:.8rem;font-weight:750}.flow-legend span{display:flex;align-items:center;gap:.4rem}.flow-legend i{width:1.5rem;height:.35rem;border-radius:99px;background:var(--accent)}.flow-legend .legend-cutaway{background:var(--orange)}.flow-legend .legend-return{height:0;border-top:2px dashed var(--cyan);background:transparent}.flow-scroll{background:#f7f9fc}.flow-scroll svg{display:block;max-width:none}.chapter-band{fill:#e7edff;stroke:#a9b9ee}.chapter-band__id{fill:#2448af;font-size:11px;font-weight:800}.chapter-band__title{fill:#172d68;font-size:14px;font-weight:800}.main-line,.branch-line,.return-line{fill:none;stroke-linecap:round;stroke-linejoin:round}.main-line{stroke:var(--accent);stroke-width:4}.branch-line{stroke:var(--orange);stroke-width:3}.return-line{stroke:var(--cyan);stroke-width:2.5;stroke-dasharray:7 6}.arrow-main{fill:var(--accent)}.arrow-branch{fill:var(--orange)}.arrow-return{fill:var(--cyan)}.flow-node{fill:#fff;stroke:var(--accent);stroke-width:2}.flow-node--cutaway{fill:#fff8f0;stroke:var(--orange)}.flow-node__type{fill:#5b6579;font-size:10px;font-weight:800;text-transform:uppercase}.flow-node__id{fill:#172033;font-size:14px;font-weight:850}.flow-node__description{fill:#4d586d;font-size:11px}.report-footer{padding:0 0 3rem;color:var(--muted);font-size:.8rem}[hidden]{display:none!important}@media(max-width:46rem){.report-header__inner,main,.report-footer{width:min(100% - 1rem,78rem)}.report-meta{grid-template-columns:1fr}.report-section{padding:1rem;border-radius:12px}.storyboard-tabs{display:flex}.storyboard-tabs button{min-width:0;flex:1}}@media print{.storyboard-tabs{display:none}[data-storyboard-panel]{display:block!important}.report-section{box-shadow:none;break-inside:avoid}.flow-scroll{overflow:visible}.report-header{color:#111;background:#fff;border-bottom:2px solid #111}}`;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

const escapeXml = escapeHtml;

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const [inputPath, outputPath, extra] = process.argv.slice(2);
  if (!inputPath || extra) {
    console.error("使い方: node packages/decision-cards/render-research-plan-report.mjs <research-plan.json> [research-plan-report.html]");
    process.exit(2);
  }
  try {
    const renderedPath = renderResearchPlanReportFile(inputPath, outputPath);
    console.log(`OK: ${renderedPath}`);
  } catch (error) {
    console.error(`NG: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
