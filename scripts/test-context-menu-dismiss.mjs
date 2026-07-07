import assert from 'node:assert/strict';
import {
  isInsideMenuTree,
  isPointerInsideMenuTree,
} from '../src/hooks/useContextMenuDismissOnLeave.ts';

const menu = { closest: (sel) => (sel.includes('context-menu') ? menu : null) };
const flyout = { closest: (sel) => (sel.includes('submenu-flyout') ? flyout : null) };
const outside = { closest: () => null };

assert.equal(isInsideMenuTree(menu), true);
assert.equal(isInsideMenuTree(flyout), true);
assert.equal(isInsideMenuTree(outside), false);

const fakeDoc = {
  elementFromPoint(x) {
    if (x < 200) return menu;
    if (x < 400) return flyout;
    return outside;
  },
};

assert.equal(isPointerInsideMenuTree(100, 50, fakeDoc), true);
assert.equal(isPointerInsideMenuTree(300, 50, fakeDoc), true);
assert.equal(isPointerInsideMenuTree(500, 50, fakeDoc), false);

console.log('context menu dismiss: ok');
