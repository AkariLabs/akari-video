// オーバーレイランタイム
// 契約: docs/planning/contract-2026-07-13-m1-m4.md §M2
window.akari = window.akari || {};

(() => {
// premount（task 2026-08-29-overlay-3d-premount）: ライブプレビューだけで 3D を先読みする。
// 既定 auto は #overlay-stage があるホストで有効。明示的に切る場合は premount:false を渡す。
const PREMOUNT_DEFAULTS = { leadSeconds: 2.0, maxInstances: 4 };

function resolvePremount(value) {
  if (value === false || value === null) return null;
  if (value === true || value === undefined) {
    return document.getElementById("overlay-stage") ? { ...PREMOUNT_DEFAULTS } : null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return { ...PREMOUNT_DEFAULTS, ...value };
  }
  return null;
}

function createOverlayRuntime(options = {}) {
  const mountedOverlays = [];
  const mountedThreeOverlays = [];
  let mountedStage = null;
  let premount = resolvePremount(options.premount);
  let premountConfigured = false;

  // packages/overlay-runtime/package.json の version と同期させる。ブラウザに
  // <script> で直接読み込まれるホスト（npm 解決を経ない）が、mount 済みの
  // window.akari.runtime.version から機能検出できるようにする（例: 0.2.0 以降 =
  // 多層テキスト断片の data-mirror 同期に対応。P0-R 契約 §4）。
  const RUNTIME_VERSION = "0.2.0";

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function applyPremountConfiguration() {
    if (!premount || typeof window.akari.threeRuntime?.configurePremount !== "function") {
      return false;
    }
    window.akari.threeRuntime.configurePremount(premount);
    premountConfigured = true;
    return true;
  }

  applyPremountConfiguration();

  function configure(next = {}) {
    if (Object.prototype.hasOwnProperty.call(next, "premount")) {
      premount = resolvePremount(next.premount);
      premountConfigured = false;
      window.akari.threeRuntime?.configurePremount?.(premount);
      premountConfigured = typeof window.akari.threeRuntime?.configurePremount === "function";
    }
    return { premount: premount ? { ...premount } : null };
  }

  // 入場アニメが現在時刻で確定姿勢に達したか。装飾用の無限ループ（spark 等）は
  // 永遠に終わらないため、終端が有限なアニメーションだけを見る。
  function entryAnimationsSettled(animations) {
    for (const animation of animations) {
      const endTime = Number(animation.effect?.getComputedTiming?.().endTime);
      if (!Number.isFinite(endTime)) continue;
      const currentTime = Number(animation.currentTime);
      if (!Number.isFinite(currentTime) || currentTime < endTime) return false;
    }
    return true;
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
    mountedThreeOverlays.length = 0;
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
      // 外側コンテナは出力全体を覆うため、自身ではポインタを受けない。断片内で実際に
      // 描画している要素だけ、可視化時に interaction.applyOverlayHitPolicy() が auto へ戻す。
      container.style.pointerEvents = "none";
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

      const template = document.createElement("template");
      template.innerHTML = overlay.html ?? "";
      const rendered = window.akari.slotParams?.renderTextSlots(
        template.content,
        overlay.params
      );
      container.replaceChildren(rendered ?? template.content.cloneNode(true));

      // 多層テキスト断片のミラー層（縁取り・影・裏打ち等でテキストを複製した層。
      // interaction.js のテキスト編集同期対象）を支援技術・検索から隠す。断片は
      // script を持たない前提のため、mount 時にランタイムが一括付与する
      // （skills/overlay-authoring/telop.md「多層テキスト断片と data-mirror 規約」・
      // P0-R 契約 §2）。
      for (const mirror of container.querySelectorAll('[data-mirror="text"]')) {
        mirror.setAttribute("aria-hidden", "true");
      }

      fragment.appendChild(container);
      const mountedOverlay = {
        container,
        start,
        duration,
        visible: false,
        hitPolicyPending: false,
        ...(Array.isArray(overlay.keyframes) ? {
          keyframes: overlay.keyframes,
          fps: finiteNumber(summary?.output?.fps, 30),
          statics: {
            x: isBackground ? 0 : finiteNumber(transform.x, 0),
            y: isBackground ? 0 : finiteNumber(transform.y, 0),
            scale: isBackground ? 1 : finiteNumber(transform.scale, 1),
            rotate: isBackground ? 0 : finiteNumber(transform.rotate, 0),
            opacity: finiteNumber(overlay.opacity, 1),
          },
          isBackground,
        } : {}),
        isThreeDimensional: Boolean(
          container.querySelector(
            'script[type="application/json"][data-akari-3d-scene]'
          )
        ),
      };
      mountedOverlays.push(mountedOverlay);
      if (mountedOverlay.isThreeDimensional) mountedThreeOverlays.push(mountedOverlay);
    }

    stage.replaceChildren(fragment);
    mountedStage = stage;
  }

  function tick(t, _playing) {
    const timelineTime = finiteNumber(t, 0);
    if (premount && !premountConfigured) applyPremountConfiguration();

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
        overlay.hitPolicyPending = visible;
        if (!visible && overlay.isThreeDimensional && !premount) {
          window.akari.threeRuntime?.dispose(overlay.container);
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
      if (Array.isArray(overlay.keyframes)) {
        const interpolate = window.akari.keyframes?.interpolateKeyframes;
        if (typeof interpolate !== "function") {
          throw new Error("item keyframes runtime is not loaded");
        }
        const state = interpolate(overlay.keyframes, localTimeMs * overlay.fps / 1000, {
          statics: overlay.statics,
        });
        overlay.container.style.setProperty("--x", overlay.isBackground ? "0px" : `${state.x}px`);
        overlay.container.style.setProperty("--y", overlay.isBackground ? "0px" : `${state.y}px`);
        overlay.container.style.setProperty("--scale", overlay.isBackground ? "1" : String(state.scale));
        overlay.container.style.setProperty("--rotate", overlay.isBackground ? "0deg" : `${state.rotate}deg`);
        overlay.container.style.setProperty("opacity", String(state.opacity));
      }
      if (overlay.isThreeDimensional) {
        // syncVideos: ライブプレビューでは動画テクスチャの時刻を誰も進めないので、
        // ここで overlay のローカル時刻へ合わせる（書き出しは rasterize が自前で
        // フレーム精度シークを済ませるため、この指定を渡さない = 決定性を崩さない）
        window.akari.threeRuntime?.render(overlay.container, localTimeMs / 1000, {
          syncVideos: true,
        });
        // clip-path は可視な間、入場アニメが終わるまで毎 tick 測り直す。可視化フリップの
        // 1 tick だけで確定すると、通常再生では localTimeMs がほぼ 0 のため、0% の遠方姿勢の
        // bbox が焼き付き、入場後の断片が丸ごと消える。対象は可視オーバーレイだけに絞り、
        // 有限な入場アニメが終わった tick で確定して以後は呼ばない。無限ループは終端無しと
        // して数えず、性能原則「見えている分だけ」を保ったまま永久 pending を避ける。
        if (overlay.hitPolicyPending) {
          window.akari.interaction?.syncOverlayHitRegion?.(overlay.container);
          window.akari.interaction?.applyOverlayHitPolicy?.(overlay.container);
          if (entryAnimationsSettled(overlay.container.getAnimations({ subtree: true }))) {
            window.akari.interaction?.invalidateOverlayHitPolicy?.(overlay.container);
            window.akari.interaction?.applyOverlayHitPolicy?.(overlay.container);
            overlay.hitPolicyPending = false;
          }
        }
        continue;
      }
      const animations = overlay.container.getAnimations({ subtree: true });
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = localTimeMs;
      }
      // opacity と clip-path は現在時刻へ合わせ、可視な間は入場アニメの終了まで毎 tick
      // 測り直す。フリップ時だけでは通常再生の localTimeMs がほぼ 0 となり、0% 姿勢の
      // bbox が焼き付くため。上で取得済みの animations を再利用し、有限な入場アニメが
      // 終わった tick で確定する。以後は呼ばず、無限ループも終端無しとして数えないので、
      // 対象を可視オーバーレイだけにする性能原則「見えている分だけ」は維持される。
      if (overlay.hitPolicyPending) {
        window.akari.interaction?.syncOverlayHitRegion?.(overlay.container);
        // 当たり判定ポリシーは初回適用が WeakSet でガードされるため、ここでの再呼び出しは
        // 実質 no-op（暫定適用）。確定姿勢に達した tick で invalidate してから測り直す。
        window.akari.interaction?.applyOverlayHitPolicy?.(overlay.container);
        if (entryAnimationsSettled(animations)) {
          window.akari.interaction?.invalidateOverlayHitPolicy?.(overlay.container);
          window.akari.interaction?.applyOverlayHitPolicy?.(overlay.container);
          overlay.hitPolicyPending = false;
        }
      }
    }

    if (premount && mountedThreeOverlays.length > 0) {
      window.akari.threeRuntime?.premountTick?.(mountedThreeOverlays, timelineTime);
    }
  }

  return { mount, tick, unmount, configure, version: RUNTIME_VERSION };
}

window.akari.createOverlayRuntime = createOverlayRuntime;
window.akari.runtime = createOverlayRuntime();
})();
