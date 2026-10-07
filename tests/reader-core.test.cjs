const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/reader-core.js');
const paper = (id = '2610.00001', extra = {}) => ({ id, title: 'Canonical differential equations for Feynman integrals',
  authors: 'Alice Smith, Bob Jones', date: '2026-10-05', category: ['hep-th', 'hep-ph'],
  summary: 'An integration-by-parts algorithm.', details: 'A two-loop numerical method.', ...extra });
const state = extra => ({ category: 'all', mode: 'priority', reading: 'all', q: '', keywords: [], authors: [], ...extra });

test('IDs support old/new arXiv schemes, versions and PDF URLs; reject unsafe values', () => {
  assert.equal(C.id('https://arxiv.org/pdf/hep-th/9901001v2.pdf'), 'hep-th/9901001v2');
  assert.equal(C.baseId('2610.00001v3'), '2610.00001');
  for (const value of ['__proto__', 'javascript:alert(1)', '2610.00001?x=1', '<img>', '../../x', '']) assert.equal(C.id(value), '');
});
test('search uses AND, quoted phrases, exclusions and bounded terms', () => {
  assert(C.matches(paper(), C.queryTerms('"differential equations" two-loop -elliptic')));
  assert(!C.matches(paper(), C.queryTerms('canonical elliptic')));
  assert(!C.matches(paper(), C.queryTerms('canonical -numerical')));
  assert(C.matches(paper(), C.queryTerms('-elliptic')));
  assert(C.queryTerms('a '.repeat(100)).length <= 32);
});
test('fielded searches cover author, title, category and exact ID strings', () => {
  assert(C.matches(paper(), C.queryTerms('author:"alice smith" cat:hep-ph title:canonical id:2610.00001')));
  assert(!C.matches(paper(), C.queryTerms('author:canonical')));
  assert(C.matches(paper('2610.00002', { title: '费曼积分约化方法' }), C.queryTerms('费曼 积分')));
});
test('matching-first keeps nonmatches; matching-only removes them', () => {
  const rows = [paper('2610.00002', { title: 'Dark matter', summary: '', details: '' }), paper()];
  const ranked = C.select(rows, state({ q: 'canonical' }));
  assert.equal(ranked.papers.length, 2); assert.equal(ranked.matched, 1); assert.equal(ranked.papers[0].id, '2610.00001');
  assert.equal(C.select(rows, state({ q: 'canonical', mode: 'filter' })).papers.length, 1);
  assert.equal(C.select(rows, state({ mode: 'filter' })).papers.length, 2);
});
test('text search takes precedence over interests; cross-listed categories remain searchable', () => {
  assert.equal(C.select([paper()], state({ q: 'canonical', keywords: ['unrelated'], mode: 'filter' })).papers.length, 1);
  assert.equal(C.select([paper()], state({ category: 'hep-ph' })).papers.length, 1);
  assert.equal(C.select([paper()], state({ keywords: ['two-loop'], mode: 'filter' })).papers.length, 1);
});
test('range merging deduplicates versions by base ID and unions categories', () => {
  const result = C.uniquePapers([paper('2610.00001v1', { date: '2026-10-05', category: ['hep-th'] }),
    paper('2610.00001v2', { date: '2026-10-04', category: ['hep-ph'] })]);
  assert.equal(result.length, 1); assert.equal(result[0].id, '2610.00001v2');
  assert.deepEqual(result[0].allCategories, ['hep-th', 'hep-ph']);
});
test('explicit read/later/star marks are independent and persist by base ID', () => {
  const empty = C.emptyLibrary(); let list = C.toggle(empty, paper(), 'star', 100);
  assert.equal(Object.keys(empty.entries).length, 0);
  list = C.toggle(list, paper('2610.00001v2'), 'read', 200);
  assert(list.entries['2610.00001'].star && list.entries['2610.00001'].read);
  assert(!list.entries['2610.00001'].later);
  assert.equal(C.select([paper()], state({ reading: 'unread' }), list.entries).papers.length, 0);
  assert.equal(C.select([paper()], state({ reading: 'star' }), list.entries).papers.length, 1);
  list = C.toggle(list, paper(), 'star', 300);
  assert(!list.entries['2610.00001'].star); assert(list.entries['2610.00001'].read);
});
test('validated backup merge keeps newer marks, including explicit unmarks', () => {
  const old = C.toggle(C.emptyLibrary(), paper(), 'star', 100);
  const latest = C.toggle(old, paper(), 'star', 200);
  assert(!C.mergeLibrary(old, latest).entries['2610.00001'].star);
  assert(!C.mergeLibrary(latest, old).entries['2610.00001'].star);
  assert.equal(C.mergeLibrary(old, old).entries['2610.00001'].updatedAt, 100);
});
test('invalid or oversized backups are rejected without mutating the local list', () => {
  const local = C.toggle(C.emptyLibrary(), paper(), 'star', 100), before = JSON.stringify(local);
  const invalid = [null, {}, { schema: 2, entries: {} }, { schema: 1, entries: [] },
    { schema: 1, entries: { invalid: {} } }, { schema: 1, entries: { '2610.00001': { read: 'yes' } } }];
  for (const value of invalid) assert.throws(() => C.mergeLibrary(local, value));
  assert.equal(JSON.stringify(local), before);
});
test('imported links are rebuilt from IDs and HTML remains plain metadata', () => {
  const list = C.toggle(C.emptyLibrary(), paper('2610.00001', { title: '<img src=x onerror=alert(1)>', url: 'javascript:evil()' }), 'star', 10);
  const result = C.validateLibrary(JSON.parse(JSON.stringify(list)));
  assert.equal(result.entries['2610.00001'].paper.url, 'https://arxiv.org/abs/2610.00001');
  assert.equal(result.entries['2610.00001'].paper.title, '<img src=x onerror=alert(1)>');
});
test('view links restore dates, search, mode, interests, category and local reading view', () => {
  const view = state({ start: '2026-10-01', end: '2026-10-05', q: 'author:"A B" -foo', mode: 'filter', category: 'hep-th',
    reading: 'unread', keywords: ['IBP', 'canonical form'], authors: ['A, B'], view: 'list' });
  const restored = C.readURL(C.viewURL('https://cn.heps.today/?unrelated=1', view));
  for (const key of Object.keys(view)) assert.deepEqual(restored[key], view[key]);
});
test('shared links omit private reading filters; paper permalinks are independent of filters', () => {
  const view = state({ start: '2026-10-05', end: '2026-10-05', reading: 'star', q: 'no-match' });
  const shared = C.readURL(C.viewURL('https://en.heps.today/', view, null, true));
  assert.equal(shared.reading, 'all');
  const link = C.readURL(C.viewURL('https://en.heps.today/', view, paper()));
  assert.equal(link.paper, '2610.00001'); assert.equal(link.start, '2026-10-05'); assert.equal(link.q, '');
});
test('category display uses the site scope without deleting cross-list metadata', () => {
  const p = paper('2610.00002', { category: ['quant-ph', 'hep-th', 'cond-mat.stat-mech', 'hep-th'] });
  const before = JSON.stringify(p);
  assert.deepEqual(C.categoryInfo(p, ['hep-th', 'hep-ph']), { primary: 'quant-ph', visible: ['hep-th'], crossListed: true });
  assert.equal(JSON.stringify(p), before);
  assert(C.matches(p, C.queryTerms('cat:quant-ph')));
  assert.equal(C.select([p], state({ category: 'hep-th' })).papers.length, 1);
});
test('an in-scope primary category is not marked as an incoming cross-list', () => {
  const p = paper('2610.00002', { category: ['hep-th', 'quant-ph', 'hep-ph'] });
  assert.deepEqual(C.categoryInfo(p, ['hep-th', 'hep-ph']), { primary: 'hep-th', visible: ['hep-th', 'hep-ph'], crossListed: false });
});
test('primary classification follows the selected version, not the merged union', () => {
  const [p] = C.uniquePapers([paper('2610.00001v1', { category: ['quant-ph', 'hep-th'] }),
    paper('2610.00001v2', { category: ['hep-th', 'quant-ph'] })]);
  assert.equal(C.categoryInfo(p, ['hep-th']).crossListed, false);
  assert.equal(C.primaryCategory(C.snapshot(p)), 'hep-th');
  const [incoming] = C.uniquePapers([paper('2610.00002v1', { category: ['hep-th'] }),
    paper('2610.00002v2', { category: ['quant-ph', 'hep-th'] })]);
  const saved = C.validateLibrary(JSON.parse(JSON.stringify(C.toggle(C.emptyLibrary(), incoming, 'star'))));
  assert.equal(C.categoryInfo(saved.entries['2610.00002'].paper, ['hep-th']).crossListed, true);
});
test('missing or unrelated categories cannot invent an incoming cross-list', () => {
  assert.deepEqual(C.categoryInfo(paper('2610.00002', { category: [] }), ['hep-th']), { primary: '', visible: [], crossListed: false });
  assert.equal(C.categoryInfo(paper('2610.00002', { category: ['quant-ph'] }), ['hep-th']).crossListed, false);
  assert.equal(C.primaryCategory({ categories: ['quant-ph', 'hep-th'] }), 'quant-ph');
});
test('invalid dates and paper parameters cannot become paths or scripts', () => {
  assert.equal(C.validDate('2026-02-30'), ''); assert.equal(C.validDate('2024-02-29'), '2024-02-29');
  const state = C.readURL('https://en.heps.today/?date=../../etc/passwd&paper=javascript:evil()&mode=bad');
  assert.equal(state.start, ''); assert.equal(state.paper, ''); assert.equal(state.mode, 'priority');
});
