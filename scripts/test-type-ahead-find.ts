import { advanceTypeAheadPrefix, pickTypeAheadMatch, isTypeAheadKey } from '../src/lib/typeAheadFind';
import { matchesTypeAhead, typeAheadEntityName } from '../src/lib/keyboardShortcuts';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isTypeAheadKey('A'), 'A is type-ahead');
assert(isTypeAheadKey('.'), 'dot is type-ahead');
assert(!isTypeAheadKey(' '), 'space reserved');
assert(!isTypeAheadKey(':'), 'colon forbidden');

const items = [
  { id: '1', name: 'Alpha' },
  { id: '2', name: 'Beta' },
  { id: '3', name: 'Box' },
];

const matchesB = items.filter(i => matchesTypeAhead(i.name, 'b', 'Match at beginning'));

let t = 1000;
let prefix = '';
let lastAt = 0;

const first = advanceTypeAheadPrefix(prefix, lastAt, 'b', t, { allowRepeatCycle: true });
prefix = first.prefix;
lastAt = t;
assert(first.prefix === 'b' && !first.repeatCycle, 'first b sets prefix');
assert(pickTypeAheadMatch(matchesB, null, prefix, false)?.id === '2', 'first b -> Beta');

const second = advanceTypeAheadPrefix(prefix, lastAt, 'b', t + 200, { allowRepeatCycle: true });
assert(second.repeatCycle, 'second b cycles');
assert(
  pickTypeAheadMatch(matchesB, '2', prefix, true)?.id === '3',
  'second b cycles to Box',
);

const third = advanceTypeAheadPrefix(prefix, lastAt, 'b', t + 400, { allowRepeatCycle: true });
assert(
  pickTypeAheadMatch(matchesB, '3', prefix, true)?.id === '2',
  'third b wraps to Beta',
);

const append = advanceTypeAheadPrefix('b', t + 400, 'b', t + 500, { allowRepeatCycle: false });
assert(append.prefix === 'bb', 'repeat disabled appends chars');

assert(typeAheadEntityName({ name: 'App.exe' }, 'App…e') === 'App.exe', 'raw name preferred');
assert(matchesTypeAhead('Applications', 'ap', 'Match at beginning'), 'prefix match');

console.log('typeAheadFind unit tests passed');
