import assert from 'node:assert/strict';
import { isMeshDropCode, meshDropCodeChecksum } from '../src/lib/meshDrop';
import {
  buildMeshDropDeepLink,
  buildMeshDropWebLink,
  extractMeshDropCode,
  MESH_DROP_DEEP_SCHEME,
} from '../src/lib/meshDropLinks';

assert.equal(isMeshDropCode('BNDZMD:abc'), true);
assert.equal(isMeshDropCode('bndzmd:abc'), true);
assert.equal(isMeshDropCode('not-a-code'), false);

const sample = 'BNDZMD:eyJ2IjoiMSJ9';
const checksum = meshDropCodeChecksum(sample);
assert.equal(checksum.length, 6);
assert.equal(meshDropCodeChecksum(sample), checksum);

const deep = buildMeshDropDeepLink(sample);
assert.ok(deep.startsWith(MESH_DROP_DEEP_SCHEME));
assert.ok(deep.includes('code='));

const web = buildMeshDropWebLink(sample, 'https://bndz.app/mesh-drop');
assert.ok(web.startsWith('https://bndz.app/mesh-drop'));
assert.ok(web.includes('#'));

assert.equal(extractMeshDropCode(sample), sample);
assert.equal(extractMeshDropCode(deep), sample);
assert.equal(extractMeshDropCode(web), sample);

console.log('test-mesh-drop-signaling: ok');
