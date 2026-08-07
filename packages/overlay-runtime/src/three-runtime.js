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
  ]);
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
    if (typeof descriptor.model !== "string" || descriptor.model.length === 0) {
      throw new TypeError("data-akari-3d-scene.model は配信 URL である必要があります");
    }
    if (descriptor.animationClip !== undefined && !isAnimationClipSelector(descriptor.animationClip)) {
      throw new TypeError('animationClip は glTF clip 名の文字列、その配列、または "*" である必要があります');
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
    if (!instance.active || !instance.model) return;
    rendererSize(instance, instance.maxRenderSize);
    applyProjectionKnobs(instance);
    if (instance.mixer) instance.mixer.setTime(Math.max(0, localSeconds));
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
    const canvas = container.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new Error("3D overlay には canvas が必要です");
    }

    const { THREE, GLTFLoader, RoomEnvironment } = library;
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
      lastTime: 0,
      mixer: null,
      model: null,
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
    setFallback(container, true);

    const loader = new GLTFLoader();
    instance.loading = loader.loadAsync(descriptor.model).then(async (gltf) => {
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
      if (descriptor.animationClip !== undefined) {
        const clips = selectAnimationClips(gltf.animations, descriptor.animationClip);
        instance.mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of clips) instance.mixer.clipAction(clip).play();
        instance.animationClips = clips.length;
      }
      if (instance.shadows.enabled) wireShadows(THREE, instance, instance.shadows);
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
      // 標準ツマミ（pan/zoom）が投影へ実際に反映されたかの実測値（検証・証跡用。
      // task 2026-08-06-live-knob-camera-v2）。view が null なら「3 プロパティとも未宣言で
      // camera.view に一切触れていない」= 後方互換の直接証拠になる
      cameraFov: instance.camera.fov,
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
