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
  private readonly positionLocation: number;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly tileProgram: WebGLProgram;
  private readonly tilePositionLocation: number;
  private readonly tileVertexBuffer: WebGLBuffer;
  private readonly tileUnitLocation: WebGLUniformLocation;
  private readonly tileTransformLocation: WebGLUniformLocation;
  private readonly tileSourceLocation: WebGLUniformLocation;
  private readonly tileDestinationLocation: WebGLUniformLocation;
  private readonly tileMixLocation: WebGLUniformLocation;
  private readonly tileOpacityLocation: WebGLUniformLocation;
  private readonly baseTexture: WebGLTexture;
  private readonly sprites = new Map<string, WebGLTexture>();
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
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    this.positionLocation = position;
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const matrixLocation = gl.getUniformLocation(program, 'transform');
    const opacityLocation = gl.getUniformLocation(program, 'opacity');
    if (!matrixLocation || !opacityLocation) throw new Error('sprite compositor uniforms are unavailable');
    this.matrixLocation = matrixLocation;
    this.opacityLocation = opacityLocation;
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);

    const tileVertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec2 position;
      out vec2 uv;
      uniform vec4 uSrc;
      uniform vec4 uDst;
      uniform vec2 uCanvas;
      uniform mat3 uUnit;
      uniform mat3 uTile;
      void main() {
        vec2 ratio = vec2(position.x * .5 + .5, .5 - position.y * .5);
        uv = uSrc.xy + ratio * uSrc.zw;
        vec2 pixel = uDst.xy + ratio * uDst.zw;
        vec2 clip = vec2(pixel.x * 2. / uCanvas.x - 1., 1. - pixel.y * 2. / uCanvas.y);
        vec3 point = uUnit * uTile * vec3(clip, 1.);
        gl_Position = vec4(point.xy, 0., 1.);
      }`);
    const tileFragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      in vec2 uv;
      out vec4 color;
      uniform sampler2D baseImage;
      uniform sampler2D highlightImage;
      uniform float uMix;
      uniform float uOpacity;
      void main() {
        vec4 base = texture(baseImage, uv);
        vec4 highlight = texture(highlightImage, uv);
        color = vec4(mix(base.rgb, highlight.rgb, uMix), base.a * uOpacity);
      }`);
    const tileProgram = gl.createProgram();
    if (!tileProgram) throw new Error('sprite compositor could not create tile program');
    gl.attachShader(tileProgram, tileVertex);
    gl.attachShader(tileProgram, tileFragment);
    gl.linkProgram(tileProgram);
    gl.deleteShader(tileVertex);
    gl.deleteShader(tileFragment);
    if (!gl.getProgramParameter(tileProgram, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(tileProgram) ?? 'sprite tile compositor link failed');
    }
    this.tileProgram = tileProgram;
    const tileBuffer = gl.createBuffer();
    if (!tileBuffer) throw new Error('sprite compositor could not create tile vertex buffer');
    this.tileVertexBuffer = tileBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, tileBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.tilePositionLocation = gl.getAttribLocation(tileProgram, 'position');
    const requiredUniform = (name: string): WebGLUniformLocation => {
      const location = gl.getUniformLocation(tileProgram, name);
      if (!location) throw new Error(`sprite tile compositor uniform is unavailable: ${name}`);
      return location;
    };
    this.tileUnitLocation = requiredUniform('uUnit');
    this.tileTransformLocation = requiredUniform('uTile');
    this.tileSourceLocation = requiredUniform('uSrc');
    this.tileDestinationLocation = requiredUniform('uDst');
    this.tileMixLocation = requiredUniform('uMix');
    this.tileOpacityLocation = requiredUniform('uOpacity');
    gl.useProgram(tileProgram);
    gl.uniform1i(gl.getUniformLocation(tileProgram, 'baseImage'), 0);
    gl.uniform1i(gl.getUniformLocation(tileProgram, 'highlightImage'), 1);
    gl.uniform2f(gl.getUniformLocation(tileProgram, 'uCanvas'), canvas.width, canvas.height);
    this.baseTexture = createTexture(gl);
    gl.viewport(0, 0, canvas.width, canvas.height);
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
    gl.useProgram(this.program);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.upload(this.baseTexture, base);
    this.draw(this.baseTexture, { id: '__base__', opacity: 1 }, false);
    for (const draw of draws) {
      const texture = this.sprites.get(draw.id);
      if (!texture) throw new Error(`unknown sprite: ${draw.id}`);
      if (draw.tiles !== undefined) {
        const secondary = draw.secondaryId === undefined ? texture : this.sprites.get(draw.secondaryId);
        if (!secondary) throw new Error(`unknown secondary sprite: ${draw.secondaryId}`);
        this.drawTiles(texture, secondary, draw);
      } else if (draw.textureRect !== undefined) {
        this.drawTiles(texture, texture, {
          ...draw,
          tiles: [{ ...draw.textureRect }]
        });
      } else {
        this.draw(texture, draw, true);
      }
    }
    gl.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteTexture(this.baseTexture);
    for (const texture of this.sprites.values()) this.gl.deleteTexture(texture);
    this.sprites.clear();
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteBuffer(this.tileVertexBuffer);
    this.gl.deleteProgram(this.program);
    this.gl.deleteProgram(this.tileProgram);
  }

  private upload(texture: WebGLTexture, source: TexImageSource): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  private draw(texture: WebGLTexture, draw: SpriteDraw, blend: boolean): void {
    const gl = this.gl;
    const value = normalizeSpriteDraw(draw);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniformMatrix3fv(this.matrixLocation, false, spriteTransformMatrix(value, this.canvas.width, this.canvas.height));
    gl.uniform1f(this.opacityLocation, value.opacity);
    if (blend) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    } else {
      gl.disable(gl.BLEND);
    }
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private drawTiles(base: WebGLTexture, secondary: WebGLTexture, draw: SpriteDraw): void {
    const gl = this.gl;
    const unit = normalizeSpriteDraw(draw);
    const textureRect = normalizeSpriteTextureRect(
      draw.textureRect,
      this.canvas.width,
      this.canvas.height
    );
    gl.useProgram(this.tileProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tileVertexBuffer);
    gl.enableVertexAttribArray(this.tilePositionLocation);
    gl.vertexAttribPointer(this.tilePositionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, base);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, secondary);
    gl.uniformMatrix3fv(this.tileUnitLocation, false, spriteTransformMatrix(unit, this.canvas.width, this.canvas.height));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    for (const tile of draw.tiles ?? []) {
      const value = normalizeSpriteTile(tile);
      if (!value.visible) continue;
      const source = spriteTileSourceRect(value, textureRect, this.canvas.width, this.canvas.height);
      gl.uniform4f(this.tileSourceLocation, source[0]!, source[1]!, source[2]!, source[3]!);
      gl.uniform4f(this.tileDestinationLocation, value.x, value.y, value.width, value.height);
      gl.uniformMatrix3fv(this.tileTransformLocation, false, spriteTileMatrix(value, this.canvas.width, this.canvas.height));
      gl.uniform1f(this.tileMixLocation, value.mix);
      gl.uniform1f(this.tileOpacityLocation, unit.opacity * value.opacity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.activeTexture(gl.TEXTURE0);
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('sprite compositor is disposed');
  }
}
