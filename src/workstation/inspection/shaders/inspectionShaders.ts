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

/** Luma heat-tint inspect — mix cyan heat with original so detail stays visible. */
export const histogramFrag = /* glsl */`
uniform sampler2D uMap;
uniform vec2 uResolution;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  float luma = dot(c.rgb, vec3(0.299, 0.587, 0.114));
  float heat = smoothstep(0.08, 0.92, luma);
  vec3 tint = mix(vec3(0.02, 0.06, 0.14), vec3(0.25, 0.72, 0.95), heat);
  // Preserve original detail; never replace with flat bright tint (white blowout).
  vec3 mixed = mix(c.rgb, tint, 0.55);
  gl_FragColor = vec4(clamp(mixed, 0.0, 1.0), c.a);
}
`;

/** Loupe: true passthrough outside the lens; magnified sample inside; thin rim only. */
export const loupeFrag = /* glsl */`
uniform sampler2D uMap;
uniform vec2 uMouse;
uniform float uZoom;
varying vec2 vUv;
void main() {
  vec2 d = vUv - uMouse;
  float r = 0.16;
  float edge = 0.012;
  float dist = length(d);
  float inside = 1.0 - smoothstep(r - edge, r + edge, dist);
  vec2 uv = clamp(uMouse + d / max(uZoom, 1.0), 0.0, 1.0);
  vec4 base = texture2D(uMap, vUv);
  vec4 mag = texture2D(uMap, uv);
  // Outside lens: unmodified base (no blue wash).
  vec4 color = mix(base, mag, inside);
  // Thin cyan rim only at the edge ring — not a full-frame mix.
  float rim = smoothstep(r - edge * 2.0, r - edge * 0.35, dist)
            * (1.0 - smoothstep(r + edge * 0.15, r + edge * 1.6, dist));
  color.rgb = mix(color.rgb, vec3(0.35, 0.75, 1.0), rim * 0.55);
  gl_FragColor = color;
}
`;
