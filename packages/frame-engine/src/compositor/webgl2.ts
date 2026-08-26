import type {
  CompositorBackend,
  EvaluationPlan,
  FrameMetricsRecorder,
  GPUFrameSurface,
  NativeYuvFrame
} from '../types.js';

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('WebGL2 could not allocate a shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown shader compile failure';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function requiredUniform(gl: WebGL2RenderingContext, program: WebGLProgram, name: string): WebGLUniformLocation {
  const location = gl.getUniformLocation(program, name);
  if (!location) throw new Error(`missing WebGL2 uniform: ${name}`);
  return location;
}

function flipRows(input: Uint8Array, width: number, height: number): Uint8Array {
  const stride = width * 4;
  const output = new Uint8Array(input.length);
  for (let row = 0; row < height; row += 1) {
    output.set(input.subarray(row * stride, (row + 1) * stride), (height - row - 1) * stride);
  }
  return output;
}

class WebGLSurface implements GPUFrameSurface {
  private closed = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    private readonly gl: WebGL2RenderingContext,
    private readonly metrics: FrameMetricsRecorder
  ) {}

  async readRgba(): Promise<Uint8Array> {
    if (this.closed) throw new Error('cannot read a closed GPU frame surface');
    const gl = this.gl;
    const byteLength = this.width * this.height * 4;
    const pbo = gl.createBuffer();
    if (!pbo) throw new Error('WebGL2 could not allocate a pixel pack buffer');
    const started = performance.now();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    if (!fence) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
      throw new Error('WebGL2 could not allocate a readback fence');
    }
    gl.flush();
    try {
      const deadline = performance.now() + 15_000;
      while (true) {
        const status = gl.clientWaitSync(fence, 0, 0);
        if (status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED) break;
        if (status === gl.WAIT_FAILED) throw new Error('WebGL2 PBO fence wait failed');
        if (performance.now() >= deadline) throw new Error('WebGL2 PBO fence wait timed out');
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
      const raw = new Uint8Array(byteLength);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw);
      const rgba = flipRows(raw, this.width, this.height);
      this.metrics.record('readback', performance.now() - started);
      return rgba;
    } finally {
      gl.deleteSync(fence);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.deleteBuffer(pbo);
    }
  }

  recordSink(elapsedMs: number): void {
    this.metrics.record('sink', elapsedMs);
  }

  close(): void {
    this.closed = true;
  }
}

/** WebGL2 limited-range BT.709 compositor. Phase 1a intentionally accepts one hard-cut winner. */
export class WebGL2Compositor implements CompositorBackend {
  readonly kind = 'webgl2' as const;
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly textures: readonly WebGLTexture[];
  private readonly formatLocation: WebGLUniformLocation;
  private disposed = false;

  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: true
    });
    if (!gl) throw new Error('WebGL2 is unavailable');
    this.gl = gl;

    const vertex = compileShader(gl, gl.VERTEX_SHADER, `#version 300 es
      in vec2 position;
      out vec2 uv;
      void main() {
        uv = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `);
    const fragment = compileShader(gl, gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      precision highp int;
      in vec2 uv;
      out vec4 color;
      uniform sampler2D yPlane;
      uniform sampler2D uPlane;
      uniform sampler2D vPlane;
      uniform int yuvFormat;
      void main() {
        vec2 p = vec2(uv.x, 1.0 - uv.y);
        float y = texture(yPlane, p).r - 16.0 / 255.0;
        vec2 chroma = yuvFormat == 1
          ? texture(uPlane, p).rg
          : vec2(texture(uPlane, p).r, texture(vPlane, p).r);
        float u = chroma.r - 0.5;
        float v = chroma.g - 0.5;
        vec3 rgb = vec3(
          1.164383 * y + 1.792741 * v,
          1.164383 * y - 0.213249 * u - 0.532909 * v,
          1.164383 * y + 2.112402 * u
        );
        color = vec4(clamp(rgb, 0.0, 1.0), 1.0);
      }
    `);
    const program = gl.createProgram();
    if (!program) throw new Error('WebGL2 could not allocate a program');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) ?? 'WebGL2 link failure');
    }
    gl.useProgram(program);
    this.program = program;

    const vertices = gl.createBuffer();
    if (!vertices) throw new Error('WebGL2 could not allocate a vertex buffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

    this.textures = [0, 1, 2].map(unit => {
      const texture = gl.createTexture();
      if (!texture) throw new Error('WebGL2 could not allocate a texture');
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return texture;
    });
    ['yPlane', 'uPlane', 'vPlane'].forEach((name, unit) => {
      gl.uniform1i(requiredUniform(gl, program, name), unit);
    });
    this.formatLocation = requiredUniform(gl, program, 'yuvFormat');
  }

  private upload(unit: number, data: Uint8Array, width: number, height: number, channels = 1): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, this.textures[unit] ?? null);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      channels === 2 ? gl.RG8 : gl.R8,
      width,
      height,
      0,
      channels === 2 ? gl.RG : gl.RED,
      gl.UNSIGNED_BYTE,
      data
    );
  }

  private uploadFrame(frame: NativeYuvFrame): void {
    const chromaWidth = Math.ceil(frame.width / 2);
    const chromaHeight = Math.ceil(frame.height / 2);
    this.upload(0, frame.y, frame.width, frame.height);
    if (frame.format === 'NV12') {
      this.upload(1, frame.uv, chromaWidth, chromaHeight, 2);
      this.upload(2, new Uint8Array([128]), 1, 1);
      this.gl.uniform1i(this.formatLocation, 1);
    } else {
      this.upload(1, frame.u, chromaWidth, chromaHeight);
      this.upload(2, frame.v, chromaWidth, chromaHeight);
      this.gl.uniform1i(this.formatLocation, 0);
    }
  }

  async compose(
    frames: readonly NativeYuvFrame[],
    output: EvaluationPlan['output'],
    metrics: FrameMetricsRecorder
  ): Promise<GPUFrameSurface> {
    if (this.disposed) throw new Error('WebGL2 compositor is disposed');
    if (output.colorSpace !== 'bt709-limited') throw new Error(`unsupported color space: ${output.colorSpace}`);
    if (frames.length !== 1 || !frames[0]) {
      throw new Error(`Phase 1a hard-cut compositor requires exactly one resolved layer; received ${frames.length}`);
    }
    if (this.canvas.width !== output.width) this.canvas.width = output.width;
    if (this.canvas.height !== output.height) this.canvas.height = output.height;
    const gl = this.gl;
    gl.viewport(0, 0, output.width, output.height);
    gl.useProgram(this.program);
    const uploadStarted = performance.now();
    this.uploadFrame(frames[0]);
    metrics.record('upload', performance.now() - uploadStarted);
    const shaderStarted = performance.now();
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.finish();
    metrics.record('shader', performance.now() - shaderStarted);
    return new WebGLSurface(this.canvas, output.width, output.height, gl, metrics);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.gl.deleteProgram(this.program);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
