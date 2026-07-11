import assert from 'node:assert/strict';
import {
  resolveEntityPanePath,
  isShellKnownFolderRoot,
  shellKnownFolderParent,
  SPECIAL_FOLDER_PANE_PATHS,
} from '../src/lib/shellPaths';
import { parseUserPathToPane } from '../src/lib/displayPath';

assert.equal(resolveEntityPanePath('/shell:Desktop', {
  name: 'Projects',
  type: 'directory',
  path: 'C:/Users/alice/Desktop/Projects',
}), '/C:/Users/alice/Desktop/Projects');

assert.equal(resolveEntityPanePath('/C:/Users/alice/Desktop', {
  name: 'Desktop',
  type: 'directory',
  path: 'C:/Users/alice/Desktop/nested',
}), '/C:/Users/alice/Desktop/nested');

assert.equal(isShellKnownFolderRoot('/shell:Desktop'), true);
assert.equal(isShellKnownFolderRoot('/shell:Desktop/foo'), false);
assert.equal(shellKnownFolderParent('/shell:Desktop'), '/shell:Profile');
assert.equal(parseUserPathToPane('Desktop'), SPECIAL_FOLDER_PANE_PATHS.desktop);
assert.equal(parseUserPathToPane('Recents'), SPECIAL_FOLDER_PANE_PATHS.recents);

console.log('shellPaths unit tests passed');
