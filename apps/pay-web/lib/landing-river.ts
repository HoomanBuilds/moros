const vertexSource = `
attribute vec2 a_position;
varying vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const fragmentSource = `
precision highp float;
uniform sampler2D u_image;
uniform vec2 u_cover;
uniform vec2 u_position;
uniform float u_time;
varying vec2 v_uv;
void main() {
  vec2 uv = v_uv * u_cover + (1.0 - u_cover) * u_position;
  vec2 top = vec2(uv.x, 1.0 - uv.y);
  float depth = smoothstep(0.47, 1.0, top.y);
  float center = mix(0.52, 0.64, depth);
  float width = mix(0.045, 0.27, depth);
  float water = smoothstep(0.49, 0.59, top.y)
    * (1.0 - smoothstep(width * 0.7, width, abs(top.x - center)));
  float wave = sin(top.y * 125.0 - u_time * 0.9 + sin(top.x * 70.0));
  float ripple = sin(top.x * 105.0 + top.y * 65.0 - u_time * 0.7);
  uv.x += water * wave * 0.0019;
  uv.y += water * ripple * 0.0009;
  vec2 camera = vec2(sin(u_time * 0.12), sin(u_time * 0.09)) * 0.0015;
  uv = (uv - 0.5) * 0.995 + 0.5 + camera;
  vec4 color = texture2D(u_image, uv);
  color.rgb += water * wave * ripple * 0.005;
  gl_FragColor = color;
}`;

export function startRiverMotion(image: HTMLImageElement): (() => void) | undefined {
  const host = image.parentElement;
  if (!host || !image.naturalWidth || !("ResizeObserver" in window)) return;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" });
  if (!gl) return;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  };
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!vertex || !fragment || !program || !buffer || !texture) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program) gl.deleteProgram(program);
    if (buffer) gl.deleteBuffer(buffer);
    if (texture) gl.deleteTexture(texture);
    return;
  }

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.deleteTexture(texture);
    return;
  }
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  try {
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
  } catch {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.deleteTexture(texture);
    return;
  }

  const coverUniform = gl.getUniformLocation(program, "u_cover");
  const positionUniform = gl.getUniformLocation(program, "u_position");
  const timeUniform = gl.getUniformLocation(program, "u_time");
  canvas.setAttribute("aria-hidden", "true");
  canvas.dataset.heroMotion = "paused";
  canvas.style.opacity = "0";
  host.append(canvas);
  let disposed = false;
  let visible = false;
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let painted = false;

  const resize = () => {
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2, 1600 / bounds.width, 1000 / bounds.height);
    canvas.width = Math.round(bounds.width * ratio);
    canvas.height = Math.round(bounds.height * ratio);
    gl.viewport(0, 0, canvas.width, canvas.height);
    const aspect = bounds.width / bounds.height;
    const sourceAspect = image.naturalWidth / image.naturalHeight;
    gl.uniform2f(coverUniform, Math.min(aspect / sourceAspect, 1), Math.min(sourceAspect / aspect, 1));
    const [x, y] = getComputedStyle(image).objectPosition.split(" ").map(value => Number.parseFloat(value) / 100);
    gl.uniform2f(positionUniform, x, 1 - y);
  };
  const draw = (now: number) => {
    frame = 0;
    if (disposed || !visible || document.hidden) return;
    if (!last || now - last >= 1000 / 30 - 0.5) {
      elapsed += last ? Math.min((now - last) / 1000, 0.1) : 0;
      last = now;
      gl.uniform1f(timeUniform, elapsed);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      if (!painted) {
        canvas.style.opacity = "1";
        painted = true;
      }
    }
    frame = requestAnimationFrame(draw);
  };
  const sync = () => {
    if (visible && !document.hidden && !disposed) {
      canvas.dataset.heroMotion = "running";
      if (!frame) frame = requestAnimationFrame(draw);
    } else {
      canvas.dataset.heroMotion = "paused";
      cancelAnimationFrame(frame);
      frame = 0;
      last = 0;
    }
  };
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; sync(); });
  const resizing = new ResizeObserver(resize);
  const contextLost = (event: Event) => { event.preventDefault(); canvas.style.opacity = "0"; visible = false; sync(); };
  observer.observe(host);
  resizing.observe(host);
  document.addEventListener("visibilitychange", sync);
  canvas.addEventListener("webglcontextlost", contextLost);
  resize();

  return () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    resizing.disconnect();
    document.removeEventListener("visibilitychange", sync);
    canvas.removeEventListener("webglcontextlost", contextLost);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    gl.deleteProgram(program);
    gl.deleteBuffer(buffer);
    gl.deleteTexture(texture);
    canvas.remove();
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
