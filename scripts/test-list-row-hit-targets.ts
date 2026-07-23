import assert from 'node:assert/strict';
import { isListMarqueeSurface, isListSelectCellTarget } from '../src/lib/listRowHitTargets';

type MockEl = {
  tag: string;
  parent?: MockEl;
};

function closest(el: MockEl, selector: string): MockEl | null {
  let cur: MockEl | undefined = el;
  while (cur) {
    if (selector.includes('fs-item-wrapper') && cur.tag === 'fs-item-wrapper') return cur;
    if (selector.includes('bndz-list-col-gutter') && cur.tag === 'bndz-list-col-gutter') return cur;
    if (selector.includes('bndz-list-marquee') && (cur.tag === 'bndz-list-marquee-pad' || cur.tag === 'bndz-list-marquee-trail')) return cur;
    if (selector.includes('bndz-list-select-cell') && cur.tag === 'bndz-list-select-cell') return cur;
    cur = cur.parent;
  }
  return null;
}

function asTarget(el: MockEl): EventTarget {
  return {
    closest: (sel: string) => closest(el, sel),
  } as unknown as EventTarget;
}

function run() {
  const row: MockEl = { tag: 'fs-item-wrapper' };
  const selectCell: MockEl = { tag: 'bndz-list-select-cell', parent: row };
  const marqueePad: MockEl = { tag: 'bndz-list-marquee-pad', parent: row };
  const gutter: MockEl = { tag: 'bndz-list-col-gutter', parent: row };

  assert.equal(isListMarqueeSurface(asTarget(marqueePad)), true);
  assert.equal(isListMarqueeSurface(asTarget(gutter)), true);
  assert.equal(isListMarqueeSurface(asTarget(selectCell)), false);
  assert.equal(isListSelectCellTarget(asTarget(selectCell)), true);
  assert.equal(isListSelectCellTarget(asTarget(marqueePad)), false);
  // Whole row (non-marquee) is a solid click/drag hit target.
  assert.equal(isListSelectCellTarget(asTarget(row)), true);
  assert.equal(isListMarqueeSurface(asTarget(row)), false);

  console.log('test-list-row-hit-targets: ok');
}

run();
