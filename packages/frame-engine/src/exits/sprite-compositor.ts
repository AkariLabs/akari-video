export interface SpriteDraw {
  id: string;
  opacity: number;
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotateDeg?: number;
}

interface NormalizedSpriteDraw extends Required<SpriteDraw> {}

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
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const matrixLocation = gl.getUniformLocation(program, 'transform');
    const opacityLocation = gl.getUniformLocation(program, 'opacity');
    if (!matrixLocation || !opacityLocation) throw new Error('sprite compositor uniforms are unavailable');
    this.matrixLocation = matrixLocation;
    this.opacityLocation = opacityLocation;
    gl.uniform1i(gl.getUniformLocation(program, 'image'), 0);
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
      this.draw(texture, draw, true);
    }
    gl.flush();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.gl.deleteTexture(this.baseTexture);
    for (const texture of this.sprites.values()) this.gl.deleteTexture(texture);
    this.sprites.clear();
    this.gl.deleteProgram(this.program);
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

  private assertUsable(): void {
    if (this.disposed) throw new Error('sprite compositor is disposed');
  }
}
