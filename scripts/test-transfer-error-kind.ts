/**
 * Host errorKind must drive ops sheets (not regex alone).
 */
import assert from 'node:assert/strict';
import { classifyTransferError } from '../src/lib/transferErrorKind.ts';

const opaque = classifyTransferError('The operation failed with code 0x80070070.', 'diskFull');
assert.equal(opaque.kind, 'diskFull', 'errorKind diskFull wins over opaque text');

const share = classifyTransferError('Something went wrong', 'sharingViolation');
assert.equal(share.kind, 'sharingViolation');

const pathLong = classifyTransferError('fail', 'pathTooLong');
assert.equal(pathLong.kind, 'pathTooLong');

const invalid = classifyTransferError('fail', 'invalidName');
assert.equal(invalid.kind, 'invalidName');
assert.match(invalid.summary, /not allowed/i);

const intoSelf = classifyTransferError('fail', 'intoSelf');
assert.equal(intoSelf.kind, 'intoSelf');

const access = classifyTransferError('fail', 'accessDenied');
assert.equal(access.kind, 'accessDenied');

const readOnly = classifyTransferError('fail', 'readOnly');
assert.equal(readOnly.kind, 'readOnly');

// Regex still works when kind omitted
const regexDisk = classifyTransferError('There is not enough free space on the disk.');
assert.equal(regexDisk.kind, 'diskFull');

console.log('transfer errorKind: ok');
