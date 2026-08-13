(() => {
  const { THREE, GLTFLoader, VRMLoaderPlugin } = window.AkariThree;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(720, 720, false);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x667788, 2.2));
  const key = new THREE.DirectionalLight(0xffffff, 2.5);
  key.position.set(1.5, 2.5, 3);
  scene.add(key);
  const camera = new THREE.PerspectiveCamera(24, 1, 0.01, 100);
  let vrm = null;

  function fitCamera(framing) {
    vrm.scene.updateWorldMatrix(true, true);
    const full = new THREE.Box3().setFromObject(vrm.scene);
    if (full.isEmpty()) throw new Error("VRM scene の外接矩形が空です");
    const center = full.getCenter(new THREE.Vector3());
    let height = full.max.y - full.min.y;
    if (framing === "bust") {
      const head = vrm.humanoid?.getRawBoneNode("head");
      if (!head) throw new Error("bust framing に必要な head bone がありません");
      const headPosition = head.getWorldPosition(new THREE.Vector3());
      const topPadding = Math.max(0.08, height * 0.04);
      const bustBottom = Math.max(full.min.y, headPosition.y - Math.max(0.65, height * 0.37));
      center.y = (full.max.y + topPadding + bustBottom) / 2;
      height = full.max.y + topPadding - bustBottom;
    }
    height *= 1.12;
    const distance = height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
    camera.position.set(center.x, center.y, full.max.z + distance);
    camera.near = Math.max(0.001, distance / 100);
    camera.far = Math.max(100, distance * 10);
    camera.lookAt(center);
    camera.updateProjectionMatrix();
  }

  async function loadModel(url, framing) {
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
    const gltf = await loader.loadAsync(url);
    vrm = gltf.userData.vrm;
    if (!vrm) throw new Error("VRMLoaderPlugin が VRM instance を生成しませんでした");
    scene.add(vrm.scene);
    fitCamera(framing);
    vrm.update(0);
    renderer.compile(scene, camera);
    renderer.render(scene, camera);
    return {
      expressions: Object.keys(vrm.expressionManager?.expressionMap ?? {}).sort(),
      mtoonMaterialCount: vrm.materials?.filter((material) => material.isMToonMaterial).length ?? 0,
      threeRevision: THREE.REVISION,
    };
  }

  function renderExpressions(values) {
    if (!vrm?.expressionManager) throw new Error("VRM expressionManager がありません");
    for (const name of ["aa", "ih", "ou", "ee", "oh", "blink"]) {
      vrm.expressionManager.setValue(name, Number(values[name] ?? 0));
    }
    vrm.update(0);
    renderer.render(scene, camera);
  }

  window.avatarVrmRenderer = Object.freeze({ loadModel, renderExpressions });
  document.body.dataset.ready = "true";
})();
