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
  // Shaders live in shaders/; '#include "file"' lines are inlined at load time.
  const load = async f => {
    const r = await fetch('shaders/' + f);
    if (!r.ok) throw new Error('failed to load shaders/' + f);
    const txt = await r.text();
    return (await Promise.all(txt.split('\n').map(async l => {
      const m = l.match(/^\s*#include\s+"(.+)"\s*$/);
      return m ? load(m[1]) : l;
    }))).join('\n');
  };
  const [VS, RAIN_FS, BRIGHT_FS, BLUR_FS, COMP_FS] = await Promise.all(
    ['quad.vert', 'rain.frag', 'bright.frag', 'blur.frag', 'composite.frag'].map(load));

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

