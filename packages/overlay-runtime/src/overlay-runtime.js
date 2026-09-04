// オーバーレイランタイム
// 契約: docs/planning/contract-2026-07-13-m1-m4.md §M2
window.akari = window.akari || {};

window.akari.runtime = (() => {
  const mountedOverlays = [];
  let mountedStage = null;

  // packages/overlay-runtime/package.json の version と同期させる。ブラウザに
  // <script> で直接読み込まれるホスト（npm 解決を経ない）が、mount 済みの
  // window.akari.runtime.version から機能検出できるようにする。
  //   0.2.0 以降 = 多層テキスト断片の data-mirror 同期に対応（P0-R 契約 §4）
  //   0.5.0 以降 = テキスト分割 data-akari-split に対応
  //                （contract-2026-08-15-telop-motion-grammar-v0）
  // ※ 2026-08-15 時点でこの定数は 0.2.0 のまま package.json だけ 0.4.0 へ
  //   進んでおり、min_overlay_runtime_version の機能検出が実態とずれていた。
  //   分割対応の追加に合わせて両方を 0.5.0 へ揃える。
  const RUNTIME_VERSION = "0.5.0";

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function unmount() {
    for (const overlay of mountedOverlays) {
      if (overlay.isThreeDimensional) {
        window.akari.threeRuntime?.dispose(overlay.container);
      }
    }
    const stage = mountedStage ?? document.getElementById("overlay-stage");
    if (stage) stage.replaceChildren();

    mountedOverlays.length = 0;
    mountedStage = null;
  }

  async function mount(summary) {
    unmount();

    const stage = document.getElementById("overlay-stage");
    if (!stage) throw new Error("#overlay-stage が見つかりません");

    const overlays = summary?.overlays;
    if (!Array.isArray(overlays)) {
      throw new TypeError("summary.overlays は配列である必要があります");
    }

    const fragment = document.createDocumentFragment();

    for (const overlay of overlays) {
      const start = finiteNumber(overlay.start, 0);
      const duration = finiteNumber(overlay.duration, 0);
      const transform = overlay.transform ?? {};
      const container = document.createElement("div");

      // 2026-08-07 オーナー裁定: role==="background" は
      // ずらせない・必ずフレームを埋める種別。--x/--y/--scale/--rotate を無条件で恒等値へ
      // ロックする（transform も vars 経由の抜け道も無視する。preview-server の app.js の
      // mount・render-cut の rasterize.mjs の renderOverlayNode と同じロック）。
      const isBackground = overlay.role === "background";

      container.dataset.overlayId = String(overlay.id);
      container.dataset.start = String(start);
      container.dataset.duration = String(duration);
      if (overlay.role !== undefined && overlay.role !== null) {
        container.dataset.role = String(overlay.role);
      }
      container.style.position = "absolute";
      container.style.inset = "0";
      container.style.pointerEvents = "auto";
      container.style.visibility = "hidden";

      for (const [name, value] of Object.entries(overlay.vars ?? {})) {
        if (name.startsWith("--")) {
          container.style.setProperty(name, String(value));
        }
      }

      container.style.setProperty("--x", isBackground ? "0px" : `${finiteNumber(transform.x, 0)}px`);
      container.style.setProperty("--y", isBackground ? "0px" : `${finiteNumber(transform.y, 0)}px`);
      container.style.setProperty("--scale", isBackground ? "1" : String(finiteNumber(transform.scale, 1)));
      container.style.setProperty("--rotate", isBackground ? "0deg" : `${finiteNumber(transform.rotate, 0)}deg`);
      container.style.transform =
        "translate(var(--x,0px), var(--y,0px)) " +
        "scale(var(--scale,1)) rotate(var(--rotate,0deg))";

      container.innerHTML = overlay.html ?? "";

      // 多層テキスト断片のミラー層（縁取り・影・裏打ち等でテキストを複製した層。
      // interaction.js のテキスト編集同期対象）を支援技術・検索から隠す。断片は
      // script を持たない前提のため、mount 時にランタイムが一括付与する
      // （skills/overlay-authoring/telop.md「多層テキスト断片と data-mirror 規約」・
      // P0-R 契約 §2）。
      for (const mirror of container.querySelectorAll('[data-mirror="text"]')) {
        mirror.setAttribute("aria-hidden", "true");
      }

      // テキスト分割断片（data-akari-split="bunsetsu" 等）: 断片は分割済みの
      // <span class="akari-u" style="--i:N"> で出荷する規約だが、出荷漏れ・
      // vars によるテキスト差し替えに備えて mount 時にも整える（冪等）。
      // 断片は script を持たない前提のため、data-mirror と同じくランタイムが担う
      // （telop.md「テキスト分割と stagger 規約」・
      //  akari-video-internal contract-2026-08-15-telop-motion-grammar-v0 §4）。
      window.akari.textSplit?.applyAll(container);

      fragment.appendChild(container);
      mountedOverlays.push({
        container,
        start,
        duration,
        visible: false,
        isThreeDimensional: Boolean(
          container.querySelector(
            'script[type="application/json"][data-akari-3d-scene]'
          )
        ),
      });
    }

    stage.replaceChildren(fragment);
    mountedStage = stage;
  }

  function tick(t, _playing) {
    const timelineTime = finiteNumber(t, 0);

    for (const overlay of mountedOverlays) {
      const visible =
        overlay.start <= timelineTime &&
        timelineTime < overlay.start + overlay.duration;

      if (visible !== overlay.visible) {
        overlay.container.style.visibility = visible ? "visible" : "hidden";
        // 断片側の出入りアニメ（telop.md）は `[data-akari-active] .foo { animation: ... }`
        // という祖先属性ゲート付きセレクタで宣言する規約にする（字幕断片は 1,205 件級で
        // 同時にマウントされるため）。実測したところ、Element/Document.getAnimations() の
        // コストは「対象サブツリーの大きさ」ではなく「ドキュメント全体に現存する
        // CSS animation の総数」にほぼ比例する（ヘッドレス Chrome で 1,205 件へ常時
        // animation を宣言した場合、可視 1 件だけを問い合わせる呼び出しでも ~27ms/回。
        // 60fps は疎か 30fps 予算も単独で超過する）。ゲート属性を可視区間だけ付け外し
        // することで、実際に存在する CSS Animation を「今可視のオーバーレイ分だけ」に
        // 抑え、この地雷を踏まない。
        overlay.container.toggleAttribute("data-akari-active", visible);
        if (!visible && overlay.isThreeDimensional) {
          window.akari.threeRuntime?.dispose(overlay.container);
        }
        // ㉑ 素通し: 可視化した断片の実寸に当たり判定（clip-path）を合わせ直す。
        // 非可視の間は当たり判定自体が発生しない（visibility:hidden は hit-test 対象外）
        // ため、可視化タイミングだけに限定して呼べば十分（tick() 全体の毎フレーム負荷は
        // 増えない = 上の性能原則と同じ「見えている分だけ」）。
        if (visible) {
          window.akari.interaction?.syncOverlayHitRegion?.(overlay.container);
        }
        overlay.visible = visible;
      }

      // 性能原則「見えている分だけ」: 非表示オーバーレイのアニメーション同期を省く。
      // 再表示された tick で必ず同期されるため、シークの決定性は保たれる（字幕のような
      // 1000 エントリ級でも tick が O(可視数) で済む。ただし getAnimations() 自体の
      // コストを可視数に閉じ込めるには、上の data-akari-active ゲートと組み合わせる
      // ことが必須。ゲート無しで「可視のものだけ getAnimations() する」だけでは、
      // 非可視分の CSS animation がドキュメントに現存し続ける限りコストは落ちない）
      if (!visible) continue;

      const localTimeMs = Math.max(0, (timelineTime - overlay.start) * 1000);
      if (overlay.isThreeDimensional) {
        // syncVideos: ライブプレビューでは動画テクスチャの時刻を誰も進めないので、
        // ここで overlay のローカル時刻へ合わせる（書き出しは rasterize が自前で
        // フレーム精度シークを済ませるため、この指定を渡さない = 決定性を崩さない）
        window.akari.threeRuntime?.render(overlay.container, localTimeMs / 1000, {
          syncVideos: true,
        });
        continue;
      }
      const animations = overlay.container.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = localTimeMs;
      }
    }
  }

  return { mount, tick, unmount, version: RUNTIME_VERSION };
})();
