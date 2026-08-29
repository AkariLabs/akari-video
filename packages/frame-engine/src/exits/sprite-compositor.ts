export interface SpriteDraw {
  id: string;
  opacity: number;
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
  /** Canvas-space placement of a cropped texture. Omitted means the full canvas. */
  textureRect?: SpriteTextureRect;
  secondaryId?: string;
  tiles?: readonly SpriteTile[];
}

export interface SpriteTextureRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteTile {
  x: number;
  y: number;
  width: number;
  height: number;
  mix?: number;
  visible?: boolean;
  opacity?: number;
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
}

export type SpriteDrawSectionLabel =
  | 'clear'
  | 'baseUpload'
  | 'baseDraw'
  | 'program'
  | 'bindTexture'
  | 'sampler'
  | 'uniform'
  | 'instanceUpload'
  | 'blend'
  | 'drawArrays'
  | 'flush';

export interface SpriteDrawProbe {
  /** Called around a labelled section of GL work inside compose(). */
  section(label: SpriteDrawSectionLabel, run: () => void): void;
  /** Called once per compose() with draw-call counts only. */
  frame(shape: { plainDraws: number; tileDraws: number; tiles: number }): void;
}

interface NormalizedSpriteDraw {
  id: string;
  opacity: number;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotateDeg: number;
}

interface NormalizedSpriteTile extends Required<Omit<SpriteTile, 'visible'>> {
  visible: boolean;
}

interface SpriteComposeState {
  program: WebGLProgram | null;
  vertexArray: WebGLVertexArrayObject | null;
  blend: boolean | null;
  activeTextureUnit: number | null;
  textures: Map<number, WebGLTexture>;
}

interface SpritePlainInstance {
  transform: Float32Array;
  opacity: number;
  texture: WebGLTexture;
}

interface SpriteTileInstance {
  source: Float32Array;
  destination: readonly [number, number, number, number];
  unitTransform: Float32Array;
  tileTransform: Float32Array;
  mix: number;
  opacity: number;
  base: WebGLTexture;
  highlight: WebGLTexture;
}

type SpriteInstance = SpritePlainInstance | SpriteTileInstance;
type SpriteInstanceKind = 'plain' | 'tile';

interface SpriteInstanceRun {
  kind: SpriteInstanceKind;
  instances: SpriteInstance[];
}

interface SpriteBatchChunk {
  kind: SpriteInstanceKind;
  start: number;
  count: number;
  instances: readonly SpriteInstance[];
  textures: readonly WebGLTexture[];
  units: ReadonlyMap<WebGLTexture, number>;
}

const TILE_INSTANCE_FLOATS = 30;
const TILE_INSTANCE_STRIDE_BYTES = TILE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const TILE_INSTANCE_ATTRIBUTES = [
  { location: 1, size: 4, offset: 0 },
  { location: 2, size: 4, offset: 4 },
  { location: 3, size: 3, offset: 8 },
  { location: 4, size: 3, offset: 11 },
  { location: 5, size: 3, offset: 14 },
  { location: 6, size: 3, offset: 17 },
  { location: 7, size: 3, offset: 20 },
  { location: 8, size: 3, offset: 23 },
  { location: 9, size: 4, offset: 26 }
] as const;

const PLAIN_INSTANCE_FLOATS = 11;
const PLAIN_INSTANCE_STRIDE_BYTES = PLAIN_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT;
const PLAIN_INSTANCE_ATTRIBUTES = [
  { location: 1, size: 3, offset: 0 },
  { location: 2, size: 3, offset: 3 },
  { location: 3, size: 3, offset: 6 },
  { location: 4, size: 2, offset: 9 }
] as const;

function finite(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved)) throw new Error(`${label} must be finite`);
  return resolved;
}

export function normalizeSpriteDraw(draw: SpriteDraw): NormalizedSpriteDraw {
  if (!draw || typeof draw.id !== 'string' || draw.id === '') {
    throw new Error('sprite draw id must be a non-empty string');
  }
  return {
    id: draw.id,
    opacity: Math.max(0, Math.min(1, finite(draw.opacity, 1, 'opacity'))),
    translateX: finite(draw.translateX, 0, 'translateX'),
    translateY: finite(draw.translateY, 0, 'translateY'),
    scaleX: finite(draw.scaleX, 1, 'scaleX'),
    scaleY: finite(draw.scaleY, 1, 'scaleY'),
    rotateDeg: finite(draw.rotateDeg, 0, 'rotateDeg')
  };
}

export function normalizeSpriteTile(tile: SpriteTile): NormalizedSpriteTile {
  if (!tile || !Number.isInteger(tile.x) || !Number.isInteger(tile.y)
      || !Number.isInteger(tile.width) || !Number.isInteger(tile.height)
      || tile.width <= 0 || tile.height <= 0) {
    throw new Error('sprite tile rectangle must use positive integer dimensions');
  }
  return {
    x: tile.x,
    y: tile.y,
    width: tile.width,
    height: tile.height,
    mix: Math.max(0, Math.min(1, finite(tile.mix, 0, 'tile mix'))),
    visible: tile.visible ?? true,
    opacity: Math.max(0, Math.min(1, finite(tile.opacity, 1, 'tile opacity'))),
    translateX: finite(tile.translateX, 0, 'tile translateX'),
    translateY: finite(tile.translateY, 0, 'tile translateY'),
    scaleX: finite(tile.scaleX, 1, 'tile scaleX'),
    scaleY: finite(tile.scaleY, 1, 'tile scaleY'),
    rotateDeg: finite(tile.rotateDeg, 0, 'tile rotateDeg')
  };
}

export function normalizeSpriteTextureRect(
  rect: SpriteTextureRect | undefined,
  canvasWidth: number,
  canvasHeight: number
): SpriteTextureRect {
  if (!Number.isFinite(canvasWidth) || canvasWidth <= 0
      || !Number.isFinite(canvasHeight) || canvasHeight <= 0) {
    throw new Error('sprite compositor dimensions must be positive');
  }
  const value = rect ?? { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  if (!Number.isFinite(value.x) || !Number.isFinite(value.y)
      || !Number.isFinite(value.width) || !Number.isFinite(value.height)
      || value.width <= 0 || value.height <= 0) {
    throw new Error('sprite texture rectangle must use finite positive dimensions');
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}

export function spriteTileSourceRect(
  tile: SpriteTile,
  textureRect: SpriteTextureRect | undefined,
  canvasWidth: number,
  canvasHeight: number
): Float32Array {
  const value = normalizeSpriteTile(tile);
  const texture = normalizeSpriteTextureRect(textureRect, canvasWidth, canvasHeight);
  return new Float32Array([
    (value.x - texture.x) / texture.width,
    (value.y - texture.y) / texture.height,
    value.width / texture.width,
    value.height / texture.height
  ]);
}

/** Column-major clip-space matrix used by the sprite vertex shader. */
export function spriteTransformMatrix(draw: SpriteDraw, width: number, height: number): Float32Array {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('sprite compositor dimensions must be positive');
  }
  const value = normalizeSpriteDraw(draw);
  const radians = value.rotateDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const translateX = value.translateX * 2 / width;
  const translateY = -value.translateY * 2 / height;
  return new Float32Array([
    cosine * value.scaleX, sine * value.scaleX, 0,
    -sine * value.scaleY, cosine * value.scaleY, 0,
    translateX, translateY, 1
  ]);
}

/** Column-major clip-space transform around the center of one pixel tile. */
export function spriteTileMatrix(tile: SpriteTile, width: number, height: number): Float32Array {
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
    throw new Error('sprite compositor dimensions must be positive');
  }
  const value = normalizeSpriteTile(tile);
  const radians = value.rotateDeg * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const a = cosine * value.scaleX;
  const b = sine * value.scaleX;
  const c = -sine * value.scaleY;
  const d = cosine * value.scaleY;
  const centerX = (value.x + value.width / 2) * 2 / width - 1;
  const centerY = 1 - (value.y + value.height / 2) * 2 / height;
  const translatedCenterX = centerX + value.translateX * 2 / width;
  const translatedCenterY = centerY - value.translateY * 2 / height;
  return new Float32Array([
    a, b, 0,
    c, d, 0,
    translatedCenterX - a * centerX - c * centerY,
    translatedCenterY - b * centerX - d * centerY,
    1
  ]);
}

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('sprite compositor could not create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createTexture(gl: WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture();
  if (!texture) throw new Error('sprite compositor could not create texture');
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return texture;
}

export class SpriteCompositor {
  readonly uploadPath = 'direct' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly matrixLocation: WebGLUniformLocation;
  private readonly opacityLocation: WebGLUniformLocation;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly vertexArray: WebGLVertexArrayObject;
  private readonly instanceProgram: WebGLProgram;
  private readonly instanceVertexArray: WebGLVertexArrayObject;
  private readonly instanceBuffer: WebGLBuffer;
  private readonly instanceCanvasLocation: WebGLUniformLocation;
  private readonly plainInstanceProgram: WebGLProgram;
  private readonly plainInstanceVertexArray: WebGLVertexArrayObject;
  private readonly plainInstanceBuffer: WebGLBuffer;
  private readonly textureUnitCount: number;
  private readonly baseTexture: WebGLTexture;
  private readonly sprites = new Map<string, WebGLTexture>();
  private instanceCapacity = 1;
  private instanceData = new Float32Array(TILE_INSTANCE_FLOATS);
  private plainInstanceCapacity = 1;
  private plainInstanceData = new Float32Array(PLAIN_INSTANCE_FLOATS);
  private probe: SpriteDrawProbe | null = null;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, options: { width?: number; height?: number } = {}) {
    this.canvas = canvas;
    if (options.width !== undefined) canvas.width = options.width;
    if (options.height !== undefined) canvas.height = options.height;
    if (canvas.width <= 0 || canvas.height <= 0) throw new Error('sprite compositor canvas must have positive dimensions');
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true
    });
    if (!gl) throw new Error('WebGL2 is unavailable for sprite composition');
    this.gl = gl;
    const maxVertexAttributes = Number(gl.getParameter(gl.MAX_VERTEX_ATTRIBS));
    if (maxVertexAttributes < 10) {
      throw new Error('sprite compositor requires at least 10 vertex attributes');
    }
    const maxTextureImageUnits = Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS));
    this.textureUnitCount = Math.min(16, maxTextureImageUnits);
    if (this.textureUnitCount < 2) {
      throw new Error('sprite compositor requires at least 2 texture image units');
    }
    const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec2 position;
      out vec2 uv;
      uniform mat3 transform;
      void main() {
        uv = vec2(position.x * .5 + .5, .5 - position.y * .5);
        vec3 point = transform * vec3(position, 1.);
        gl_Position = vec4(point.xy, 0., 1.);
      }`);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 uv;
      out vec4 color;
      uniform sampler2D image;
      uniform float opacity;
      void main() {
        vec4 value = texture(image, uv);
        color = vec4(value.rgb, value.a * opacity);
      }`);
    const program = gl.createProgram();
    if (!program) throw new Error('sprite compositor could not create program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'sprite compositor link failed');
    }
    this.program = program;
    gl.useProgram(program);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('sprite compositor could not create vertex buffer');
    this.vertexBuffer = buffer;
    const vertexArray = gl.createVertexArray();
    if (!vertexArray) throw new Error('sprite compositor could not create vertex array');
    this.vertexArray = vertexArray;
    gl.bindVertexArray(vertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    const matrixLocation = gl.getUniformLocation(program, 'transform');
    const opacityLocation = gl.getUniformLocation(program, 'opacity');
    if (!matrixLocation || !opacityLocation) throw new Error('sprite compositor uniforms are unavailable');
    this.matrixLocation = matrixLocation;
    this.opacityLocation = opacityLocation;
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);

    const instanceVertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      layout(location = 0) in vec2 position;
      layout(location = 1) in vec4 aSrc;
      layout(location = 2) in vec4 aDst;
      layout(location = 3) in mat3 aUnit;
      layout(location = 6) in mat3 aTile;
      layout(location = 9) in vec4 aParams;
      uniform vec2 uCanvas;
      out vec2 uv;
      flat out float vMix;
      flat out float vOpacity;
      flat out int vBase;
      flat out int vHighlight;
      void main() {
        vec2 ratio = vec2(position.x * .5 + .5, .5 - position.y * .5);
        uv = aSrc.xy + ratio * aSrc.zw;
        vec2 pixel = aDst.xy + ratio * aDst.zw;
        vec2 clip = vec2(pixel.x * 2. / uCanvas.x - 1., 1. - pixel.y * 2. / uCanvas.y);
        vec3 point = aUnit * aTile * vec3(clip, 1.);
        gl_Position = vec4(point.xy, 0., 1.);
        vMix = aParams.x; vOpacity = aParams.y;
        vBase = int(aParams.z); vHighlight = int(aParams.w);
      }`);
    const samplerDeclarations = Array.from(
      { length: this.textureUnitCount },
      (_, index) => `uniform sampler2D uTexture${index};`
    ).join('\n');
    const samplerBranches = Array.from(
      { length: this.textureUnitCount },
      (_, index) => `if (unit == ${index}) return texture(uTexture${index}, coord);`
    ).join('\n');
    const instanceFragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 uv;
      flat in float vMix;
      flat in float vOpacity;
      flat in int vBase;
      flat in int vHighlight;
      out vec4 color;
      ${samplerDeclarations}
      vec4 sampleUnit(int unit, vec2 coord) {
        ${samplerBranches}
        return vec4(0.);
      }
      void main() {
        vec4 base = sampleUnit(vBase, uv);
        vec4 highlight = sampleUnit(vHighlight, uv);
        color = vec4(mix(base.rgb, highlight.rgb, vMix), base.a * vOpacity);
      }`);
    const instanceProgram = gl.createProgram();
    if (!instanceProgram) throw new Error('sprite compositor could not create instance program');
    gl.attachShader(instanceProgram, instanceVertex);
    gl.attachShader(instanceProgram, instanceFragment);
    gl.linkProgram(instanceProgram);
    gl.deleteShader(instanceVertex);
    gl.deleteShader(instanceFragment);
    if (!gl.getProgramParameter(instanceProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(instanceProgram) ?? 'sprite instance compositor link failed');
    }
    this.instanceProgram = instanceProgram;
    const instanceVertexArray = gl.createVertexArray();
    if (!instanceVertexArray) throw new Error('sprite compositor could not create instance vertex array');
    this.instanceVertexArray = instanceVertexArray;
    const instanceBuffer = gl.createBuffer();
    if (!instanceBuffer) throw new Error('sprite compositor could not create instance buffer');
    this.instanceBuffer = instanceBuffer;
    gl.bindVertexArray(instanceVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, TILE_INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
    for (const attribute of TILE_INSTANCE_ATTRIBUTES) {
      gl.enableVertexAttribArray(attribute.location);
      gl.vertexAttribPointer(
        attribute.location,
        attribute.size,
        gl.FLOAT,
        false,
        TILE_INSTANCE_STRIDE_BYTES,
        attribute.offset * Float32Array.BYTES_PER_ELEMENT
      );
      gl.vertexAttribDivisor(attribute.location, 1);
    }
    gl.bindVertexArray(null);
    const instanceCanvasLocation = gl.getUniformLocation(instanceProgram, 'uCanvas');
    if (!instanceCanvasLocation) throw new Error('sprite instance compositor uniform is unavailable: uCanvas');
    this.instanceCanvasLocation = instanceCanvasLocation;
    gl.useProgram(instanceProgram);
    for (let unit = 0; unit < this.textureUnitCount; unit += 1) {
      gl.uniform1i(gl.getUniformLocation(instanceProgram, `uTexture${unit}`), unit);
    }

    const plainInstanceVertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      layout(location = 0) in vec2 position;
      layout(location = 1) in mat3 aTransform;
      layout(location = 4) in vec2 aParams;
      out vec2 uv;
      flat out float vOpacity;
      flat out int vTexture;
      void main() {
        uv = vec2(position.x * .5 + .5, .5 - position.y * .5);
        vec3 point = aTransform * vec3(position, 1.);
        gl_Position = vec4(point.xy, 0., 1.);
        vOpacity = aParams.x; vTexture = int(aParams.y);
      }`);
    const plainInstanceFragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 uv;
      flat in float vOpacity;
      flat in int vTexture;
      out vec4 color;
      ${samplerDeclarations}
      vec4 sampleUnit(int unit, vec2 coord) {
        ${samplerBranches}
        return vec4(0.);
      }
      void main() {
        vec4 value = sampleUnit(vTexture, uv);
        color = vec4(value.rgb, value.a * vOpacity);
      }`);
    const plainInstanceProgram = gl.createProgram();
    if (!plainInstanceProgram) throw new Error('sprite compositor could not create plain instance program');
    gl.attachShader(plainInstanceProgram, plainInstanceVertex);
    gl.attachShader(plainInstanceProgram, plainInstanceFragment);
    gl.linkProgram(plainInstanceProgram);
    gl.deleteShader(plainInstanceVertex);
    gl.deleteShader(plainInstanceFragment);
    if (!gl.getProgramParameter(plainInstanceProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(plainInstanceProgram) ?? 'sprite plain instance compositor link failed');
    }
    this.plainInstanceProgram = plainInstanceProgram;
    const plainInstanceVertexArray = gl.createVertexArray();
    if (!plainInstanceVertexArray) throw new Error('sprite compositor could not create plain instance vertex array');
    this.plainInstanceVertexArray = plainInstanceVertexArray;
    const plainInstanceBuffer = gl.createBuffer();
    if (!plainInstanceBuffer) throw new Error('sprite compositor could not create plain instance buffer');
    this.plainInstanceBuffer = plainInstanceBuffer;
    gl.bindVertexArray(plainInstanceVertexArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, plainInstanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, PLAIN_INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
    for (const attribute of PLAIN_INSTANCE_ATTRIBUTES) {
      gl.enableVertexAttribArray(attribute.location);
      gl.vertexAttribPointer(
        attribute.location,
        attribute.size,
        gl.FLOAT,
        false,
        PLAIN_INSTANCE_STRIDE_BYTES,
        attribute.offset * Float32Array.BYTES_PER_ELEMENT
      );
      gl.vertexAttribDivisor(attribute.location, 1);
    }
    gl.bindVertexArray(null);
    gl.useProgram(plainInstanceProgram);
    for (let unit = 0; unit < this.textureUnitCount; unit += 1) {
      gl.uniform1i(gl.getUniformLocation(plainInstanceProgram, `uTexture${unit}`), unit);
    }
    this.baseTexture = createTexture(gl);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  /** Verification-only draw-stage probe. Passing null restores the uninstrumented path. */
  setDrawProbe(probe: SpriteDrawProbe | null): void {
    this.probe = probe;
  }

  registerSprite(id: string, source: TexImageSource): void {
    this.assertUsable();
    if (typeof id !== 'string' || id === '') throw new Error('sprite id must be a non-empty string');
    if (this.sprites.has(id)) throw new Error(`sprite already registered: ${id}`);
    const texture = createTexture(this.gl);
    this.upload(texture, source);
    this.sprites.set(id, texture);
  }

  updateSprite(id: string, source: TexImageSource): void {
    this.assertUsable();
    const texture = this.sprites.get(id);
    if (!texture) throw new Error(`unknown sprite: ${id}`);
    this.upload(texture, source);
  }

  releaseSprite(id: string): void {
    this.assertUsable();
    const texture = this.sprites.get(id);
    if (!texture) throw new Error(`unknown sprite: ${id}`);
    this.gl.deleteTexture(texture);
    this.sprites.delete(id);
  }

  compose(base: TexImageSource, draws: readonly SpriteDraw[]): void {
    this.assertUsable();
    const gl = this.gl;
    const probe = this.probe;
    if (probe) {
      let plainDraws = 1;
      let tileDraws = 0;
      let tiles = 0;
      for (const draw of draws) {
        if (draw.tiles !== undefined) {
          tileDraws += 1;
          for (const tile of draw.tiles) {
            if (tile.visible !== false) tiles += 1;
          }
        } else if (draw.textureRect !== undefined) {
          tileDraws += 1;
          tiles += 1;
        } else {
          plainDraws += 1;
        }
      }
      probe.frame({ plainDraws, tileDraws, tiles });
    }
    const state: SpriteComposeState = {
      program: null,
      vertexArray: null,
      blend: null,
      activeTextureUnit: null,
      textures: new Map()
    };
    if (probe) {
      probe.section('clear', () => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      });
      probe.section('baseUpload', () => this.upload(this.baseTexture, base, state));
      probe.section('baseDraw', () => {
        this.draw(this.baseTexture, { id: '__base__', opacity: 1 }, false, state);
      });
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      this.upload(this.baseTexture, base, state);
      this.draw(this.baseTexture, { id: '__base__', opacity: 1 }, false, state);
    }
    const runs = this.buildInstanceRuns(draws);
    if (runs.length > 0) this.drawInstanceRuns(runs, state);
    if (probe) probe.section('flush', () => gl.flush());
    else gl.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteTexture(this.baseTexture);
    for (const texture of this.sprites.values()) this.gl.deleteTexture(texture);
    this.sprites.clear();
    if (this.vertexArray) this.gl.deleteVertexArray?.(this.vertexArray);
    if (this.instanceVertexArray) this.gl.deleteVertexArray?.(this.instanceVertexArray);
    if (this.plainInstanceVertexArray) this.gl.deleteVertexArray?.(this.plainInstanceVertexArray);
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteBuffer(this.instanceBuffer);
    this.gl.deleteBuffer(this.plainInstanceBuffer);
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.instanceProgram);
    this.gl.deleteProgram(this.plainInstanceProgram);
  }

  private upload(texture: WebGLTexture, source: TexImageSource, state?: SpriteComposeState): void {
    const gl = this.gl;
    if (state) this.bindTexture(0, texture, state);
    else {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private draw(texture: WebGLTexture, draw: SpriteDraw, blend: boolean, state: SpriteComposeState): void {
    const gl = this.gl;
    const value = normalizeSpriteDraw(draw);
    this.usePipeline(this.program, this.vertexArray, state);
    this.bindTexture(0, texture, state);
    const transform = spriteTransformMatrix(value, this.canvas.width, this.canvas.height);
    if (this.probe) {
      this.probe.section('uniform', () => {
        gl.uniformMatrix3fv(this.matrixLocation, false, transform);
        gl.uniform1f(this.opacityLocation, value.opacity);
      });
    } else {
      gl.uniformMatrix3fv(this.matrixLocation, false, transform);
      gl.uniform1f(this.opacityLocation, value.opacity);
    }
    this.setBlend(blend, state);
    if (this.probe) this.probe.section('drawArrays', () => gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4));
    else gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private buildInstanceRuns(draws: readonly SpriteDraw[]): SpriteInstanceRun[] {
    const runs: SpriteInstanceRun[] = [];
    let run: SpriteInstanceRun | null = null;
    for (const draw of draws) {
      const kind: SpriteInstanceKind = draw.tiles === undefined && draw.textureRect === undefined
        ? 'plain'
        : 'tile';
      if (!run || run.kind !== kind) {
        run = { kind, instances: [] };
        runs.push(run);
      }
      const base = this.sprites.get(draw.id);
      if (!base) throw new Error(`unknown sprite: ${draw.id}`);
      const unit = normalizeSpriteDraw(draw);
      if (kind === 'plain') {
        run.instances.push({
          transform: spriteTransformMatrix(unit, this.canvas.width, this.canvas.height),
          opacity: unit.opacity,
          texture: base
        });
        continue;
      }
      let highlight = base;
      if (draw.tiles !== undefined && draw.secondaryId !== undefined) {
        const secondary = this.sprites.get(draw.secondaryId);
        if (!secondary) throw new Error(`unknown secondary sprite: ${draw.secondaryId}`);
        highlight = secondary;
      }
      const textureRect = normalizeSpriteTextureRect(
        draw.textureRect,
        this.canvas.width,
        this.canvas.height
      );
      const tiles: readonly SpriteTile[] = draw.tiles !== undefined
        ? draw.tiles
        : draw.textureRect !== undefined
          ? [{ ...draw.textureRect }]
          : [{ x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }];
      const unitTransform = spriteTransformMatrix(unit, this.canvas.width, this.canvas.height);
      for (const tile of tiles) {
        const value = normalizeSpriteTile(tile);
        if (!value.visible) continue;
        run.instances.push({
          source: spriteTileSourceRect(value, textureRect, this.canvas.width, this.canvas.height),
          destination: [value.x, value.y, value.width, value.height],
          unitTransform,
          tileTransform: spriteTileMatrix(value, this.canvas.width, this.canvas.height),
          mix: value.mix,
          opacity: unit.opacity * value.opacity,
          base,
          highlight
        });
      }
    }
    return runs.filter((value) => value.instances.length > 0);
  }

  private drawInstanceRuns(runs: readonly SpriteInstanceRun[], state: SpriteComposeState): void {
    const gl = this.gl;
    const chunks = this.planRunChunks(runs, state);
    const tileCount = chunks
      .filter((chunk) => chunk.kind === 'tile')
      .reduce((sum, chunk) => sum + chunk.count, 0);
    const plainCount = chunks
      .filter((chunk) => chunk.kind === 'plain')
      .reduce((sum, chunk) => sum + chunk.count, 0);
    const tileGrew = this.ensureInstanceCapacity(tileCount);
    const plainGrew = this.ensurePlainInstanceCapacity(plainCount);
    for (const chunk of chunks) {
      for (let localIndex = 0; localIndex < chunk.instances.length; localIndex += 1) {
        const instance = chunk.instances[localIndex]!;
        const index = chunk.start + localIndex;
        if (chunk.kind === 'plain') {
          const plain = instance as SpritePlainInstance;
          const offset = index * PLAIN_INSTANCE_FLOATS;
          this.plainInstanceData.set(plain.transform, offset);
          this.plainInstanceData[offset + 9] = plain.opacity;
          this.plainInstanceData[offset + 10] = chunk.units.get(plain.texture)!;
        } else {
          const tile = instance as SpriteTileInstance;
          const offset = index * TILE_INSTANCE_FLOATS;
          this.instanceData.set(tile.source, offset);
          this.instanceData.set(tile.destination, offset + 4);
          this.instanceData.set(tile.unitTransform, offset + 8);
          this.instanceData.set(tile.tileTransform, offset + 17);
          this.instanceData[offset + 26] = tile.mix;
          this.instanceData[offset + 27] = tile.opacity;
          this.instanceData[offset + 28] = chunk.units.get(tile.base)!;
          this.instanceData[offset + 29] = chunk.units.get(tile.highlight)!;
        }
      }
    }
    if (tileCount > 0) {
      if (this.probe) {
        this.probe.section('instanceUpload', () => {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
          if (tileGrew) gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacity * TILE_INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
          gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, tileCount * TILE_INSTANCE_FLOATS));
        });
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
        if (tileGrew) gl.bufferData(gl.ARRAY_BUFFER, this.instanceCapacity * TILE_INSTANCE_STRIDE_BYTES, gl.DYNAMIC_DRAW);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.instanceData.subarray(0, tileCount * TILE_INSTANCE_FLOATS));
      }
    }
    if (plainCount > 0) {
      if (this.probe) {
        this.probe.section('instanceUpload', () => {
          gl.bindBuffer(gl.ARRAY_BUFFER, this.plainInstanceBuffer);
          if (plainGrew) gl.bufferData(
            gl.ARRAY_BUFFER,
            this.plainInstanceCapacity * PLAIN_INSTANCE_STRIDE_BYTES,
            gl.DYNAMIC_DRAW
          );
          gl.bufferSubData(
            gl.ARRAY_BUFFER,
            0,
            this.plainInstanceData.subarray(0, plainCount * PLAIN_INSTANCE_FLOATS)
          );
        });
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.plainInstanceBuffer);
        if (plainGrew) gl.bufferData(
          gl.ARRAY_BUFFER,
          this.plainInstanceCapacity * PLAIN_INSTANCE_STRIDE_BYTES,
          gl.DYNAMIC_DRAW
        );
        gl.bufferSubData(
          gl.ARRAY_BUFFER,
          0,
          this.plainInstanceData.subarray(0, plainCount * PLAIN_INSTANCE_FLOATS)
        );
      }
    }
    this.setBlend(true, state);
    for (const chunk of chunks) {
      if (chunk.kind === 'plain') {
        this.usePipeline(this.plainInstanceProgram, this.plainInstanceVertexArray, state);
      } else {
        const switchProgram = state.program !== this.instanceProgram;
        this.usePipeline(this.instanceProgram, this.instanceVertexArray, state);
        if (switchProgram) {
          if (this.probe) {
            this.probe.section('uniform', () => {
              gl.uniform2f(this.instanceCanvasLocation, this.canvas.width, this.canvas.height);
            });
          } else {
            gl.uniform2f(this.instanceCanvasLocation, this.canvas.width, this.canvas.height);
          }
        }
      }
      for (const texture of chunk.textures) {
        this.bindTexture(chunk.units.get(texture)!, texture, state);
      }
      this.setInstanceOffset(chunk.kind, chunk.start);
      if (this.probe) {
        this.probe.section('drawArrays', () => {
          gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, chunk.count);
        });
      } else {
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, chunk.count);
      }
    }
  }

  private planRunChunks(
    runs: readonly SpriteInstanceRun[],
    state: SpriteComposeState
  ): SpriteBatchChunk[] {
    const simulated = Array<WebGLTexture | null>(this.textureUnitCount).fill(null);
    for (const [unit, texture] of state.textures) {
      if (unit >= 0 && unit < simulated.length) simulated[unit] = texture;
    }
    const chunks: SpriteBatchChunk[] = [];
    let plainStart = 0;
    let tileStart = 0;
    for (const run of runs) {
      const pending: { instances: SpriteInstance[]; textures: WebGLTexture[] }[] = [];
      let current: { instances: SpriteInstance[]; textures: WebGLTexture[] } | null = null;
      for (const instance of run.instances) {
        const required = run.kind === 'plain'
          ? [(instance as SpritePlainInstance).texture]
          : (instance as SpriteTileInstance).highlight === (instance as SpriteTileInstance).base
            ? [(instance as SpriteTileInstance).base]
            : [(instance as SpriteTileInstance).base, (instance as SpriteTileInstance).highlight];
        const missing = required.filter((texture) => !current?.textures.includes(texture));
        if (current && current.instances.length > 0
            && current.textures.length + missing.length > this.textureUnitCount) {
          pending.push(current);
          current = null;
        }
        if (!current) current = { instances: [], textures: [] };
        for (const texture of required) {
          if (!current.textures.includes(texture)) current.textures.push(texture);
        }
        if (current.textures.length > this.textureUnitCount) {
          throw new Error('sprite compositor texture unit capacity is insufficient');
        }
        current.instances.push(instance);
      }
      if (current && current.instances.length > 0) pending.push(current);
      for (const value of pending) {
        const units = new Map<WebGLTexture, number>();
        const used = new Set<number>();
        for (const texture of value.textures) {
          const unit = simulated.indexOf(texture);
          if (unit >= 0) {
            units.set(texture, unit);
            used.add(unit);
          }
        }
        for (const texture of value.textures) {
          if (units.has(texture)) continue;
          let unit = simulated.findIndex((entry, index) => entry === null && !used.has(index));
          if (unit < 0) unit = simulated.findIndex((_entry, index) => !used.has(index));
          if (unit < 0) throw new Error('sprite compositor texture unit capacity is insufficient');
          units.set(texture, unit);
          used.add(unit);
          simulated[unit] = texture;
        }
        const start = run.kind === 'plain' ? plainStart : tileStart;
        chunks.push({
          kind: run.kind,
          start,
          count: value.instances.length,
          instances: value.instances,
          textures: value.textures,
          units
        });
        if (run.kind === 'plain') plainStart += value.instances.length;
        else tileStart += value.instances.length;
      }
    }
    return chunks;
  }

  private ensureInstanceCapacity(count: number): boolean {
    if (count <= this.instanceCapacity) return false;
    let capacity = this.instanceCapacity;
    while (capacity < count) capacity *= 2;
    this.instanceCapacity = capacity;
    this.instanceData = new Float32Array(capacity * TILE_INSTANCE_FLOATS);
    return true;
  }

  private ensurePlainInstanceCapacity(count: number): boolean {
    if (count <= this.plainInstanceCapacity) return false;
    let capacity = this.plainInstanceCapacity;
    while (capacity < count) capacity *= 2;
    this.plainInstanceCapacity = capacity;
    this.plainInstanceData = new Float32Array(capacity * PLAIN_INSTANCE_FLOATS);
    return true;
  }

  private setInstanceOffset(kind: SpriteInstanceKind, start: number): void {
    const gl = this.gl;
    const stride = kind === 'plain' ? PLAIN_INSTANCE_STRIDE_BYTES : TILE_INSTANCE_STRIDE_BYTES;
    const buffer = kind === 'plain' ? this.plainInstanceBuffer : this.instanceBuffer;
    const attributes = kind === 'plain' ? PLAIN_INSTANCE_ATTRIBUTES : TILE_INSTANCE_ATTRIBUTES;
    const baseOffset = start * stride;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const attribute of attributes) {
      gl.vertexAttribPointer(
        attribute.location,
        attribute.size,
        gl.FLOAT,
        false,
        stride,
        baseOffset + attribute.offset * Float32Array.BYTES_PER_ELEMENT
      );
    }
  }

  private bindTexture(unit: number, texture: WebGLTexture, state: SpriteComposeState): void {
    const gl = this.gl;
    if (state.textures.get(unit) === texture) return;
    const switchActiveTexture = state.activeTextureUnit !== unit;
    if (this.probe) {
      this.probe.section('bindTexture', () => {
        if (switchActiveTexture) gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
      });
    } else {
      if (switchActiveTexture) gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
    }
    if (switchActiveTexture) state.activeTextureUnit = unit;
    state.textures.set(unit, texture);
  }

  private usePipeline(
    program: WebGLProgram,
    vertexArray: WebGLVertexArrayObject,
    state: SpriteComposeState
  ): void {
    const switchProgram = state.program !== program;
    const switchVertexArray = state.vertexArray !== vertexArray;
    if (!switchProgram && !switchVertexArray) return;
    if (this.probe) {
      this.probe.section('program', () => {
        if (switchProgram) this.gl.useProgram(program);
        if (switchVertexArray) this.gl.bindVertexArray(vertexArray);
      });
    } else {
      if (switchProgram) this.gl.useProgram(program);
      if (switchVertexArray) this.gl.bindVertexArray(vertexArray);
    }
    if (switchProgram) state.program = program;
    if (switchVertexArray) state.vertexArray = vertexArray;
  }

  private setBlend(blend: boolean, state: SpriteComposeState): void {
    if (state.blend === blend) return;
    if (this.probe) {
      this.probe.section('blend', () => {
        if (blend) {
          this.gl.enable(this.gl.BLEND);
          this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
        } else {
          this.gl.disable(this.gl.BLEND);
        }
      });
    } else {
      if (blend) {
        this.gl.enable(this.gl.BLEND);
        this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
      } else {
        this.gl.disable(this.gl.BLEND);
      }
    }
    state.blend = blend;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('sprite compositor is disposed');
  }
}
