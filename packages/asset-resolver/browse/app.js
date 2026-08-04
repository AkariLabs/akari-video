// 1ビュー素材パネル — /api/items（カタログ + 取得状態 + entitlements の合成ビュー）を描き、
// 「ライブラリへ取得する」「プロジェクトへ入れる」はどちらも POST /api/fetch = resolver 直行
// （エージェント非経由。lab/asset-oneview-proto の PoC を本パッケージのデータ層に差し替えた移植）。
(async function () {
  const $ = (sel) => document.querySelector(sel);
  const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let { home, items } = await (await fetch('/api/items')).json();
  let activeCategory = 'all';
  let query = '';
  let onlyGot = false;
  let selectedId = null;

  $('#home-line').textContent = `ライブラリ: ${home}`;

  function categories() {
    const set = new Set(items.map((i) => i.category));
    return ['all', ...[...set].sort()];
  }

  /* ---- フィルタチップ ---- */
  const chips = $('#chips');
  function renderChips() {
    chips.innerHTML = '';
    for (const c of categories()) {
      const count = c === 'all' ? items.length : items.filter((i) => i.category === c).length;
      const btn = el(`<button class="chip-btn${c === activeCategory ? ' active' : ''}" data-c="${c}">${c === 'all' ? 'すべて' : esc(c)}（${count}）</button>`);
      btn.addEventListener('click', () => { activeCategory = c; renderChips(); renderGrid(); });
      chips.append(btn);
    }
  }
  $('#search').addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); renderGrid(); });
  $('#only-got').addEventListener('click', (e) => { onlyGot = !onlyGot; e.target.classList.toggle('active', onlyGot); renderGrid(); });

  function matches(item) {
    if (activeCategory !== 'all' && item.category !== activeCategory) return false;
    if (onlyGot && item.state !== 'cached') return false;
    if (!query) return true;
    const hay = `${item.title} ${item.id} ${(item.tags || []).join(' ')}`.toLowerCase();
    return query.split(/\s+/).every((q) => hay.includes(q));
  }

  /* ---- グリッド ---- */
  const grid = $('#grid');
  function badgeOf(item) {
    if (item.state === 'cached') return '<span class="badge got">✓ 取得済み</span>';
    if (item.state === 'locked') return `<span class="badge paid">¥${(item.price ?? 0).toLocaleString()}</span>`;
    return '<span class="badge">☁ 未取得</span>';
  }
  function renderGrid() {
    grid.innerHTML = '';
    const list = items.filter(matches);
    $('#count-line').textContent = `${list.length} 件 ・ 一覧はサムネとメタデータだけ（実体は未取得のまま）`;
    list.forEach((item) => {
      const card = el(`
        <div class="card ${item.category}${item.id === selectedId ? ' selected' : ''}" data-id="${item.id}">
          <div class="ph">${item.preview ? `<img loading="lazy" src="/thumb/${encodeURIComponent(item.id)}" alt="">` : esc(item.title)}</div>
          ${badgeOf(item)}
          <div class="cap"><b>${esc(item.title)}</b><span class="kind">${esc(item.category)}</span></div>
        </div>`);
      card.addEventListener('click', () => { selectedId = item.id; renderGrid(); renderDetail(item); });
      grid.append(card);
    });
  }

  /* ---- 詳細パネル ---- */
  const detail = $('#detail');
  async function refreshItems() {
    const data = await (await fetch('/api/items')).json();
    items = data.items;
    home = data.home;
  }
  function renderDetail(item) {
    detail.innerHTML = '';
    const isAudio = item.category === 'audio';
    detail.append(el(`<div>
      ${item.preview && !isAudio ? `<img class="big" src="/thumb/${encodeURIComponent(item.id)}" alt="">` : ''}
      ${item.preview && isAudio ? `<audio controls preload="none" src="/media/${encodeURIComponent(item.id)}"></audio>` : ''}
      <h2>${esc(item.title)}</h2>
      <p class="id">${esc(item.id)} ・ ${esc(item.license?.spdx ?? '')}${item.price ? ` ・ ¥${item.price.toLocaleString()}` : ' ・ 無料'}</p>
      <div class="tagrow">${(item.tags || []).map((t) => `<span>${esc(t)}</span>`).join('')}</div>
      ${item.provenance?.prompt ? `<details class="prompt"><summary>生成プロンプト</summary><p>${esc(item.provenance.prompt)}</p></details>` : ''}
      <div class="actions" id="actions"></div>
      <p class="msg" id="msg"></p>
    </div>`));
    const actions = $('#actions');
    const msg = $('#msg');
    const say = (ok, text) => { msg.className = `msg ${ok ? 'ok' : 'err'}`; msg.textContent = text; };

    if (item.state === 'locked') {
      actions.append(el(`<button class="btn" disabled>未購入（¥${(item.price ?? 0).toLocaleString()}） — ストアで購入してください</button>`));
    } else if (item.state === 'cached') {
      actions.append(el('<p class="note">✓ ライブラリに取得済みです。</p>'));
    } else {
      const lib = el('<button class="btn">ライブラリへ取得する</button>');
      lib.addEventListener('click', async () => {
        lib.disabled = true;
        const r = await (await fetch('/api/fetch', { method: 'POST', body: JSON.stringify({ id: item.id }) })).json();
        if (r.ok) { say(true, `取得した → ${r.dir}`); await refreshItems(); renderChips(); renderGrid(); renderDetail(items.find((i) => i.id === item.id)); }
        else { say(false, r.error ?? '失敗'); lib.disabled = false; }
      });
      actions.append(lib);
    }

    if (item.state !== 'locked') {
      const proj = el(`<div class="proj">
        <input id="proj-path" placeholder="/path/to/project（実在ディレクトリ）" value="${esc(localStorage.getItem('projPath') ?? '')}">
        <button class="btn secondary" style="width:100%">プロジェクトへ入れる（assets/${esc(item.id)}/）</button>
      </div>`);
      proj.querySelector('button').addEventListener('click', async () => {
        const projectPath = proj.querySelector('input').value.trim();
        localStorage.setItem('projPath', projectPath);
        const r = await (await fetch('/api/fetch', { method: 'POST', body: JSON.stringify({ id: item.id, project: projectPath }) })).json();
        if (r.ok) { say(true, `プロジェクトへ入れた → ${r.projectDir}`); await refreshItems(); renderChips(); renderGrid(); }
        else say(false, r.error ?? '失敗');
      });
      actions.append(proj);
    }
  }

  renderChips();
  renderGrid();
})();
