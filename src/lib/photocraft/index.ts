/**
 * photocraft document-logic port for the BNDZ photo studio.
 *
 * Ported from photocraft (MIT/Apache) at ~/workspace/photocraft:
 * - `crates/color/src/blend.rs` -> blend.ts (blend modes)
 * - `crates/geom/src/lib.rs`, `crates/algo/src/transform.rs` -> geometry.ts (affine/projective math)
 * - `crates/doc/src/{lib,adjust,effects,blend_if,vector}.rs` -> model.ts (document/layer model)
 */

export * from './blend';
export * from './geometry';
export * from './model';
