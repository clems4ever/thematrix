'use strict';
(async () => {
  const canvas = document.getElementById('c');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) { document.body.innerHTML = '<p style="color:#0f0;font:20px monospace;padding:2em">WebGL2 not supported.</p>'; return; }
  const hdr = !!gl.getExtension('EXT_color_buffer_float');

  // ---------- glyph atlas ----------
  const KATA = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン';
  const OTHER = '012345789Z:・."=*+-<>¦|╌日';
  const CHARS = [...KATA, ...OTHER];
  const GS = 96, AC = 16, AR = Math.ceil(CHARS.length / AC);
  try {
    await Promise.race([
      Promise.all([document.fonts.load(`500 ${GS}px "Noto Sans JP"`, KATA), document.fonts.load(`${GS}px "Share Tech Mono"`, OTHER)]),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch (e) {}
  const atlas = document.createElement('canvas');
  atlas.width = AC * GS; atlas.height = AR * GS;
  const ac = atlas.getContext('2d');
  ac.fillStyle = '#000'; ac.fillRect(0, 0, atlas.width, atlas.height);
  ac.fillStyle = '#fff'; ac.textAlign = 'center'; ac.textBaseline = 'middle';
  CHARS.forEach((ch, i) => {
    const isKata = i < KATA.length;
    ac.save();
    ac.translate((i % AC + 0.5) * GS, (Math.floor(i / AC) + 0.52) * GS);
    // classic look: katakana are mirrored and slightly condensed
    ac.scale(isKata ? -0.82 : 0.9, 1);
    ac.font = isKata ? `500 ${GS * 0.78}px "Noto Sans JP","MS Gothic","Hiragino Kaku Gothic Pro",sans-serif`
                     : `${GS * 0.8}px "Share Tech Mono","Courier New",monospace`;
    ac.fillText(ch, 0, 0);
    ac.restore();
  });

  const atlasTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, atlasTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);

  // ---------- shaders ----------
  const VS = `#version 300 es
  in vec2 p; out vec2 vUv;
  void main(){ vUv = p*0.5+0.5; gl_Position = vec4(p,0,1); }`;

  const HASH = `
  float h21(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }`;

  const RAIN_FS = `#version 300 es
  precision highp float;
  uniform vec2 uRes; uniform float uTime; uniform sampler2D uAtlas;
  uniform float uCount; uniform vec2 uGrid; uniform vec2 uMouse; uniform float uDpr;
  uniform vec3 uPulse; // xy = pos (px, y-down), z = start time
  out vec4 o;
  ${HASH}

  // returns rgb, a = glyph coverage
  vec4 layer(vec2 fc, float cell, float seed, float speedMul, float bright, float blur, float reveal){
    vec2 p = fc / cell + vec2(seed*13.7, 0.0);
    float col = floor(p.x), row = floor(p.y);
    vec2 cid = vec2(col, row);

    float inten = 0.0, head = 0.0;
    for (int s = 0; s < 3; s++) {
      float fs = float(s);
      vec2 k = vec2(col, seed*31.0 + fs*7.13);
      float speed = mix(6.0, 17.0, h21(k + 1.7)) * speedMul;
      float len   = mix(8.0, 36.0, h21(k + 4.1));
      float gap   = mix(16.0, 90.0, h21(k + 9.3)) + fs*30.0;
      float period = len + gap;
      float hpos = uTime*speed + h21(k)*period*9.0;
      // quantize the head so drops advance cell by cell, like the film
      float d = floor(hpos) - row;
      float dm = mod(d, period);
      if (dm < len) {
        float t = dm / len;
        float b = pow(1.0 - t, 1.6);
        b *= 0.85 + 0.15*h21(cid + floor(uTime*12.0)); // subtle flicker
        inten = max(inten, b);
        if (dm < 1.0) head = 1.0;
      }
    }

    // mouse light reveals dormant glyphs
    vec2 m = uMouse; float md = length(fc - m) / (uDpr*260.0);
    float glowM = exp(-md*md*3.0) * reveal;
    // click shockwave ring
    float pt = uTime - uPulse.z;
    float pr = pt * 900.0 * uDpr;
    float pd = abs(length(fc - uPulse.xy) - pr) / (uDpr*70.0);
    float ring = exp(-pd*pd) * exp(-pt*0.9) * step(0.0, pt) * reveal * 1.6;
    float ambient = max(glowM, ring);
    inten = max(inten, ambient * (0.35 + 0.65*h21(cid*1.7)));
    if (inten < 0.002) return vec4(0);

    // glyph selection: most cells change slowly, some shimmer quickly
    float hc = h21(cid + seed);
    float rate = hc > 0.88 ? 9.0 : (head > 0.5 ? 14.0 : 0.6);
    float tick = floor(uTime*rate + hc*50.0);
    float g = floor(h21(cid*vec2(1.31,0.77) + tick*vec2(0.137, 0.713) + seed) * uCount);

    vec2 local = fract(p);
    vec2 gxy = vec2(mod(g, uGrid.x), floor(g / uGrid.x));
    vec2 uv = (gxy + local) / uGrid;
    vec2 dx = dFdx(p) / uGrid * blur, dy = dFdy(p) / uGrid * blur;
    float a = textureGrad(uAtlas, uv, dx, dy).r;

    vec3 deep  = vec3(0.0, 0.22, 0.05);
    vec3 green = vec3(0.10, 1.0, 0.32);
    vec3 c = mix(deep, green, smoothstep(0.0, 0.6, inten)) * inten;
    c = mix(c, vec3(0.80, 1.0, 0.88) * 2.6, head);
    c += vec3(0.2, 1.0, 0.4) * ambient * 0.6 * (1.0 - head);
    return vec4(c * a * bright, a * min(1.0, inten*1.5 + head));
  }

  void main(){
    vec2 fc = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
    vec2 par = (uMouse / uRes - 0.5) * uDpr;
    float u = uDpr;
    vec4 far  = layer(fc + par*12.0, 11.0*u, 3.0, 0.55, 0.30, 2.2, 0.35);
    vec4 mid  = layer(fc + par*28.0, 17.0*u, 7.0, 0.80, 0.62, 1.3, 0.7);
    vec4 near = layer(fc + par*55.0, 27.0*u, 11.0, 1.00, 1.00, 1.0, 1.0);
    vec3 c = far.rgb;
    c = mix(c, vec3(0), mid.a*0.6) + mid.rgb;   // nearer glyphs occlude farther ones
    c = mix(c, vec3(0), near.a*0.7) + near.rgb;
    o = vec4(c, 1.0);
  }`;

  const BRIGHT_FS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex; in vec2 vUv; out vec4 o;
  void main(){ vec3 c = texture(uTex, vUv).rgb; float l = max(c.r, max(c.g, c.b));
    o = vec4(c * smoothstep(0.15, 0.9, l), 1.0); }`;

  const BLUR_FS = `#version 300 es
  precision highp float;
  uniform sampler2D uTex; uniform vec2 uDir; in vec2 vUv; out vec4 o;
  void main(){
    vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
    c += texture(uTex, vUv + uDir*1.3846153846).rgb * 0.3162162162;
    c += texture(uTex, vUv - uDir*1.3846153846).rgb * 0.3162162162;
    c += texture(uTex, vUv + uDir*3.2307692308).rgb * 0.0702702703;
    c += texture(uTex, vUv - uDir*3.2307692308).rgb * 0.0702702703;
    o = vec4(c, 1.0);
  }`;

  const COMP_FS = `#version 300 es
  precision highp float;
  uniform sampler2D uScene, uB1, uB2, uB3; uniform float uTime; uniform vec2 uRes; uniform float uFade;
  in vec2 vUv; out vec4 o;
  ${HASH}
  void main(){
    vec2 q = vUv - 0.5;
    // faint chromatic fringe toward the edges
    vec2 off = q * 0.0025;
    vec3 s = vec3(texture(uScene, vUv + off).r, texture(uScene, vUv).g, texture(uScene, vUv - off).b);
    vec3 c = s + texture(uB1, vUv).rgb*0.9 + texture(uB2, vUv).rgb*0.8 + texture(uB3, vUv).rgb*0.9;
    c += vec3(0.0, 0.012, 0.004); // the green-black of the void
    c = 1.0 - exp(-c * 1.15);
    c *= 1.0 - dot(q, q) * 1.1;
    c *= 0.93 + 0.07 * sin(gl_FragCoord.y * 3.14159 * 0.5);
    c += (h21(gl_FragCoord.xy + fract(uTime)*100.0) - 0.5) * 0.025;
    o = vec4(pow(max(c, 0.0), vec3(0.95)) * uFade, 1.0);
  }`;

  function compile(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  const rainP = program(RAIN_FS), brightP = program(BRIGHT_FS), blurP = program(BLUR_FS), compP = program(COMP_FS);

  const vbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // ---------- render targets ----------
  function target(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    return { tex, fb, w, h };
  }
  let W, H, dpr, scene, bloom = [];
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.floor(innerWidth * dpr); H = Math.floor(innerHeight * dpr);
    canvas.width = W; canvas.height = H;
    for (const t of [scene, ...bloom.flat()]) if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    scene = target(W, H);
    bloom = [2, 4, 8].map(d => [target(Math.max(1, W / d | 0), Math.max(1, H / d | 0)), target(Math.max(1, W / d | 0), Math.max(1, H / d | 0))]);
  }
  resize();
  addEventListener('resize', resize);

  // ---------- interaction ----------
  const mouse = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2 };
  let pulse = [0, 0, -100];
  addEventListener('pointermove', e => { mouse.tx = e.clientX; mouse.ty = e.clientY; });
  const hint = document.getElementById('hint');
  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    hint.style.opacity = 0;
  }
  addEventListener('pointerdown', e => { goFullscreen(); pulse = [e.clientX * dpr, e.clientY * dpr, time]; });
  let paused = false;
  addEventListener('keydown', e => {
    if (e.code === 'Space') paused = !paused;
    else if (e.key === 'f' || e.key === 'F') {
      if (document.fullscreenElement) document.exitFullscreen(); else goFullscreen();
    } else goFullscreen();
  });
  setTimeout(() => (hint.style.opacity = 0), 6000);

  // ---------- intro ----------
  const intro = document.getElementById('intro');
  (async () => {
    const lines = ['Wake up, Neo...', 'The Matrix has you...', 'Follow the white rabbit.'];
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    await sleep(1200);
    for (const line of lines) {
      for (let i = 0; i <= line.length; i++) {
        intro.innerHTML = line.slice(0, i).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '<span class="cursor"></span>';
        await sleep(70 + Math.random() * 90);
      }
      await sleep(1800);
    }
    intro.style.opacity = 0;
  })();

  // ---------- loop ----------
  function pass(prog, fb, w, h) { gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.viewport(0, 0, w, h); gl.useProgram(prog.p); }
  function bindTex(prog, name, unit, tex) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(prog.u[name], unit); }

  let time = 0, last = performance.now(), start = last;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!paused) time += dt;
    mouse.x += (mouse.tx - mouse.x) * Math.min(1, dt * 6);
    mouse.y += (mouse.ty - mouse.y) * Math.min(1, dt * 6);

    pass(rainP, scene.fb, W, H);
    bindTex(rainP, 'uAtlas', 0, atlasTex);
    gl.uniform2f(rainP.u.uRes, W, H);
    gl.uniform1f(rainP.u.uTime, time);
    gl.uniform1f(rainP.u.uCount, CHARS.length);
    gl.uniform2f(rainP.u.uGrid, AC, AR);
    gl.uniform2f(rainP.u.uMouse, mouse.x * dpr, mouse.y * dpr);
    gl.uniform1f(rainP.u.uDpr, dpr);
    gl.uniform3f(rainP.u.uPulse, pulse[0], pulse[1], pulse[2]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // bloom chain: bright-pass -> separable blur at 3 scales
    let src = scene.tex;
    bloom.forEach(([a, b], i) => {
      pass(i === 0 ? brightP : blurP, a.fb, a.w, a.h);
      if (i === 0) bindTex(brightP, 'uTex', 0, src);
      else { bindTex(blurP, 'uTex', 0, src); gl.uniform2f(blurP.u.uDir, 0, 0); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      for (let k = 0; k < 2; k++) {
        pass(blurP, b.fb, b.w, b.h); bindTex(blurP, 'uTex', 0, a.tex);
        gl.uniform2f(blurP.u.uDir, 1 / a.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(blurP, a.fb, a.w, a.h); bindTex(blurP, 'uTex', 0, b.tex);
        gl.uniform2f(blurP.u.uDir, 0, 1 / a.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      src = a.tex;
    });

    pass(compP, null, W, H);
    bindTex(compP, 'uScene', 0, scene.tex);
    bindTex(compP, 'uB1', 1, bloom[0][0].tex);
    bindTex(compP, 'uB2', 2, bloom[1][0].tex);
    bindTex(compP, 'uB3', 3, bloom[2][0].tex);
    gl.uniform1f(compP.u.uTime, time);
    gl.uniform2f(compP.u.uRes, W, H);
    gl.uniform1f(compP.u.uFade, Math.min(1, (now - start) / 2500));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

