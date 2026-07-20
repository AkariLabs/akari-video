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
  ]);

  function finiteNumber(value, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function vector3(value, fallback) {
    if (!Array.isArray(value) || value.length !== 3) return [...fallback];
    return value.map((item, index) => finiteNumber(item, fallback[index]));
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
    if (descriptor.animationClip !== undefined && typeof descriptor.animationClip !== "string") {
      throw new TypeError("animationClip は glTF clip 名の文字列である必要があります");
    }
    if (descriptor.environment !== undefined) {
      if (!descriptor.environment
        || typeof descriptor.environment !== "object"
        || Array.isArray(descriptor.environment)
        || Object.keys(descriptor.environment).some(
          (key) => key !== "intensity" && key !== "exposure"
        )) {
        throw new TypeError("environment は intensity / exposure を指定する object である必要があります");
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

  async function applyMaterialOverrides(THREE, root, overrides) {
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
      const texture = await textureLoader.loadAsync(override.texture);
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
          configuredTexture = configuredTextures.size === 0 ? texture : texture.clone();
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

  function setFallback(container, visible) {
    const fallback = container.querySelector("[data-akari-3d-fallback]");
    if (!(fallback instanceof HTMLElement)) return;
    fallback.hidden = !visible;
    if (visible) fallback.style.removeProperty("display");
    else fallback.style.setProperty("display", "none", "important");
  }

  function rendererSize(instance) {
    const rect = instance.canvas.getBoundingClientRect();
    const containerRect = instance.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width || containerRect.width || 1));
    const height = Math.max(1, Math.round(rect.height || containerRect.height || 1));
    if (instance.canvas.width !== width || instance.canvas.height !== height) {
      instance.renderer.setSize(width, height, false);
    }
    const aspect = width / height;
    if (instance.camera.aspect !== aspect) {
      instance.camera.aspect = aspect;
      instance.camera.updateProjectionMatrix();
    }
  }

  function draw(instance, localSeconds) {
    if (!instance.active || !instance.model) return;
    rendererSize(instance);
    if (instance.mixer) instance.mixer.setTime(Math.max(0, localSeconds));
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

  function disposeInstance(instance) {
    instance.active = false;
    instance.mixer?.stopAllAction();
    disposeObject(instance.model);
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
      camera,
      canvas,
      container,
      descriptor,
      environmentTarget,
      lastTime: 0,
      mixer: null,
      model: null,
      renderer,
      scene,
      status: "loading",
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
      await applyMaterialOverrides(THREE, gltf.scene, descriptor.materialOverrides);
      if (instances.get(container) !== instance || !instance.active) {
        disposeObject(gltf.scene);
        if (instance.model === gltf.scene) instance.model = null;
        return;
      }
      instance.scene.add(gltf.scene);
      if (descriptor.animationClip) {
        const clip = gltf.animations.find((candidate) => candidate.name === descriptor.animationClip);
        if (!clip) throw new Error(`glTF animation clip が見つかりません: ${descriptor.animationClip}`);
        instance.mixer = new THREE.AnimationMixer(gltf.scene);
        instance.mixer.clipAction(clip).play();
      }
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
      instance.status = "error";
      console.error("[akari-three] 3D scene の読み込みに失敗しました", error);
      setFallback(container, true);
    });
    return instance;
  }

  function render(container, localTimeSeconds) {
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
    };
  }

  return { dispose, inspect, render };
})();
