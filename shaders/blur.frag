#version 300 es
precision highp float;
uniform sampler2D uTex; uniform vec2 uDir; in vec2 vUv; out vec4 o;
void main(){
  vec3 c = texture(uTex, vUv).rgb * 0.2270270270;
  c += texture(uTex, vUv + uDir*1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv - uDir*1.3846153846).rgb * 0.3162162162;
  c += texture(uTex, vUv + uDir*3.2307692308).rgb * 0.0702702703;
  c += texture(uTex, vUv - uDir*3.2307692308).rgb * 0.0702702703;
  o = vec4(c, 1.0);
}
