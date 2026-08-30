import F from "@webav/mp4box.js";
import { workerTimer as ut, Log as C, autoReadStream as U, file2stream as Z, EventTool as N, recodemux as ft } from "@webav/internal-utils";
import { Log as Se } from "@webav/internal-utils";
import * as mt from "wave-resampler";
import { tmpfile as _, write as O } from "opfs-tools";
const pt = `#version 300 es
  layout (location = 0) in vec4 a_position;
  layout (location = 1) in vec2 a_texCoord;
  out vec2 v_texCoord;
  void main () {
    gl_Position = a_position;
    v_texCoord = a_texCoord;
  }
`, wt = `#version 300 es
precision mediump float;
out vec4 FragColor;
in vec2 v_texCoord;

uniform sampler2D frameTexture;
uniform vec3 keyColor;

// 色度的相似度计算
uniform float similarity;
// 透明度的平滑度计算
uniform float smoothness;
// 降低绿幕饱和度，提高抠图准确度
uniform float spill;

vec2 RGBtoUV(vec3 rgb) {
  return vec2(
    rgb.r * -0.169 + rgb.g * -0.331 + rgb.b *  0.5    + 0.5,
    rgb.r *  0.5   + rgb.g * -0.419 + rgb.b * -0.081  + 0.5
  );
}

void main() {
  // 获取当前像素的rgba值
  vec4 rgba = texture(frameTexture, v_texCoord);
  // 计算当前像素与绿幕像素的色度差值
  vec2 chromaVec = RGBtoUV(rgba.rgb) - RGBtoUV(keyColor);
  // 计算当前像素与绿幕像素的色度距离（向量长度）, 越相像则色度距离越小
  float chromaDist = sqrt(dot(chromaVec, chromaVec));
  // 设置了一个相似度阈值，baseMask为负，则表明是绿幕，为正则表明不是绿幕
  float baseMask = chromaDist - similarity;
  // 如果baseMask为负数，fullMask等于0；baseMask为正数，越大，则透明度越低
  float fullMask = pow(clamp(baseMask / smoothness, 0., 1.), 1.5);
  rgba.a = fullMask; // 设置透明度
  // 如果baseMask为负数，spillVal等于0；baseMask为整数，越小，饱和度越低
  float spillVal = pow(clamp(baseMask / spill, 0., 1.), 1.5);
  float desat = clamp(rgba.r * 0.2126 + rgba.g * 0.7152 + rgba.b * 0.0722, 0., 1.); // 计算当前像素的灰度值
  rgba.rgb = mix(vec3(desat, desat, desat), rgba.rgb, spillVal);
  FragColor = rgba;
}
`, yt = [-1, 1, -1, -1, 1, -1, 1, -1, 1, 1, -1, 1], gt = [0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 1];
function bt(s, t, e) {
  const i = G(s, s.VERTEX_SHADER, t), n = G(s, s.FRAGMENT_SHADER, e), a = s.createProgram();
  if (s.attachShader(a, i), s.attachShader(a, n), s.linkProgram(a), !s.getProgramParameter(a, s.LINK_STATUS))
    throw Error(
      s.getProgramInfoLog(a) ?? "Unable to initialize the shader program"
    );
  return a;
}
function G(s, t, e) {
  const i = s.createShader(t);
  if (s.shaderSource(i, e), s.compileShader(i), !s.getShaderParameter(i, s.COMPILE_STATUS)) {
    const n = s.getShaderInfoLog(i);
    throw s.deleteShader(i), Error(n ?? "An error occurred compiling the shaders");
  }
  return i;
}
function xt(s, t, e) {
  s.bindTexture(s.TEXTURE_2D, e), s.texImage2D(s.TEXTURE_2D, 0, s.RGBA, s.RGBA, s.UNSIGNED_BYTE, t), s.drawArrays(s.TRIANGLES, 0, 6);
}
function Ct(s) {
  const t = s.createTexture();
  if (t == null) throw Error("Create WebGL texture error");
  s.bindTexture(s.TEXTURE_2D, t);
  const e = 0, i = s.RGBA, n = 1, a = 1, r = 0, o = s.RGBA, c = s.UNSIGNED_BYTE, l = new Uint8Array([0, 0, 255, 255]);
  return s.texImage2D(
    s.TEXTURE_2D,
    e,
    i,
    n,
    a,
    r,
    o,
    c,
    l
  ), s.texParameteri(s.TEXTURE_2D, s.TEXTURE_MAG_FILTER, s.LINEAR), s.texParameteri(s.TEXTURE_2D, s.TEXTURE_MIN_FILTER, s.LINEAR), s.texParameteri(s.TEXTURE_2D, s.TEXTURE_WRAP_S, s.CLAMP_TO_EDGE), s.texParameteri(s.TEXTURE_2D, s.TEXTURE_WRAP_T, s.CLAMP_TO_EDGE), t;
}
function vt(s) {
  const t = "document" in globalThis ? globalThis.document.createElement("canvas") : new OffscreenCanvas(s.width, s.height);
  t.width = s.width, t.height = s.height;
  const e = t.getContext("webgl2", {
    premultipliedAlpha: !1,
    alpha: !0
  });
  if (e == null) throw Error("Cant create gl context");
  const i = bt(e, pt, wt);
  e.useProgram(i), e.uniform3fv(
    e.getUniformLocation(i, "keyColor"),
    s.keyColor.map((c) => c / 255)
  ), e.uniform1f(
    e.getUniformLocation(i, "similarity"),
    s.similarity
  ), e.uniform1f(
    e.getUniformLocation(i, "smoothness"),
    s.smoothness
  ), e.uniform1f(e.getUniformLocation(i, "spill"), s.spill);
  const n = e.createBuffer();
  e.bindBuffer(e.ARRAY_BUFFER, n), e.bufferData(e.ARRAY_BUFFER, new Float32Array(yt), e.STATIC_DRAW);
  const a = e.getAttribLocation(i, "a_position");
  e.vertexAttribPointer(
    a,
    2,
    e.FLOAT,
    !1,
    Float32Array.BYTES_PER_ELEMENT * 2,
    0
  ), e.enableVertexAttribArray(a);
  const r = e.createBuffer();
  e.bindBuffer(e.ARRAY_BUFFER, r), e.bufferData(
    e.ARRAY_BUFFER,
    new Float32Array(gt),
    e.STATIC_DRAW
  );
  const o = e.getAttribLocation(i, "a_texCoord");
  return e.vertexAttribPointer(
    o,
    2,
    e.FLOAT,
    !1,
    Float32Array.BYTES_PER_ELEMENT * 2,
    0
  ), e.enableVertexAttribArray(o), e.pixelStorei(e.UNPACK_FLIP_Y_WEBGL, 1), { cvs: t, gl: e };
}
function St(s) {
  return s instanceof VideoFrame ? { width: s.codedWidth, height: s.codedHeight } : { width: s.width, height: s.height };
}
function Tt(s) {
  const e = new OffscreenCanvas(1, 1).getContext("2d");
  e.drawImage(s, 0, 0);
  const {
    data: [i, n, a]
  } = e.getImageData(0, 0, 1, 1);
  return [i, n, a];
}
const we = (s) => {
  let t = null, e = null, i = s.keyColor, n = null;
  return async (a) => {
    if ((t == null || e == null || n == null) && (i == null && (i = Tt(a)), { cvs: t, gl: e } = vt({
      ...St(a),
      keyColor: i,
      ...s
    }), n = Ct(e)), xt(e, a, n), globalThis.VideoFrame != null && a instanceof globalThis.VideoFrame) {
      const r = new VideoFrame(t, {
        alpha: "keep",
        timestamp: a.timestamp,
        duration: a.duration ?? void 0
      });
      return a.close(), r;
    }
    return createImageBitmap(t, {
      imageOrientation: a instanceof ImageBitmap ? "flipY" : "none"
    });
  };
};
function At(s) {
  return document.createElement(s);
}
function Ft(s) {
  var t = "", e = new Uint8Array(s), i = e.byteLength;
  for (let n = 0; n < i; n++)
    t += String.fromCharCode(e[n]);
  return window.btoa(t);
}
async function kt(s, t, e = {}) {
  const i = At("pre");
  i.style.cssText = `margin: 0; ${t}; position: fixed;`, i.textContent = s, document.body.appendChild(i), e.onCreated?.(i);
  const n = "TMP_FONT_NAME_" + crypto.randomUUID();
  let a = null;
  e.font != null && (i.style.fontFamily = n, a = new FontFace(n, `url(${e.font.url})`), await a.load(), document.fonts.add(a), await document.fonts.ready);
  const { width: r, height: o } = i.getBoundingClientRect();
  i.remove(), a != null && document.fonts.delete(a);
  const c = new Image();
  c.width = r, c.height = o;
  const l = e.font == null ? "" : `
    @font-face {
      font-family: '${n}';
      src: url('data:font/woff2;base64,${Ft(await (await fetch(e.font.url)).arrayBuffer())}') format('woff2');
    }
  `, h = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${r}" height="${o}">
      <style>
        ${l}
      </style>
      <foreignObject width="100%" height="100%">
        <div xmlns="http://www.w3.org/1999/xhtml">${i.outerHTML}</div>
      </foreignObject>
    </svg>
  `.replace(/\t/g, "").replace(/#/g, "%23");
  return c.src = `data:image/svg+xml;charset=utf-8,${h}`, await new Promise((u) => {
    c.onload = u;
  }), c;
}
async function ye(s, t, e = {}) {
  const i = await kt(s, t, e), n = new OffscreenCanvas(i.width, i.height);
  return n.getContext("2d")?.drawImage(i, 0, 0, i.width, i.height), await createImageBitmap(n);
}
function It(s) {
  const t = new Float32Array(
    s.map((i) => i.length).reduce((i, n) => i + n)
  );
  let e = 0;
  for (const i of s)
    t.set(i, e), e += i.length;
  return t;
}
function tt(s) {
  const t = [];
  for (let e = 0; e < s.length; e += 1)
    for (let i = 0; i < s[e].length; i += 1)
      t[i] == null && (t[i] = []), t[i].push(s[e][i]);
  return t.map(It);
}
function et(s) {
  if (s.format === "f32-planar") {
    const t = [];
    for (let e = 0; e < s.numberOfChannels; e += 1) {
      const i = s.allocationSize({ planeIndex: e }), n = new ArrayBuffer(i);
      s.copyTo(n, { planeIndex: e }), t.push(new Float32Array(n));
    }
    return t;
  } else if (s.format === "f32") {
    const t = new ArrayBuffer(s.allocationSize({ planeIndex: 0 }));
    return s.copyTo(t, { planeIndex: 0 }), Et(new Float32Array(t), s.numberOfChannels);
  } else if (s.format === "s16") {
    const t = new ArrayBuffer(s.allocationSize({ planeIndex: 0 }));
    return s.copyTo(t, { planeIndex: 0 }), Rt(new Int16Array(t), s.numberOfChannels);
  }
  throw Error("Unsupported audio data format");
}
function Rt(s, t) {
  const e = s.length / t, i = Array.from(
    { length: t },
    () => new Float32Array(e)
  );
  for (let n = 0; n < e; n++)
    for (let a = 0; a < t; a++) {
      const r = s[n * t + a];
      i[a][n] = r / 32768;
    }
  return i;
}
function Et(s, t) {
  const e = s.length / t, i = Array.from(
    { length: t },
    () => new Float32Array(e)
  );
  for (let n = 0; n < e; n++)
    for (let a = 0; a < t; a++)
      i[a][n] = s[n * t + a];
  return i;
}
function $(s) {
  return Array(s.numberOfChannels).fill(0).map((t, e) => s.getChannelData(e));
}
async function Dt(s, t) {
  const e = {
    type: t,
    data: s
  }, i = new ImageDecoder(e);
  await Promise.all([i.completed, i.tracks.ready]);
  let n = i.tracks.selectedTrack?.frameCount ?? 1;
  const a = [];
  for (let r = 0; r < n; r += 1)
    a.push((await i.decode({ frameIndex: r })).image);
  return a;
}
function j(s) {
  const t = Math.max(...s.map((i) => i[0]?.length ?? 0)), e = new Float32Array(t * 2);
  for (let i = 0; i < t; i++) {
    let n = 0, a = 0;
    for (let r = 0; r < s.length; r++) {
      const o = s[r][0]?.[i] ?? 0, c = s[r][1]?.[i] ?? o;
      n += o, a += c;
    }
    e[i] = n, e[i + t] = a;
  }
  return e;
}
async function Pt(s, t, e) {
  const i = s.length, n = Array(e.chanCount).fill(0).map(() => new Float32Array(0));
  if (i === 0) return n;
  const a = Math.max(...s.map((l) => l.length));
  if (a === 0) return n;
  if (globalThis.OfflineAudioContext == null)
    return s.map(
      (l) => new Float32Array(
        mt.resample(l, t, e.rate, {
          method: "sinc",
          LPF: !1
        })
      )
    );
  const r = new globalThis.OfflineAudioContext(
    e.chanCount,
    a * e.rate / t,
    e.rate
  ), o = r.createBufferSource(), c = r.createBuffer(i, a, t);
  return s.forEach((l, h) => c.copyToChannel(l, h)), o.buffer = c, o.connect(r.destination), o.start(), $(await r.startRendering());
}
function H(s) {
  return new Promise((t) => {
    const e = ut(() => {
      e(), t();
    }, s);
  });
}
function z(s, t, e) {
  const i = e - t, n = new Float32Array(i);
  let a = 0;
  for (; a < i; )
    n[a] = s[(t + a) % s.length], a += 1;
  return n;
}
function it(s, t) {
  const e = Math.floor(s.length / t), i = new Float32Array(e);
  for (let n = 0; n < e; n++) {
    const a = n * t, r = Math.floor(a), o = a - r;
    r + 1 < s.length ? i[n] = s[r] * (1 - o) + s[r + 1] * o : i[n] = s[r];
  }
  return i;
}
const x = {
  sampleRate: 48e3,
  channelCount: 2,
  codec: "mp4a.40.2"
};
function W(s, t) {
  const e = t.videoTracks[0], i = {};
  if (e != null) {
    const a = Mt(s.getTrackById(e.id))?.buffer, { descKey: r, type: o } = e.codec.startsWith("avc1") ? { descKey: "avcDecoderConfigRecord", type: "avc1" } : e.codec.startsWith("hvc1") ? { descKey: "hevcDecoderConfigRecord", type: "hvc1" } : { descKey: "", type: "" };
    r !== "" && (i.videoTrackConf = {
      timescale: e.timescale,
      duration: e.duration,
      width: e.video.width,
      height: e.video.height,
      brands: t.brands,
      type: o,
      [r]: a
    }), i.videoDecoderConf = {
      codec: e.codec,
      codedHeight: e.video.height,
      codedWidth: e.video.width,
      description: a
    };
  }
  const n = t.audioTracks[0];
  if (n != null) {
    const a = Bt(s), r = a == null ? {} : _t(a);
    i.audioTrackConf = {
      timescale: n.timescale,
      samplerate: r.sampleRate ?? n.audio.sample_rate,
      channel_count: r.numberOfChannels ?? n.audio.channel_count,
      hdlr: "soun",
      type: n.codec.startsWith("mp4a") ? "mp4a" : n.codec,
      description: a
    }, i.audioDecoderConf = {
      codec: r.codec ?? x.codec,
      numberOfChannels: r.numberOfChannels ?? n.audio.channel_count,
      sampleRate: r.sampleRate ?? n.audio.sample_rate
    };
  }
  return i;
}
function Mt(s) {
  for (const t of s.mdia.minf.stbl.stsd.entries) {
    const e = t.avcC ?? t.hvcC ?? t.av1C ?? t.vpcC;
    if (e != null) {
      const i = new F.DataStream(
        void 0,
        0,
        F.DataStream.BIG_ENDIAN
      );
      return e.write(i), new Uint8Array(i.buffer.slice(8));
    }
  }
}
function Bt(s, t = "mp4a") {
  return s.moov?.traks.map((i) => i.mdia.minf.stbl.stsd.entries).flat().find(({ type: i }) => i === t)?.esds;
}
function _t(s) {
  let t = "mp4a";
  const e = s.esd.descs[0];
  if (e == null) return {};
  t += "." + e.oti.toString(16);
  const i = e.descs[0];
  if (i == null)
    return t.endsWith("40") && (t += ".2"), { codec: t };
  const n = (i.data[0] & 248) >> 3;
  t += "." + n;
  const [a, r] = i.data, o = ((a & 7) << 1) + (r >> 7), c = (r & 127) >> 3;
  return {
    codec: t,
    sampleRate: [
      96e3,
      88200,
      64e3,
      48e3,
      44100,
      32e3,
      24e3,
      22050,
      16e3,
      12e3,
      11025,
      8e3,
      7350
    ][o],
    numberOfChannels: c
  };
}
async function Ot(s, t, e) {
  const i = F.createFile(!1);
  i.onReady = (a) => {
    t({ mp4boxFile: i, info: a });
    const r = a.videoTracks[0]?.id;
    r != null && i.setExtractionOptions(r, "video", { nbSamples: 100 });
    const o = a.audioTracks[0]?.id;
    o != null && i.setExtractionOptions(o, "audio", { nbSamples: 100 }), i.start();
  }, i.onSamples = e, await n();
  async function n() {
    let a = 0;
    const r = 30 * 1024 * 1024;
    for (; ; ) {
      const o = await s.read(r, {
        at: a
      });
      if (o.byteLength === 0) break;
      o.fileStart = a;
      const c = i.appendBuffer(o);
      if (c == null) break;
      a = c;
    }
    i.stop();
  }
}
function zt(s) {
  if (s?.length !== 9) return {};
  const t = new Int32Array(s.buffer), e = t[0] / 65536, i = t[1] / 65536, n = t[3] / 65536, a = t[4] / 65536, r = t[6] / 65536, o = t[7] / 65536, c = t[8] / (1 << 30), l = Math.sqrt(e * e + n * n), h = Math.sqrt(i * i + a * a), u = Math.atan2(n, e), d = u * 180 / Math.PI;
  return {
    scaleX: l,
    scaleY: h,
    rotationRad: u,
    rotationDeg: d,
    translateX: r,
    translateY: o,
    perspective: c
  };
}
function Vt(s, t, e) {
  const i = (Math.round(e / 90) * 90 + 360) % 360;
  if (i === 0) return (c) => c;
  const n = i === 90 || i === 270 ? t : s, a = i === 90 || i === 270 ? s : t, r = new OffscreenCanvas(n, a), o = r.getContext("2d");
  return o.translate(n / 2, a / 2), o.rotate(-i * Math.PI / 180), o.translate(-s / 2, -t / 2), (c) => {
    if (c == null) return null;
    o.drawImage(c, 0, 0);
    const l = new VideoFrame(r, {
      timestamp: c.timestamp,
      duration: c.duration ?? void 0
    });
    return c.close(), l;
  };
}
let X = 0;
function B(s) {
  return s.kind === "file" && s.createReader instanceof Function;
}
class I {
  #t = X++;
  #n = C.create(`MP4Clip id:${this.#t},`);
  ready;
  #e = !1;
  #s = {
    // 微秒
    duration: 0,
    width: 0,
    height: 0,
    audioSampleRate: 0,
    audioChanCount: 0
  };
  get meta() {
    return { ...this.#s };
  }
  #a;
  /** 存储视频头（box: ftyp, moov）的二进制数据 */
  #r = [];
  /**
   * 提供视频头（box: ftyp, moov）的二进制数据
   * 使用任意 mp4 demxer 解析即可获得详细的视频信息
   * 单元测试包含使用 mp4box.js 解析示例代码
   */
  async getFileHeaderBinData() {
    await this.ready;
    const t = await this.#a.getOriginFile();
    if (t == null) throw Error("MP4Clip localFile is not origin file");
    return await new Blob(
      this.#r.map(
        ({ start: e, size: i }) => t.slice(e, e + i)
      )
    ).arrayBuffer();
  }
  /**存储视频平移旋转信息，目前只还原旋转 */
  #i = {
    perspective: 1,
    rotationRad: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0
  };
  #o = (t) => t;
  #l = 1;
  #c = [];
  #d = [];
  #m = null;
  #u = null;
  #f = {
    video: null,
    audio: null
  };
  #h = { audio: !0 };
  constructor(t, e = {}) {
    if (!(t instanceof ReadableStream) && !B(t) && !Array.isArray(t.videoSamples))
      throw Error("Illegal argument");
    this.#h = { audio: !0, ...e }, this.#l = typeof e.audio == "object" && "volume" in e.audio ? e.audio.volume : 1;
    const i = async (n) => (await O(this.#a, n), this.#a);
    this.#a = B(t) ? t : "localFile" in t ? t.localFile : _(), this.ready = (t instanceof ReadableStream ? i(t).then(
      (n) => J(n, this.#h)
    ) : B(t) ? J(t, this.#h) : Promise.resolve(t)).then(
      async ({
        videoSamples: n,
        audioSamples: a,
        decoderConf: r,
        headerBoxPos: o,
        parsedMatrix: c
      }) => {
        this.#c = n, this.#d = a, this.#f = r, this.#r = o, this.#i = c;
        const { videoFrameFinder: l, audioFrameFinder: h } = Ut(
          {
            video: r.video == null ? null : {
              ...r.video,
              hardwareAcceleration: this.#h.__unsafe_hardwareAcceleration__
            },
            audio: r.audio
          },
          await this.#a.createReader(),
          n,
          a,
          this.#h.audio !== !1 ? this.#l : 0
        );
        this.#m = l, this.#u = h;
        const { codedWidth: u, codedHeight: d } = r.video ?? {};
        return u && d && !this.#h.__unsafe_skipRotation__ && (this.#o = Vt(
          u,
          d,
          c.rotationDeg
        )), this.#s = Object.assign(Lt(
          r,
          n,
          a,
          c.rotationDeg
        ), { rotationDeg: c.rotationDeg }), this.#n.info("MP4Clip meta:", this.#s), { ...this.#s };
      }
    );
  }
  /**
   * 拦截 {@link MP4Clip.tick} 方法返回的数据，用于对图像、音频数据二次处理
   * @param time 调用 tick 的时间
   * @param tickRet tick 返回的数据
   *
   * @see [移除视频绿幕背景](https://webav-tech.github.io/WebAV/demo/3_2-chromakey-video)
   */
  tickInterceptor = async (t, e) => e;
  /**
   * 获取素材指定时刻的图像帧、音频数据
   * @param time 微秒
   */
  async tick(t) {
    if (t >= this.#s.duration)
      return await this.tickInterceptor(t, {
        audio: await this.#u?.find(t) ?? [],
        state: "done"
      });
    const [e, i] = await Promise.all([
      this.#u?.find(t) ?? [],
      this.#m?.find(t).then(this.#o)
    ]);
    return i == null ? await this.tickInterceptor(t, {
      audio: e,
      state: "success"
    }) : await this.tickInterceptor(t, {
      video: i,
      audio: e,
      state: "success"
    });
  }
  #p = new AbortController();
  /**
   * 生成缩略图，默认每个关键帧生成一个 100px 宽度的缩略图。
   *
   * @param imgWidth 缩略图宽度，默认 100
   * @param opts Partial<ThumbnailOpts>
   * @returns Promise<Array<{ ts: number; img: Blob }>>
   */
  async thumbnails(t = 100, e) {
    this.#p.abort(), this.#p = new AbortController();
    const i = this.#p.signal;
    await this.ready;
    const n = "generate thumbnails aborted";
    if (i.aborted) throw Error(n);
    const { width: a, height: r } = this.#s, o = Xt(
      t,
      Math.round(r * (t / a)),
      { quality: 0.1, type: "image/png" }
    );
    return new Promise(
      async (c, l) => {
        let h = [];
        const u = this.#f.video;
        if (u == null || this.#c.length === 0) {
          d();
          return;
        }
        i.addEventListener("abort", () => {
          l(Error(n));
        });
        async function d() {
          i.aborted || c(
            await Promise.all(
              h.map(async (p) => ({
                ts: p.ts,
                img: await p.img
              }))
            )
          );
        }
        function y(p) {
          h.push({
            ts: p.timestamp,
            img: o(p)
          });
        }
        const { start: m = 0, end: f = this.#s.duration, step: w } = e ?? {};
        if (w) {
          let p = m;
          const g = new nt(
            await this.#a.createReader(),
            this.#c,
            {
              ...u,
              hardwareAcceleration: this.#h.__unsafe_hardwareAcceleration__
            }
          );
          for (; p <= f && !i.aborted; ) {
            const b = await g.find(p);
            b && y(b), p += w;
          }
          g.destroy(), d();
        } else
          await Jt(
            this.#c,
            this.#a,
            u,
            i,
            { start: m, end: f },
            (p, g) => {
              p != null && y(p), g && d();
            }
          );
      }
    );
  }
  async split(t) {
    if (await this.ready, t <= 0 || t >= this.#s.duration)
      throw Error('"time" out of bounds');
    const [e, i] = Yt(
      this.#c,
      t
    ), [n, a] = Gt(
      this.#d,
      t
    ), r = new I(
      {
        localFile: this.#a,
        videoSamples: e ?? [],
        audioSamples: n ?? [],
        decoderConf: this.#f,
        headerBoxPos: this.#r,
        parsedMatrix: this.#i
      },
      this.#h
    ), o = new I(
      {
        localFile: this.#a,
        videoSamples: i ?? [],
        audioSamples: a ?? [],
        decoderConf: this.#f,
        headerBoxPos: this.#r,
        parsedMatrix: this.#i
      },
      this.#h
    );
    return await Promise.all([r.ready, o.ready]), [r, o];
  }
  async clone() {
    await this.ready;
    const t = new I(
      {
        localFile: this.#a,
        videoSamples: [...this.#c],
        audioSamples: [...this.#d],
        decoderConf: this.#f,
        headerBoxPos: this.#r,
        parsedMatrix: this.#i
      },
      this.#h
    );
    return await t.ready, t.tickInterceptor = this.tickInterceptor, t;
  }
  /**
   * 拆分 MP4Clip 为仅包含视频轨道和音频轨道的 MP4Clip
   * @returns Mp4CLip[]
   */
  async splitTrack() {
    await this.ready;
    const t = [];
    if (this.#c.length > 0) {
      const e = new I(
        {
          localFile: this.#a,
          videoSamples: [...this.#c],
          audioSamples: [],
          decoderConf: {
            video: this.#f.video,
            audio: null
          },
          headerBoxPos: this.#r,
          parsedMatrix: this.#i
        },
        this.#h
      );
      await e.ready, e.tickInterceptor = this.tickInterceptor, t.push(e);
    }
    if (this.#d.length > 0) {
      const e = new I(
        {
          localFile: this.#a,
          videoSamples: [],
          audioSamples: [...this.#d],
          decoderConf: {
            audio: this.#f.audio,
            video: null
          },
          headerBoxPos: this.#r,
          parsedMatrix: this.#i
        },
        this.#h
      );
      await e.ready, e.tickInterceptor = this.tickInterceptor, t.push(e);
    }
    return t;
  }
  destroy() {
    this.#e || (this.#n.info("MP4Clip destroy"), this.#e = !0, this.#m?.destroy(), this.#u?.destroy());
  }
}
function Lt(s, t, e, i) {
  const n = {
    duration: 0,
    width: 0,
    height: 0,
    audioSampleRate: 0,
    audioChanCount: 0
  };
  if (s.video != null && t.length > 0) {
    n.width = s.video.codedWidth ?? 0, n.height = s.video.codedHeight ?? 0;
    const o = (Math.round(i / 90) * 90 + 360) % 360;
    (o === 90 || o === 270) && ([n.width, n.height] = [n.height, n.width]);
  }
  s.audio != null && e.length > 0 && (n.audioSampleRate = x.sampleRate, n.audioChanCount = x.channelCount);
  let a = 0, r = 0;
  if (t.length > 0)
    for (let o = t.length - 1; o >= 0; o--) {
      const c = t[o];
      if (!c.deleted) a = Math.max(a, c.cts + c.duration);
    }
  if (e.length > 0) {
    const o = e.at(-1);
    r = o.cts + o.duration;
  }
  return n.duration = Math.max(a, r), n;
}
function Ut(s, t, e, i, n) {
  return {
    audioFrameFinder: n === 0 || s.audio == null || i.length === 0 ? null : new $t(
      t,
      i,
      s.audio,
      {
        volume: n,
        targetSampleRate: x.sampleRate
      }
    ),
    videoFrameFinder: s.video == null || e.length === 0 ? null : new nt(
      t,
      e,
      s.video
    )
  };
}
async function J(s, t = {}) {
  let e = null;
  const i = { video: null, audio: null };
  let n = [], a = [], r = [];
  const o = {
    perspective: 1,
    rotationRad: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0
  };
  let c = -1, l = -1;
  const h = await s.createReader();
  await Ot(
    h,
    async (d) => {
      e = d.info;
      const y = d.mp4boxFile.ftyp;
      r.push({ start: y.start, size: y.size });
      const m = d.mp4boxFile.moov;
      r.push({ start: m.start, size: m.size }), Object.assign(o, zt(e.videoTracks[0]?.matrix));
      let { videoDecoderConf: f, audioDecoderConf: w } = W(
        d.mp4boxFile,
        d.info
      );
      if (i.video = f ?? null, i.audio = w ?? null, f == null && w == null && C.error("MP4Clip no video and audio track"), w != null) {
        const { supported: p } = await AudioDecoder.isConfigSupported(w);
        p || C.error(`MP4Clip audio codec is not supported: ${w.codec}`);
      }
      if (f != null) {
        const { supported: p } = await VideoDecoder.isConfigSupported(f);
        p || C.error(`MP4Clip video codec is not supported: ${f.codec}`);
      }
      C.info(
        "mp4BoxFile moov ready",
        {
          ...d.info,
          tracks: null,
          videoTracks: null,
          audioTracks: null
        },
        i
      );
    },
    (d, y, m) => {
      if (y === "video") {
        c === -1 && (c = m[0].dts);
        for (const f of m)
          n.push(Q(f, c, "video"));
      } else if (y === "audio" && t.audio) {
        l === -1 && (l = m[0].dts);
        for (const f of m)
          a.push(Q(f, l, "audio"));
      }
    }
  ), await h.close();
  const u = n.at(-1) ?? a.at(-1);
  if (e == null)
    throw Error("MP4Clip stream is done, but not emit ready");
  if (u == null)
    throw Error("MP4Clip stream not contain any sample");
  return L(n), C.info("mp4 stream parsed"), {
    videoSamples: n,
    audioSamples: a,
    decoderConf: i,
    headerBoxPos: r,
    parsedMatrix: o
  };
}
function Q(s, t = 0, e) {
  let i = s.offset;
  const n = e === "video" && s.is_sync ? jt(s.data, s.description.type) : -1;
  let a = s.size;
  return n > 0 && (i += n, a -= n), {
    ...s,
    is_idr: n >= 0,
    offset: i,
    size: a,
    cts: (s.cts - t) / s.timescale * 1e6,
    dts: (s.dts - t) / s.timescale * 1e6,
    duration: s.duration / s.timescale * 1e6,
    timescale: 1e6,
    // 音频数据量可控，直接保存在内存中
    data: e === "video" ? null : s.data
  };
}
class nt {
  constructor(t, e, i) {
    this.localFileReader = t, this.samples = e, this.conf = i;
  }
  #t = null;
  #n = 0;
  #e = { abort: !1, st: performance.now() };
  find = async (t) => {
    (this.#t == null || this.#t.state === "closed" || t <= this.#n || t - this.#n > 3e6) && this.#h(t), this.#e.abort = !0, this.#n = t, this.#e = { abort: !1, st: performance.now() };
    const e = await this.#m(t, this.#t, this.#e);
    return this.#c = 0, e;
  };
  // fix VideoFrame duration is null
  #s = 0;
  #a = !1;
  #r = 0;
  #i = [];
  #o = 0;
  #l = 0;
  #c = 0;
  #d = !1;
  #m = async (t, e, i) => {
    if (e == null || e.state === "closed" || i.abort) return null;
    if (this.#i.length > 0) {
      const n = this.#i[0];
      return t < n.timestamp ? null : (this.#i.shift(), t > n.timestamp + (n.duration ?? 0) ? (n.close(), await this.#m(t, e, i)) : (!this.#d && this.#i.length < 10 && this.#f(e).catch((a) => {
        throw this.#d = !0, this.#h(t), a;
      }), n));
    }
    if (this.#u || this.#o < this.#l && e.decodeQueueSize > 0) {
      if (performance.now() - i.st > 6e3)
        throw Error(
          `MP4Clip.tick video timeout, ${JSON.stringify(this.#p())}`
        );
      this.#c += 1, await H(15);
    } else {
      if (this.#r >= this.samples.length)
        return null;
      try {
        await this.#f(e);
      } catch (n) {
        throw this.#h(t), n;
      }
    }
    return await this.#m(t, e, i);
  };
  #u = !1;
  #f = async (t) => {
    if (this.#u || t.decodeQueueSize > 600) return;
    let e = this.#r + 1;
    if (e > this.samples.length) return;
    this.#u = !0;
    let i = !1;
    for (; e < this.samples.length; e++) {
      const n = this.samples[e];
      if (!i && !n.deleted && (i = !0), n.is_idr) break;
    }
    if (i) {
      const n = this.samples.slice(this.#r, e);
      if (n[0]?.is_idr !== !0)
        C.warn("First sample not idr frame");
      else {
        const a = performance.now(), r = await st(n, this.localFileReader), o = performance.now() - a;
        if (o > 1e3) {
          const c = n[0], l = n.at(-1), h = l.offset + l.size - c.offset;
          C.warn(
            `Read video samples time cost: ${Math.round(o)}ms, file chunk size: ${h}`
          );
        }
        if (t.state === "closed") return;
        this.#s = r[0]?.duration ?? 0, V(t, r, {
          onDecodingError: (c) => {
            if (this.#a)
              throw c;
            this.#o === 0 && (this.#a = !0, C.warn("Downgrade to software decode"), this.#h());
          }
        }), this.#l += r.length;
      }
    }
    this.#r = e, this.#u = !1;
  };
  #h = (t) => {
    if (this.#u = !1, this.#i.forEach((i) => i.close()), this.#i = [], t == null || t === 0)
      this.#r = 0;
    else {
      let i = 0;
      for (let n = 0; n < this.samples.length; n++) {
        const a = this.samples[n];
        if (a.is_idr && (i = n), !(a.cts < t)) {
          this.#r = i;
          break;
        }
      }
    }
    this.#l = 0, this.#o = 0, this.#t?.state !== "closed" && this.#t?.close();
    const e = {
      ...this.conf,
      ...this.#a ? { hardwareAcceleration: "prefer-software" } : {}
    };
    this.#t = new VideoDecoder({
      output: (i) => {
        if (this.#o += 1, i.timestamp === -1) {
          i.close();
          return;
        }
        let n = i;
        i.duration == null && (n = new VideoFrame(i, {
          duration: this.#s
        }), i.close()), this.#i.push(n);
      },
      error: (i) => {
        if (i.message.includes("Codec reclaimed due to inactivity")) {
          this.#t = null, C.warn(i.message);
          return;
        }
        const n = `VideoFinder VideoDecoder err: ${i.message}, config: ${JSON.stringify(e)}, state: ${JSON.stringify(this.#p())}`;
        throw C.error(n), Error(n);
      }
    }), this.#t.configure(e);
  };
  #p = () => ({
    time: this.#n,
    decState: this.#t?.state,
    decQSize: this.#t?.decodeQueueSize,
    decCusorIdx: this.#r,
    sampleLen: this.samples.length,
    inputCnt: this.#l,
    outputCnt: this.#o,
    cacheFrameLen: this.#i.length,
    softDeocde: this.#a,
    clipIdCnt: X,
    sleepCnt: this.#c,
    memInfo: at()
  });
  destroy = () => {
    this.#t?.state !== "closed" && this.#t?.close(), this.#t = null, this.#e.abort = !0, this.#i.forEach((t) => t.close()), this.#i = [], this.localFileReader.close();
  };
}
function Nt(s, t) {
  for (let e = 0; e < t.length; e++) {
    const i = t[e];
    if (s >= i.cts && s < i.cts + i.duration)
      return e;
    if (i.cts > s) break;
  }
  return 0;
}
class $t {
  constructor(t, e, i, n) {
    this.localFileReader = t, this.samples = e, this.conf = i, this.#t = n.volume, this.#n = n.targetSampleRate;
  }
  #t = 1;
  #n;
  #e = null;
  #s = { abort: !1, st: performance.now() };
  find = async (t) => {
    const e = t <= this.#a || t - this.#a > 1e5;
    (this.#e == null || this.#e.state === "closed" || e) && this.#d(), e && (this.#a = t, this.#r = Nt(t, this.samples)), this.#s.abort = !0;
    const i = t - this.#a;
    this.#a = t, this.#s = { abort: !1, st: performance.now() };
    const n = await this.#l(
      Math.ceil(i * (this.#n / 1e6)),
      this.#e,
      this.#s
    );
    return this.#o = 0, n;
  };
  #a = 0;
  #r = 0;
  #i = {
    frameCnt: 0,
    data: []
  };
  #o = 0;
  #l = async (t, e = null, i) => {
    if (e == null || i.abort || e.state === "closed" || t === 0)
      return [];
    const n = this.#i.frameCnt - t;
    if (n > 0)
      return n < x.sampleRate / 10 && this.#c(e), K(this.#i, t);
    if (e.decoding) {
      if (performance.now() - i.st > 3e3)
        throw i.abort = !0, Error(
          `MP4Clip.tick audio timeout, ${JSON.stringify(this.#m())}`
        );
      this.#o += 1, await H(15);
    } else {
      if (this.#r >= this.samples.length - 1)
        return K(this.#i, this.#i.frameCnt);
      this.#c(e);
    }
    return this.#l(t, e, i);
  };
  #c = (t) => {
    if (t.decodeQueueSize > 10) return;
    const i = [];
    let n = this.#r;
    for (; n < this.samples.length; ) {
      const a = this.samples[n];
      if (n += 1, !a.deleted && (i.push(a), i.length >= 10))
        break;
    }
    this.#r = n, t.decode(
      i.map(
        (a) => new EncodedAudioChunk({
          type: "key",
          timestamp: a.cts,
          duration: a.duration,
          data: a.data
        })
      )
    );
  };
  #d = () => {
    this.#a = 0, this.#r = 0, this.#i = {
      frameCnt: 0,
      data: []
    }, this.#e?.close(), this.#e = Ht(
      this.conf,
      {
        resampleRate: x.sampleRate,
        volume: this.#t
      },
      (t) => {
        this.#i.data.push(t), this.#i.frameCnt += t[0].length;
      }
    );
  };
  #m = () => ({
    time: this.#a,
    decState: this.#e?.state,
    decQSize: this.#e?.decodeQueueSize,
    decCusorIdx: this.#r,
    sampleLen: this.samples.length,
    pcmLen: this.#i.frameCnt,
    clipIdCnt: X,
    sleepCnt: this.#o,
    memInfo: at()
  });
  destroy = () => {
    this.#e = null, this.#s.abort = !0, this.#i = {
      frameCnt: 0,
      data: []
    }, this.localFileReader.close();
  };
}
function Ht(s, t, e) {
  let i = 0, n = 0;
  const a = (h) => {
    if (n += 1, h.length !== 0) {
      if (t.volume !== 1)
        for (const u of h)
          for (let d = 0; d < u.length; d++) u[d] *= t.volume;
      h.length === 1 && (h = [h[0], h[0]]), e(h);
    }
  }, r = Wt(a), o = t.resampleRate !== s.sampleRate;
  let c = new AudioDecoder({
    output: (h) => {
      const u = et(h);
      o ? r(
        () => Pt(u, h.sampleRate, {
          rate: t.resampleRate,
          chanCount: h.numberOfChannels
        })
      ) : a(u), h.close();
    },
    error: (h) => {
      h.message.includes("Codec reclaimed due to inactivity") || l("MP4Clip AudioDecoder err", h);
    }
  });
  c.configure(s);
  function l(h, u) {
    const d = `${h}: ${u.message}, state: ${JSON.stringify(
      {
        qSize: c.decodeQueueSize,
        state: c.state,
        inputCnt: i,
        outputCnt: n
      }
    )}`;
    throw C.error(d), Error(d);
  }
  return {
    decode(h) {
      i += h.length;
      try {
        for (const u of h) c.decode(u);
      } catch (u) {
        l("decode audio chunk error", u);
      }
    },
    close() {
      c.state !== "closed" && c.close();
    },
    get decoding() {
      return i > n && c.decodeQueueSize > 0;
    },
    get state() {
      return c.state;
    },
    get decodeQueueSize() {
      return c.decodeQueueSize;
    }
  };
}
function Wt(s) {
  const t = [];
  let e = 0;
  function i(r, o) {
    t[o] = r, n();
  }
  function n() {
    const r = t[e];
    r != null && (s(r), e += 1, n());
  }
  let a = 0;
  return (r) => {
    const o = a;
    a += 1, r().then((c) => i(c, o)).catch((c) => i(c, o));
  };
}
function K(s, t) {
  const e = [new Float32Array(t), new Float32Array(t)];
  let i = 0, n = 0;
  for (; n < s.data.length; ) {
    const [a, r] = s.data[n];
    if (i + a.length > t) {
      const o = t - i;
      e[0].set(a.subarray(0, o), i), e[1].set(r.subarray(0, o), i), s.data[n][0] = a.subarray(o, a.length), s.data[n][1] = r.subarray(o, r.length);
      break;
    } else
      e[0].set(a, i), e[1].set(r, i), i += a.length, n++;
  }
  return s.data = s.data.slice(n), s.frameCnt -= t, e;
}
async function st(s, t) {
  const e = s[0], i = s.at(-1);
  if (i == null) return [];
  const n = i.offset + i.size - e.offset;
  if (n < 3e7) {
    const a = new Uint8Array(
      await t.read(n, { at: e.offset })
    );
    return s.map((r) => {
      const o = r.offset - e.offset;
      return new EncodedVideoChunk({
        type: r.is_sync ? "key" : "delta",
        timestamp: r.cts,
        duration: r.duration,
        data: a.subarray(o, o + r.size)
      });
    });
  }
  return await Promise.all(
    s.map(async (a) => new EncodedVideoChunk({
      type: a.is_sync ? "key" : "delta",
      timestamp: a.cts,
      duration: a.duration,
      data: await t.read(a.size, {
        at: a.offset
      })
    }))
  );
}
function Xt(s, t, e) {
  const i = new OffscreenCanvas(s, t), n = i.getContext("2d");
  return async (a) => (n.drawImage(a, 0, 0, s, t), a.close(), await i.convertToBlob(e));
}
function Yt(s, t) {
  if (s.length === 0) return [];
  let e = 0, i = 0, n = -1;
  for (let c = 0; c < s.length; c++) {
    const l = s[c];
    if (n === -1 && t < l.cts && (n = c - 1), l.is_idr)
      if (n === -1)
        e = c;
      else {
        i = c;
        break;
      }
  }
  const a = s[n];
  if (a == null) throw Error("Not found video sample by time");
  const r = s.slice(0, i === 0 ? s.length : i).map((c) => ({ ...c }));
  for (let c = e; c < r.length; c++) {
    const l = r[c];
    t < l.cts && (l.deleted = !0, l.cts = -1);
  }
  L(r);
  const o = s.slice(a.is_idr ? n : e).map((c) => ({ ...c, cts: c.cts - t }));
  for (const c of o)
    c.cts < 0 && (c.deleted = !0, c.cts = -1);
  return L(o), [r, o];
}
function Gt(s, t) {
  if (s.length === 0) return [void 0, void 0];
  if (s[0].cts >= t)
    return [void 0, s.map((r) => ({ ...r }))];
  if (s[s.length - 1].cts < t)
    return [s.map((r) => ({ ...r })), void 0];
  let i = -1;
  for (let r = 0; r < s.length; r++) {
    const o = s[r];
    if (!(t > o.cts)) {
      i = r;
      break;
    }
  }
  if (i === -1) throw Error("Not found audio sample by time");
  const n = s.slice(0, i).map((r) => ({ ...r })), a = s.slice(i).map((r) => ({ ...r, cts: r.cts - t }));
  return [n, a];
}
function V(s, t, e) {
  if (s.state === "configured") {
    for (let i = 0; i < t.length; i++) s.decode(t[i]);
    s.flush().catch((i) => {
      if (!(i instanceof Error)) throw i;
      if (i.message.includes("Decoding error") && e.onDecodingError != null) {
        e.onDecodingError(i);
        return;
      }
      if (!i.message.includes("Aborted due to close"))
        throw i;
    });
  }
}
function jt(s, t) {
  if (t !== "avc1" && t !== "hvc1") return 0;
  const e = new DataView(s.buffer);
  for (let i = 0; i < s.byteLength - 4; ) {
    if (t === "avc1") {
      const n = e.getUint8(i + 4) & 31;
      if (n === 5 || n === 7 || n === 8) return i;
    } else if (t === "hvc1") {
      const n = e.getUint8(i + 4) >> 1 & 63;
      if (n === 19 || n === 20 || n === 32 || n === 33 || n === 34)
        return i;
    }
    i += e.getUint32(i) + 4;
  }
  return -1;
}
async function Jt(s, t, e, i, n, a) {
  const r = await t.createReader(), o = await st(
    s.filter(
      (h) => !h.deleted && h.is_sync && h.cts >= n.start && h.cts <= n.end
    ),
    r
  );
  if (o.length === 0 || i.aborted) {
    a(null, !0);
    return;
  }
  let c = 0;
  V(l(), o, {
    onDecodingError: (h) => {
      C.warn("thumbnailsByKeyFrame", h), c === 0 ? V(l(!0), o, {
        onDecodingError: (u) => {
          r.close(), C.error("thumbnailsByKeyFrame retry soft deocde", u);
        }
      }) : (a(null, !0), r.close());
    }
  });
  function l(h = !1) {
    const u = {
      ...e,
      ...h ? { hardwareAcceleration: "prefer-software" } : {}
    }, d = new VideoDecoder({
      output: (y) => {
        c += 1;
        const m = c === o.length;
        a(y, m), m && (r.close(), d.state !== "closed" && d.close());
      },
      error: (y) => {
        const m = `thumbnails decoder error: ${y.message}, config: ${JSON.stringify(u)}, state: ${JSON.stringify(
          {
            qSize: d.decodeQueueSize,
            state: d.state,
            outputCnt: c,
            inputCnt: o.length
          }
        )}`;
        throw C.error(m), Error(m);
      }
    });
    return i.addEventListener("abort", () => {
      r.close(), d.state !== "closed" && d.close();
    }), d.configure(u), d;
  }
}
function L(s) {
  let t = 0, e = null;
  for (const i of s)
    if (!i.deleted) {
      if (i.is_sync && (t += 1), t >= 2) break;
      (e == null || i.cts < e.cts) && (e = i);
    }
  e != null && e.cts < 2e5 && (e.duration += e.cts, e.cts = 0);
}
function at() {
  try {
    const s = performance.memory;
    return {
      jsHeapSizeLimit: s.jsHeapSizeLimit,
      totalJSHeapSize: s.totalJSHeapSize,
      usedJSHeapSize: s.usedJSHeapSize,
      percentUsed: (s.usedJSHeapSize / s.jsHeapSizeLimit).toFixed(3),
      percentTotal: (s.totalJSHeapSize / s.jsHeapSizeLimit).toFixed(3)
    };
  } catch {
    return {};
  }
}
class R {
  ready;
  #t = {
    // 微秒
    duration: 0,
    width: 0,
    height: 0
  };
  /**
   * ⚠️ 静态图片的 duration 为 Infinity
   *
   * 使用 Sprite 包装时需要将它的 duration 设置为有限数
   *
   */
  get meta() {
    return { ...this.#t };
  }
  #n = null;
  #e = [];
  /**
   * 静态图片可使用流、ImageBitmap 初始化
   *
   * 动图需要使用 VideoFrame[] 或提供图片类型
   */
  constructor(t) {
    const e = (i) => (this.#n = i, this.#t.width = i.width, this.#t.height = i.height, this.#t.duration = 1 / 0, { ...this.#t });
    if (t instanceof ReadableStream)
      this.ready = new Response(t).blob().then((i) => createImageBitmap(i)).then(e);
    else if (t instanceof ImageBitmap)
      this.ready = Promise.resolve(e(t));
    else if (Array.isArray(t) && t.every((i) => i instanceof VideoFrame)) {
      this.#e = t;
      const i = this.#e[0];
      if (i == null) throw Error("The frame count must be greater than 0");
      this.#t = {
        width: i.displayWidth,
        height: i.displayHeight,
        duration: this.#e.reduce(
          (n, a) => n + (a.duration ?? 0),
          0
        )
      }, this.ready = Promise.resolve({ ...this.#t, duration: 1 / 0 });
    } else if ("type" in t)
      this.ready = this.#s(
        t.stream,
        t.type
      ).then(() => ({
        width: this.#t.width,
        height: this.#t.height,
        duration: 1 / 0
      }));
    else
      throw Error("Illegal arguments");
  }
  async #s(t, e) {
    this.#e = await Dt(t, e);
    const i = this.#e[0];
    if (i == null) throw Error("No frame available in gif");
    this.#t = {
      duration: this.#e.reduce((n, a) => n + (a.duration ?? 0), 0),
      width: i.codedWidth,
      height: i.codedHeight
    }, C.info("ImgClip ready:", this.#t);
  }
  tickInterceptor = async (t, e) => e;
  async tick(t) {
    if (this.#n != null)
      return await this.tickInterceptor(t, {
        video: await createImageBitmap(this.#n),
        state: "success"
      });
    const e = t % this.#t.duration;
    return await this.tickInterceptor(t, {
      video: (this.#e.find(
        (i) => e >= i.timestamp && e <= i.timestamp + (i.duration ?? 0)
      ) ?? this.#e[0]).clone(),
      state: "success"
    });
  }
  async split(t) {
    if (await this.ready, this.#n != null)
      return [
        new R(await createImageBitmap(this.#n)),
        new R(await createImageBitmap(this.#n))
      ];
    let e = -1;
    for (let a = 0; a < this.#e.length; a++) {
      const r = this.#e[a];
      if (!(t > r.timestamp)) {
        e = a;
        break;
      }
    }
    if (e === -1) throw Error("Not found frame by time");
    const i = this.#e.slice(0, e).map((a) => new VideoFrame(a)), n = this.#e.slice(e).map(
      (a) => new VideoFrame(a, {
        timestamp: a.timestamp - t
      })
    );
    return [new R(i), new R(n)];
  }
  async clone() {
    await this.ready;
    const t = this.#n == null ? this.#e.map((i) => i.clone()) : await createImageBitmap(this.#n), e = new R(t);
    return e.tickInterceptor = this.tickInterceptor, e;
  }
  destroy() {
    C.info("ImgClip destroy"), this.#n?.close(), this.#e.forEach((t) => t.close());
  }
}
class A {
  static ctx = null;
  ready;
  #t = {
    // 微秒
    duration: 0,
    width: 0,
    height: 0
  };
  /**
   * 音频元信息
   *
   * ⚠️ 注意，这里是转换后（标准化）的元信息，非原始音频元信息
   */
  get meta() {
    return {
      ...this.#t,
      sampleRate: x.sampleRate,
      chanCount: 2
    };
  }
  // 使用类型断言来避免 ArrayBufferLike 和 ArrayBuffer 的类型兼容性问题
  #n = new Float32Array();
  #e = new Float32Array();
  /**
   * 获取音频素材完整的 PCM 数据
   */
  getPCMData() {
    return [this.#n, this.#e];
  }
  #s;
  /**
   *
   * @param dataSource 音频文件流
   * @param opts 音频配置，控制音量、是否循环
   */
  constructor(t, e = {}) {
    this.#s = {
      loop: !1,
      volume: 1,
      ...e
    }, this.ready = this.#a(t).then(() => ({
      // audio 没有宽高，无需绘制
      width: 0,
      height: 0,
      duration: e.loop ? 1 / 0 : this.#t.duration
    }));
  }
  async #a(t) {
    A.ctx == null && (A.ctx = new AudioContext({
      sampleRate: x.sampleRate
    }));
    const e = performance.now(), i = t instanceof ReadableStream ? await Kt(t, A.ctx) : t;
    C.info("Audio clip decoded complete:", performance.now() - e);
    const n = this.#s.volume;
    if (n !== 1)
      for (const a of i)
        for (let r = 0; r < a.length; r += 1) a[r] *= n;
    this.#t.duration = i[0].length / x.sampleRate * 1e6, this.#n = i[0], this.#e = i[1] ?? this.#n, C.info(
      "Audio clip convert to AudioData, time:",
      performance.now() - e
    );
  }
  /**
   * 拦截 {@link AudioClip.tick} 方法返回的数据，用于对音频数据二次处理
   * @param time 调用 tick 的时间
   * @param tickRet tick 返回的数据
   *
   * @see [移除视频绿幕背景](https://webav-tech.github.io/WebAV/demo/3_2-chromakey-video)
   */
  tickInterceptor = async (t, e) => e;
  // 微秒
  #r = 0;
  #i = 0;
  /**
   * 返回上次与当前时刻差对应的音频 PCM 数据；
   *
   * 若差值超过 3s 或当前时间小于上次时间，则重置状态
   * @example
   * tick(0) // => []
   * tick(1e6) // => [leftChanPCM(1s), rightChanPCM(1s)]
   *
   */
  async tick(t) {
    if (!this.#s.loop && t >= this.#t.duration)
      return await this.tickInterceptor(t, { audio: [], state: "done" });
    const e = t - this.#r;
    if (t < this.#r || e > 3e6)
      return this.#r = t, this.#i = Math.ceil(
        this.#r / 1e6 * x.sampleRate
      ), await this.tickInterceptor(t, {
        audio: [new Float32Array(0), new Float32Array(0)],
        state: "success"
      });
    this.#r = t;
    const i = Math.ceil(
      e / 1e6 * x.sampleRate
    ), n = this.#i + i, a = this.#s.loop ? [
      z(this.#n, this.#i, n),
      z(this.#e, this.#i, n)
    ] : [
      this.#n.slice(this.#i, n),
      this.#e.slice(this.#i, n)
    ];
    return this.#i = n, await this.tickInterceptor(t, { audio: a, state: "success" });
  }
  /**
   * 按指定时间切割，返回前后两个音频素材
   * @param time 时间，单位微秒
   */
  async split(t) {
    await this.ready;
    const e = Math.ceil(t / 1e6 * x.sampleRate), i = new A(
      this.getPCMData().map((a) => a.slice(0, e)),
      this.#s
    ), n = new A(
      this.getPCMData().map((a) => a.slice(e)),
      this.#s
    );
    return [i, n];
  }
  async clone() {
    await this.ready;
    const t = new A(this.getPCMData(), this.#s);
    return await t.ready, t;
  }
  /**
   * 销毁实例，释放资源
   */
  destroy() {
    this.#n = new Float32Array(0), this.#e = new Float32Array(0), C.info("---- audioclip destroy ----");
  }
  static concatAudioClip = Qt;
}
async function Qt(s, t) {
  const e = [];
  for (const i of s)
    await i.ready, e.push(i.getPCMData());
  return new A(tt(e), t);
}
async function Kt(s, t) {
  const e = await new Response(s).arrayBuffer();
  return $(await t.decodeAudioData(e));
}
class rt {
  static ctx = null;
  ready;
  #t = {
    // 微秒
    duration: 0,
    width: 0,
    height: 0
  };
  get meta() {
    return {
      ...this.#t
    };
  }
  #n = () => {
  };
  /**
   * 实时流的音轨
   */
  audioTrack;
  #e = null;
  #s;
  constructor(t) {
    this.#s = t, this.audioTrack = t.getAudioTracks()[0] ?? null, this.#t.duration = 1 / 0;
    const e = t.getVideoTracks()[0];
    e != null ? (e.contentHint = "motion", this.ready = new Promise((i) => {
      this.#n = qt(e, (n) => {
        this.#t.width = n.width, this.#t.height = n.height, this.#e = n, i(this.meta);
      });
    })) : this.ready = Promise.resolve(this.meta);
  }
  async tick() {
    return {
      video: this.#e == null ? null : await createImageBitmap(this.#e),
      audio: [],
      state: "success"
    };
  }
  async split() {
    return [await this.clone(), await this.clone()];
  }
  async clone() {
    return new rt(this.#s.clone());
  }
  destroy() {
    this.#s.getTracks().forEach((t) => t.stop()), this.#n();
  }
}
function qt(s, t) {
  let e = !1, i;
  return U(
    new MediaStreamTrackProcessor({
      track: s
    }).readable,
    {
      onChunk: async (n) => {
        if (!e) {
          const { displayHeight: a, displayWidth: r } = n, o = r ?? 0, c = a ?? 0, l = new OffscreenCanvas(o, c);
          i = l.getContext("2d"), t(l), e = !0;
        }
        i.drawImage(n, 0, 0), n.close();
      },
      onDone: async () => {
      }
    }
  );
}
class E {
  ready;
  #t = [];
  #n = {
    width: 0,
    height: 0,
    duration: 0
  };
  get meta() {
    return { ...this.#n };
  }
  #e = {
    color: "#FFF",
    textBgColor: null,
    type: "srt",
    fontSize: 30,
    letterSpacing: null,
    bottomOffset: 30,
    fontFamily: "Noto Sans SC",
    strokeStyle: "#000",
    lineWidth: null,
    lineCap: null,
    lineJoin: null,
    textShadow: {
      offsetX: 2,
      offsetY: 2,
      blur: 4,
      color: "#000"
    },
    videoWidth: 1280,
    videoHeight: 720,
    fontWeight: "normal",
    fontStyle: "normal"
  };
  #s;
  #a;
  #r = null;
  #i = 0;
  #o = 0;
  constructor(t, e) {
    if (this.#t = Array.isArray(t) ? t : Zt(t).map(({ start: h, end: u, text: d }) => ({
      start: h * 1e6,
      end: u * 1e6,
      text: d
    })), this.#t.length === 0) throw Error("No subtitles content");
    this.#e = Object.assign(this.#e, e), this.#o = e.textBgColor == null ? 0 : (e.fontSize ?? 50) * 0.2;
    const {
      fontSize: i,
      fontFamily: n,
      fontWeight: a,
      fontStyle: r,
      videoWidth: o,
      videoHeight: c,
      letterSpacing: l
    } = this.#e;
    this.#i = i + this.#o * 2, this.#s = new OffscreenCanvas(o, c), this.#a = this.#s.getContext("2d"), this.#a.font = `${r} ${a} ${i}px ${n}`, this.#a.textAlign = "center", this.#a.textBaseline = "top", this.#a.letterSpacing = l ?? "0px", this.#n = {
      width: o,
      height: c,
      duration: this.#t.at(-1)?.end ?? 0
    }, this.ready = Promise.resolve(this.meta);
  }
  #l(t, e) {
    const i = [];
    let n = "";
    if (/[\u4e00-\u9fff]/.test(t)) {
      for (let r = 0; r < t.length; r++) {
        const o = t[r], c = n + o;
        this.#a.measureText(c).width <= e ? n = c : n ? (i.push(n), n = o) : (i.push(o), n = "");
      }
      n && i.push(n);
    } else {
      const r = t.split(" ");
      for (const o of r) {
        const c = n ? `${n} ${o}` : o;
        this.#a.measureText(c).width <= e ? n = c : n ? (i.push(n), n = o) : i.push(o);
      }
      n && i.push(n);
    }
    return i;
  }
  #c(t) {
    const { width: e, height: i } = this.#s, n = e * 0.9, a = t.split(`
`).flatMap((p) => this.#l(p.trim(), n)).reverse(), {
      color: r,
      fontSize: o,
      textBgColor: c,
      textShadow: l,
      strokeStyle: h,
      lineWidth: u,
      lineCap: d,
      lineJoin: y,
      bottomOffset: m
    } = this.#e, f = this.#a;
    f.clearRect(0, 0, e, i), f.globalAlpha = 0.6;
    let w = m;
    for (const p of a) {
      const g = f.measureText(p), b = e / 2;
      c != null && (f.shadowOffsetX = 0, f.shadowOffsetY = 0, f.shadowBlur = 0, f.fillStyle = c, f.globalAlpha = 0.5, f.fillRect(
        b - g.actualBoundingBoxLeft - this.#o,
        i - w - this.#i,
        g.width + this.#o * 2,
        this.#i
      )), f.shadowColor = l.color, f.shadowOffsetX = l.offsetX, f.shadowOffsetY = l.offsetY, f.shadowBlur = l.blur, f.globalAlpha = 1, h != null && (f.lineWidth = u ?? o / 6, d != null && (f.lineCap = d), y != null && (f.lineJoin = y), f.strokeStyle = h, f.strokeText(
        p,
        b,
        i - w - this.#i + this.#o
      )), f.fillStyle = r, f.fillText(
        p,
        b,
        i - w - this.#i + this.#o
      ), w += this.#i + o * 0.2;
    }
  }
  /**
   * @see {@link IClip.tick}
   */
  async tick(t) {
    if (this.#r != null && t >= this.#r.timestamp && t <= this.#r.timestamp + (this.#r.duration ?? 0))
      return { video: this.#r.clone(), state: "success" };
    let e = 0;
    for (; e < this.#t.length && !(t <= this.#t[e].end); e += 1)
      ;
    const i = this.#t[e] ?? this.#t.at(-1);
    if (t > i.end) return { state: "done" };
    if (t < i.start) {
      this.#a.clearRect(0, 0, this.#s.width, this.#s.height);
      const a = new VideoFrame(this.#s, {
        timestamp: t,
        // 直到下个字幕出现的时机
        duration: i.start - t
      });
      return this.#r?.close(), this.#r = a, { video: a.clone(), state: "success" };
    }
    this.#c(i.text);
    const n = new VideoFrame(this.#s, {
      timestamp: t,
      duration: i.end - t
    });
    return this.#r?.close(), this.#r = n, { video: n.clone(), state: "success" };
  }
  /**
   * @see {@link IClip.split}
   */
  async split(t) {
    await this.ready;
    let e = -1;
    for (let o = 0; o < this.#t.length; o++) {
      const c = this.#t[o];
      if (!(t > c.start)) {
        e = o;
        break;
      }
    }
    if (e === -1) throw Error("Not found subtitle by time");
    const i = this.#t.slice(0, e).map((o) => ({ ...o }));
    let n = i.at(-1), a = null;
    n != null && n.end > t && (a = {
      start: 0,
      end: n.end - t,
      text: n.text
    }, n.end = t);
    const r = this.#t.slice(e).map((o) => ({ ...o, start: o.start - t, end: o.end - t }));
    return a != null && r.unshift(a), [
      new E(i, this.#e),
      new E(r, this.#e)
    ];
  }
  /**
   * @see {@link IClip.clone}
   */
  async clone() {
    return new E(this.#t.slice(0), this.#e);
  }
  /**
   * @see {@link IClip.destroy}
   */
  destroy() {
    this.#r?.close();
  }
}
function q(s) {
  const t = s.match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/);
  if (t == null) throw Error(`time format error: ${s}`);
  const e = Number(t[1]), i = Number(t[2]), n = Number(t[3]), a = Number(t[4]);
  return e * 60 * 60 + i * 60 + n + a / 1e3;
}
function Zt(s) {
  return s.split(/\r|\n/).map((t) => t.trim()).filter((t) => t.length > 0).map((t) => ({
    lineStr: t,
    match: t.match(
      /(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})/
    )
  })).filter(
    ({ lineStr: t }, e, i) => !(/^\d+$/.test(t) && i[e + 1]?.match != null)
  ).reduce(
    (t, { lineStr: e, match: i }) => {
      if (i == null) {
        const n = t.at(-1);
        if (n == null) return t;
        n.text += n.text.length === 0 ? e : `
${e}`;
      } else
        t.push({
          start: q(i[1]),
          end: q(i[2]),
          text: ""
        });
      return t;
    },
    []
  );
}
class ot {
  readable;
  writable;
  #t = 0;
  constructor() {
    const t = F.createFile();
    let e = !1;
    this.readable = new ReadableStream(
      {
        start: (i) => {
          t.onReady = (a) => {
            const r = a.videoTracks[0]?.id;
            r != null && t.setExtractionOptions(r, "video", { nbSamples: 100 });
            const o = a.audioTracks[0]?.id;
            o != null && t.setExtractionOptions(o, "audio", { nbSamples: 100 }), i.enqueue({ chunkType: "ready", data: { info: a, file: t } }), t.start();
          };
          const n = {};
          t.onSamples = (a, r, o) => {
            i.enqueue({
              chunkType: "samples",
              data: { id: a, type: r, samples: o.map((c) => ({ ...c })) }
            }), n[a] = (n[a] ?? 0) + o.length, t.releaseUsedSamples(a, n[a]);
          }, t.onFlush = () => {
            i.close();
          };
        },
        cancel: () => {
          t.stop(), e = !0;
        }
      },
      {
        // 每条消息 100 个 samples
        highWaterMark: 50
      }
    ), this.writable = new WritableStream({
      write: async (i) => {
        if (e) {
          this.writable.abort();
          return;
        }
        const n = i.buffer;
        n.fileStart = this.#t, this.#t += n.byteLength, t.appendBuffer(n);
      },
      close: () => {
        t.flush(), t.stop(), t.onFlush?.();
      }
    });
  }
}
function te(s) {
  let t = 0;
  const e = s.boxes, i = [];
  let n = 0;
  async function a() {
    const m = y(e, t);
    t = e.length, i.forEach(({ track: f, id: w }) => {
      const p = f.samples.at(-1);
      p != null && (n = Math.max(n, p.cts + p.duration)), s.releaseUsedSamples(w, f.samples.length), f.samples = [];
    }), s.mdats = [], s.moofs = [], m != null && await h?.write(m);
  }
  let r = [];
  function o() {
    if (r.length > 0) return !0;
    const m = e.findIndex((f) => f.type === "moov");
    if (m === -1) return !1;
    if (r = e.slice(0, m + 1), t = m + 1, i.length === 0)
      for (let f = 1; ; f += 1) {
        const w = s.getTrackById(f);
        if (w == null) break;
        i.push({ track: w, id: f });
      }
    return !0;
  }
  let c = 0;
  const l = _();
  let h = null;
  const u = (async () => {
    h = await l.createWriter(), c = self.setInterval(() => {
      o() && a();
    }, 100);
  })();
  let d = !1;
  return async () => {
    if (d) throw Error("File exported");
    if (d = !0, await u, clearInterval(c), !o() || h == null) return null;
    s.flush(), await a(), await h?.close();
    const m = r.find((p) => p.type === "moov");
    if (m == null) return null;
    m.mvhd.duration = n;
    const f = _(), w = y(r, 0);
    return await O(f, w), await O(f, l, { overwrite: !1 }), await f.stream();
  };
  function y(m, f) {
    if (f >= m.length) return null;
    const w = new F.DataStream();
    w.endianness = F.DataStream.BIG_ENDIAN;
    for (let p = f; p < m.length; p++)
      m[p] !== null && (m[p].write(w), delete m[p]);
    return new Uint8Array(w.buffer);
  }
}
function ee(s) {
  const t = new ArrayBuffer(s.byteLength);
  s.copyTo(t);
  const e = s.timestamp;
  return {
    duration: s.duration ?? 0,
    dts: e,
    cts: e,
    is_sync: s.type === "key",
    data: t
  };
}
async function ie(s) {
  const t = F.createFile(), e = te(t);
  await ne(s, t);
  const i = await e();
  if (i == null) throw Error("Can not generate file from streams");
  return i;
}
async function ne(s, t) {
  let e = 0, i = 0, n = 0, a = 0, r = 0, o = 0, c = null, l = null;
  for (const h of s) {
    let u = null, d = null, y = null, m = null;
    if (await new Promise(async (f) => {
      U(h.pipeThrough(new ot()), {
        onDone: f,
        onChunk: async ({ chunkType: w, data: p }) => {
          if (w === "ready") {
            const { videoTrackConf: g, audioTrackConf: b } = W(
              p.file,
              p.info
            );
            e === 0 && g != null && (e = t.addTrack(g)), a === 0 && b != null && (a = t.addTrack(b));
          } else if (w === "samples") {
            const { type: g, samples: b } = p, v = g === "video" ? e : a, S = g === "video" ? i : r, D = g === "video" ? n : o;
            b.forEach((T) => {
              let P, M;
              g === "video" ? (u === null && (u = T.dts, d = T.cts), P = T.dts - u, M = T.cts - (d ?? 0)) : (y === null && (y = T.dts, m = T.cts), P = T.dts - y, M = T.cts - (m ?? 0)), t.addSample(v, T.data, {
                duration: T.duration,
                dts: P + S,
                cts: M + D,
                is_sync: T.is_sync
              });
            });
            const k = b.at(-1);
            if (k == null) return;
            g === "video" ? c = k : g === "audio" && (l = k);
          }
        }
      });
    }), c != null && u !== null && d !== null) {
      const f = c.dts - u + c.duration, w = c.cts - d + c.duration;
      i += f, n += w;
    }
    if (l != null && c != null) {
      const f = l.timescale / c.timescale;
      r = Math.round(i * f), o = Math.round(n * f);
    }
  }
}
async function ge(s) {
  return await ie([s]);
}
function se(s) {
  let t = [];
  const e = new AudioDecoder({
    output: (i) => {
      t.push(i);
    },
    error: C.error
  });
  return e.configure(s), {
    decode: async (i) => {
      i.forEach((a) => {
        e.decode(
          new EncodedAudioChunk({
            type: a.is_sync ? "key" : "delta",
            timestamp: 1e6 * a.cts / a.timescale,
            duration: 1e6 * a.duration / a.timescale,
            data: a.data
          })
        );
      }), await e.flush();
      const n = t;
      return t = [], n;
    },
    close: () => {
      e.close();
    }
  };
}
function ae(s, t) {
  const e = {
    codec: s.codec,
    sampleRate: s.sampleRate,
    numberOfChannels: s.numberOfChannels
  }, i = new AudioEncoder({
    output: (r) => {
      t(ee(r));
    },
    error: (r) => {
      C.error("AudioEncoder error:", r, ", config:", e);
    }
  });
  i.configure(e);
  let n = null;
  function a(r, o) {
    return new AudioData({
      timestamp: o,
      numberOfChannels: s.numberOfChannels,
      numberOfFrames: r.length / s.numberOfChannels,
      sampleRate: s.sampleRate,
      format: "f32-planar",
      data: r
    });
  }
  return {
    encode: async (r, o) => {
      n != null && i.encode(a(n.data, n.ts)), n = { data: r, ts: o };
    },
    stop: async () => {
      n != null && (re(n.data, s.numberOfChannels, s.sampleRate), i.encode(a(n.data, n.ts)), n = null), await i.flush(), i.close();
    }
  };
}
function re(s, t, e) {
  const i = s.length - 1, n = Math.min(e / 2, i);
  for (let a = 0; a < n; a++)
    for (let r = 1; r <= t; r++)
      s[Math.floor(i / r) - a] *= a / n;
}
function be(s, t) {
  C.info("mixinMP4AndAudio, opts:", {
    volume: t.volume,
    loop: t.loop
  });
  const e = F.createFile(), { stream: i, stop: n } = Z(e, 500);
  let a = null, r = null, o = [], c = 0, l = 0, h = 0, u = !0, d = x.sampleRate;
  U(s.pipeThrough(new ot()), {
    onDone: async () => {
      await r?.stop(), a?.close(), n();
    },
    onChunk: async ({ chunkType: w, data: p }) => {
      if (w === "ready") {
        const { videoTrackConf: g, audioTrackConf: b, audioDecoderConf: v } = W(p.file, p.info);
        c === 0 && g != null && (c = e.addTrack(g));
        const S = b ?? {
          timescale: 1e6,
          samplerate: d,
          channel_count: x.channelCount,
          hdlr: "soun",
          name: "SoundHandler",
          type: "mp4a"
        };
        l === 0 && (l = e.addTrack(S), d = b?.samplerate ?? d, u = b != null);
        const D = new AudioContext({ sampleRate: d });
        o = $(
          await D.decodeAudioData(
            await new Response(t.stream).arrayBuffer()
          )
        ), v != null && (a = se(v)), r = ae(
          v ?? {
            codec: S.type === "mp4a" ? x.codec : S.type,
            numberOfChannels: S.channel_count,
            sampleRate: S.samplerate
          },
          (k) => e.addSample(l, k.data, k)
        );
      } else if (w === "samples") {
        const { id: g, type: b, samples: v } = p;
        if (b === "video") {
          v.forEach((S) => e.addSample(g, S.data, S)), u || await m(v);
          return;
        }
        b === "audio" && await f(v);
      }
    }
  });
  function y(w) {
    const p = o.map(
      (g) => t.loop ? z(g, h, h + w) : g.slice(h, h + w)
    );
    if (h += w, t.volume !== 1)
      for (const g of p)
        for (let b = 0; b < g.length; b++) g[b] *= t.volume;
    return p;
  }
  async function m(w) {
    const p = w[0], g = w[w.length - 1], b = Math.floor(
      (g.cts + g.duration - p.cts) / g.timescale * d
    ), v = j([y(b)]);
    v.length !== 0 && r?.encode(
      v,
      p.cts / p.timescale * 1e6
    );
  }
  async function f(w) {
    if (a == null) return;
    const p = (await a.decode(w)).map(
      et
    ), g = tt(p), b = y(g[0].length), v = w[0];
    r?.encode(
      // 2. 混合输入的音频
      j([g, b]),
      v.cts / v.timescale * 1e6
    );
  }
  return i;
}
let oe = 0;
async function ct(s) {
  s() > 50 && (await H(15), await ct(s));
}
class xe {
  /**
   * 检测当前环境的兼容性
   * @param args.videoCodec 指定视频编码格式，默认 avc1.42E032
   * @param args.width 指定视频宽度，默认 1920
   * @param args.height 指定视频高度，默认 1080
   * @param args.bitrate 指定视频比特率，默认 5e6
   */
  static async isSupported(t = {}) {
    return (self.OffscreenCanvas != null && self.VideoEncoder != null && self.VideoDecoder != null && self.VideoFrame != null && self.AudioEncoder != null && self.AudioDecoder != null && self.AudioData != null && ((await self.VideoEncoder.isConfigSupported({
      codec: t.videoCodec ?? "avc1.42E032",
      width: t.width ?? 1920,
      height: t.height ?? 1080,
      bitrate: t.bitrate ?? 7e6
    })).supported ?? !1) && (await self.AudioEncoder.isConfigSupported({
      codec: x.codec,
      sampleRate: x.sampleRate,
      numberOfChannels: x.channelCount
    })).supported) ?? !1;
  }
  #t = C.create(`id:${oe++},`);
  #n = !1;
  #e = [];
  #s;
  #a;
  // 中断输出
  #r = null;
  #i;
  #o;
  #l = new N();
  on = this.#l.on;
  /**
   * 根据配置创建合成器实例
   * @param opts ICombinatorOpts
   */
  constructor(t = {}) {
    const { width: e = 0, height: i = 0 } = t;
    this.#s = new OffscreenCanvas(e, i);
    const n = this.#s.getContext("2d", { alpha: !1 });
    if (n == null) throw Error("Can not create 2d offscreen context");
    this.#a = n, this.#i = Object.assign(
      {
        bgColor: "#000",
        width: 0,
        height: 0,
        videoCodec: "avc1.42E032",
        audio: !0,
        bitrate: 5e6,
        fps: 30,
        metaDataTags: null
      },
      t
    ), this.#o = e * i > 0;
  }
  /**
   * 添加用于合成视频的 Sprite，视频时长默认取所有素材 duration 字段的最大值
   * @param os Sprite
   * @param opts.main 如果 main 为 true，视频时长为该素材的 duration 值
   */
  async addSprite(t, e = {}) {
    const i = {
      rect: de(["x", "y", "w", "h"], t.rect),
      time: { ...t.time },
      zIndex: t.zIndex
    };
    this.#t.info("Combinator add sprite", i);
    const n = await t.clone();
    this.#t.info("Combinator add sprite ready"), this.#e.push(
      Object.assign(n, {
        main: e.main ?? !1,
        expired: !1
      })
    ), this.#e.sort((a, r) => a.zIndex - r.zIndex);
  }
  #c(t) {
    const { fps: e, width: i, height: n, videoCodec: a, bitrate: r, audio: o, metaDataTags: c } = this.#i;
    return ft({
      video: this.#o ? {
        width: i,
        height: n,
        expectFPS: e,
        codec: a,
        bitrate: r,
        __unsafe_hardwareAcceleration__: this.#i.__unsafe_hardwareAcceleration__
      } : null,
      audio: o === !1 ? null : {
        codec: "aac",
        sampleRate: x.sampleRate,
        channelCount: x.channelCount
      },
      duration: t,
      metaDataTags: c
    });
  }
  /**
   * 输出视频文件二进制流
   * @param opts.maxTime 允许输出视频的最大时长，超过时长的素材内容会被忽略
   */
  output(t = {}) {
    if (this.#e.length === 0) throw Error("No sprite added");
    const e = this.#e.find((l) => l.main), i = t.maxTime ?? (e != null ? e.time.offset + e.time.duration : Math.max(
      ...this.#e.map((l) => l.time.offset + l.time.duration)
    ));
    if (i === 1 / 0)
      throw Error(
        "Unable to determine the end time, please specify a main sprite, or limit the duration of ImgClip, AudioCli"
      );
    i === -1 && this.#t.warn(
      "Unable to determine the end time, process value don't update"
    ), this.#t.info(`start combinate video, maxTime:${i}`);
    const n = this.#c(i);
    let a = performance.now();
    const r = this.#d(n, i, {
      onProgress: (l) => {
        this.#t.debug("OutputProgress:", l), this.#l.emit("OutputProgress", l);
      },
      onEnded: async () => {
        await n.flush(), this.#t.info(
          "===== output ended =====, cost:",
          performance.now() - a
        ), this.#l.emit("OutputProgress", 1), this.destroy();
      },
      onError: (l) => {
        this.#l.emit("error", l), c(l), this.destroy();
      }
    });
    this.#r = () => {
      r(), n.close(), c();
    };
    const { stream: o, stop: c } = Z(
      n.mp4file,
      500,
      this.destroy
    );
    return o;
  }
  /**
   * 销毁实例，释放资源
   */
  destroy() {
    this.#n || (this.#n = !0, this.#r?.(), this.#l.destroy());
  }
  #d(t, e, {
    onProgress: i,
    onEnded: n,
    onError: a
  }) {
    let r = 0;
    const o = { aborted: !1 };
    let c = null;
    (async () => {
      const { fps: d, bgColor: y, audio: m } = this.#i, f = Math.round(1e6 / d), w = this.#a, p = ce({
        ctx: w,
        bgColor: y,
        sprites: this.#e,
        aborter: o
      }), g = le({
        remux: t,
        ctx: w,
        cvs: this.#s,
        outputAudio: m,
        hasVideoTrack: this.#o,
        timeSlice: f,
        fps: d
      });
      let b = 0;
      for (; ; ) {
        if (c != null) return;
        if (o.aborted || e !== -1 && b > e || this.#e.length === 0) {
          u(), await n();
          return;
        }
        r = b / e;
        const { audios: v, mainSprDone: S } = await p(b);
        if (S) {
          u(), await n();
          return;
        }
        if (o.aborted) return;
        g(b, v), b += f, await ct(t.getEncodeQueueSize);
      }
    })().catch((d) => {
      c = d, this.#t.error(d), u(), a(d);
    });
    const h = setInterval(() => {
      i(r);
    }, 500), u = () => {
      o.aborted || (o.aborted = !0, clearInterval(h), this.#e.forEach((d) => d.destroy()));
    };
    return u;
  }
}
function ce(s) {
  const { ctx: t, bgColor: e, sprites: i, aborter: n } = s, { width: a, height: r } = t.canvas;
  return async (o) => {
    t.fillStyle = e, t.fillRect(0, 0, a, r);
    const c = [];
    let l = !1;
    for (const h of i) {
      if (n.aborted) break;
      if (o < h.time.offset || h.expired) continue;
      t.save();
      const { audio: u, done: d } = await h.offscreenRender(t, o - h.time.offset);
      c.push(u), t.restore(), (h.time.duration > 0 && o > h.time.offset + h.time.duration || d) && (h.main && (l = !0), h.destroy(), h.expired = !0);
    }
    return {
      audios: c,
      mainSprDone: l
    };
  };
}
function le(s) {
  const { ctx: t, cvs: e, outputAudio: i, remux: n, hasVideoTrack: a, timeSlice: r } = s, { width: o, height: c } = e;
  let l = 0;
  const h = Math.floor(3 * s.fps), u = he(1024);
  return (d, y) => {
    if (i !== !1)
      for (const m of u(d, y)) n.encodeAudio(m);
    if (a) {
      const m = new VideoFrame(e, {
        duration: r,
        timestamp: d
      });
      n.encodeVideo(m, {
        keyFrame: l % h === 0
      }), t.resetTransform(), t.clearRect(0, 0, o, c), l += 1;
    }
  };
}
function he(s) {
  const t = s * x.channelCount, e = new Float32Array(t * 3);
  let i = 0, n = 0;
  const a = s / x.sampleRate * 1e6, r = new Float32Array(t), o = (c) => {
    let l = 0;
    const h = Math.floor(i / t), u = [];
    for (let d = 0; d < h; d++)
      u.push(
        new AudioData({
          timestamp: n,
          numberOfChannels: x.channelCount,
          numberOfFrames: s,
          sampleRate: x.sampleRate,
          format: "f32",
          data: e.subarray(l, l + t)
        })
      ), l += t, n += a;
    for (e.set(e.subarray(l, i), 0), i -= l; c - n > a; )
      u.push(
        new AudioData({
          timestamp: n,
          numberOfChannels: x.channelCount,
          numberOfFrames: s,
          sampleRate: x.sampleRate,
          format: "f32",
          data: r
        })
      ), n += a;
    return u;
  };
  return (c, l) => {
    const h = Math.max(...l.map((u) => u[0]?.length ?? 0));
    for (let u = 0; u < h; u++) {
      let d = 0, y = 0;
      for (let m = 0; m < l.length; m++) {
        const f = l[m][0]?.[u] ?? 0, w = l[m][1]?.[u] ?? f;
        d += f, y += w;
      }
      e[i] = d, e[i + 1] = y, i += 2;
    }
    return o(c);
  };
}
function de(s, t) {
  return s.reduce(
    (e, i) => (e[i] = t[i], e),
    {}
  );
}
class Y {
  #t = new N();
  /**
   * 监听属性变更事件
   * @example
   * rect.on('propsChange', (changedProps) => {})
   */
  on = this.#t.on;
  #n = 0;
  /**
   * x 坐标
   */
  get x() {
    return this.#n;
  }
  set x(t) {
    this.#i("x", t);
  }
  #e = 0;
  get y() {
    return this.#e;
  }
  /**
   * y 坐标
   */
  set y(t) {
    this.#i("y", t);
  }
  #s = 0;
  /**
   * 宽
   */
  get w() {
    return this.#s;
  }
  set w(t) {
    this.#i("w", t);
  }
  #a = 0;
  /**
   * 高
   */
  get h() {
    return this.#a;
  }
  set h(t) {
    this.#i("h", t);
  }
  #r = 0;
  /**
   * 旋转角度
   * @see [MDN Canvas rotate](https://developer.mozilla.org/docs/Web/API/CanvasRenderingContext2D/rotate)
   */
  get angle() {
    return this.#r;
  }
  set angle(t) {
    this.#i("angle", t);
  }
  #i(t, e) {
    const i = this[t] !== e;
    switch (t) {
      case "x":
        this.#n = e;
        break;
      case "y":
        this.#e = e;
        break;
      case "w":
        this.#s = e;
        break;
      case "h":
        this.#a = e;
        break;
      case "angle":
        this.#r = e;
        break;
    }
    i && this.#t.emit("propsChange", { [t]: e });
  }
  /**
   * 如果当前实例是 Rect 控制点之一，`master` 将指向该 Rect
   *
   * 控制点的坐标是相对于它的 `master` 定位
   */
  #o = null;
  constructor(t, e, i, n, a) {
    this.x = t ?? 0, this.y = e ?? 0, this.w = i ?? 0, this.h = n ?? 0, this.#o = a ?? null;
  }
  /**
   * 根据坐标、宽高计算出来的矩形中心点
   */
  get center() {
    const { x: t, y: e, w: i, h: n } = this;
    return { x: t + i / 2, y: e + n / 2 };
  }
  /**
   * 是否保持固定宽高比例，禁止变形缩放
   *
   * 值为 true 时，将缺少上下左右四个控制点
   */
  fixedAspectRatio = !1;
  /**
   * 是否固定中心点进行缩放
   * 值为 true 时，固定中心点不变进行缩放
   * 值为 false 时，固定对角点不变进行缩放
   */
  fixedScaleCenter = !1;
  clone() {
    const { x: t, y: e, w: i, h: n } = this, a = new Y(t, e, i, n, this.#o);
    return a.angle = this.angle, a.fixedAspectRatio = this.fixedAspectRatio, a.fixedScaleCenter = this.fixedScaleCenter, a;
  }
  /**
   * 检测目标坐标是否命中当前实例
   * @param tx 目标点 x 坐标
   * @param ty 目标点 y 坐标
   */
  checkHit(t, e) {
    let { angle: i, center: n, x: a, y: r, w: o, h: c } = this;
    const l = this.#o?.center ?? n, h = this.#o?.angle ?? i;
    this.#o == null && (a = a - l.x, r = r - l.y);
    const u = t - l.x, d = e - l.y;
    let y = u, m = d;
    return h !== 0 && (y = u * Math.cos(h) + d * Math.sin(h), m = d * Math.cos(h) - u * Math.sin(h)), !(y < a || y > a + o || m < r || m > r + c);
  }
}
class lt {
  /**
   * 控制素材在视频中的空间属性（坐标、旋转、缩放）
   */
  rect = new Y();
  /**
   * 控制素材在的时间偏移、时长、播放速率，常用于剪辑场景时间轴（轨道）模块
   * duration 不能大于引用 {@link IClip} 的时长，单位 微秒
   *
   * playbackRate 控制当前素材的播放速率，1 表示正常播放；
   * **注意**
   *    1. 设置 playbackRate 时需要主动修正 duration
   *    2. 音频使用最简单的插值算法来改变速率，所以改变速率后音调会产生变化，自定义算法请使用 {@link MP4Clip.tickInterceptor} 配合实现
   *
   */
  #t = {
    offset: 0,
    duration: 0,
    playbackRate: 1
  };
  get time() {
    return this.#t;
  }
  set time(t) {
    Object.assign(this.#t, t);
  }
  #n = new N();
  /**
   * 监听属性变更事件
   * @example
   * sprite.on('propsChange', (changedProps) => {})
   */
  on = this.#n.on;
  #e = 0;
  get zIndex() {
    return this.#e;
  }
  /**
   * 控制素材间的层级关系，zIndex 值较小的素材会被遮挡
   */
  set zIndex(t) {
    const e = this.#e !== t;
    this.#e = t, e && this.#n.emit("propsChange", { zIndex: t });
  }
  /**
   * 不透明度
   */
  opacity = 1;
  /**
   * 水平或垂直方向翻转素材
   */
  flip = null;
  #s = null;
  #a = null;
  /**
   * @see {@link IClip.ready}
   */
  ready = Promise.resolve();
  constructor() {
    this.rect.on("propsChange", (t) => {
      this.#n.emit("propsChange", { rect: t });
    });
  }
  _render(t) {
    const {
      rect: { center: e, angle: i }
    } = this;
    t.setTransform(
      // 水平 缩放、倾斜
      this.flip === "horizontal" ? -1 : 1,
      0,
      // 垂直 倾斜、缩放
      0,
      this.flip === "vertical" ? -1 : 1,
      // 坐标原点偏移 x y
      e.x,
      e.y
    ), t.rotate((this.flip == null ? 1 : -1) * i), t.globalAlpha = this.opacity;
  }
  /**
   * 给素材添加动画，使用方法参考 css animation
   *
   * @example
   * sprite.setAnimation(
   *   {
   *     '0%': { x: 0, y: 0 },
   *     '25%': { x: 1200, y: 680 },
   *     '50%': { x: 1200, y: 0 },
   *     '75%': { x: 0, y: 680 },
   *     '100%': { x: 0, y: 0 },
   *   },
   *   { duration: 4e6, iterCount: 1 },
   * );
   *
   * @see [视频水印动画](https://webav-tech.github.io/WebAV/demo/2_1-concat-video)
   */
  setAnimation(t, e) {
    this.#s = Object.entries(t).map(([i, n]) => {
      const a = { from: 0, to: 100 }[i] ?? Number(i.slice(0, -1));
      if (isNaN(a) || a > 100 || a < 0)
        throw Error("keyFrame must between 0~100");
      return [a / 100, n];
    }), this.#a = Object.assign({}, this.#a, {
      duration: e.duration,
      delay: e.delay ?? 0,
      iterCount: e.iterCount ?? 1 / 0
    });
  }
  /**
   * 如果当前 sprite 已被设置动画，将 sprite 的动画属性设定到指定时间的状态
   */
  animate(t) {
    if (this.#s == null || this.#a == null || t < this.#a.delay)
      return;
    const e = ue(
      t,
      this.#s,
      this.#a
    );
    for (const i in e)
      switch (i) {
        case "opacity":
          this.opacity = e[i];
          break;
        case "x":
        case "y":
        case "w":
        case "h":
        case "angle":
          this.rect[i] = e[i];
          break;
      }
  }
  /**
   * 将当前 sprite 的属性赋值到目标
   *
   * 用于 clone，或 {@link VisibleSprite} 与 {@link OffscreenSprite} 实例间的类型转换
   */
  copyStateTo(t) {
    t.#s = this.#s, t.#a = this.#a, t.zIndex = this.zIndex, t.opacity = this.opacity, t.flip = this.flip, t.rect = this.rect.clone(), t.time = { ...this.time };
  }
  destroy() {
    this.#n.destroy();
  }
}
function ue(s, t, e) {
  const i = s - e.delay, n = i % e.duration, a = i / e.duration >= e.iterCount || i === e.duration ? 1 : n / e.duration, r = t.findIndex((y) => y[0] >= a);
  if (r === -1) return {};
  const o = t[r - 1], c = t[r], l = c[1];
  if (o == null) return l;
  const h = o[1], u = {}, d = (a - o[0]) / (c[0] - o[0]);
  for (const y in l) {
    const m = y;
    h[m] != null && (u[m] = (l[m] - h[m]) * d + h[m]);
  }
  return u;
}
class ht extends lt {
  #t;
  // 保持最近一帧，若 clip 在当前帧无数据，则绘制最近一帧
  #n = null;
  #e = !1;
  constructor(t) {
    super(), this.#t = t, this.ready = t.ready.then(({ width: e, height: i, duration: n }) => {
      this.rect.w = this.rect.w === 0 ? e : this.rect.w, this.rect.h = this.rect.h === 0 ? i : this.rect.h, this.time.duration = this.time.duration === 0 ? n : this.time.duration;
    });
  }
  /**
   * 绘制素材指定时刻的图像到 canvas 上下文，并返回对应的音频数据
   * @param time 指定时刻，微秒
   */
  async offscreenRender(t, e) {
    const i = e * this.time.playbackRate;
    this.animate(i), super._render(t);
    const { w: n, h: a } = this.rect, { video: r, audio: o, state: c } = await this.#t.tick(i);
    let l = o ?? [];
    if (o != null && this.time.playbackRate !== 1 && (l = o.map(
      (u) => it(u, this.time.playbackRate)
    )), c === "done")
      return {
        audio: l,
        done: !0
      };
    const h = r ?? this.#n;
    return h != null && t.drawImage(h, -n / 2, -a / 2, n, a), r != null && (this.#n?.close(), this.#n = r), {
      audio: l,
      done: !1
    };
  }
  async clone() {
    const t = new ht(await this.#t.clone());
    return await t.ready, this.copyStateTo(t), t;
  }
  destroy() {
    this.#e || (this.#e = !0, C.info("OffscreenSprite destroy"), super.destroy(), this.#n?.close(), this.#n = null, this.#t.destroy());
  }
}
class dt extends lt {
  #t;
  getClip() {
    return this.#t;
  }
  /**
   * 元素是否可见，用于不想删除，期望临时隐藏 Sprite 的场景
   */
  visible = !0;
  /**
   * 控制 Sprite 的交互状态
   * - 'interactive': 可选中，可进行移动、缩放、旋转等所有交互
   * - 'selectable': 仅可选中，但不可进行移动、缩放、旋转等交互
   * - 'disabled': 不可选中，也不可交互
   * @default 'interactive'
   */
  interactable = "interactive";
  constructor(t) {
    super(), this.#t = t, this.ready = t.ready.then(({ width: e, height: i, duration: n }) => {
      this.rect.w = this.rect.w === 0 ? e : this.rect.w, this.rect.h = this.rect.h === 0 ? i : this.rect.h, this.time.duration = this.time.duration === 0 ? n : this.time.duration;
    });
  }
  // 保持最近一帧，若 clip 在当前帧无数据，则绘制最近一帧
  #n = null;
  #e = [];
  #s = !1;
  async #a(t) {
    if (!this.#s) {
      this.#s = !0;
      try {
        const { video: e, audio: i } = await this.#t.tick(
          t * this.time.playbackRate
        );
        if (this.#i) {
          e?.close();
          return;
        }
        e != null && (this.#n?.close(), this.#n = e ?? null), this.#e = i ?? [], i != null && this.time.playbackRate !== 1 && (this.#e = i.map(
          (n) => it(n, this.time.playbackRate)
        ));
      } finally {
        this.#s = !1;
      }
    }
  }
  /**
   * 提前准备指定 time 的帧
   */
  async preFrame(t) {
    this.#r !== t && (await this.#a(t), this.#r = t);
  }
  #r = -1;
  /**
   * 绘制素材指定时刻的图像到 canvas 上下文，并返回对应的音频数据
   * @param time 指定时刻，微秒
   */
  render(t, e) {
    this.animate(e), super._render(t);
    const { w: i, h: n } = this.rect;
    this.#r !== e && this.#a(e), this.#r = e;
    const a = this.#e;
    this.#e = [];
    const r = this.#n;
    return r != null && t.drawImage(r, -i / 2, -n / 2, i, n), { audio: a };
  }
  copyStateTo(t) {
    super.copyStateTo(t), t instanceof dt && (t.visible = this.visible, t.interactable = this.interactable);
  }
  #i = !1;
  destroy() {
    this.#i || (this.#i = !0, C.info("VisibleSprite destroy"), super.destroy(), this.#n?.close(), this.#n = null, this.#t.destroy());
  }
}
export {
  A as AudioClip,
  xe as Combinator,
  E as EmbedSubtitlesClip,
  R as ImgClip,
  Se as Log,
  I as MP4Clip,
  rt as MediaStreamClip,
  ht as OffscreenSprite,
  Y as Rect,
  dt as VisibleSprite,
  we as createChromakey,
  ie as fastConcatMP4,
  ge as fixFMP4Duration,
  be as mixinMP4AndAudio,
  ye as renderTxt2ImgBitmap
};
