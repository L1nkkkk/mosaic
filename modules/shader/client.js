import { field, fields } from '../../web/ui.js';
export { validate } from './definition.js';
export function edit({ data, change }) {
  const controls = fields(field('标题', data.title, title => change({ title }), { maxLength: 100 }));
  for (const [key, label, max] of [['speed', '流动速度', 2], ['hue', '色相', 1]]) {
    const wrap = document.createElement('label'); wrap.className = 'field'; wrap.textContent = label;
    const input = document.createElement('input'); input.type = 'range'; input.min = '0'; input.max = String(max); input.step = '0.01'; input.value = data[key]; input.setAttribute('aria-label', label);
    input.oninput = () => change({ [key]: Number(input.value) }); wrap.append(input); controls.append(wrap);
  }
  return controls;
}
export function mount(context) {
  const card = document.createElement('article'); card.className = 'shader-module'; card.dataset.ownBackground = '';
  const canvas = document.createElement('canvas'); canvas.setAttribute('aria-hidden', 'true');
  const title = document.createElement('h2'); const status = document.createElement('p'); status.className = 'shader-status'; status.setAttribute('role', 'status');
  card.append(canvas, title, status); context.root.append(card);
  let gl, program, buffer, resolution, phase, hue, elapsed = 0, data = context.data, size = context.size, lost = false;
  function release() {
    if (gl) { if (buffer) gl.deleteBuffer(buffer); if (program) gl.deleteProgram(program); }
    buffer = program = undefined;
  }
  function setup() {
    release(); gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) { status.textContent = '设备不支持 WebGL，显示静态色场'; return; }
    const shaders = [];
    try {
      const compile = (type, source) => {
        const shader = gl.createShader(type); shaders.push(shader); gl.shaderSource(shader, source); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Shader compilation failed');
        return shader;
      };
      program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, 'attribute vec2 a_position; void main(){gl_Position=vec4(a_position,0.0,1.0);}'));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `precision mediump float;
uniform vec2 u_resolution; uniform float u_phase; uniform float u_hue;
void main(){
  vec2 p=(gl_FragCoord.xy*2.0-u_resolution)/max(u_resolution.y,1.0);
  float wave=sin(p.x*2.1+u_phase+sin(p.y*2.4-u_phase*0.7))*0.5+0.5;
  vec3 color=0.52+0.32*cos(6.28318*(u_hue+vec3(0.0,0.17,0.34))+wave*2.8+p.y*0.5);
  gl_FragColor=vec4(color,1.0);
}`));
      gl.linkProgram(program); if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
      gl.useProgram(program); buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
      const position = gl.getAttribLocation(program, 'a_position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
      resolution = gl.getUniformLocation(program, 'u_resolution'); phase = gl.getUniformLocation(program, 'u_phase'); hue = gl.getUniformLocation(program, 'u_hue');
      status.textContent = ''; resize(size); context.invalidate();
    } catch { release(); status.textContent = '画布暂时不可用，显示静态色场'; }
    finally { for (const shader of shaders) gl.deleteShader(shader); }
  }
  function resize(next) {
    size = next;
    // Cap backing pixels for a small server dashboard on high-density screens.
    const ratio = Math.min(next.pixelRatio, 1536 / Math.max(next.width, next.height, 1));
    canvas.width = Math.max(1, Math.round(next.width * ratio)); canvas.height = Math.max(1, Math.round(next.height * ratio));
    gl?.viewport(0, 0, canvas.width, canvas.height);
  }
  canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); lost = true; status.textContent = '画布暂停，等待恢复'; }, { signal: context.signal });
  canvas.addEventListener('webglcontextrestored', () => { lost = false; setup(); }, { signal: context.signal });
  setup();
  return {
    update(next) { data = next; title.textContent = next.title; }, resize,
    frame(time, delta) {
      if (!gl || !program || lost) return;
      elapsed += delta / 1000 * data.speed;
      gl.useProgram(program); gl.uniform2f(resolution, canvas.width, canvas.height); gl.uniform1f(phase, elapsed); gl.uniform1f(hue, data.hue); gl.drawArrays(gl.TRIANGLES, 0, 6);
    },
    dispose() { release(); gl?.getExtension('WEBGL_lose_context')?.loseContext(); },
  };
}
