import assert from 'node:assert/strict';
import { isValidOutboundDragPath, toWindowsPath } from '../src/lib/pathUtils';

assert.equal(isValidOutboundDragPath('C:\\Users\\mikey\\Downloads\\Audio'), true);
assert.equal(isValidOutboundDragPath('/C:/Users/mikey/Downloads/foo.txt'), true);
assert.equal(isValidOutboundDragPath('\\\\server\\share\\file.txt'), true);

// Literal folder named file%3A on disk must remain draggable.
assert.equal(isValidOutboundDragPath('C:\\Users\\mikey\\Downloads\\file%3A'), true);
assert.equal(toWindowsPath('C:/Users/mikey/Downloads/file%3A'), 'C:\\Users\\mikey\\Downloads\\file%3A');
assert.equal(isValidOutboundDragPath('file:///C:/Users/mikey/x'), false);
assert.equal(isValidOutboundDragPath('/bndz/ram/zone-1'), false);
assert.equal(isValidOutboundDragPath(''), false);

assert.equal(isValidOutboundDragPath('C:\\Users\\mikey\\Downloads\\file:'), false);

import { resolveEntityDragPath } from '../src/lib/fsPathRouting';
assert.equal(
  resolveEntityDragPath({ name: 'Audio', path: 'C:/Users/mikey/Downloads/file%3A' }, '/C:/Users/mikey/Downloads'),
  'C:\\Users\\mikey\\Downloads\\Audio',
);
assert.equal(
  resolveEntityDragPath({ name: 'file%3A', path: 'C:/Users/mikey/Downloads/file%3A' }, '/C:/Users/mikey/Downloads'),
  'C:\\Users\\mikey\\Downloads\\file%3A',
);
assert.equal(
  resolveEntityDragPath({ name: 'doc.txt', path: 'bndz-stream://local/C%3A/Users/x/doc.txt' }, '/C:/Users/x'),
  'C:\\Users\\x\\doc.txt',
);

console.log('test-outbound-drag-paths: ok');
