// glass-runtime.js — liquid-glass-js のシェーダを AKARI overlay-runtime の流儀へ移植した PoC ランタイム。
//
// 原作: https://github.com/dashersw/liquid-glass-js  (MIT, (c) 2025 Armagan Amcalar)
//       container.js（standalone シェーダ）/ button.js（nested シェーダ）の GLSL を写した。
//       ライセンス全文は同ディレクトリの LICENSE.liquid-glass-js。
//
// 原作からの変更（AKARI の決定論契約に合わせるため）:
//   1. html2canvas によるページ撮影を廃止。背景（backdrop）は外から画像 URL で与える。
//      オーバーレイのシートは下のトラックを見られないので、原作の「ページを撮る」は成立しない
//   2. requestAnimationFrame / scroll 依存を廃止。render(container, seconds) を呼んだときだけ描く
//      （three-runtime.js と同じ外部時刻駆動。壁時計に触らない）
//   3. ツマミは CSS カスタムプロパティ → uniform。断片の <script> は実行しない（宣言だけ読む）
//   4. onClick（alert コールバック）は持ち込まない。押下の見た目は断片側の CSS アニメ（transform/opacity）
//
// API（window.akari.threeRuntime と同形）:
//   render(container, localSeconds, { backdrop?: url })  … 指定時刻の状態で 1 回描く
//   inspect(container) → { status: 'loading'|'ready'|'error'|'disposed', surfaces, nested, drawMs }
//   dispose(container)
//
// 断片側の契約（PoC）:
//   <script type="application/json" data-akari-glass-scene>{ "backdrop": "相対パス" } … 既定の背景（閉じタグ略）
//   [data-akari-glass] 要素 = ガラス面。入れ子にすると子は親の出力を屈折させる（原作の nested）
//   ツマミ（要素または祖先で宣言。既定値は原作 controls.js の初期値）:
//     --glass-edge-intensity 0.01 / --glass-rim-intensity 0.05 / --glass-base-intensity 0.01
//     --glass-edge-distance 0.15 / --glass-rim-distance 0.8 / --glass-base-distance 0.1
//     --glass-corner-boost 0.02 / --glass-ripple 0.1 / --glass-blur 5 / --glass-tint 0.2 / --glass-warp 0
window.akari = window.akari || {};
window.akari.glassRuntime = (() => {
  const instances = new Map();

  const VERTEX_SOURCE = `
    attribute vec2 a_position;
    attribute vec2 a_texcoord;
    varying vec2 v_texcoord;
    void main() {
      gl_Position = vec4(a_position, 0, 1);
      v_texcoord = a_texcoord;
    }
  `;

  // 形状関数は原作 container.js / button.js と同一
  const SHAPE_FUNCTIONS = `
    float roundedRectDistance(vec2 coord, vec2 size, float radius) {
      vec2 center = size * 0.5;
      vec2 pixelCoord = coord * size;
      vec2 toCorner = abs(pixelCoord - center) - (center - radius);
      float outsideCorner = length(max(toCorner, 0.0));
      float insideCorner = min(max(toCorner.x, toCorner.y), 0.0);
      return (outsideCorner + insideCorner - radius);
    }
    float circleDistance(vec2 coord, vec2 size, float radius) {
      vec2 center = vec2(0.5, 0.5);
      vec2 pixelCoord = coord * size;
      vec2 centerPixel = center * size;
      float distFromCenter = length(pixelCoord - centerPixel);
      return distFromCenter - radius;
    }
    bool isPill(vec2 size, float radius) {
      float heightRatioDiff = abs(radius - size.y * 0.5);
      bool radiusMatchesHeight = heightRatioDiff < 2.0;
      bool isWiderThanTall = size.x > size.y + 4.0;
      return radiusMatchesHeight && isWiderThanTall;
    }
    bool isCircle(vec2 size, float radius) {
      float minDim = min(size.x, size.y);
      bool radiusMatchesMinDim = abs(radius - minDim * 0.5) < 1.0;
      bool isRoughlySquare = abs(size.x - size.y) < 4.0;
      return radiusMatchesMinDim && isRoughlySquare;
    }
    float pillDistance(vec2 coord, vec2 size, float radius) {
      vec2 center = size * 0.5;
      vec2 pixelCoord = coord * size;
      vec2 capsuleStart = vec2(radius, center.y);
      vec2 capsuleEnd = vec2(size.x - radius, center.y);
      vec2 capsuleAxis = capsuleEnd - capsuleStart;
      float capsuleLength = length(capsuleAxis);
      if (capsuleLength > 0.0) {
        vec2 toPoint = pixelCoord - capsuleStart;
        float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
        vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
        return length(pixelCoord - closestPointOnAxis) - radius;
      } else {
        return length(pixelCoord - center) - radius;
      }
    }
    // 形状ごとの「縁からの距離」と法線（原作 main() の分岐を関数化。式は同一）
    void shapeEdge(vec2 coord, vec2 size, float radius, out float distFromEdgeShape, out vec2 shapeNormal) {
      vec2 center = vec2(0.5, 0.5);
      if (isPill(size, radius)) {
        distFromEdgeShape = -pillDistance(coord, size, radius);
        vec2 pixelCoord = coord * size;
        vec2 capsuleStart = vec2(radius, center.y * size.y);
        vec2 capsuleEnd = vec2(size.x - radius, center.y * size.y);
        vec2 capsuleAxis = capsuleEnd - capsuleStart;
        float capsuleLength = length(capsuleAxis);
        if (capsuleLength > 0.0) {
          vec2 toPoint = pixelCoord - capsuleStart;
          float t = clamp(dot(toPoint, capsuleAxis) / dot(capsuleAxis, capsuleAxis), 0.0, 1.0);
          vec2 closestPointOnAxis = capsuleStart + t * capsuleAxis;
          vec2 normalDir = pixelCoord - closestPointOnAxis;
          shapeNormal = length(normalDir) > 0.0 ? normalize(normalDir) : vec2(0.0, 1.0);
        } else {
          shapeNormal = normalize(coord - center);
        }
      } else if (isCircle(size, radius)) {
        distFromEdgeShape = -circleDistance(coord, size, radius);
        shapeNormal = normalize(coord - center);
      } else {
        distFromEdgeShape = -roundedRectDistance(coord, size, radius);
        shapeNormal = normalize(coord - center);
      }
      distFromEdgeShape = max(distFromEdgeShape, 0.0);
    }
    float shapeMask(vec2 coord, vec2 size, float radius) {
      float maskDistance;
      if (isPill(size, radius)) maskDistance = pillDistance(coord, size, radius);
      else if (isCircle(size, radius)) maskDistance = circleDistance(coord, size, radius);
      else maskDistance = roundedRectDistance(coord, size, radius);
      return 1.0 - smoothstep(-1.0, 1.0, maskDistance);
    }
  `;

  const KNOB_UNIFORMS = `
    uniform float u_blurRadius;
    uniform float u_borderRadius;
    uniform float u_warp;
    uniform float u_edgeIntensity;
    uniform float u_rimIntensity;
    uniform float u_baseIntensity;
    uniform float u_edgeDistance;
    uniform float u_rimDistance;
    uniform float u_baseDistance;
    uniform float u_cornerBoost;
    uniform float u_rippleEffect;
    uniform float u_tintOpacity;
  `;

  // standalone（原作 container.js setupShader の fs）。ページ座標 → ステージ座標へ置き換え、
  // scroll / pageHeight / viewportHeight を外した以外は同一
  const STANDALONE_FRAGMENT = `
    precision mediump float;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_textureSize;
    uniform vec2 u_stageSize;
    uniform vec2 u_uvScale;
    uniform vec2 u_containerPosition;
    ${KNOB_UNIFORMS}
    varying vec2 v_texcoord;
    ${SHAPE_FUNCTIONS}
    // 背景画像はステージに cover で敷かれている前提（アスペクトが違えば中央クロップ）。
    // ステージ正規化座標 → テクスチャ座標の写像。アスペクト一致なら恒等
    vec2 stageToTexture(vec2 stageUv) {
      return 0.5 + (stageUv - 0.5) * u_uvScale;
    }
    void main() {
      vec2 coord = v_texcoord;
      vec2 containerSize = u_resolution;
      vec2 containerCenter = u_containerPosition;
      vec2 containerOffset = (coord - 0.5) * containerSize;
      vec2 pagePixel = containerCenter + containerOffset;
      vec2 textureCoord = stageToTexture(pagePixel / u_stageSize);

      float distFromEdgeShape; vec2 shapeNormal;
      shapeEdge(coord, u_resolution, u_borderRadius, distFromEdgeShape, shapeNormal);

      float distFromLeft = coord.x;
      float distFromRight = 1.0 - coord.x;
      float distFromTop = coord.y;
      float distFromBottom = 1.0 - coord.y;
      float distFromEdge = distFromEdgeShape / min(u_resolution.x, u_resolution.y);

      float normalizedDistance = distFromEdge * min(u_resolution.x, u_resolution.y);
      float baseIntensity = 1.0 - exp(-normalizedDistance * u_baseDistance);
      float edgeIntensity = exp(-normalizedDistance * u_edgeDistance);
      float rimIntensity = exp(-normalizedDistance * u_rimDistance);
      float baseComponent = u_warp > 0.5 ? baseIntensity * u_baseIntensity : 0.0;
      float totalIntensity = baseComponent + edgeIntensity * u_edgeIntensity + rimIntensity * u_rimIntensity;
      vec2 baseRefraction = shapeNormal * totalIntensity;

      float cornerProximityX = min(distFromLeft, distFromRight);
      float cornerProximityY = min(distFromTop, distFromBottom);
      float cornerDistance = max(cornerProximityX, cornerProximityY);
      float cornerNormalized = cornerDistance * min(u_resolution.x, u_resolution.y);
      float cornerBoost = exp(-cornerNormalized * 0.3) * u_cornerBoost;
      vec2 cornerRefraction = shapeNormal * cornerBoost;

      vec2 perpendicular = vec2(-shapeNormal.y, shapeNormal.x);
      float rippleEffect = sin(distFromEdge * 25.0) * u_rippleEffect * rimIntensity;
      vec2 textureRefraction = perpendicular * rippleEffect;

      vec2 totalRefraction = baseRefraction + cornerRefraction + textureRefraction;
      textureCoord += totalRefraction;

      vec4 color = vec4(0.0);
      vec2 texelSize = 1.0 / u_textureSize;
      float sigma = u_blurRadius / 2.0;
      vec2 blurStep = texelSize * sigma;
      float totalWeight = 0.0;
      for (float i = -6.0; i <= 6.0; i += 1.0) {
        for (float j = -6.0; j <= 6.0; j += 1.0) {
          float distance = length(vec2(i, j));
          if (distance > 6.0) continue;
          float weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
          vec2 offset = vec2(i, j) * blurStep;
          color += texture2D(u_image, textureCoord + offset) * weight;
          totalWeight += weight;
        }
      }
      color /= totalWeight;

      float gradientPosition = coord.y;
      vec3 topTint = vec3(1.0, 1.0, 1.0);
      vec3 bottomTint = vec3(0.7, 0.7, 0.7);
      vec3 gradientTint = mix(topTint, bottomTint, gradientPosition);
      vec3 tintedColor = mix(color.rgb, gradientTint, u_tintOpacity);
      color = vec4(tintedColor, color.a);

      vec2 viewportCenter = containerCenter;
      float topY = stageToTexture(vec2(0.5, (viewportCenter.y - containerSize.y * 0.4) / u_stageSize.y)).y;
      float midY = stageToTexture(vec2(0.5, viewportCenter.y / u_stageSize.y)).y;
      float bottomY = stageToTexture(vec2(0.5, (viewportCenter.y + containerSize.y * 0.4) / u_stageSize.y)).y;
      vec3 topColor = vec3(0.0); vec3 midColor = vec3(0.0); vec3 bottomColor = vec3(0.0);
      float sampleCount = 0.0;
      for (float x = 0.0; x < 1.0; x += 0.05) {
        for (float yOffset = -5.0; yOffset <= 5.0; yOffset += 1.0) {
          topColor += texture2D(u_image, vec2(x, topY + yOffset * texelSize.y)).rgb;
          midColor += texture2D(u_image, vec2(x, midY + yOffset * texelSize.y)).rgb;
          bottomColor += texture2D(u_image, vec2(x, bottomY + yOffset * texelSize.y)).rgb;
          sampleCount += 1.0;
        }
      }
      topColor /= sampleCount; midColor /= sampleCount; bottomColor /= sampleCount;
      vec3 sampledGradient;
      if (gradientPosition < 0.1) sampledGradient = topColor;
      else if (gradientPosition > 0.9) sampledGradient = bottomColor;
      else {
        float transitionPos = (gradientPosition - 0.1) / 0.8;
        if (transitionPos < 0.5) sampledGradient = mix(topColor, midColor, transitionPos * 2.0);
        else sampledGradient = mix(midColor, bottomColor, (transitionPos - 0.5) * 2.0);
      }
      vec3 finalTinted = mix(color.rgb, sampledGradient, u_tintOpacity * 0.3);
      color = vec4(finalTinted, color.a);

      float mask = shapeMask(coord, u_resolution, u_borderRadius);
      // 原作は非プリマルチプライのまま出すため、WebGL の既定（premultipliedAlpha: true）では縁の
      // 半透明画素が未定義の色になり点線状に走る（原作デモにも出ている）。ここでは乗算して出す
      gl_FragColor = vec4(color.rgb * mask, mask);
    }
  `;

  // nested（原作 button.js setupDynamicNestedShader の fs）。親キャンバスを屈折させる
  const NESTED_FRAGMENT = `
    precision mediump float;
    uniform sampler2D u_image;
    uniform vec2 u_resolution;
    uniform vec2 u_buttonPosition;
    uniform vec2 u_containerPosition;
    uniform vec2 u_containerSize;
    ${KNOB_UNIFORMS}
    varying vec2 v_texcoord;
    ${SHAPE_FUNCTIONS}
    void main() {
      vec2 coord = v_texcoord;
      vec2 buttonSize = u_resolution;
      vec2 containerSize = u_containerSize;
      vec2 containerTopLeft = u_containerPosition - containerSize * 0.5;
      vec2 buttonTopLeft = u_buttonPosition - buttonSize * 0.5;
      vec2 buttonRelativePos = buttonTopLeft - containerTopLeft;
      vec2 buttonPixel = coord * buttonSize;
      vec2 containerPixel = buttonRelativePos + buttonPixel;
      vec2 baseTextureCoord = containerPixel / containerSize;

      float distFromEdgeShape; vec2 shapeNormal;
      shapeEdge(coord, u_resolution, u_borderRadius, distFromEdgeShape, shapeNormal);

      float distFromLeft = coord.x;
      float distFromRight = 1.0 - coord.x;
      float distFromTop = coord.y;
      float distFromBottom = 1.0 - coord.y;
      float distFromEdge = distFromEdgeShape / min(u_resolution.x, u_resolution.y);

      float normalizedDistance = distFromEdge * min(u_resolution.x, u_resolution.y);
      float baseIntensity = 1.0 - exp(-normalizedDistance * u_baseDistance);
      float edgeIntensity = exp(-normalizedDistance * u_edgeDistance);
      float rimIntensity = exp(-normalizedDistance * u_rimDistance);
      float baseComponent = u_warp > 0.5 ? baseIntensity * u_baseIntensity : 0.0;
      float totalIntensity = baseComponent + edgeIntensity * u_edgeIntensity + rimIntensity * u_rimIntensity;
      vec2 baseRefraction = shapeNormal * totalIntensity;

      float cornerProximityX = min(distFromLeft, distFromRight);
      float cornerProximityY = min(distFromTop, distFromBottom);
      float cornerDistance = max(cornerProximityX, cornerProximityY);
      float cornerNormalized = cornerDistance * min(u_resolution.x, u_resolution.y);
      float cornerBoost = exp(-cornerNormalized * 0.3) * u_cornerBoost;
      vec2 cornerRefraction = shapeNormal * cornerBoost;

      vec2 perpendicular = vec2(-shapeNormal.y, shapeNormal.x);
      float rippleEffect = sin(distFromEdge * 30.0) * u_rippleEffect * rimIntensity;
      vec2 textureRefraction = perpendicular * rippleEffect;

      vec2 totalRefraction = baseRefraction + cornerRefraction + textureRefraction;
      vec2 textureCoord = baseTextureCoord + totalRefraction;

      vec4 color = vec4(0.0);
      vec2 texelSize = 1.0 / containerSize;
      float sigma = u_blurRadius / 3.0;
      vec2 blurStep = texelSize * sigma;
      float totalWeight = 0.0;
      for (float i = -4.0; i <= 4.0; i += 1.0) {
        for (float j = -4.0; j <= 4.0; j += 1.0) {
          float distance = length(vec2(i, j));
          if (distance > 4.0) continue;
          float weight = exp(-(distance * distance) / (2.0 * sigma * sigma));
          vec2 offset = vec2(i, j) * blurStep;
          color += texture2D(u_image, textureCoord + offset) * weight;
          totalWeight += weight;
        }
      }
      color /= totalWeight;

      float gradientPosition = coord.y;
      vec3 topTint = vec3(1.0, 1.0, 1.0);
      vec3 bottomTint = vec3(0.7, 0.7, 0.7);
      vec3 gradientTint = mix(topTint, bottomTint, gradientPosition);
      vec3 tintedColor = mix(color.rgb, gradientTint, u_tintOpacity * 0.7);
      color = vec4(tintedColor, color.a);

      vec2 viewportCenter = u_buttonPosition;
      float topY = max(0.0, (viewportCenter.y - buttonSize.y * 0.4) / containerSize.y);
      float midY = viewportCenter.y / containerSize.y;
      float bottomY = min(1.0, (viewportCenter.y + buttonSize.y * 0.4) / containerSize.y);
      vec3 topColor = texture2D(u_image, vec2(0.5, topY)).rgb;
      vec3 midColor = texture2D(u_image, vec2(0.5, midY)).rgb;
      vec3 bottomColor = texture2D(u_image, vec2(0.5, bottomY)).rgb;
      vec3 sampledGradient;
      if (gradientPosition < 0.1) sampledGradient = topColor;
      else if (gradientPosition > 0.9) sampledGradient = bottomColor;
      else {
        float transitionPos = (gradientPosition - 0.1) / 0.8;
        if (transitionPos < 0.5) sampledGradient = mix(topColor, midColor, transitionPos * 2.0);
        else sampledGradient = mix(midColor, bottomColor, (transitionPos - 0.5) * 2.0);
      }
      vec3 secondTinted = mix(color.rgb, sampledGradient, u_tintOpacity * 0.4);
      vec3 buttonTopTint = vec3(1.08, 1.08, 1.08);
      vec3 buttonBottomTint = vec3(0.92, 0.92, 0.92);
      vec3 buttonGradient = mix(buttonTopTint, buttonBottomTint, gradientPosition);
      vec3 finalTinted = secondTinted * buttonGradient;

      float mask = shapeMask(coord, u_resolution, u_borderRadius);
      gl_FragColor = vec4(finalTinted * mask, mask);
    }
  `;

  const KNOBS = [
    ["--glass-edge-intensity", "u_edgeIntensity", 0.01],
    ["--glass-rim-intensity", "u_rimIntensity", 0.05],
    ["--glass-base-intensity", "u_baseIntensity", 0.01],
    ["--glass-edge-distance", "u_edgeDistance", 0.15],
    ["--glass-rim-distance", "u_rimDistance", 0.8],
    ["--glass-base-distance", "u_baseDistance", 0.1],
    ["--glass-corner-boost", "u_cornerBoost", 0.02],
    ["--glass-ripple", "u_rippleEffect", 0.1],
    ["--glass-blur", "u_blurRadius", 5.0],
    ["--glass-tint", "u_tintOpacity", 0.2],
    ["--glass-warp", "u_warp", 0],
  ];

  function readNumber(style, name, fallback) {
    const raw = style.getPropertyValue(name).trim();
    if (raw === "") return fallback;
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : fallback;
  }

  function readBorderRadius(style, width, height) {
    const raw = style.borderTopLeftRadius.trim();
    if (raw.endsWith("%")) return (Number.parseFloat(raw) / 100) * Math.min(width, height);
    const value = Number.parseFloat(raw);
    return Number.isFinite(value) ? value : 0;
  }

  function compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`shader compile error: ${gl.getShaderInfoLog(shader)}`);
    }
    return shader;
  }

  function createProgram(gl, fragmentSource) {
    const program = gl.createProgram();
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX_SOURCE));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`program link error: ${gl.getProgramInfoLog(program)}`);
    }
    return program;
  }

  function readDescriptor(container) {
    const node = container.querySelector('script[type="application/json"][data-akari-glass-scene]');
    if (!node) return {};
    const parsed = JSON.parse(node.textContent || "{}");
    if (!parsed || typeof parsed !== "object") throw new Error("data-akari-glass-scene は JSON オブジェクトにする");
    if (parsed.backdrop) {
      const base = container.getAttribute("data-akari-glass-base") || container.ownerDocument.baseURI;
      parsed.backdrop = new URL(parsed.backdrop, base).href;
    }
    return parsed;
  }

  function resolveUrl(container, url) {
    if (!url) return null;
    const base = container.ownerDocument.baseURI;
    return new URL(url, base).href;
  }

  function createSurface(element, parentSurface) {
    const canvas = element.ownerDocument.createElement("canvas");
    canvas.className = "akari-glass-canvas";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;border-radius:inherit;pointer-events:none;";
    element.insertBefore(canvas, element.firstChild);
    const gl = canvas.getContext("webgl", { preserveDrawingBuffer: true, premultipliedAlpha: true, antialias: false });
    if (!gl) throw new Error("WebGL コンテキストを作れません");
    const program = createProgram(gl, parentSurface ? NESTED_FRAGMENT : STANDALONE_FRAGMENT);
    gl.useProgram(program);

    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const positionLoc = gl.getAttribLocation(program, "a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    const texcoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texcoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1, 0]), gl.STATIC_DRAW);
    const texcoordLoc = gl.getAttribLocation(program, "a_texcoord");
    gl.enableVertexAttribArray(texcoordLoc);
    gl.vertexAttribPointer(texcoordLoc, 2, gl.FLOAT, false, 0, 0);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(program, "u_image"), 0);
    gl.clearColor(0, 0, 0, 0);

    const uniform = (name) => gl.getUniformLocation(program, name);
    return {
      element, canvas, gl, program, texture, parent: parentSurface,
      uploadedImage: null,
      loc: {
        resolution: uniform("u_resolution"),
        textureSize: uniform("u_textureSize"),
        stageSize: uniform("u_stageSize"),
        uvScale: uniform("u_uvScale"),
        containerPosition: uniform("u_containerPosition"),
        buttonPosition: uniform("u_buttonPosition"),
        containerSize: uniform("u_containerSize"),
        borderRadius: uniform("u_borderRadius"),
        knobs: KNOBS.map(([, uniformName]) => uniform(uniformName)),
      },
    };
  }

  function createInstance(container) {
    const descriptor = readDescriptor(container);
    const elements = Array.from(container.querySelectorAll("[data-akari-glass]"));
    if (elements.length === 0) throw new Error("[data-akari-glass] 要素がありません");
    const surfaces = new Map();
    for (const element of elements) {
      const parentElement = element.parentElement?.closest("[data-akari-glass]") ?? null;
      const parentSurface = parentElement ? surfaces.get(parentElement) ?? null : null;
      surfaces.set(element, createSurface(element, parentSurface));
    }
    return {
      container,
      status: "loading",
      surfaces,
      backdropUrl: null,
      backdropImage: null,
      backdropPending: null,
      defaultBackdrop: resolveUrl(container, descriptor.backdrop),
      lastTime: 0,
      drawMs: 0,
      drawCount: 0,
    };
  }

  function loadBackdrop(instance, url) {
    if (instance.backdropUrl === url && (instance.backdropImage || instance.backdropPending)) return;
    instance.backdropUrl = url;
    instance.backdropImage = null;
    instance.status = "loading";
    const image = new Image();
    image.crossOrigin = "anonymous";
    instance.backdropPending = image;
    image.onload = () => {
      if (instance.backdropPending !== image) return;
      instance.backdropPending = null;
      instance.backdropImage = image;
      draw(instance, instance.lastTime);
    };
    image.onerror = () => {
      if (instance.backdropPending !== image) return;
      instance.backdropPending = null;
      instance.status = "error";
      console.error("[akari-glass] backdrop 画像を読み込めません", url);
    };
    image.src = url;
  }

  function stageMetrics(container) {
    const rect = container.getBoundingClientRect();
    const logicalWidth = container.offsetWidth || rect.width;
    const logicalHeight = container.offsetHeight || rect.height;
    const scale = rect.width > 0 ? rect.width / logicalWidth : 1;
    return { rect, logicalWidth, logicalHeight, scale };
  }

  function centerOf(element, stage) {
    const rect = element.getBoundingClientRect();
    return {
      x: (rect.left + rect.width / 2 - stage.rect.left) / stage.scale,
      y: (rect.top + rect.height / 2 - stage.rect.top) / stage.scale,
    };
  }

  function drawSurface(instance, surface, stage) {
    const { element, canvas, gl, loc } = surface;
    const width = Math.max(1, Math.ceil(element.offsetWidth));
    const height = Math.max(1, Math.ceil(element.offsetHeight));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.useProgram(surface.program);

    const style = getComputedStyle(element);
    gl.uniform2f(loc.resolution, width, height);
    gl.uniform1f(loc.borderRadius, readBorderRadius(style, width, height));
    KNOBS.forEach(([cssVar, , fallback], index) => {
      gl.uniform1f(loc.knobs[index], readNumber(style, cssVar, fallback));
    });

    gl.bindTexture(gl.TEXTURE_2D, surface.texture);
    if (surface.parent) {
      // 親キャンバスの現在の出力をそのままテクスチャに上げる（原作 startNestedRenderLoop と同じ）
      const parentCanvas = surface.parent.canvas;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, parentCanvas);
      const parentCenter = centerOf(surface.parent.element, stage);
      const ownCenter = centerOf(element, stage);
      gl.uniform2f(loc.buttonPosition, ownCenter.x, ownCenter.y);
      gl.uniform2f(loc.containerPosition, parentCenter.x, parentCenter.y);
      gl.uniform2f(loc.containerSize, parentCanvas.width, parentCanvas.height);
    } else {
      const image = instance.backdropImage;
      if (surface.uploadedImage !== image) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        surface.uploadedImage = image;
      }
      const center = centerOf(element, stage);
      gl.uniform2f(loc.textureSize, image.naturalWidth, image.naturalHeight);
      gl.uniform2f(loc.stageSize, stage.logicalWidth, stage.logicalHeight);
      // cover 写像: 画像がステージより横長なら x を、縦長なら y を縮めて中央を切り出す
      const imageAspect = image.naturalWidth / image.naturalHeight;
      const stageAspect = stage.logicalWidth / stage.logicalHeight;
      gl.uniform2f(loc.uvScale, imageAspect > stageAspect ? stageAspect / imageAspect : 1, imageAspect > stageAspect ? 1 : imageAspect / stageAspect);
      gl.uniform2f(loc.containerPosition, center.x, center.y);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function draw(instance, localSeconds) {
    if (!instance.backdropImage) return;
    const started = performance.now();
    const stage = stageMetrics(instance.container);
    // Map は挿入順（document order）なので親が必ず子より先に描かれる
    for (const surface of instance.surfaces.values()) drawSurface(instance, surface, stage);
    instance.drawMs = performance.now() - started;
    instance.drawCount += 1;
    instance.status = "ready";
  }

  function render(container, localSeconds, options) {
    let instance = instances.get(container);
    if (!instance) {
      try {
        instance = createInstance(container);
      } catch (error) {
        console.error("[akari-glass] 初期化に失敗しました", error);
        instances.set(container, { status: "error", surfaces: new Map(), drawMs: 0, drawCount: 0, error: String(error) });
        return;
      }
      instances.set(container, instance);
    }
    if (instance.status === "error" && !instance.container) return;
    instance.lastTime = Math.max(0, Number.isFinite(localSeconds) ? localSeconds : 0);
    const backdrop = options?.backdrop ? resolveUrl(container, options.backdrop) : instance.defaultBackdrop;
    if (!backdrop) {
      instance.status = "error";
      console.error("[akari-glass] backdrop が未指定です（宣言の backdrop か render() の options.backdrop）");
      return;
    }
    loadBackdrop(instance, backdrop);
    draw(instance, instance.lastTime);
  }

  function inspect(container) {
    const instance = instances.get(container);
    if (!instance) return { status: "disposed" };
    let nested = 0;
    for (const surface of instance.surfaces.values()) if (surface.parent) nested += 1;
    return {
      status: instance.status,
      surfaces: instance.surfaces.size,
      nested,
      drawMs: instance.drawMs,
      drawCount: instance.drawCount,
      backdrop: instance.backdropUrl ?? null,
      error: instance.error ?? null,
    };
  }

  function dispose(container) {
    const instance = instances.get(container);
    if (!instance) return;
    for (const surface of instance.surfaces.values()) {
      const lose = surface.gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      surface.canvas.remove();
    }
    instances.delete(container);
  }

  return { dispose, inspect, render };
})();

// Register with current hosts, or queue until a script-only host boots its registry.
(() => {
  const entry = { id: "glass", selector: 'script[type="application/json"][data-akari-glass-scene]',
    ...window.akari.glassRuntime,
    fragmentBaseAttribute: "data-akari-glass-base" };
  if (window.akari.runtimes) window.akari.runtimes.register(entry);
  else (window.akari.pendingRuntimes ??= []).push(entry);
})();
