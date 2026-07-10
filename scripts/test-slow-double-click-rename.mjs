/**
 * Unit tests for slow double-click rename thresholds.
 * Run: tsx scripts/test-slow-double-click-rename.mjs
 */
import assert from 'assert';
import {
  SLOW_DOUBLE_CLICK_MIN_MS,
  SLOW_DOUBLE_CLICK_MAX_MS,
  advanceSlowDoubleClickRename,
  clearSlowDoubleClickTimer,
} from '../src/lib/slowDoubleClickRename.ts';

let fired = 0;
const timerRef = { current: null };

clearSlowDoubleClickTimer(timerRef);
advanceSlowDoubleClickRename({
  key: 'a',
  wasAlreadyActive: true,
  lastClick: { key: 'a', time: 0 },
  now: SLOW_DOUBLE_CLICK_MIN_MS - 1,
  timerRef,
  onRename: () => { fired += 1; },
});
assert.strictEqual(timerRef.current, null, 'too-fast second click must not arm rename');

advanceSlowDoubleClickRename({
  key: 'a',
  wasAlreadyActive: true,
  lastClick: { key: 'a', time: 0 },
  now: SLOW_DOUBLE_CLICK_MIN_MS + 100,
  timerRef,
  onRename: () => { fired += 1; },
});
assert.ok(timerRef.current, 'slow second click should arm rename timer');

clearSlowDoubleClickTimer(timerRef);
fired = 0;
advanceSlowDoubleClickRename({
  key: 'a',
  wasAlreadyActive: true,
  lastClick: { key: 'a', time: 0 },
  now: SLOW_DOUBLE_CLICK_MAX_MS + 50,
  timerRef,
  onRename: () => { fired += 1; },
});
assert.strictEqual(timerRef.current, null, 'gap longer than max must not arm rename');

advanceSlowDoubleClickRename({
  key: 'a',
  wasAlreadyActive: false,
  lastClick: { key: 'a', time: 0 },
  now: 5000,
  timerRef,
  onRename: () => { fired += 1; },
});
assert.strictEqual(timerRef.current, null, 'first click must not arm rename');

console.log('slow double-click rename tests passed');
