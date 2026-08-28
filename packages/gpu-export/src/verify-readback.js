export async function hashCanvasFrame(canvas) {
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true });
  if (!gl) throw new Error("verification WebGL2 context is unavailable");
  const bytes = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
