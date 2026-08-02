export const passthroughVert = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const passthroughFrag = /* glsl */`
uniform sampler2D uMap;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uMap, vUv);
}
`;

/** Luma heat-tint inspect (not a statistical histogram overlay). */
export const histogramFrag = /* glsl */`
uniform sampler2D uMap;
uniform vec2 uResolution;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  vec3 tint = mix(vec3(0.08, 0.12, 0.18), vec3(0.2, 0.85, 1.0), luma);
  gl_FragColor = vec4(tint, 1.0);
}
`;

export const loupeFrag = /* glsl */`
uniform sampler2D uMap;
uniform vec2 uMouse;
uniform float uZoom;
varying vec2 vUv;
void main() {
  vec2 d = vUv - uMouse;
  vec2 uv = uMouse + d / max(uZoom, 1.0);
  if (length(d) > 0.18) {
    gl_FragColor = texture2D(uMap, vUv) * 0.35;
  } else {
    gl_FragColor = texture2D(uMap, uv);
  }
}
`;
