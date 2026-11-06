#version 300 es
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform sampler2D uAtlas;
uniform float uCount; uniform vec2 uGrid; uniform vec2 uMouse; uniform float uDpr;
uniform vec3 uPulse; // xy = pos (px, y-down), z = start time
out vec4 o;
#include "hash.glsl"

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
}
