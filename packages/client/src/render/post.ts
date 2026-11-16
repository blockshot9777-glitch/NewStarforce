// Постобработка кадра на WebGL: свечение ярких источников (bloom), тональная кривая, цветокоррекция,
// виньетка, лёгкое зерно и хроматическая аберрация по краям. Игра по-прежнему рисуется в Canvas 2D;
// каждый кадр этот холст становится текстурой и проходит через шейдеры в отдельный WebGL-холст поверх.
// Нет WebGL или он программный — ничего не ломается: виден исходный 2D-холст. ?post=0 — выключить,
// ?post=1 — включить принудительно (для проверки на машине без видеокарты).

const VS = `
attribute vec2 p;
varying vec2 uv;
void main() { uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;

// Выделение ярких участков с мягким порогом (knee) — светятся огни, пламя, лазеры, звезда, а не весь кадр.
const FS_BRIGHT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D src;
uniform vec2 texel;
uniform float threshold;
void main() {
  // Усреднение 4 точек — заодно уменьшение в 2 раза без мерцания.
  vec3 c = texture2D(src, uv + texel * vec2(-0.5, -0.5)).rgb
         + texture2D(src, uv + texel * vec2( 0.5, -0.5)).rgb
         + texture2D(src, uv + texel * vec2(-0.5,  0.5)).rgb
         + texture2D(src, uv + texel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float knee = 0.18;
  float soft = clamp(l - threshold + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float w = max(soft, l - threshold) / max(l, 1e-4);
  // Насыщенные цвета светятся сильнее серых — белый текст интерфейса почти не «плывёт».
  float sat = l - min(c.r, min(c.g, c.b));
  gl_FragColor = vec4(c * w * (0.55 + sat), 1.0);
}`;

// Разделимое гауссово размытие, 9 отсчётов через линейную выборку.
const FS_BLUR = `
precision mediump float;
varying vec2 uv;
uniform sampler2D src;
uniform vec2 dir;
void main() {
  vec3 c = texture2D(src, uv).rgb * 0.2270270270;
  c += texture2D(src, uv + dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(src, uv - dir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(src, uv + dir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(src, uv - dir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FS_FINAL = `
precision mediump float;
varying vec2 uv;
uniform sampler2D scene;
uniform sampler2D b1;
uniform sampler2D b2;
uniform sampler2D b3;
uniform float bloom;
uniform float time;
uniform vec2 res;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 d = uv - 0.5;
  float r2 = dot(d, d);
  // Хроматическая аберрация — только у краёв экрана, в центре картинка чёткая.
  vec2 ca = d * r2 * 0.003;
  vec3 c;
  c.r = texture2D(scene, uv + ca).r;
  c.g = texture2D(scene, uv).g;
  c.b = texture2D(scene, uv - ca).b;
  vec3 glow = texture2D(b1, uv).rgb * 0.55 + texture2D(b2, uv).rgb * 0.75 + texture2D(b3, uv).rgb * 0.9;
  c += glow * bloom;
  // Мягкая тональная кривая: яркое не «выгорает» в плоский белый.
  c = c * (1.0 + c / 6.0) / (1.0 + c * 0.55);
  c *= 1.12;
  // Цветокоррекция: холодные тени, тёплые света, чуть больше контраста.
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += vec3(-0.012, 0.004, 0.02) * (1.0 - smoothstep(0.0, 0.45, l));
  c += vec3(0.02, 0.008, -0.015) * smoothstep(0.5, 1.0, l);
  c = mix(vec3(l), c, 1.08);
  c = (c - 0.5) * 1.06 + 0.5;
  // Виньетка.
  c *= 1.0 - smoothstep(0.18, 0.75, r2) * 0.42;
  // Зерно плёнки — едва заметное, оживляет тёмные градиенты и убирает «полосы».
  float n = hash(uv * res + fract(time) * 91.7) - 0.5;
  c += n * 0.018;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

interface Target {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class PostFx {
  private gl: WebGLRenderingContext;
  private canvas: HTMLCanvasElement;
  private sceneTex: WebGLTexture;
  private progs: Record<'bright' | 'blur' | 'final', WebGLProgram>;
  private targets: Target[] = [];
  private tw = 0;
  private th = 0;
  /** Сила свечения — режимы могут подкручивать. */
  bloom = 1;

  static create(under: HTMLCanvasElement): PostFx | null {
    if (new URLSearchParams(location.search).get('post') === '0') return null;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
      if (!gl) return null;
      // Программный WebGL (нет видеокарты/драйвера) тянет постобработку в разы медленнее — не включаем.
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
      if (/swiftshader|llvmpipe|software/i.test(renderer) && new URLSearchParams(location.search).get('post') !== '1') return null;
      return new PostFx(gl, c, under);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext, c: HTMLCanvasElement, under: HTMLCanvasElement) {
    this.gl = gl;
    this.canvas = c;
    c.id = 'game-post';
    // Поверх игрового холста, но под интерфейсом; события мыши проходят к 2D-холсту.
    c.style.cssText = 'position:fixed;inset:0;display:block;pointer-events:none;';
    under.after(c);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.progs = { bright: this.program(FS_BRIGHT), blur: this.program(FS_BLUR), final: this.program(FS_FINAL) };
    this.sceneTex = this.texture();
  }

  private program(fs: string): WebGLProgram {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    return p;
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture();
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { fb, tex, w, h };
  }

  /** Цели размытия: 1/2 (яркое), затем пары 1/4, 1/8, 1/16 для «ближнего» и «дальнего» свечения. */
  private ensure(w: number, h: number): void {
    if (w === this.tw && h === this.th) return;
    const gl = this.gl;
    for (const t of this.targets) {
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }
    this.tw = w;
    this.th = h;
    this.canvas.width = w;
    this.canvas.height = h;
    const sz = (k: number) => [Math.max(1, Math.floor(w / k)), Math.max(1, Math.floor(h / k))] as const;
    this.targets = [this.target(...sz(2))];
    for (const k of [4, 8, 16]) this.targets.push(this.target(...sz(k)), this.target(...sz(k)));
  }

  private pass(prog: WebGLProgram, out: Target | null, tex: WebGLTexture[], set: (u: (n: string) => WebGLUniformLocation | null) => void): void {
    const gl = this.gl;
    gl.useProgram(prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    gl.viewport(0, 0, out ? out.w : this.tw, out ? out.h : this.th);
    tex.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t);
    });
    set((n) => gl.getUniformLocation(prog, n));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Показать кадр: 2D-холст → шейдеры → экран. */
  present(src: HTMLCanvasElement, timeSec: number): void {
    const gl = this.gl;
    this.ensure(src.width, src.height);
    this.canvas.style.width = src.style.width;
    this.canvas.style.height = src.style.height;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
    // Холст 2D уже «сверху вниз», а UV у WebGL — снизу вверх: переворачиваем при загрузке.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const [half, ...rest] = this.targets;
    this.pass(this.progs.bright, half, [this.sceneTex], (u) => {
      gl.uniform1i(u('src'), 0);
      gl.uniform2f(u('texel'), 1 / src.width, 1 / src.height);
      gl.uniform1f(u('threshold'), 0.62);
    });
    let input = half;
    const levels: Target[] = [];
    for (let k = 0; k < 3; k++) {
      const a = rest[k * 2];
      const b = rest[k * 2 + 1];
      // Горизонталь из предыдущего уровня в A (заодно уменьшение), вертикаль из A в B.
      this.pass(this.progs.blur, a, [input.tex], (u) => {
        gl.uniform1i(u('src'), 0);
        gl.uniform2f(u('dir'), 1 / input.w, 0);
      });
      this.pass(this.progs.blur, b, [a.tex], (u) => {
        gl.uniform1i(u('src'), 0);
        gl.uniform2f(u('dir'), 0, 1 / a.h);
      });
      levels.push(b);
      input = b;
    }
    this.pass(this.progs.final, null, [this.sceneTex, levels[0].tex, levels[1].tex, levels[2].tex], (u) => {
      gl.uniform1i(u('scene'), 0);
      gl.uniform1i(u('b1'), 1);
      gl.uniform1i(u('b2'), 2);
      gl.uniform1i(u('b3'), 3);
      gl.uniform1f(u('bloom'), this.bloom);
      gl.uniform1f(u('time'), timeSec);
      gl.uniform2f(u('res'), this.tw, this.th);
    });
  }
}
