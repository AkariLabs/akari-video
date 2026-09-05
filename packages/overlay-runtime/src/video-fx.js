/*
 * AKARI video FX rail
 *
 * A shell-independent, externally-clocked WebGL plane for LUT and chroma-key preview.
 * It never owns media playback: callers keep <video>/<img> as the clock and call render(t).
 */
(() => {
  'use strict';

  const root = typeof window !== 'undefined' ? window : globalThis;
  const DEFAULT_CHROMA = Object.freeze({ color: '0x00FF00', similarity: 0.2, blend: 0.1 });
  const CSS_COLOR_KEYWORDS = Object.freeze({
    black: [0, 0, 0], white: [1, 1, 1], red: [1, 0, 0], green: [0, 0.5019607843, 0],
    blue: [0, 0, 1], yellow: [1, 1, 0], cyan: [0, 1, 1], magenta: [1, 0, 1],
    gray: [0.5019607843, 0.5019607843, 0.5019607843],
    grey: [0.5019607843, 0.5019607843, 0.5019607843], orange: [1, 0.6470588235, 0],
    purple: [0.5019607843, 0, 0.5019607843], pink: [1, 0.7529411765, 0.7960784314],
    brown: [0.6470588235, 0.1647058824, 0.1647058824]
  });

  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));

  function parseCube(text) {
    if (typeof text !== 'string' || !text.trim()) throw new TypeError('.cube text is required');
    let size = 0;
    let domainMin = [0, 0, 0];
    let domainMax = [1, 1, 1];
    const values = [];
    const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u);
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
      const line = lines[lineNumber].replace(/#.*$/u, '').trim();
      if (!line) continue;
      const parts = line.split(/\s+/u);
      const keyword = parts[0].toUpperCase();
      if (keyword === 'TITLE') continue;
      if (keyword === 'LUT_1D_SIZE') throw new TypeError('1D LUT is not supported');
      if (keyword === 'LUT_3D_SIZE') {
        size = Number(parts[1]);
        if (!Number.isInteger(size) || size < 2 || size > 256) {
          throw new RangeError(`invalid LUT_3D_SIZE at line ${lineNumber + 1}`);
        }
        continue;
      }
      if (keyword === 'DOMAIN_MIN' || keyword === 'DOMAIN_MAX') {
        const parsed = parts.slice(1, 4).map(Number);
        if (parsed.length !== 3 || parsed.some(value => !Number.isFinite(value))) {
          throw new TypeError(`invalid ${keyword} at line ${lineNumber + 1}`);
        }
        if (keyword === 'DOMAIN_MIN') domainMin = parsed;
        else domainMax = parsed;
        continue;
      }
      const row = parts.slice(0, 3).map(Number);
      if (row.length !== 3 || row.some(value => !Number.isFinite(value))) {
        throw new TypeError(`invalid LUT row at line ${lineNumber + 1}`);
      }
      values.push(...row);
    }
    if (!size) throw new TypeError('LUT_3D_SIZE is missing');
    if (domainMax.some((value, index) => !(value > domainMin[index]))) {
      throw new RangeError('DOMAIN_MAX must be greater than DOMAIN_MIN');
    }
    const expected = size * size * size * 3;
    if (values.length !== expected) {
      throw new RangeError(`LUT_3D_SIZE ${size} requires ${expected / 3} rows; got ${values.length / 3}`);
    }
    return Object.freeze({
      size,
      domainMin: Object.freeze([...domainMin]),
      domainMax: Object.freeze([...domainMax]),
      data: new Float32Array(values)
    });
  }

  // .cube's canonical order is R-fastest, then G, then B.
  function lutValue(lut, r, g, b, channel) {
    return lut.data[((b * lut.size * lut.size + g * lut.size + r) * 3) + channel];
  }

  function sampleLutTrilinear(lut, rgb) {
    if (!lut || !Number.isInteger(lut.size) || !(lut.data instanceof Float32Array)) {
      throw new TypeError('a parsed 3D LUT is required');
    }
    if (!Array.isArray(rgb) && !(rgb instanceof Float32Array)) throw new TypeError('rgb must be an array');
    const p = [0, 1, 2].map(index => {
      const unit = (finite(rgb[index], 0) - lut.domainMin[index])
        / (lut.domainMax[index] - lut.domainMin[index]);
      return clamp(unit) * (lut.size - 1);
    });
    const lo = p.map(Math.floor);
    const hi = p.map((value, index) => Math.min(lut.size - 1, lo[index] + 1));
    const f = p.map((value, index) => value - lo[index]);
    const out = [0, 0, 0];
    for (let channel = 0; channel < 3; channel += 1) {
      const c000 = lutValue(lut, lo[0], lo[1], lo[2], channel);
      const c100 = lutValue(lut, hi[0], lo[1], lo[2], channel);
      const c010 = lutValue(lut, lo[0], hi[1], lo[2], channel);
      const c110 = lutValue(lut, hi[0], hi[1], lo[2], channel);
      const c001 = lutValue(lut, lo[0], lo[1], hi[2], channel);
      const c101 = lutValue(lut, hi[0], lo[1], hi[2], channel);
      const c011 = lutValue(lut, lo[0], hi[1], hi[2], channel);
      const c111 = lutValue(lut, hi[0], hi[1], hi[2], channel);
      const x00 = c000 + (c100 - c000) * f[0];
      const x10 = c010 + (c110 - c010) * f[0];
      const x01 = c001 + (c101 - c001) * f[0];
      const x11 = c011 + (c111 - c011) * f[0];
      const y0 = x00 + (x10 - x00) * f[1];
      const y1 = x01 + (x11 - x01) * f[1];
      out[channel] = y0 + (y1 - y0) * f[2];
    }
    return out;
  }

  // WebGL1 stores the canonical R-fastest, then G, then B .cube sequence in a
  // width=size^2 / height=size atlas. The upload and shader helpers remain
  // separate so tests can pin both sides of the texture-addressing contract.
  function lutAtlasUploadPosition(size, r, g, b) {
    const pixelIndex = b * size * size + g * size + r;
    return Object.freeze({ x: pixelIndex % (size * size), y: Math.floor(pixelIndex / (size * size)) });
  }

  function lutAtlasSamplePosition(size, r, g, b) {
    const x = g * size + r;
    const y = b;
    return Object.freeze({ x, y, u: (x + 0.5) / (size * size), v: (y + 0.5) / size });
  }

  function packLutAtlas(lut) {
    const width = lut.size * lut.size;
    const height = lut.size;
    const data = new Float32Array(width * height * 3);
    for (let b = 0; b < lut.size; b += 1) {
      for (let g = 0; g < lut.size; g += 1) {
        for (let r = 0; r < lut.size; r += 1) {
          const source = (b * lut.size * lut.size + g * lut.size + r) * 3;
          const position = lutAtlasUploadPosition(lut.size, r, g, b);
          const target = (position.y * width + position.x) * 3;
          data[target] = lut.data[source];
          data[target + 1] = lut.data[source + 1];
          data[target + 2] = lut.data[source + 2];
        }
      }
    }
    return Object.freeze({ width, height, data });
  }

  function parseColor(value) {
    const input = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (CSS_COLOR_KEYWORDS[input]) return [...CSS_COLOR_KEYWORDS[input]];
    let hex = input.startsWith('0x') ? input.slice(2) : input.startsWith('#') ? input.slice(1) : '';
    if (/^[0-9a-f]{3}$/u.test(hex)) hex = hex.split('').map(char => char + char).join('');
    if (!/^[0-9a-f]{6}$/u.test(hex)) throw new TypeError(`unsupported color: ${String(value)}`);
    return [0, 2, 4].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
  }

  function rgbToFfmpegUv(rgb) {
    // FFmpeg vf_chromakey.c RGB_TO_U/RGB_TO_V coefficients, normalized to [0,1].
    return [
      -0.16874 * rgb[0] - 0.33126 * rgb[1] + 0.5 * rgb[2] + 0.5,
      0.5 * rgb[0] - 0.41869 * rgb[1] - 0.08131 * rgb[2] + 0.5
    ];
  }

  function shader(gl, type, source) {
    const handle = gl.createShader(type);
    gl.shaderSource(handle, source);
    gl.compileShader(handle);
    if (!gl.getShaderParameter(handle, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(handle) || 'shader compilation failed';
      gl.deleteShader(handle);
      throw new Error(message);
    }
    return handle;
  }

  function program(gl, vertexSource, fragmentSource) {
    const handle = gl.createProgram();
    const vertex = shader(gl, gl.VERTEX_SHADER, vertexSource);
    const fragment = shader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(handle, vertex);
    gl.attachShader(handle, fragment);
    gl.linkProgram(handle);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(handle) || 'program link failed';
      gl.deleteProgram(handle);
      throw new Error(message);
    }
    return handle;
  }

  const VERTEX_1 = `
attribute vec2 a_position;
attribute vec2 a_uv;
varying vec2 v_uv;
void main(){ v_uv=a_uv; gl_Position=vec4(a_position,0.0,1.0); }
`;
  const VERTEX_2 = `#version 300 es
in vec2 a_position;
in vec2 a_uv;
out vec2 v_uv;
void main(){ v_uv=a_uv; gl_Position=vec4(a_position,0.0,1.0); }
`;
  const FRAGMENT_COMMON = `
precision highp float;
uniform sampler2D u_media;
uniform sampler2D u_background;
uniform vec2 u_texel;
uniform vec2 u_key_uv;
uniform vec3 u_background_color;
uniform vec2 u_background_size;
uniform vec2 u_output_size;
uniform float u_similarity;
uniform float u_blend;
uniform float u_intensity;
uniform float u_lut_size;
uniform bool u_has_chroma;
uniform bool u_source_chroma;
uniform bool u_has_background_image;
uniform bool u_has_lut;
vec2 toUv(vec3 rgb){
  return vec2(-0.16874*rgb.r-0.33126*rgb.g+0.5*rgb.b+0.5,
              0.5*rgb.r-0.41869*rgb.g-0.08131*rgb.b+0.5);
}
float keyAlpha(vec2 uv){
  float diff=0.0;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec3 rgb=texture2D(u_media,clamp(uv+vec2(float(x),float(y))*u_texel,0.0,1.0)).rgb;
    vec2 d=toUv(rgb)-u_key_uv;
    diff += sqrt(dot(d,d)/2.0);
  }
  diff/=9.0;
  return u_blend>0.0001 ? clamp((diff-u_similarity)/u_blend,0.0,1.0)
                          : (diff>u_similarity ? 1.0 : 0.0);
}
vec2 coverUv(vec2 uv){
  float sourceAspect=u_background_size.x/max(1.0,u_background_size.y);
  float outputAspect=u_output_size.x/max(1.0,u_output_size.y);
  return sourceAspect>outputAspect
    ? vec2((uv.x-0.5)*outputAspect/sourceAspect+0.5,uv.y)
    : vec2(uv.x,(uv.y-0.5)*sourceAspect/outputAspect+0.5);
}
`;
  const FRAGMENT_1 = `${FRAGMENT_COMMON}
uniform sampler2D u_lut;
varying vec2 v_uv;
vec3 lutCell(float r,float g,float b){
  vec2 atlas=vec2(u_lut_size*u_lut_size,u_lut_size);
  return texture2D(u_lut,(vec2(g*u_lut_size+r,b)+0.5)/atlas).rgb;
}
vec3 applyLut(vec3 rgb){
  vec3 p=clamp(rgb,0.0,1.0)*(u_lut_size-1.0), lo=floor(p), hi=min(lo+1.0,u_lut_size-1.0), f=p-lo;
  vec3 x00=mix(lutCell(lo.r,lo.g,lo.b),lutCell(hi.r,lo.g,lo.b),f.r);
  vec3 x10=mix(lutCell(lo.r,hi.g,lo.b),lutCell(hi.r,hi.g,lo.b),f.r);
  vec3 x01=mix(lutCell(lo.r,lo.g,hi.b),lutCell(hi.r,lo.g,hi.b),f.r);
  vec3 x11=mix(lutCell(lo.r,hi.g,hi.b),lutCell(hi.r,hi.g,hi.b),f.r);
  return mix(mix(x00,x10,f.g),mix(x01,x11,f.g),f.b);
}
void main(){
  vec4 base=texture2D(u_media,v_uv); float alpha=u_has_chroma?keyAlpha(v_uv):base.a;
  vec3 color=base.rgb;
  if(u_has_chroma&&u_source_chroma){ vec3 bg=u_has_background_image?texture2D(u_background,coverUv(v_uv)).rgb:u_background_color; color=mix(bg,color,alpha); alpha=1.0; }
  if(u_has_lut) color=mix(color,applyLut(color),u_intensity);
  gl_FragColor=vec4(color*alpha,alpha);
}`;
  const FRAGMENT_2 = `#version 300 es
#define texture2D texture
${FRAGMENT_COMMON}
#undef texture2D
uniform highp sampler3D u_lut;
in vec2 v_uv;
out vec4 outColor;
vec3 lutCell(ivec3 p){ return texelFetch(u_lut,p,0).rgb; }
vec3 applyLut(vec3 rgb){
  vec3 p=clamp(rgb,0.0,1.0)*(u_lut_size-1.0), f=fract(p); ivec3 lo=ivec3(floor(p));
  ivec3 hi=min(lo+ivec3(1),ivec3(int(u_lut_size)-1));
  vec3 x00=mix(lutCell(ivec3(lo.x,lo.y,lo.z)),lutCell(ivec3(hi.x,lo.y,lo.z)),f.x);
  vec3 x10=mix(lutCell(ivec3(lo.x,hi.y,lo.z)),lutCell(ivec3(hi.x,hi.y,lo.z)),f.x);
  vec3 x01=mix(lutCell(ivec3(lo.x,lo.y,hi.z)),lutCell(ivec3(hi.x,lo.y,hi.z)),f.x);
  vec3 x11=mix(lutCell(ivec3(lo.x,hi.y,hi.z)),lutCell(ivec3(hi.x,hi.y,hi.z)),f.x);
  return mix(mix(x00,x10,f.y),mix(x01,x11,f.y),f.z);
}
void main(){
  vec4 base=texture(u_media,v_uv); float alpha=u_has_chroma?keyAlpha(v_uv):base.a;
  vec3 color=base.rgb;
  if(u_has_chroma&&u_source_chroma){ vec3 bg=u_has_background_image?texture(u_background,coverUv(v_uv)).rgb:u_background_color; color=mix(bg,color,alpha); alpha=1.0; }
  if(u_has_lut) color=mix(color,applyLut(color),u_intensity);
  outColor=vec4(color*alpha,alpha);
}`;

  function createTexture2D(gl) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function createRail(options) {
    const media = options && options.media;
    if (!media || !media.parentNode) throw new TypeError('video FX rail requires a mounted media element');
    const documentRef = media.ownerDocument;
    const canvas = documentRef.createElement('canvas');
    canvas.className = 'akari-video-fx-rail';
    canvas.dataset.akariVideoFxRole = String(options.role || 'media');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.pointerEvents = 'none';
    let gl = null;
    let isWebGl2 = false;
    let handle = null;
    let mediaTexture = null;
    let lutTexture = null;
    let backgroundTexture = null;
    let hasBackgroundImage = false;
    let effects = null;
    let lut = null;
    let backgroundSize = [1, 1];
    let configureGeneration = 0;
    let disposed = false;
    let collapsed = false;
    let status = 'initializing';
    let presentationFilter = media.style.filter || '';
    let appliedMediaFilter = null;
    const originalBackground = [0, 0, 0];

    const capturePresentationFilter = () => {
      const current = media.style.filter || '';
      if (current !== appliedMediaFilter) presentationFilter = current;
      return presentationFilter;
    };
    const restorePresentationFilter = () => {
      capturePresentationFilter();
      media.style.filter = presentationFilter;
      appliedMediaFilter = null;
    };

    const reportState = (next, error) => {
      status = next;
      canvas.dataset.akariVideoFxStatus = next;
      if (typeof options.onStateChange === 'function') options.onStateChange({ status: next, error, rail: api });
    };
    const collapse = error => {
      if (collapsed || disposed) return;
      collapsed = true;
      restorePresentationFilter();
      canvas.remove();
      reportState('failed', error instanceof Error ? error : new Error(String(error)));
    };

    try {
      if (options.forceFailure) throw new Error('forced WebGL failure');
      if (!options.forceWebGl1) {
        gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      }
      isWebGl2 = Boolean(gl);
      if (!gl) gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
      if (!gl) throw new Error('WebGL is unavailable');
      handle = program(gl, isWebGl2 ? VERTEX_2 : VERTEX_1, isWebGl2 ? FRAGMENT_2 : FRAGMENT_1);
      gl.useProgram(handle);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
        -1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1,
        -1, 1, 0, 1, 1, -1, 1, 0, 1, 1, 1, 1
      ]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(handle, 'a_position');
      const uv = gl.getAttribLocation(handle, 'a_uv');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);
      mediaTexture = createTexture2D(gl);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      media.parentNode.insertBefore(canvas, media.nextSibling);
    } catch (error) {
      if (canvas.parentNode) canvas.remove();
      restorePresentationFilter();
      throw error;
    }

    const uniform = name => gl.getUniformLocation(handle, name);
    const uniforms = Object.fromEntries([
      'u_media', 'u_background', 'u_lut', 'u_texel', 'u_key_uv', 'u_background_color', 'u_background_size',
      'u_output_size', 'u_similarity', 'u_blend', 'u_intensity', 'u_lut_size',
      'u_has_chroma', 'u_source_chroma', 'u_has_background_image', 'u_has_lut'
    ].map(name => [name, uniform(name)]));
    const assignTexture = (unit, target, texture, uniformLocation) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, texture);
      gl.uniform1i(uniformLocation, unit);
    };

    const uploadLut = parsed => {
      if (lutTexture) gl.deleteTexture(lutTexture);
      if (isWebGl2) {
        lutTexture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_3D, lutTexture);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        const rgba = new Float32Array(parsed.size * parsed.size * parsed.size * 4);
        for (let source = 0, target = 0; source < parsed.data.length; source += 3, target += 4) {
          rgba[target] = parsed.data[source];
          rgba[target + 1] = parsed.data[source + 1];
          rgba[target + 2] = parsed.data[source + 2];
          rgba[target + 3] = 1;
        }
        gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, parsed.size, parsed.size, parsed.size, 0, gl.RGBA, gl.FLOAT, rgba);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      } else {
        if (!gl.getExtension('OES_texture_float')) throw new Error('WebGL1 float textures are unavailable');
        if (parsed.size * parsed.size > gl.getParameter(gl.MAX_TEXTURE_SIZE)) {
          throw new RangeError(`LUT ${parsed.size} exceeds WebGL1 texture limit`);
        }
        lutTexture = createTexture2D(gl);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        const atlas = packLutAtlas(parsed);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, atlas.width, atlas.height, 0, gl.RGB, gl.FLOAT, atlas.data);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      }
    };

    const loadBackground = (url, generation) => new Promise((resolve, reject) => {
      const image = new root.Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => {
        if (generation !== configureGeneration || disposed) return resolve();
        try {
          if (backgroundTexture) gl.deleteTexture(backgroundTexture);
          backgroundTexture = createTexture2D(gl);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
          backgroundSize = [image.naturalWidth || image.width || 1, image.naturalHeight || image.height || 1];
          hasBackgroundImage = true;
          resolve();
        } catch (error) { reject(error); }
      };
      image.onerror = () => reject(new Error(`chroma background could not be loaded: ${url}`));
      image.src = url;
    });

    const configure = async nextEffects => {
      if (disposed || collapsed) return false;
      const generation = ++configureGeneration;
      try {
        effects = nextEffects || {};
        lut = effects.look
          ? (effects.look.lut && effects.look.lut.data ? effects.look.lut : parseCube(effects.look.cubeText))
          : null;
        if (lut) uploadLut(lut);
        const chroma = effects.chromaKey;
        if (chroma && chroma.background && chroma.background.type === 'image') {
          await loadBackground(chroma.background.url, generation);
        } else {
          if (backgroundTexture) gl.deleteTexture(backgroundTexture);
          backgroundTexture = null;
          hasBackgroundImage = false;
          backgroundSize = [1, 1];
          if (chroma && chroma.background && chroma.background.type === 'color') {
            originalBackground.splice(0, 3, ...parseColor(chroma.background.color));
          } else originalBackground.splice(0, 3, 0, 0, 0);
        }
        if (generation !== configureGeneration) return false;
        reportState('ready');
        return true;
      } catch (error) {
        collapse(error);
        return false;
      }
    };

    const syncStyle = () => {
      const properties = [
        'display', 'visibility', 'left', 'top', 'right', 'bottom', 'width', 'height', 'opacity',
        'transform', 'transformOrigin', 'clipPath', 'zIndex', 'mixBlendMode', 'objectFit', 'objectPosition'
      ];
      for (const property of properties) canvas.style[property] = media.style[property] || '';
      canvas.style.position = media.style.position || 'absolute';
      canvas.style.maxWidth = media.style.maxWidth || 'none';
      canvas.style.maxHeight = media.style.maxHeight || 'none';
      const filter = capturePresentationFilter();
      canvas.style.filter = filter;
      media.style.filter = `${filter}${filter ? ' ' : ''}opacity(0)`;
      appliedMediaFilter = media.style.filter || 'opacity(0)';
    };

    const render = timeSeconds => {
      if (disposed || collapsed || status !== 'ready') return false;
      const width = Number(media.videoWidth || media.naturalWidth || media.width || 0);
      const height = Number(media.videoHeight || media.naturalHeight || media.height || 0);
      if (!(width > 0) || !(height > 0)) return false;
      try {
        syncStyle();
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        canvas.dataset.akariVideoFxTime = String(finite(timeSeconds, 0));
        gl.viewport(0, 0, width, height);
        gl.useProgram(handle);
        assignTexture(0, gl.TEXTURE_2D, mediaTexture, uniforms.u_media);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, media);

        const chroma = effects.chromaKey || null;
        const keyColor = parseColor(chroma && chroma.color || DEFAULT_CHROMA.color);
        const keyUv = rgbToFfmpegUv(keyColor);
        gl.uniform2f(uniforms.u_texel, 1 / width, 1 / height);
        gl.uniform2f(uniforms.u_key_uv, keyUv[0], keyUv[1]);
        gl.uniform3f(uniforms.u_background_color, originalBackground[0], originalBackground[1], originalBackground[2]);
        gl.uniform1f(uniforms.u_similarity, clamp(finite(chroma && chroma.similarity, DEFAULT_CHROMA.similarity)));
        gl.uniform1f(uniforms.u_blend, clamp(finite(chroma && chroma.blend, DEFAULT_CHROMA.blend)));
        gl.uniform1i(uniforms.u_has_chroma, chroma ? 1 : 0);
        gl.uniform1i(uniforms.u_source_chroma, chroma && chroma.mode === 'source' ? 1 : 0);
        gl.uniform1i(uniforms.u_has_background_image, hasBackgroundImage ? 1 : 0);
        gl.uniform2f(uniforms.u_background_size, backgroundSize[0], backgroundSize[1]);
        gl.uniform2f(uniforms.u_output_size, width, height);
        if (backgroundTexture) assignTexture(1, gl.TEXTURE_2D, backgroundTexture, uniforms.u_background);
        else {
          if (!backgroundTexture) backgroundTexture = createTexture2D(gl);
          gl.bindTexture(gl.TEXTURE_2D, backgroundTexture);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE,
            new Uint8Array([...originalBackground.map(value => Math.round(value * 255)), 255]));
          assignTexture(1, gl.TEXTURE_2D, backgroundTexture, uniforms.u_background);
        }
        gl.uniform1i(uniforms.u_has_lut, lut ? 1 : 0);
        gl.uniform1f(uniforms.u_lut_size, lut ? lut.size : 2);
        gl.uniform1f(uniforms.u_intensity, clamp(finite(effects.look && effects.look.intensity, 1)));
        // WebGL validates sampler types even behind a false uniform branch. Keep sampler3D off
        // the media sampler's unit when chroma-only effects have no LUT texture.
        if (!lutTexture && isWebGl2) {
          lutTexture = gl.createTexture();
          gl.bindTexture(gl.TEXTURE_3D, lutTexture);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
          gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA32F, 2, 2, 2, 0, gl.RGBA, gl.FLOAT, new Float32Array(32));
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
        }
        if (lutTexture) assignTexture(2, isWebGl2 ? gl.TEXTURE_3D : gl.TEXTURE_2D, lutTexture, uniforms.u_lut);
        // createTexture2D() above may have run while texture unit 0 was active for a solid
        // background. Restore the media binding immediately before the draw.
        assignTexture(0, gl.TEXTURE_2D, mediaTexture, uniforms.u_media);
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
        return true;
      } catch (error) {
        collapse(error);
        return false;
      }
    };

    const dispose = () => {
      if (disposed) return;
      disposed = true;
      configureGeneration += 1;
      restorePresentationFilter();
      canvas.remove();
      for (const texture of [mediaTexture, lutTexture, backgroundTexture]) if (texture) gl.deleteTexture(texture);
      if (handle) gl.deleteProgram(handle);
      status = 'disposed';
    };

    const api = Object.freeze({
      canvas,
      configure,
      render,
      dispose,
      inspect: () => Object.freeze({
        status,
        webglVersion: isWebGl2 ? 2 : 1,
        role: canvas.dataset.akariVideoFxRole,
        hasLut: Boolean(lut),
        hasChroma: Boolean(effects && effects.chromaKey),
        time: finite(canvas.dataset.akariVideoFxTime, 0)
      })
    });
    reportState('initialized');
    return api;
  }

  root.AkariVideoFx = Object.freeze({
    parseCube,
    sampleLutTrilinear,
    lutAtlasUploadPosition,
    lutAtlasSamplePosition,
    packLutAtlas,
    parseColor,
    rgbToFfmpegUv,
    createRail
  });
})();
