// 宣言型 Three.js オーバーレイランタイム
window.akari = window.akari || {};

window.akari.threeRuntime = (() => {
  const instances = new WeakMap();
  const failedContainers = new WeakSet();
  const ALLOWED_SCENE_KEYS = new Set([
    "model",
    "camera",
    "environment",
    "lights",
    "animationClip",
    "materialOverrides",
    "shadows",
    "texts",
    "physics",
  ]);
  const TEXT_ANIM_PRESETS = new Set(["none", "carousel", "char-chaos", "flip-wave", "tumble"]);
  const PHYSICS_COLLIDER_TYPES = new Set(["floor", "wall", "circle", "polygon"]);
  // 頂点数の妥当レンジは 25〜60（T5 spike 実測。人物シルエット輪郭の簡略化ポリゴン）。
  // 上限 200 だけを validation エラーにする（契約 §3.1 実装指示 2）
  const PHYSICS_MAX_POLYGON_POINTS = 200;
  // floor/wall を「実質無限」に見せるための板の長さ・厚み（scene 単位）。契約の宣言例
  // （floor y=-2.6, wall x=±5.6 等）より一桁以上大きく、通常のカメラ画角では端に到達しない
  const PHYSICS_COLLIDER_SPAN = 200;
  // troika-three-text はグリフ欠落時に unicode-font-resolver 経由で cdn.jsdelivr.net から
  // フォールバックフォントを動的取得しにいく（vendor-3d-text-bundle.js 内の唯一の fetch() 呼び出し）。
  // unicodeFontsURL を null のまま（既定）にしても、この経路はコードパス自体が無条件で動く
  // （欠落コードポイントがあれば必ず fetch する。設定値は「どこから取るか」しか変えず
  // 「取るかどうか」は変えられない）。
  //
  // **この fetch はメインスレッドではなく troika-worker-utils が Blob 経由で生成する Worker の
  // 中で実行される**（実測: `window.fetch` だけを差し替えても素通りする。vendor-3d-text-bundle.js
  // は `Pt.useWorker` 既定 true で typesetting 全体を `new Worker(URL.createObjectURL(new Blob([...],
  // {type:"application/javascript"})))` へ委譲しており、Worker は独立したグローバルスコープ =
  // 別の `self.fetch` を持つ。`configureTextBuilder`（useWorker を切る唯一の口）は vendor bundle
  // が re-export していないため外から到達できない）。よって window.Blob を差し替え、
  // "application/javascript" 型で生成される Worker ソースの先頭へ `self.fetch` を上書きする
  // 前置スクリプトを注入する。fetch 本体を呼ばずに reject するので実ネットワークへは一切出ない
  const TROIKA_UNICODE_FONT_RESOLVER_CDN_PREFIX =
    "https://cdn.jsdelivr.net/gh/lojjic/unicode-font-resolver@";
  const TROIKA_WORKER_FETCH_GUARD_SOURCE = `(function(){var f=self.fetch;if(typeof f==="function"){self.fetch=function(input,init){var u=typeof input==="string"?input:(input&&input.url)||"";if(u.indexOf(${JSON.stringify(TROIKA_UNICODE_FONT_RESOLVER_CDN_PREFIX)})===0){return Promise.reject(new Error("akari-three: troika unicode font fallback is disabled"));}return f(input,init);};}})();`;
  let troikaUnicodeFontFallbackDisabled = false;
  function disableTroikaUnicodeFontFallback() {
    if (troikaUnicodeFontFallbackDisabled) return;
    troikaUnicodeFontFallbackDisabled = true;
    // 保険: 将来 troika がメインスレッド実行に倒れても効くよう window.fetch 自体も塞ぐ
    if (typeof window.fetch === "function") {
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = typeof input === "string" ? input : (input?.url ?? "");
        if (url.startsWith(TROIKA_UNICODE_FONT_RESOLVER_CDN_PREFIX)) {
          return Promise.reject(
            new Error("[akari-three] troika unicode font fallback is disabled (network reach must stay zero)")
          );
        }
        return originalFetch(input, init);
      };
    }
    // 本命: Worker のソースになる Blob（type: application/javascript）の先頭へ
    // self.fetch ガードを注入する
    if (typeof window.Blob === "function") {
      const OriginalBlob = window.Blob;
      const PatchedBlob = function (parts, options) {
        const isScript = Array.isArray(parts)
          && typeof options?.type === "string"
          && /javascript/i.test(options.type);
        return new OriginalBlob(isScript ? [TROIKA_WORKER_FETCH_GUARD_SOURCE, ...parts] : parts, options);
      };
      PatchedBlob.prototype = OriginalBlob.prototype;
      window.Blob = PatchedBlob;
    }
  }
  // troika-three-text の sync() は fetch reject を .catch せずに握り潰す（実測: 完了コールバックが
  // 二度と呼ばれない）ため、fetch を遮断しただけでは「その Text 全体の sync() が完了しない」
  // 無限ハングになる。豆腐（不描画）で済ませるには sync() 自体を TEXT_SYNC_TIMEOUT_MS で
  // 打ち切る必要がある（waitForTextSync。rasterize.mjs の動画シーク待ち waitForVideo と同じ流儀 —
  // 諦めて先へ進む）。この打ち切りは mount 時の非同期待ち合わせであって draw(localSeconds) を
  // 汚さないため、決定論の不変条件（§3.3・render は localSeconds の純関数）とは独立している。
  // 値は寛容め（15000ms）に振ってある — 正常系（欠落グリフなし）の sync() は通常数百 ms 未満で
  // 終わるため、この分岐に触れるのは「本当に遮断された」ケースのみのはずだが、負荷が高い環境では
  // 正常な sync() 自体が数秒級に伸びることがあり（実測: 開発機 load average 100+ の下で
  // 5000ms だと正常系が間に合わず豆腐化した）、早すぎる打ち切りは正常系の誤判定になる
  const TEXT_SYNC_TIMEOUT_MS = 15000;
  function waitForTextSync(node) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      node.sync(finish);
      setTimeout(finish, TEXT_SYNC_TIMEOUT_MS);
    });
  }
  // materialOverrides.texture が動画かどうか。export では相対パスが data URI へ
  // 埋め込まれた後にランタイムへ届くので、拡張子と data: の MIME 型の両方を見る
  const VIDEO_TEXTURE_PATTERN = /^data:video\/|\.(?:mp4|m4v|mov|webm)(?:[?#]|$)/i;

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  // 標準ツマミ 3 種（--akari-3d-pan-x / --akari-3d-pan-y / --akari-3d-zoom）の生値を
  // フレーム比の小数へ変換する。「% 付きなら /100、無単位ならそのまま割合」の両対応
  // （skills/overlay-authoring/3d.md）。宣言が無ければ null を返し、呼び出し側が
  // 「未宣言（後方互換の対象）」と区別できるようにする。
  function readProjectionRatio(computedStyle, propertyName) {
    const raw = computedStyle.getPropertyValue(propertyName).trim();
    if (raw === "") return null;
    const isPercent = raw.endsWith("%");
    const numeric = Number.parseFloat(isPercent ? raw.slice(0, -1) : raw);
    if (!Number.isFinite(numeric)) return null;
    return isPercent ? numeric / 100 : numeric;
  }

  function vector3(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) return [...fallback];
    return value.map((item, index) => finiteNumber(item, fallback[index]));
  }

  function isAnimationClipSelector(value) {
    if (typeof value === "string") return value.length > 0;
    return Array.isArray(value)
      && value.length > 0
      && value.every((name) => typeof name === "string" && name.length > 0);
  }

  function selectAnimationClips(animations, selector) {
    const available = Array.isArray(animations) ? animations : [];
    // Blender の glTF 書き出しはオブジェクトごとに clip を分けるので、1 個のモデルに
    // 複数の動き（本体のカメラワークと装飾など）があると clip も分かれる。"*" はそれを束ねて同時に回す
    if (selector === "*") {
      if (available.length === 0) throw new Error("glTF に animation clip がありません");
      return available;
    }
    const names = Array.isArray(selector) ? selector : [selector];
    return names.map((name) => {
      const clip = available.find((candidate) => candidate.name === name);
      if (!clip) throw new Error(`glTF animation clip が見つかりません: ${name}`);
      return clip;
    });
  }

  function shadowSettings(descriptor) {
    if (descriptor === undefined || descriptor === false) return { enabled: false };
    const settings = descriptor === true ? {} : descriptor;
    return {
      enabled: settings.enabled !== false,
      mapSize: Math.max(1, Math.round(finiteNumber(settings.mapSize, 2048))),
      // 既定は被写体の実寸から決める（wireShadows）。宣言があればそちらを優先する
      bias: settings.bias === undefined ? null : finiteNumber(settings.bias, 0),
      normalBias: settings.normalBias === undefined ? null : finiteNumber(settings.normalBias, 0),
    };
  }

  function isEmissiveMesh(material) {
    const materials = Array.isArray(material) ? material : material ? [material] : [];
    return materials.some((entry) => {
      if (!entry?.emissive) return false;
      if (finiteNumber(entry.emissiveIntensity, 1) <= 0) return false;
      return entry.emissive.r > 0 || entry.emissive.g > 0 || entry.emissive.b > 0;
    });
  }

  function wireShadows(THREE, instance, settings) {
    // 影は shadowMap を有効にしただけでは出ない。どのメッシュが落とし / 受け、
    // どの光が投げるかの配線と、被写体の実寸に畳んだ shadow camera が要る
    instance.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(instance.model);
    if (bounds.isEmpty()) return;
    const sphere = bounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1e-6);
    instance.model.traverse((object) => {
      if (!object.isMesh) return;
      // 自発光マテリアルは光源側の扱い。影を落とすと発光体が自分の影で汚れ、
      // 受けると画面へ差した絵が影で沈む
      const emissive = isEmissiveMesh(object.material);
      object.castShadow = !emissive;
      object.receiveShadow = !emissive;
    });
    instance.scene.traverse((object) => {
      if (!object.isDirectionalLight) return;
      object.castShadow = true;
      object.shadow.mapSize.set(settings.mapSize, settings.mapSize);
      // DirectionalLight の shadow camera は既定が ±5 の正射影。数 cm〜数十 cm の
      // 被写体をそのまま撮ると深度の分解能を使い切れず、影が出ないか縞になる。
      // 注視点が被写体の中心からずれている分も足して、必ず全体を覆う
      const extent = radius + sphere.center.distanceTo(object.target.position);
      const camera = object.shadow.camera;
      camera.left = -extent;
      camera.right = extent;
      camera.top = extent;
      camera.bottom = -extent;
      const distance = object.position.distanceTo(object.target.position);
      camera.near = Math.max(extent * 0.01, distance - extent * 2);
      camera.far = distance + extent * 2;
      camera.updateProjectionMatrix();
      object.shadow.bias = settings.bias ?? -0.0027 * extent;
      object.shadow.normalBias = settings.normalBias ?? 0.01 * extent;
    });
  }

  // texts[] 宣言の検証（contract-2026-08-12-3d-text-rail.md §3.1）。既存の materialOverrides /
  // shadows と同じ流儀（object 形状チェック + 明示エラーメッセージ）。ランタイム側の既定値埋めは
  // resolveTextLayout / resolveTextAnim / buildTextMaterial が担う（ここでは形状と値の妥当性だけを見る）。
  function validateTexts(texts) {
    if (!Array.isArray(texts)) {
      throw new TypeError("data-akari-3d-scene.texts は配列である必要があります");
    }
    const seenIds = new Set();
    for (const [index, entry] of texts.entries()) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new TypeError(`texts[${index}] は object である必要があります`);
      }
      if (typeof entry.id !== "string" || entry.id.length === 0) {
        throw new TypeError(`texts[${index}].id は非空文字列である必要があります`);
      }
      if (seenIds.has(entry.id)) {
        throw new TypeError(`texts[].id が重複しています: ${entry.id}`);
      }
      seenIds.add(entry.id);
      if (typeof entry.text !== "string" || entry.text.length === 0) {
        throw new TypeError(`texts[${entry.id}].text は非空文字列である必要があります`);
      }
      if (typeof entry.font !== "string" || entry.font.length === 0) {
        throw new TypeError(`texts[${entry.id}].font は配信 URL である必要があります`);
      }
      const mode = entry.mode ?? "flat";
      if (mode === "extrude") {
        throw new Error(`texts[${entry.id}].mode="extrude" は T3 未実装です`);
      }
      if (mode !== "flat") {
        throw new TypeError(`texts[${entry.id}].mode の未対応値です: ${String(entry.mode)}`);
      }
      if (entry.size !== undefined && !Number.isFinite(Number(entry.size))) {
        throw new TypeError(`texts[${entry.id}].size は数値である必要があります`);
      }
      if (entry.color !== undefined && typeof entry.color !== "string") {
        throw new TypeError(`texts[${entry.id}].color は文字列である必要があります`);
      }
      if (entry.material !== undefined) {
        const material = entry.material;
        if (!material
          || typeof material !== "object"
          || Array.isArray(material)
          || Object.keys(material).some(
            (key) => key !== "metalness" && key !== "roughness" && key !== "doubleSide"
          )) {
          throw new TypeError(
            `texts[${entry.id}].material は metalness / roughness / doubleSide を指定する object である必要があります`
          );
        }
      }
      if (entry.layout !== undefined) {
        const layout = entry.layout;
        if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
          throw new TypeError(`texts[${entry.id}].layout は object である必要があります`);
        }
        if (layout.type !== undefined && layout.type !== "line" && layout.type !== "cylinder") {
          throw new TypeError(`texts[${entry.id}].layout.type の未対応値です: ${String(layout.type)}`);
        }
      }
      if (entry.anim !== undefined) {
        const anim = entry.anim;
        if (!anim || typeof anim !== "object" || Array.isArray(anim)) {
          throw new TypeError(`texts[${entry.id}].anim は object である必要があります`);
        }
        const preset = anim.preset ?? "none";
        if (!TEXT_ANIM_PRESETS.has(preset)) {
          throw new TypeError(`texts[${entry.id}].anim.preset の未対応値です: ${String(anim.preset)}`);
        }
        // seed 必須は不変条件（contract §3.1）— アニメが localSeconds の純関数であり続けるための
        // per-char 定数表を、mount 時にこの値だけから決定的に生成するため
        if (preset !== "none" && !Number.isFinite(Number(anim.seed))) {
          throw new TypeError(`texts[${entry.id}].anim.seed は preset="${preset}" のとき必須です`);
        }
      }
    }
  }

  // physics 宣言の検証（契約 §3.1 physics）。texts[] は validateTexts 済みの生 descriptor 配列を渡す —
  // targets の id 解決と、対象文字の anim.preset 排他チェック（physics 優先。実装判断は report 参照）に使う
  function validatePhysics(physics, texts) {
    if (!physics || typeof physics !== "object" || Array.isArray(physics)) {
      throw new TypeError("data-akari-3d-scene.physics は object である必要があります");
    }
    if (physics.enabled !== undefined && typeof physics.enabled !== "boolean") {
      throw new TypeError("physics.enabled は真偽値である必要があります");
    }
    // seed 必須は不変条件（契約 §3.1）— 決定論的な初期配置・presim の唯一の乱数源
    if (!Number.isFinite(Number(physics.seed))) {
      throw new TypeError("physics.seed は必須の数値です");
    }
    if (!Number.isFinite(Number(physics.duration)) || Number(physics.duration) <= 0) {
      throw new TypeError("physics.duration は正の数値である必要があります");
    }
    if (physics.dt !== undefined
      && (!Number.isFinite(Number(physics.dt)) || Number(physics.dt) <= 0)) {
      throw new TypeError("physics.dt は正の数値である必要があります");
    }
    if (physics.gravity !== undefined
      && (!Array.isArray(physics.gravity)
        || physics.gravity.length !== 2
        || !physics.gravity.every((value) => Number.isFinite(Number(value))))) {
      throw new TypeError("physics.gravity は [x, y] の数値配列である必要があります");
    }
    if (physics.restitution !== undefined && !Number.isFinite(Number(physics.restitution))) {
      throw new TypeError("physics.restitution は数値である必要があります");
    }
    if (!Array.isArray(physics.targets) || physics.targets.length === 0) {
      throw new TypeError("physics.targets は非空の texts[].id 配列である必要があります");
    }
    const textById = new Map((texts ?? []).map((entry) => [entry.id, entry]));
    for (const targetId of physics.targets) {
      if (typeof targetId !== "string" || targetId.length === 0) {
        throw new TypeError("physics.targets の要素は texts[].id の文字列である必要があります");
      }
      const target = textById.get(targetId);
      if (!target) {
        throw new TypeError(`physics.targets が texts[].id を解決できません: ${targetId}`);
      }
      // physics 優先の排他制約（契約の指示 3）: 対象文字に anim.preset が明示されていたらエラーにする。
      // 警告に留める案もあったが、「両方が localSeconds ごとに position/rotation を書き換える」の
      // 曖昧な優先順位を残さないため、この実装ではエラーを選ぶ（判断理由は report.md 参照）
      const preset = target.anim?.preset ?? "none";
      if (preset !== "none") {
        throw new Error(
          `texts[${targetId}] は physics.targets に含まれるため anim.preset を指定できません`
          + `（physics 優先の排他制約。preset="${preset}"）`
        );
      }
    }
    if (!Array.isArray(physics.colliders)) {
      throw new TypeError("physics.colliders は配列である必要があります");
    }
    for (const [index, collider] of physics.colliders.entries()) {
      if (!collider || typeof collider !== "object" || Array.isArray(collider)) {
        throw new TypeError(`physics.colliders[${index}] は object である必要があります`);
      }
      if (!PHYSICS_COLLIDER_TYPES.has(collider.type)) {
        throw new TypeError(`physics.colliders[${index}].type の未対応値です: ${String(collider.type)}`);
      }
      if (collider.type === "floor") {
        if (!Number.isFinite(Number(collider.y))) {
          throw new TypeError(`physics.colliders[${index}].y は数値である必要があります`);
        }
      } else if (collider.type === "wall") {
        if (!Number.isFinite(Number(collider.x))) {
          throw new TypeError(`physics.colliders[${index}].x は数値である必要があります`);
        }
      } else if (collider.type === "circle") {
        if (!Array.isArray(collider.center)
          || collider.center.length !== 2
          || !collider.center.every((value) => Number.isFinite(Number(value)))) {
          throw new TypeError(`physics.colliders[${index}].center は [x, y] の数値配列である必要があります`);
        }
        if (!Number.isFinite(Number(collider.r)) || Number(collider.r) <= 0) {
          throw new TypeError(`physics.colliders[${index}].r は正の数値である必要があります`);
        }
      } else if (collider.type === "polygon") {
        if (!Array.isArray(collider.points) || collider.points.length < 3) {
          throw new TypeError(`physics.colliders[${index}].points は 3 点以上の配列である必要があります`);
        }
        if (collider.points.length > PHYSICS_MAX_POLYGON_POINTS) {
          throw new Error(
            `physics.colliders[${index}].points が上限 ${PHYSICS_MAX_POLYGON_POINTS} 点を超えています: `
            + `${collider.points.length}`
          );
        }
        for (const point of collider.points) {
          if (!Array.isArray(point)
            || point.length !== 2
            || !point.every((value) => Number.isFinite(Number(value)))) {
            throw new TypeError(`physics.colliders[${index}].points の要素は [x, y] の数値配列である必要があります`);
          }
        }
      }
    }
  }

  function readDescriptor(container) {
    if (container.childElementCount !== 1) {
      throw new Error("3D overlay fragment は単一ルートである必要があります");
    }
    const executableScripts = container.querySelectorAll(
      'script:not([type="application/json"][data-akari-3d-scene])'
    );
    if (executableScripts.length > 0) {
      throw new Error("3D overlay fragment に実行可能 script は置けません");
    }
    const declarations = container.querySelectorAll(
      'script[type="application/json"][data-akari-3d-scene]'
    );
    if (declarations.length !== 1) {
      throw new Error("3D overlay には data-akari-3d-scene 宣言が 1 個必要です");
    }

    const descriptor = JSON.parse(declarations[0].textContent || "{}");
    if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
      throw new TypeError("data-akari-3d-scene は JSON object である必要があります");
    }
    for (const key of Object.keys(descriptor)) {
      if (!ALLOWED_SCENE_KEYS.has(key)) {
        throw new TypeError(`data-akari-3d-scene の未対応キーです: ${key}`);
      }
    }
    // texts[] があれば model は任意化される（両方あれば併存。§3.1）
    const hasTexts = descriptor.texts !== undefined;
    if (hasTexts) validateTexts(descriptor.texts);
    const hasNonEmptyTexts = hasTexts && descriptor.texts.length > 0;
    if (descriptor.physics !== undefined) {
      if (!hasNonEmptyTexts) {
        throw new TypeError("data-akari-3d-scene.physics は非空の texts[] と併用する必要があります");
      }
      validatePhysics(descriptor.physics, descriptor.texts);
    }
    if (descriptor.model !== undefined) {
      if (typeof descriptor.model !== "string" || descriptor.model.length === 0) {
        throw new TypeError("data-akari-3d-scene.model は配信 URL である必要があります");
      }
    } else if (!hasNonEmptyTexts) {
      throw new TypeError("data-akari-3d-scene.model は配信 URL である必要があります");
    }
    if (descriptor.animationClip !== undefined && !isAnimationClipSelector(descriptor.animationClip)) {
      throw new TypeError('animationClip は glTF clip 名の文字列、その配列、または "*" である必要があります');
    }
    if (descriptor.camera !== undefined) {
      if (!descriptor.camera || typeof descriptor.camera !== "object" || Array.isArray(descriptor.camera)) {
        throw new TypeError("camera は object である必要があります");
      }
      if (descriptor.camera.fromModel !== undefined
        && descriptor.camera.fromModel !== true
        && (typeof descriptor.camera.fromModel !== "string" || descriptor.camera.fromModel.length === 0)) {
        throw new TypeError("camera.fromModel は true または glb 内カメラノード名である必要があります");
      }
    }
    if (descriptor.environment !== undefined) {
      if (!descriptor.environment
        || typeof descriptor.environment !== "object"
        || Array.isArray(descriptor.environment)
        || Object.keys(descriptor.environment).some(
          (key) => key !== "intensity" && key !== "exposure" && key !== "map"
        )) {
        throw new TypeError("environment は intensity / exposure / map を指定する object である必要があります");
      }
      if (descriptor.environment.map !== undefined
        && (typeof descriptor.environment.map !== "string" || descriptor.environment.map.length === 0)) {
        throw new TypeError("environment.map は正距円筒画像の URL である必要があります");
      }
    }
    if (descriptor.shadows !== undefined && typeof descriptor.shadows !== "boolean") {
      if (!descriptor.shadows
        || typeof descriptor.shadows !== "object"
        || Array.isArray(descriptor.shadows)
        || Object.keys(descriptor.shadows).some(
          (key) => key !== "enabled" && key !== "mapSize" && key !== "bias" && key !== "normalBias"
        )) {
        throw new TypeError(
          "shadows は真偽値、または enabled / mapSize / bias / normalBias を指定する object である必要があります"
        );
      }
    }
    if (descriptor.materialOverrides !== undefined) {
      if (!descriptor.materialOverrides
        || typeof descriptor.materialOverrides !== "object"
        || Array.isArray(descriptor.materialOverrides)) {
        throw new TypeError("materialOverrides は object である必要があります");
      }
      for (const [materialName, override] of Object.entries(descriptor.materialOverrides)) {
        if (!materialName
          || !override
          || typeof override !== "object"
          || Array.isArray(override)
          || Object.keys(override).some((key) => key !== "texture")
          || typeof override.texture !== "string"
          || override.texture.length === 0) {
          throw new TypeError("materialOverrides は material 名ごとに texture URL を指定してください");
        }
      }
    }
    return descriptor;
  }

  function createVideoTexture(THREE, instance, video) {
    const texture = new THREE.VideoTexture(video);
    // VideoTexture の既定は generateMipmaps=false / minFilter=LinearFilter。大きな画面素材を
    // 3D 上の小さな面へ潰すと 1 テクセルしか拾わず細部が割れ、モデルが回ると割れ方が毎フレーム
    // 変わるので「カクついている」ように見える（静止画は TextureLoader が既定でミップマップを
    // 作るためこの症状が出ない = 動画テクスチャだけが素通しになっていた）
    texture.generateMipmaps = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(16, instance.renderer.capabilities.getMaxAnisotropy());
    instance.videoTextures.add(texture);
    return texture;
  }

  async function loadVideoTexture(THREE, instance, url) {
    const video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = "auto";
    // 壁時計で再生させない。時刻を決めるのは常に外側 —
    // export は rasterize の決定的シーク（currentTime → 提示フレーム確定）、
    // preview は overlay-runtime の tick。autoplay に任せると同じ時刻で絵が変わる
    video.autoplay = false;
    // 素材の尺より合成が長いときは巻き戻して回す。シーク側はこの loop を見て時刻を畳む
    video.loop = true;
    video.dataset.akariThreeVideoTexture = "";
    // DOM へ置くのが要点 — 決定的シークは document.querySelectorAll('video') を対象に
    // するので、DOM にいるだけで既存の機構に乗る
    video.style.cssText =
      "position:absolute;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    instance.videoElements.add(video);
    video.src = url;
    await new Promise((resolve, reject) => {
      video.addEventListener("loadeddata", resolve, { once: true });
      video.addEventListener(
        "error",
        () => reject(new Error(`materialOverrides の動画を読み込めません: ${url.slice(0, 96)}`)),
        { once: true }
      );
    });
    return createVideoTexture(THREE, instance, video);
  }

  function loadTexture(THREE, instance, textureLoader, url) {
    if (!VIDEO_TEXTURE_PATTERN.test(url)) return textureLoader.loadAsync(url);
    return loadVideoTexture(THREE, instance, url);
  }

  async function applyMaterialOverrides(THREE, instance, root, overrides) {
    if (!overrides) return;
    const materialsByName = new Map();
    root.traverse((object) => {
      const materials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of materials) {
        if (!materialsByName.has(material.name)) materialsByName.set(material.name, new Set());
        materialsByName.get(material.name).add(material);
      }
    });

    const textureLoader = new THREE.TextureLoader();
    await Promise.all(Object.entries(overrides).map(async ([materialName, override]) => {
      const materials = materialsByName.get(materialName);
      if (!materials?.size) {
        console.warn(`[akari-three] materialOverrides の対象が見つかりません: ${materialName}`);
        return;
      }
      const texture = await loadTexture(THREE, instance, textureLoader, override.texture);
      texture.flipY = false;
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      const configuredTextures = new Map();
      for (const material of materials) {
        const existingTexture = material.emissiveMap?.isTexture
          ? material.emissiveMap
          : null;
        const channel = existingTexture?.channel ?? 0;
        const wrapS = existingTexture?.wrapS ?? texture.wrapS;
        const wrapT = existingTexture?.wrapT ?? texture.wrapT;
        const configurationKey = `${channel}:${wrapS}:${wrapT}`;
        let configuredTexture = configuredTextures.get(configurationKey);
        if (!configuredTexture) {
          if (configuredTextures.size === 0) {
            configuredTexture = texture;
          } else if (texture.isVideoTexture) {
            // **動画に Texture.clone() は使えない。** clone は `this.source = source.source` で
            // Source を共有するが、GPU へのアップロードは Source の version で門番されている
            // （`sourceProperties.__version !== source.version` のときだけ上げ直す）。
            // つまり先に上げた側が version を消費し、**もう一方は 1 枚目で固まる**。
            // 同じ <video> から VideoTexture を作り直せば Source が別になり、両方が更新される
            configuredTexture = createVideoTexture(THREE, instance, texture.image);
          } else {
            configuredTexture = texture.clone();
          }
          configuredTexture.channel = channel;
          configuredTexture.wrapS = wrapS;
          configuredTexture.wrapT = wrapT;
          configuredTexture.flipY = false;
          configuredTexture.colorSpace = THREE.SRGBColorSpace;
          configuredTexture.needsUpdate = true;
          configuredTextures.set(configurationKey, configuredTexture);
        }
        material.emissiveMap = configuredTexture;
        material.needsUpdate = true;
      }
    }));
  }

  function createCamera(THREE, descriptor) {
    const cameraDescriptor = descriptor.camera ?? {};
    const camera = new THREE.PerspectiveCamera(
      finiteNumber(cameraDescriptor.fov, 45),
      1,
      finiteNumber(cameraDescriptor.near, 0.1),
      finiteNumber(cameraDescriptor.far, 2000)
    );
    camera.position.fromArray(vector3(cameraDescriptor.position, [0, 1.2, 3]));
    camera.lookAt(...vector3(cameraDescriptor.lookAt, [0, 0.5, 0]));
    return camera;
  }

  // camera.fromModel: glb 内カメラノードを描画カメラに使う（notes-2026-08-11-route-a-camera-clips.md）。
  // カメラの動きも glTF クリップ = データとして持てるため、宣言型（実行コードを配信物に
  // 入れない）の約束のままカメラアニメが成立する。ステージ演出（床 + 接地影）では
  // モデル移動と等価にならない（影が床を掃く）ので、モデルではなくカメラを動かしたいときに使う。
  function resolveModelCamera(gltf, selector) {
    const cameras = [];
    gltf.scene.traverse((object) => {
      if (object.isCamera) cameras.push(object);
    });
    // GLTFLoader はシーンツリー外のカメラを gltf.cameras にだけ持つことがある。
    // ただしツリー外のカメラは mixer が動かせない（クリップは node を辿る）ので、
    // 見つけても描画には使えない — シーンに入れて出力し直してもらう
    if (cameras.length === 0) {
      const orphaned = Array.isArray(gltf.cameras) ? gltf.cameras.length : 0;
      throw new Error(
        orphaned > 0
          ? "glb のカメラがシーンツリー外にあります（Blender 側でコレクションに入れて出力し直す）"
          : "camera.fromModel が宣言されていますが glb にカメラがありません"
      );
    }
    if (selector === true) return cameras[0];
    const found = cameras.find(
      (camera) => camera.name === selector || camera.parent?.name === selector
    );
    if (!found) {
      const names = cameras.map((camera) => camera.name || camera.parent?.name || "(無名)");
      throw new Error(`glb にカメラノードが見つかりません: ${selector}（候補: ${names.join(", ")}）`);
    }
    return found;
  }

  function adoptModelCamera(instance, gltf) {
    const selector = instance.descriptor.camera?.fromModel;
    if (selector === undefined) return;
    const camera = resolveModelCamera(gltf, selector);
    if (!camera.isPerspectiveCamera) {
      throw new Error("camera.fromModel は perspective カメラのみ対応です");
    }
    const literalKeys = Object.keys(instance.descriptor.camera).filter((key) => key !== "fromModel");
    if (literalKeys.length > 0) {
      // リテラルと fromModel の混在は「どちらが勝つか」を曖昧にするので、警告して glb 側を採る
      console.warn(
        `[akari-three] camera.fromModel 宣言時は ${literalKeys.join(" / ")} を無視します（glb の値を使う）`
      );
    }
    // glb の投影値（yfov / znear / zfar）を正とする。aspect だけは canvas 実寸が正
    //（rendererSize が毎 draw 追従する）。baseFov も差し替え、pan/zoom ツマミの
    // ズームレンズ式がベイク済みカメラの画角を基準に合成されるようにする
    instance.camera = camera;
    instance.baseFov = camera.fov;
    instance.cameraSource = "model";
    instance.projection = { panX: null, panY: null, zoom: null, width: null, height: null };
  }

  function addLights(THREE, scene, descriptors) {
    const lights = Array.isArray(descriptors) ? descriptors : [];
    for (const descriptor of lights) {
      if (!descriptor || typeof descriptor !== "object" || Array.isArray(descriptor)) {
        throw new TypeError("lights[] は object である必要があります");
      }
      let light;
      if (descriptor.type === "ambient") {
        light = new THREE.AmbientLight(
          descriptor.color ?? 0xffffff,
          finiteNumber(descriptor.intensity, 1)
        );
      } else if (descriptor.type === "directional") {
        light = new THREE.DirectionalLight(
          descriptor.color ?? 0xffffff,
          finiteNumber(descriptor.intensity, 1)
        );
        light.position.fromArray(vector3(descriptor.position, [2, 3, 2]));
        light.target.position.fromArray(vector3(descriptor.lookAt, [0, 0, 0]));
        scene.add(light.target);
      } else {
        throw new TypeError(`lights[].type の未対応値です: ${String(descriptor.type)}`);
      }
      scene.add(light);
    }
  }

  function configureEnvironment(THREE, RoomEnvironment, scene, renderer, descriptor) {
    const environmentDescriptor = descriptor.environment ?? {};
    scene.environmentIntensity = Math.max(
      0,
      finiteNumber(environmentDescriptor.intensity, 0.5)
    );
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = Math.max(
      0,
      finiteNumber(environmentDescriptor.exposure, 1)
    );

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    try {
      return pmremGenerator.fromScene(roomEnvironment);
    } finally {
      roomEnvironment.dispose();
      pmremGenerator.dispose();
    }
  }

  async function applyEnvironmentMap(THREE, instance, url) {
    // 金属は環境の映り込みでしか見えないのに、手続き生成の RoomEnvironment は強度スカラーしか
    // 触れず光源に「形」が無い。正距円筒画像を PMREM へ通して差し替えると輪郭のある映り込みが出る。
    // 差し替えは非同期なので、完了を status: ready の前に置く（待たずに焼くと既定の部屋のまま出る）
    const texture = await new Promise((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        resolve,
        undefined,
        () => reject(new Error(`environment.map を読み込めません: ${url.slice(0, 96)}`))
      );
    });
    if (instances.get(instance.container) !== instance || !instance.active) {
      texture.dispose();
      return;
    }
    texture.mapping = THREE.EquirectangularReflectionMapping;
    texture.colorSpace = THREE.SRGBColorSpace;
    const pmremGenerator = new THREE.PMREMGenerator(instance.renderer);
    try {
      const target = pmremGenerator.fromEquirectangular(texture);
      instance.scene.environment = target.texture;
      instance.environmentTarget?.dispose();
      instance.environmentTarget = target;
    } finally {
      pmremGenerator.dispose();
      texture.dispose();
    }
  }

  // per-char アニメ定数表の生成に使う決定論的疑似乱数（GLSL でよく使う sin ハッシュ）。
  // Math.random / Date は使わない — 同じ (seed, index, salt) は常に同じ値を返すので、
  // 書き出しを 2 回走らせても per-char の見た目が完全に一致する（contract §3.3）
  function seededUnit(seed, index, salt) {
    const x = Math.sin(seed * 12.9898 + index * 78.233 + salt * 37.719) * 43758.5453;
    return x - Math.floor(x);
  }

  function buildCharSeedTable(seed, index) {
    return {
      phaseX: seededUnit(seed, index, 1) * Math.PI * 2,
      phaseY: seededUnit(seed, index, 2) * Math.PI * 2,
      phaseZ: seededUnit(seed, index, 3) * Math.PI * 2,
      flickerPhase: seededUnit(seed, index, 4) * Math.PI * 2,
      tumbleRateX: 0.5 + seededUnit(seed, index, 5) * 0.4,
      tumbleRateY: 0.7 + seededUnit(seed, index, 6) * 0.5,
    };
  }

  // physics presim の初期配置（位置・角度・角速度）を決定論的に導出する。既存の per-char アニメ
  // 定数表（buildCharSeedTable）と同じ seededUnit（sin ハッシュ）を再利用する — mulberry32 等の
  // 別 PRNG を新規実装しなくても「明示シード・Math.random/Date 不使用・matter-js の
  // Common.random に非依存」という契約の不変条件は満たせるため（判断理由は report.md 参照）。
  // laneCount 列のグリッドへ physics 対象文字を並べ、列内で軽くジッタさせて重なりを避ける
  // （lab/telop-3d-poc の物理シーンと同じ発想。乱数源だけを既存の seededUnit に差し替えた）
  function physicsInitialState(seed, index) {
    const laneCount = 5;
    const col = index % laneCount;
    const row = Math.floor(index / laneCount);
    return {
      x: (col - (laneCount - 1) / 2) * 1.1 + (seededUnit(seed, index, 201) - 0.5) * 0.6,
      y: 3.4 + row * 1.5 + (seededUnit(seed, index, 202) - 0.5) * 0.5,
      angle: (seededUnit(seed, index, 203) - 0.5) * 0.6,
      angularVelocity: (seededUnit(seed, index, 204) - 0.5) * 0.24,
    };
  }

  // physics.colliders[] 1 件ぶんの静的 matter-js body を組み立てる（契約 §3.1 collider 種）。
  // floor/wall は「実質無限」に見える板（PHYSICS_COLLIDER_SPAN）として表現し、
  // polygon は凹多角形の可能性があるため poly-decomp 経由（vendor-3d-text-bundle.js で
  // Matter.Common.setDecomp 登録済み）で分解する。x, y に頂点集合の重心を渡すことで
  // Body.setVertices の再センタリング（原点へ寄せてから position へ戻す）を打ち消し、
  // 宣言どおりの絶対 scene 座標に頂点を固定する
  function buildColliderBody(Matter, collider) {
    const { Bodies, Vertices } = Matter;
    if (collider.type === "floor") {
      const thickness = PHYSICS_COLLIDER_SPAN;
      return Bodies.rectangle(
        0,
        collider.y - thickness / 2,
        PHYSICS_COLLIDER_SPAN * 2,
        thickness,
        { isStatic: true }
      );
    }
    if (collider.type === "wall") {
      const thickness = PHYSICS_COLLIDER_SPAN;
      const x = Number(collider.x);
      const center = x >= 0 ? x + thickness / 2 : x - thickness / 2;
      return Bodies.rectangle(center, 0, thickness, PHYSICS_COLLIDER_SPAN * 2, { isStatic: true });
    }
    if (collider.type === "circle") {
      const [cx, cy] = collider.center;
      return Bodies.circle(cx, cy, collider.r, { isStatic: true });
    }
    // polygon: minimumArea は既定 10 だと本プロダクトの scene 単位（宣言例のオーダーは概ね 1〜10）
    // では分解チャンクが軒並み切り捨てられ parts=[] → fromVertices が undefined を返しうる
    // （本タスクの vendor 実測で踏んだ実際の落とし穴。report.md 参照）ため明示的に 0 を渡す
    const points = collider.points.map(([x, y]) => ({ x, y }));
    const centre = Vertices.centre(points);
    return Bodies.fromVertices(centre.x, centre.y, [points], { isStatic: true }, true, 0.01, 0);
  }

  // createInstance() 時の事前シミュレーション（契約 §3.3 決定論の核）。matter-js を seed・固定 dt で
  // duration まで逐次実行し、physics 対象の per-char (x, y, angle) を Float32Array へ焼く。
  // 戻り値の buffer 以降、matter-js の Engine/Body は一切保持しない — draw(localSeconds) は
  // このバッファの線形補間 lookup だけで完結する（updatePhysicsChars）
  function runPhysicsPresim(Matter, instance, physicsDescriptor) {
    const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
    const { Engine, Composite, Body, Bodies } = Matter;
    const dt = finiteNumber(physicsDescriptor.dt, 1 / 120);
    const duration = Number(physicsDescriptor.duration);
    const gravity = Array.isArray(physicsDescriptor.gravity) ? physicsDescriptor.gravity : [0, -1];
    const restitution = finiteNumber(physicsDescriptor.restitution, 0.45);
    const seed = Number(physicsDescriptor.seed);

    const engine = Engine.create();
    engine.gravity.x = gravity[0];
    engine.gravity.y = gravity[1];
    for (const collider of physicsDescriptor.colliders ?? []) {
      Composite.add(engine.world, buildColliderBody(Matter, collider));
    }

    const targetIds = new Set(physicsDescriptor.targets);
    const physicsEntries = instance.textAnimEntries.filter((entry) => targetIds.has(entry.id));
    for (const entry of instance.textAnimEntries) entry.isPhysicsTarget = targetIds.has(entry.id);
    const physicsChars = physicsEntries.flatMap((entry) => entry.chars);

    const bodies = physicsChars.map((char, index) => {
      const box = char.node.geometry?.boundingBox;
      const boxWidth = box ? box.max.x - box.min.x : NaN;
      const boxHeight = box ? box.max.y - box.min.y : NaN;
      const fallbackSize = finiteNumber(char.node.fontSize, 0.5);
      const width = Number.isFinite(boxWidth) && boxWidth > 0 ? boxWidth : fallbackSize * 0.6;
      const height = Number.isFinite(boxHeight) && boxHeight > 0 ? boxHeight : fallbackSize;
      const initial = physicsInitialState(seed, index);
      const body = Bodies.rectangle(initial.x, initial.y, width, height, {
        angle: initial.angle,
        restitution,
        friction: 0.15,
        frictionAir: 0.002,
        density: 0.002,
      });
      Body.setAngularVelocity(body, initial.angularVelocity);
      Composite.add(engine.world, body);
      return body;
    });

    const frameCount = Math.max(1, Math.round(duration / dt)) + 1;
    const data = new Float32Array(frameCount * bodies.length * 3);
    function recordFrame(frameIndex) {
      const base = frameIndex * bodies.length * 3;
      for (let i = 0; i < bodies.length; i += 1) {
        data[base + i * 3 + 0] = bodies[i].position.x;
        data[base + i * 3 + 1] = bodies[i].position.y;
        data[base + i * 3 + 2] = bodies[i].angle;
      }
    }
    recordFrame(0);
    for (let frame = 1; frame < frameCount; frame += 1) {
      Engine.update(engine, dt * 1000);
      recordFrame(frame);
    }

    instance.physicsBuffer = { dt, duration, frameCount, charCount: bodies.length };
    instance.physicsData = data;
    instance.physicsChars = physicsChars.map((char) => char.node);
    instance.physicsPresimMs = (typeof performance !== "undefined" ? performance.now() : 0) - startedAt;
  }

  // draw(localSeconds) 側の唯一の physics 消費経路。クランプ付き線形補間 lookup のみ
  // （シーク方向・呼び出し順序に依存しない。契約 §3.3）
  function updatePhysicsChars(instance, localSeconds) {
    const buffer = instance.physicsBuffer;
    const data = instance.physicsData;
    const chars = instance.physicsChars;
    if (!buffer || !data || !chars || chars.length === 0) return;
    const { dt, duration, frameCount, charCount } = buffer;
    const clampedTime = Math.min(Math.max(0, localSeconds), duration);
    const frac = clampedTime / dt;
    const frame0 = Math.min(frameCount - 1, Math.floor(frac));
    const frame1 = Math.min(frameCount - 1, frame0 + 1);
    const alpha = frame1 === frame0 ? 0 : frac - frame0;
    const base0 = frame0 * charCount * 3;
    const base1 = frame1 * charCount * 3;
    for (let i = 0; i < charCount; i += 1) {
      const x0 = data[base0 + i * 3 + 0];
      const y0 = data[base0 + i * 3 + 1];
      const angle0 = data[base0 + i * 3 + 2];
      const x = x0 + (data[base1 + i * 3 + 0] - x0) * alpha;
      const y = y0 + (data[base1 + i * 3 + 1] - y0) * alpha;
      const angle = angle0 + (data[base1 + i * 3 + 2] - angle0) * alpha;
      const node = chars[i];
      node.position.set(x, y, 0);
      node.rotation.set(0, 0, angle);
    }
  }

  function easeInOutCubic(x) {
    return x < 0.5 ? 4 * x * x * x : 1 - ((-2 * x + 2) ** 3) / 2;
  }

  function resolveTextLayout(descriptor) {
    const layout = descriptor ?? {};
    return {
      type: layout.type === "cylinder" ? "cylinder" : "line",
      spacing: finiteNumber(layout.spacing, 0.78),
      radius: Math.max(1e-6, finiteNumber(layout.radius, 2.4)),
      position: vector3(layout.position, [0, 0, 0]),
      rotation: vector3(layout.rotation, [0, 0, 0]),
    };
  }

  function resolveTextAnim(descriptor) {
    const anim = descriptor ?? {};
    return {
      preset: TEXT_ANIM_PRESETS.has(anim.preset) ? anim.preset : "none",
      speed: finiteNumber(anim.speed, 1),
      stagger: finiteNumber(anim.stagger, 0.055),
      amplitude: finiteNumber(anim.amplitude, 1),
      seed: finiteNumber(anim.seed, 0),
    };
  }

  // flat の既定は unlit MeshBasicMaterial + DoubleSide（契約 §3.1）。metalness / roughness の
  // どちらかが明示されたときだけ、その knob が効く MeshStandardMaterial へ切り替える
  function buildTextMaterial(THREE, descriptor) {
    const material = descriptor ?? {};
    const side = material.doubleSide === false ? THREE.FrontSide : THREE.DoubleSide;
    if (material.metalness !== undefined || material.roughness !== undefined) {
      return new THREE.MeshStandardMaterial({
        side,
        transparent: true,
        metalness: finiteNumber(material.metalness, 0),
        roughness: finiteNumber(material.roughness, 1),
      });
    }
    return new THREE.MeshBasicMaterial({ side, transparent: true });
  }

  // 1 文字ぶんのレイアウト基準位置（anim プリセットはこの基準位置からの相対オフセットとして
  // 合成する）。line は spacing で中央寄せ、cylinder は文字数で等分した円周上に置き、
  // 外向きに向く（troika の SDF 平面は薄いので、裏側から見ると鏡文字が透ける = PoC 実証済みの
  // 「筒の裏側処理」がそのまま出る）
  function charBasePosition(layout, index, count) {
    if (layout.type === "cylinder") {
      const angle = count > 0 ? (index / count) * Math.PI * 2 : 0;
      return {
        x: Math.sin(angle) * layout.radius,
        y: 0,
        z: Math.cos(angle) * layout.radius,
        rotationY: angle,
      };
    }
    const x0 = (index - (count - 1) / 2) * layout.spacing;
    return { x: x0, y: 0, z: 0, rotationY: 0 };
  }

  // アニメは localSeconds だけの純関数（contract §3.3）。フレーム間の状態は持たず、
  // 毎 draw 呼び出しでゼロから (position, rotation, fillOpacity) を再計算する。
  // per-char の「乱数っぽい」ばらつきは mount 時に作った seedTable（buildCharSeedTable）由来のみ
  function applyTextAnimation(entry, localSeconds) {
    const { group, layout, anim, chars } = entry;
    group.position.set(layout.position[0], layout.position[1], layout.position[2]);
    group.rotation.set(layout.rotation[0], layout.rotation[1], layout.rotation[2]);
    const t = Math.max(0, localSeconds) * anim.speed;
    if (anim.preset === "carousel") {
      group.rotation.y += t;
      group.rotation.x += Math.sin(t * 0.4) * 0.08 * anim.amplitude;
    }
    for (const char of chars) {
      const { node, base, seedTable, index } = char;
      node.position.set(base.x, base.y, base.z);
      node.rotation.set(0, base.rotationY, 0);
      node.fillOpacity = 1;
      switch (anim.preset) {
        case "char-chaos": {
          node.rotation.x = Math.sin(t * 1.3 + seedTable.phaseX) * 0.45 * anim.amplitude;
          node.rotation.y = base.rotationY + Math.sin(t * 1.7 + seedTable.phaseY) * 0.5 * anim.amplitude;
          node.position.y = base.y + Math.sin(t * 2.1 + index * anim.stagger) * 0.16 * anim.amplitude;
          node.position.z = base.z + Math.sin(t * 1.1 + seedTable.phaseZ) * 0.35 * anim.amplitude;
          const flicker = Math.sin(t * 13 + seedTable.flickerPhase);
          node.fillOpacity = flicker > 0.93 ? 0.2 : 1;
          break;
        }
        case "flip-wave": {
          const phase = (((t * 0.22 - index * anim.stagger) % 1) + 1) % 1;
          let ry = base.rotationY;
          if (phase < 0.28) ry += easeInOutCubic(phase / 0.28) * Math.PI * 2 * anim.amplitude;
          node.rotation.y = ry;
          break;
        }
        case "tumble": {
          node.rotation.x = t * seedTable.tumbleRateX + seedTable.phaseX;
          node.rotation.y = base.rotationY + t * seedTable.tumbleRateY;
          node.rotation.z = Math.sin(t * 0.9 + seedTable.phaseZ) * 0.25 * anim.amplitude;
          node.position.y = base.y + Math.abs(Math.sin(t * 2 - index * anim.stagger)) * 0.35 * anim.amplitude;
          break;
        }
        case "carousel":
        case "none":
        default:
          break;
      }
    }
  }

  function updateTextAnimations(instance, localSeconds) {
    for (const entry of instance.textAnimEntries) {
      // physics 対象は updatePhysicsChars が per-char position/rotation を書くため、
      // anim の group/char リセット（layout 基準位置への巻き戻し）を通さない（排他。§3.1）
      if (entry.isPhysicsTarget) continue;
      applyTextAnimation(entry, localSeconds);
    }
  }

  // texts[] を per-char troika Text へ展開する。各文字の sync() 完了を待ってから resolve する
  // ことで、「読み込み中フレーム（グリフ未確定の空 SDF）」が createInstance() の ready 判定を
  // すり抜けないようにする（契約の指示 2）
  async function loadTexts(THREE, TroikaText, instance, textDescriptors) {
    disableTroikaUnicodeFontFallback();
    const syncPromises = [];
    for (const textDescriptor of textDescriptors) {
      const group = new THREE.Group();
      const layout = resolveTextLayout(textDescriptor.layout);
      const anim = resolveTextAnim(textDescriptor.anim);
      const size = finiteNumber(textDescriptor.size, 0.5);
      const color = typeof textDescriptor.color === "string" ? textDescriptor.color : "#ffffff";
      const chars = [...textDescriptor.text];
      const charEntries = [];
      chars.forEach((ch, index) => {
        const node = new TroikaText();
        node.text = ch;
        node.font = textDescriptor.font;
        node.fontSize = size;
        node.anchorX = "center";
        node.anchorY = "middle";
        node.color = color;
        node.material = buildTextMaterial(THREE, textDescriptor.material);
        const base = charBasePosition(layout, index, chars.length);
        node.position.set(base.x, base.y, base.z);
        node.rotation.y = base.rotationY;
        group.add(node);
        charEntries.push({
          node,
          index,
          base,
          seedTable: buildCharSeedTable(anim.seed, index),
        });
        syncPromises.push(waitForTextSync(node));
      });
      instance.textsGroup.add(group);
      instance.textNodes.push(...charEntries.map((entry) => entry.node));
      instance.textAnimEntries.push({ id: textDescriptor.id, group, layout, anim, chars: charEntries });
    }
    await Promise.all(syncPromises);
  }

  function setFallback(container, visible) {
    const fallback = container.querySelector("[data-akari-3d-fallback]");
    if (!(fallback instanceof HTMLElement)) return;
    fallback.hidden = !visible;
    if (visible) fallback.style.removeProperty("display");
    else fallback.style.setProperty("display", "none", "important");
  }

  // maxRenderSize: 描画バッファの長辺上限（px）。**呼び出し側が明示した時だけ**効く。
  // ライブプレビューは「位置と動きを掴む」用途なので等倍で描く必要がなく、上限を入れると
  // 目に見えて軽くなる。書き出し（render-cut の rasterize）は渡さない = 従来どおり等倍のまま。
  // CSS サイズ（setSize の第 3 引数 false）は変えないので、見た目の寸法は縮まずアスペクトも保つ。
  function rendererSize(instance, maxRenderSize) {
    const rect = instance.canvas.getBoundingClientRect();
    const containerRect = instance.container.getBoundingClientRect();
    const cssWidth = Math.max(1, Math.round(rect.width || containerRect.width || 1));
    const cssHeight = Math.max(1, Math.round(rect.height || containerRect.height || 1));
    const cap = Number(maxRenderSize);
    const longest = Math.max(cssWidth, cssHeight);
    const scale = Number.isFinite(cap) && cap > 0 && longest > cap ? cap / longest : 1;
    const width = Math.max(1, Math.round(cssWidth * scale));
    const height = Math.max(1, Math.round(cssHeight * scale));
    // 断片は拡大縮小アニメを持つのが普通で（例: icon-live の drift）、canvas の実測サイズは
    // 毎フレーム 1px 単位で動く。素直に追従すると setSize が毎フレーム走って WebGL の
    // 描画バッファを作り直し続ける（実測: プロファイルに setSize が常駐）。
    // 数 px の差は見た目に出ないので、意味のある変化のときだけ作り直す。
    const RESIZE_TOLERANCE = 0.04; // 4% 以上変わったら追従する
    const current = { w: instance.canvas.width, h: instance.canvas.height };
    const changedEnough = current.w < 1 || current.h < 1
      || Math.abs(width - current.w) / Math.max(1, current.w) > RESIZE_TOLERANCE
      || Math.abs(height - current.h) / Math.max(1, current.h) > RESIZE_TOLERANCE;
    if (changedEnough) {
      instance.renderer.setSize(width, height, false);
    }
    // 投影は CSS 上の見た目の比で決める（バッファを縮めても画角は変わらない）
    const aspect = cssWidth / cssHeight;
    if (instance.camera.aspect !== aspect) {
      instance.camera.aspect = aspect;
      instance.camera.updateProjectionMatrix();
    }
  }

  // 標準ツマミ 3 種をカメラの投影へ反映する（canvas の CSS 変形ではなく
  // camera.setViewOffset / fov のズームレンズ相当への差し替え。skills/overlay-authoring/3d.md）。
  // カメラ位置・モデル姿勢・ライトには一切触れない（焼き込み済みアニメーションクリップと
  // 干渉させないため。task 2026-08-06-live-knob-camera-v2）。
  //
  // 読むのは instance.canvas の computed style。三者（render-cut の `.scene-content`、
  // shell/knob-audit の overlay container、store の `.asset-canvas`）のどれで包んでも、
  // 標準プロパティは断片ルートで宣言され canvas まで CSS 継承で届くため、どの呼び出し元でも
  // 同じ読み方で成立する。
  //
  // 3 プロパティとも getComputedStyle が空文字（＝どの断片も宣言していない）なら
  // camera.view に一切触れない — 後方互換の根拠そのもの（旧断片は本関数の呼び出し前と
  // 完全に同じコード経路のまま）。
  function applyProjectionKnobs(instance) {
    const computedStyle = getComputedStyle(instance.canvas);
    const panXRatio = readProjectionRatio(computedStyle, "--akari-3d-pan-x");
    const panYRatio = readProjectionRatio(computedStyle, "--akari-3d-pan-y");
    const zoomRatio = readProjectionRatio(computedStyle, "--akari-3d-zoom");
    if (panXRatio === null && panYRatio === null && zoomRatio === null) return;

    const panX = panXRatio ?? 0;
    const panY = panYRatio ?? 0;
    const zoom = zoomRatio !== null && zoomRatio > 0 ? zoomRatio : 1;
    const width = instance.canvas.width;
    const height = instance.canvas.height;

    // 値は draw のたびに読むが（CSS 側でアニメートされうるため）、前フレームと同じなら
    // setViewOffset / updateProjectionMatrix を呼び直さない（無駄な行列再計算を避ける）。
    const state = instance.projection;
    if (
      state.panX === panX && state.panY === panY && state.zoom === zoom
      && state.width === width && state.height === height
    ) {
      return;
    }

    // pan は純粋な投影オフセット（フレーム幅/高さに対する割合）。
    // 符号は既存 CSS translate と同じ向き（pan-y: 正 = 下へ）。
    instance.camera.setViewOffset(width, height, -panX * width, -panY * height, width, height);
    // zoom はズームレンズ相当（fov の詰め直し）。カメラ位置・モデルは動かさない。
    const halfFovRadians = ((instance.baseFov * Math.PI) / 180) / 2;
    const zoomedFovRadians = Math.atan(Math.tan(halfFovRadians) / zoom) * 2;
    instance.camera.fov = (zoomedFovRadians * 180) / Math.PI;
    instance.camera.updateProjectionMatrix();

    state.panX = panX;
    state.panY = panY;
    state.zoom = zoom;
    state.width = width;
    state.height = height;
  }

  // 動画テクスチャの時刻を overlay のローカル時刻へ合わせる。
  //
  // **呼ぶのはライブプレビューだけ**。書き出し（rasterize）は自前でフレーム精度シークを
  // 済ませてから render() を呼ぶので、ここで currentTime を書くと確定済みの提示フレームを
  // 崩して決定性が壊れる。だから既定では同期せず、preview が明示的に要求したときだけ行う。
  //
  // preview は壁時計で進むので提示フレームの確定は待たない（待つと tick が詰まる）。
  // 1 つ前後のフレームがずれることはあるが、絵は必ず「その時刻の近傍」になる。
  function syncVideoTextures(instance, localSeconds) {
    for (const video of instance.videoElements) {
      const duration = video.duration;
      const target = video.loop && Number.isFinite(duration) && duration > 0
        ? Math.max(0, localSeconds) % duration
        : Math.max(0, localSeconds);
      // 既に十分近ければ書かない。毎 tick 無条件に代入すると再生中でも
      // シークが走り続けてデコーダが追いつかなくなる
      if (Math.abs(video.currentTime - target) < 0.02) continue;
      try {
        video.currentTime = target;
      } catch {}
    }
  }

  function draw(instance, localSeconds) {
    // texts[] のみ（model 無し）のシーンでも描く必要があるため、readiness は instance.model の
    // 有無ではなく contentReady（model 読み込み + 全 texts sync() 完了）で判定する
    if (!instance.active || !instance.contentReady) return;
    rendererSize(instance, instance.maxRenderSize);
    applyProjectionKnobs(instance);
    if (instance.mixer) instance.mixer.setTime(Math.max(0, localSeconds));
    if (instance.textAnimEntries.length > 0) updateTextAnimations(instance, localSeconds);
    if (instance.physicsBuffer) updatePhysicsChars(instance, localSeconds);
    // 動画テクスチャは「今 <video> に出ているフレーム」を GPU へ上げ直さないと 1 枚目で固まる。
    // どの時刻を出すかは外側が currentTime で決め、ここは上げ直しだけを担う
    for (const texture of instance.videoTextures) texture.needsUpdate = true;
    instance.renderer.render(instance.scene, instance.camera);
  }

  function disposeObject(root) {
    if (!root) return;
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    root.traverse((object) => {
      if (object.geometry?.dispose) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material)
        ? object.material
        : object.material
          ? [object.material]
          : [];
      for (const material of objectMaterials) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture && value.dispose) textures.add(value);
        }
        for (const uniform of Object.values(material.uniforms ?? {})) {
          if (uniform?.value?.isTexture && uniform.value.dispose) textures.add(uniform.value);
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }

  function releaseVideoTextures(instance) {
    // VideoTexture の dispose は requestVideoFrameCallback を止める。<video> は自分で body へ
    // 挿しているので自分で外す（外さないと mount / unmount のたびにデコーダが積み上がる）
    for (const texture of instance.videoTextures) texture.dispose();
    instance.videoTextures.clear();
    for (const video of instance.videoElements) {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch {}
      video.remove();
    }
    instance.videoElements.clear();
  }

  function disposeInstance(instance) {
    instance.active = false;
    instance.mixer?.stopAllAction();
    disposeObject(instance.model);
    disposeObject(instance.textsGroup);
    // troika Text.dispose() は SDF atlas 等、generic disposeObject の geometry/material 走査だけでは
    // 解放されない troika 固有のキャッシュも片付ける
    for (const node of instance.textNodes) node.dispose?.();
    instance.textNodes = [];
    instance.textAnimEntries = [];
    instance.physicsBuffer = null;
    instance.physicsData = null;
    instance.physicsChars = [];
    releaseVideoTextures(instance);
    instance.model = null;
    instance.mixer = null;
    instance.scene.environment = null;
    instance.environmentTarget?.dispose();
    instance.environmentTarget = null;
    instance.renderer.renderLists?.dispose();
    instance.renderer.dispose();
    setFallback(instance.container, true);
  }

  function dispose(container) {
    failedContainers.delete(container);
    const instance = instances.get(container);
    if (!instance) return;
    instances.delete(container);
    disposeInstance(instance);
  }

  function createInstance(container) {
    const library = window.AkariThree;
    if (!library?.THREE
      || typeof library.GLTFLoader !== "function"
      || typeof library.RoomEnvironment !== "function") {
      throw new Error("AkariThree bundle が読み込まれていません");
    }
    const descriptor = readDescriptor(container);
    const hasTexts = Array.isArray(descriptor.texts) && descriptor.texts.length > 0;
    if (hasTexts && typeof library.TroikaText !== "function") {
      throw new Error("AkariThree bundle に TroikaText がありません（vendor-3d-text-bundle.js 未読み込み）");
    }
    const hasPhysics = descriptor.physics !== undefined && descriptor.physics.enabled !== false;
    if (hasPhysics && typeof library.Matter !== "object") {
      throw new Error("AkariThree bundle に Matter がありません（vendor-3d-text-bundle.js 未読み込み）");
    }
    const canvas = container.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("3D overlay には canvas が必要です");
    }

    const { THREE, GLTFLoader, RoomEnvironment, TroikaText } = library;
    const scene = new THREE.Scene();
    const camera = createCamera(THREE, descriptor);
    addLights(THREE, scene, descriptor.lights);
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0x000000, 0);
    const shadows = shadowSettings(descriptor.shadows);
    if (shadows.enabled) {
      // shadowMap の有無は material の shader program に焼かれるので、最初の render より前に立てる。
      // PCFSoftShadowMap は同梱 Three で非推奨（内部で PCFShadowMap へ落ちて警告を出す）ため
      // 実際に使われる型を明示する
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
    }
    let environmentTarget;
    try {
      environmentTarget = configureEnvironment(
        THREE,
        RoomEnvironment,
        scene,
        renderer,
        descriptor
      );
      scene.environment = environmentTarget.texture;
    } catch (error) {
      renderer.dispose();
      throw error;
    }

    const instance = {
      active: true,
      animationClips: 0,
      // 標準ツマミの zoom（fov 詰め直し）が基準にする「宣言どおりの fov」。以後
      // instance.camera.fov は zoom 倍率で書き換わるため、生成時の値を別に保持する
      baseFov: camera.fov,
      camera,
      canvas,
      container,
      descriptor,
      environmentTarget,
      // camera.fromModel でモデル内カメラへ差し替わると "model" になる（検証・証跡用）
      cameraSource: "descriptor",
      lastTime: 0,
      mixer: null,
      model: null,
      // texts[] の状態（model と独立に存在しうる。§3.1 texts[] があれば model は任意）
      textsGroup: new THREE.Group(),
      textNodes: [],
      textAnimEntries: [],
      // physics presim の結果（契約 §3.3）。runPhysicsPresim 完了まで null
      // = draw() の updatePhysicsChars 呼び出しは物理対象なし相当で素通りする
      physicsBuffer: null,
      physicsData: null,
      physicsChars: [],
      physicsPresimMs: null,
      // model 読み込み（宣言時のみ）+ 全 texts sync() 完了の両方が揃うまで false。
      // draw() はこれを ready 条件に使う（読み込み中フレームが書き出しに混入しないため）
      contentReady: false,
      // 標準ツマミ 3 種の直近適用値（memo）。null は「まだ一度も適用していない」の意
      projection: { panX: null, panY: null, zoom: null, width: null, height: null },
      renderer,
      scene,
      shadows,
      status: "loading",
      videoElements: new Set(),
      videoTextures: new Set(),
    };
    instances.set(container, instance);
    instance.scene.add(instance.textsGroup);
    setFallback(container, true);

    const hasModel = typeof descriptor.model === "string" && descriptor.model.length > 0;
    const loader = hasModel ? new GLTFLoader() : null;

    async function loadModel() {
      const gltf = await loader.loadAsync(descriptor.model);
      if (instances.get(container) !== instance || !instance.active) {
        disposeObject(gltf.scene);
        return;
      }
      instance.model = gltf.scene;
      await applyMaterialOverrides(THREE, instance, gltf.scene, descriptor.materialOverrides);
      if (descriptor.environment?.map) {
        await applyEnvironmentMap(THREE, instance, descriptor.environment.map);
      }
      if (instances.get(container) !== instance || !instance.active) {
        disposeObject(gltf.scene);
        if (instance.model === gltf.scene) instance.model = null;
        return;
      }
      instance.scene.add(gltf.scene);
      adoptModelCamera(instance, gltf);
      if (descriptor.animationClip !== undefined) {
        const clips = selectAnimationClips(gltf.animations, descriptor.animationClip);
        instance.mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of clips) instance.mixer.clipAction(clip).play();
        instance.animationClips = clips.length;
      }
      if (instance.shadows.enabled && instance.model) wireShadows(THREE, instance, instance.shadows);
    }

    instance.loading = Promise.all([
      hasModel ? loadModel() : Promise.resolve(),
      hasTexts ? loadTexts(THREE, TroikaText, instance, descriptor.texts) : Promise.resolve(),
    ]).then(() => {
      if (instances.get(container) !== instance || !instance.active) return;
      // physics は全 texts sync() 完了後（char の bbox が確定してから）にだけ presim できる。
      // ここで例外が出れば .catch 側の後始末（textsGroup 破棄・fallback 表示）へ合流する
      if (hasPhysics) runPhysicsPresim(library.Matter, instance, descriptor.physics);
      instance.contentReady = true;
      instance.status = "ready";
      setFallback(container, false);
      draw(instance, instance.lastTime);
    }).catch((error) => {
      if (instances.get(container) !== instance || !instance.active) return;
      if (instance.model) {
        instance.scene.remove(instance.model);
        disposeObject(instance.model);
        instance.model = null;
        instance.mixer = null;
      }
      instance.scene.remove(instance.textsGroup);
      disposeObject(instance.textsGroup);
      for (const node of instance.textNodes) node.dispose?.();
      instance.textNodes = [];
      instance.textAnimEntries = [];
      instance.textsGroup = new THREE.Group();
      instance.scene.add(instance.textsGroup);
      instance.physicsBuffer = null;
      instance.physicsData = null;
      instance.physicsChars = [];
      releaseVideoTextures(instance);
      instance.status = "error";
      console.error("[akari-three] 3D scene の読み込みに失敗しました", error);
      setFallback(container, true);
    });
    return instance;
  }

  function render(container, localTimeSeconds, options) {
    if (failedContainers.has(container)) return;
    let instance = instances.get(container);
    if (!instance) {
      try {
        instance = createInstance(container);
      } catch (error) {
        failedContainers.add(container);
        console.error("[akari-three] 3D scene の初期化に失敗しました", error);
        setFallback(container, true);
        return;
      }
    }
    instance.lastTime = Math.max(0, finiteNumber(localTimeSeconds, 0));
    // syncVideos はライブプレビュー専用の opt-in（既定は同期しない = 書き出しの決定性を守る）
    if (options?.syncVideos && instance.videoElements.size > 0) {
      syncVideoTextures(instance, instance.lastTime);
    }
    // maxRenderSize もライブプレビュー専用の opt-in（未指定なら等倍 = 書き出しは不変）。
    // instance に持たせるのは、モデル読み込み完了直後の draw（呼び出し側を経由しない）にも
    // 同じ上限を効かせるため
    instance.maxRenderSize = options?.maxRenderSize;
    draw(instance, instance.lastTime);
  }

  function inspect(container) {
    const instance = instances.get(container);
    if (!instance) return { status: "disposed" };
    return {
      status: instance.status,
      memory: { ...instance.renderer.info.memory },
      render: { ...instance.renderer.info.render },
      pixelRatio: instance.renderer.getPixelRatio(),
      // 配線できたかを絵の比較なしに確かめるための実測値（検証・証跡用）
      shadows: instance.renderer.shadowMap.enabled,
      videoTextures: instance.videoTextures.size,
      animationClips: instance.animationClips,
      // texts[] の per-char 展開数（検証・証跡用。flat モードの読み込み完了を絵の比較なしに確認する）
      textNodes: instance.textNodes.length,
      textBlocks: instance.textAnimEntries.length,
      // physics presim の実測値（検証・証跡用。task 2026-08-12-3d-text-physics）。
      // physicsBuffer が null なら「physics 宣言なし、または presim 未完了」
      physics: instance.physicsBuffer
        ? {
            charCount: instance.physicsBuffer.charCount,
            frameCount: instance.physicsBuffer.frameCount,
            dt: instance.physicsBuffer.dt,
            duration: instance.physicsBuffer.duration,
            presimMs: instance.physicsPresimMs,
            bufferBytes: instance.physicsData?.byteLength ?? 0,
            // 直近 draw() 時点の per-char world 位置・回転（検証・証跡用。凸包潰れの反証や
            // 決定論の値レベル確認に使う。描画結果そのものはピクセル比較で判定するため、
            // ここは補助的な数値証跡という位置づけ）
            charStates: instance.physicsChars.map((node) => ({
              x: node.position.x,
              y: node.position.y,
              angle: node.rotation.z,
            })),
          }
        : null,
      // 標準ツマミ（pan/zoom）が投影へ実際に反映されたかの実測値（検証・証跡用。
      // task 2026-08-06-live-knob-camera-v2）。view が null なら「3 プロパティとも未宣言で
      // camera.view に一切触れていない」= 後方互換の直接証拠になる
      cameraFov: instance.camera.fov,
      // camera.fromModel の配線確認（"model" = glb 内カメラで描画している）と、
      // クリップ評価後のカメラ実位置（ベイク済みカメラワークが動いている直接証拠）
      cameraSource: instance.cameraSource,
      cameraWorldPosition: (() => {
        const position = new (instance.camera.position.constructor)();
        instance.camera.getWorldPosition(position);
        return [position.x, position.y, position.z];
      })(),
      cameraViewOffset: instance.camera.view
        ? {
            enabled: instance.camera.view.enabled,
            offsetX: instance.camera.view.offsetX,
            offsetY: instance.camera.view.offsetY,
            fullWidth: instance.camera.view.fullWidth,
            fullHeight: instance.camera.view.fullHeight,
          }
        : null,
    };
  }

  return { dispose, inspect, render };
})();
