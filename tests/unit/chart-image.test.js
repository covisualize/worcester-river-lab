// What a printout or a saved chart picture says about itself (dist/js/data.js) and how the picture's text is wrapped (dist/js/chart-image.js).
// A picture gets copied into messages and posts, away from the page, so these sentences are what stops it passing for something it is not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataBasis, imageFooter, imageFileName, MAY_HAVE_CHANGED } from '../../dist/js/data.js';
import { wrapText } from '../../dist/js/chart-image.js';

const WINTER = Date.UTC(2026, 10, 9, 7, 30); // 9 Nov 2026, 07:30 GMT
const SUMMER = Date.UTC(2026, 6, 1, 11, 5); // 1 Jul 2026, 12:05 BST
const LAST = [WINTER, 0.553];

test('dataBasis: live data names the latest reading, in UK time', () => {
  assert.equal(dataBasis({ mode: 'live', last: LAST }), 'Latest Diglis reading: Mon, 9 Nov 2026, 07:30 GMT.');
  assert.equal(dataBasis({ mode: 'live', last: [SUMMER, 0.5] }), 'Latest Diglis reading: Wed, 1 Jul 2026, 12:05 BST.');
});

test('dataBasis: a demo replay and an offline snapshot say they are not current, whatever the latest reading is', () => {
  assert.equal(dataBasis({ mode: 'demo', last: LAST }), 'DEMO REPLAY of February 2020: illustrative, not current conditions.');
  assert.equal(dataBasis({ mode: 'snapshot', snapshotAt: SUMMER, last: LAST }), 'Saved offline snapshot taken Wed, 1 Jul 2026, 12:05 BST: not current conditions.');
  assert.equal(dataBasis({ mode: 'snapshot', snapshotAt: null, last: LAST }), 'Saved offline snapshot: not current conditions.', 'no invented date when the snapshot has none');
});

test('dataBasis: no reading is said plainly', () => {
  assert.equal(dataBasis({ mode: 'live', last: null }), 'No Diglis reading was available.');
});

test('imageFooter: which reading, when saved, that it is unofficial, and where the official warnings are', () => {
  const [basis, source, pointer, ...more] = imageFooter({ mode: 'live', last: LAST, now: SUMMER });
  assert.equal(more.length, 0);
  assert.equal(basis, 'Latest Diglis reading: Mon, 9 Nov 2026, 07:30 GMT. Saved Wed, 1 Jul 2026, 12:05 BST.');
  assert.match(source, /unofficial summary of Environment Agency real-time data \(Open Government Licence v3\)/);
  assert.equal(pointer, MAY_HAVE_CHANGED);
  assert.match(pointer, /GOV\.UK Check for flooding or call Floodline 0345 988 1188/);
});

test('imageFooter: a demo picture cannot pass for a real flood', () => {
  const lines = imageFooter({ mode: 'demo', last: LAST, now: WINTER });
  assert.match(lines[0], /^DEMO REPLAY of February 2020: illustrative, not current conditions\. Saved /);
  assert.doesNotMatch(lines.join(' '), /Latest Diglis reading/, 'the replayed reading is not offered as the latest one');
});

test('imageFileName: range, UK date and time, and a demo or snapshot says so in the name too', () => {
  assert.equal(imageFileName({ range: '7d', mode: 'live', now: WINTER }), 'diglis-7d-chart-2026-11-09-0730.png');
  assert.equal(imageFileName({ range: '24h', mode: 'live', now: SUMMER }), 'diglis-24h-chart-2026-07-01-1205.png', 'UK time, so 12:05 in summer');
  assert.equal(imageFileName({ range: '7d', mode: 'demo', now: WINTER }), 'DEMO-replay-diglis-7d-chart-2026-11-09-0730.png');
  assert.equal(imageFileName({ range: '7d', mode: 'snapshot', now: WINTER }), 'SNAPSHOT-diglis-7d-chart-2026-11-09-0730.png');
  assert.doesNotMatch(imageFileName({ range: '7d', mode: 'live', now: SUMMER }), /[:\s/\\]/, 'a name every system accepts');
});

// A stand-in for a canvas context: every character is 10 units wide.
const ruler = { measureText: s => ({ width: s.length * 10 }) };

test('wrapText: breaks at spaces so no line is wider than the space, and keeps every word', () => {
  const text = 'Readings and warnings may have changed since';
  const lines = wrapText(ruler, text, 200);
  assert.ok(lines.length > 1);
  assert.ok(lines.every(l => l.length * 10 <= 200), JSON.stringify(lines));
  assert.equal(lines.join(' '), text);
});

test('wrapText: short text is one line, a word wider than the space is kept whole, nothing gives no lines', () => {
  assert.deepEqual(wrapText(ruler, 'Saved today', 500), ['Saved today']);
  assert.deepEqual(wrapText(ruler, 'a supercalifragilistic b', 100), ['a', 'supercalifragilistic', 'b']);
  assert.deepEqual(wrapText(ruler, '   ', 100), []);
});
