#version 300 es
precision highp float;
uniform sampler2D uScene, uB1, uB2, uB3; uniform float uTime; uniform vec2 uRes; uniform float uFade;
in vec2 vUv; out vec4 o;
#include "hash.glsl"
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
}
