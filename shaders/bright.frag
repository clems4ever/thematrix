#version 300 es
precision highp float;
uniform sampler2D uTex; in vec2 vUv; out vec4 o;
void main(){ vec3 c = texture(uTex, vUv).rgb; float l = max(c.r, max(c.g, c.b));
  o = vec4(c * smoothstep(0.15, 0.9, l), 1.0); }
