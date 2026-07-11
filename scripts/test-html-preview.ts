import { htmlPreviewBaseUrl, prepareHtmlForPreview } from '../src/lib/htmlPreview';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const base = htmlPreviewBaseUrl('C:/Users/test/page.html');
assert(base.includes('local-stream'), 'base url should use local-stream');
assert(base.endsWith('/'), 'base url should end with slash');
assert(!base.includes('page.html'), 'base url should be directory only');

const withHead = prepareHtmlForPreview('<html><head><title>x</title></head><body>hi</body></html>', base);
assert(withHead.includes('<base href='), 'should inject base into head');

const existing = prepareHtmlForPreview('<html><head><base href="http://x/"></head></html>', base);
assert(!existing.includes('local-stream'), 'should not replace existing base');

const fragment = prepareHtmlForPreview('<p>Hello</p>', base);
assert(fragment.includes('<base href='), 'fragment should wrap with base');

console.log('htmlPreview unit tests passed');
