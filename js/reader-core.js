/* Shared, dependency-free reader logic. Keep identical in both language sites. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HepsReaderCore = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const SCHEMA = 1;
  const STORAGE_KEY = 'heps.reader.v1';
  const ID_RE = /^(?:\d{4}\.\d{4,5}|[a-z][a-z0-9.-]*\/\d{7})(?:v\d+)?$/i;
  const FLAGS = ['read', 'later', 'star'];
  const text = (value, max = 16000) => typeof value === 'string' ? value.slice(0, max) : '';
  function id(value) {
    const candidate = String(value || '').replace(/^https?:\/\/arxiv\.org\/(?:abs|pdf)\//i, '').replace(/\.pdf$/i, '');
    return ID_RE.test(candidate) ? candidate : '';
  }
  const baseId = value => id(value).replace(/v\d+$/i, '');
  const normalize = value => String(value || '').normalize('NFKC').toLowerCase();
  function categories(paper) {
    const values = paper.allCategories || paper.category || paper.categories || [];
    return (Array.isArray(values) ? values : [values]).filter(value => typeof value === 'string');
  }
  function primaryCategory(paper) {
    // A merged allCategories array is a union, not an ordered primary category.
    const values = paper.category || paper.categories || categories(paper);
    return paper.primaryCategory || (Array.isArray(values) ? values[0] : values) || '';
  }
  function categoryInfo(paper, scope) {
    const primary = primaryCategory(paper);
    const visible = [...new Set(categories(paper))].filter(category => scope.includes(category));
    return { primary, visible, crossListed: !!(primary && !scope.includes(primary) && visible.length) };
  }
  function queryTerms(query) {
    const result = [];
    const pattern = /(-?)(?:(title|author|id|cat):)?(?:"([^"]*)"|(\S+))/gi;
    for (const match of String(query || '').slice(0, 500).matchAll(pattern)) {
      const term = normalize(match[3] ?? match[4]);
      if (term) result.push({ not: match[1] === '-', field: (match[2] || 'all').toLowerCase(), term });
      if (result.length === 32) break;
    }
    return result;
  }
  function matches(paper, terms) {
    const fields = {
      id: normalize(paper.id), title: normalize(paper.title),
      author: normalize(Array.isArray(paper.authors) ? paper.authors.join(' ') : paper.authors),
      cat: normalize(categories(paper).join(' '))
    };
    fields.all = Object.values(fields).concat(
      ['summary', 'details', 'motivation', 'method', 'result', 'conclusion'].map(key => normalize(paper[key]))
    ).join(' ');
    return terms.every(({ not, field, term }) => fields[field].includes(term) !== not);
  }
  function preferenceMatch(paper, keywords, authors) {
    const words = normalize([paper.title, paper.summary, paper.details].join(' '));
    const names = normalize(Array.isArray(paper.authors) ? paper.authors.join(' ') : paper.authors);
    return keywords.some(k => words.includes(normalize(k))) || authors.some(a => names.includes(normalize(a)));
  }
  function uniquePapers(papers) {
    const byId = new Map();
    for (const paper of papers) {
      const key = baseId(paper.id);
      if (!key) continue;
      const old = byId.get(key);
      if (!old) { byId.set(key, { ...paper, allCategories: [...new Set(categories(paper))] }); continue; }
      const version = p => Number(/v(\d+)$/i.exec(p.id)?.[1] || 0);
      const newer = version(paper) > version(old) || (version(paper) === version(old) && String(paper.date) > String(old.date));
      byId.set(key, { ...(newer ? paper : old), allCategories: [...new Set([...categories(old), ...categories(paper)])] });
    }
    return [...byId.values()];
  }
  function select(papers, state, entries = {}) {
    const terms = queryTerms(state.q);
    const hasPreference = !!(state.keywords?.length || state.authors?.length);
    let rows = uniquePapers(papers).filter(p => state.category === 'all' || !state.category || categories(p).includes(state.category));
    if (state.reading === 'unread') rows = rows.filter(p => !entries[baseId(p.id)]?.read);
    if (state.reading === 'later' || state.reading === 'star') rows = rows.filter(p => entries[baseId(p.id)]?.[state.reading]);
    const annotated = rows.map(p => ({ ...p, isMatched: terms.length ? matches(p, terms) : hasPreference && preferenceMatch(p, state.keywords || [], state.authors || []) }));
    const matched = annotated.filter(p => p.isMatched).length;
    const result = state.mode === 'filter' && (terms.length || hasPreference) ? annotated.filter(p => p.isMatched) : annotated;
    result.sort((a, b) => Number(b.isMatched) - Number(a.isMatched) || String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));
    return { papers: result, total: annotated.length, matched, hasQuery: !!(terms.length || hasPreference) };
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return '';
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(+date) && date.toISOString().slice(0, 10) === value ? value : '';
  }
  function snapshot(paper) {
    const paperId = id(paper.id);
    if (!paperId || !text(paper.title).trim()) throw new Error('Invalid paper metadata');
    const out = { id: paperId, url: 'https://arxiv.org/abs/' + paperId, date: validDate(paper.date), category: [...new Set([primaryCategory(paper), ...categories(paper)])].filter(Boolean).slice(0, 30) };
    for (const key of ['title', 'summary', 'details', 'motivation', 'method', 'result', 'conclusion']) out[key] = text(paper[key]);
    out.authors = text(Array.isArray(paper.authors) ? paper.authors.join(', ') : paper.authors);
    return out;
  }
  function validateLibrary(data) {
    if (!data || data.schema !== SCHEMA || !data.entries || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw new Error('Unsupported reading-list format');
    const pairs = Object.entries(data.entries);
    if (pairs.length > 20000) throw new Error('Reading list is too large');
    const entries = Object.create(null);
    for (const [key, entry] of pairs) {
      if (!key || key !== baseId(key) || !entry || FLAGS.some(flag => typeof entry[flag] !== 'boolean') || !Number.isFinite(entry.updatedAt) || entry.updatedAt < 0) throw new Error('Invalid reading-list entry');
      const paper = snapshot(entry.paper);
      if (key !== baseId(paper.id)) throw new Error('Mismatched paper identifier');
      entries[key] = { read: entry.read, later: entry.later, star: entry.star, updatedAt: entry.updatedAt, paper };
    }
    return { schema: SCHEMA, entries };
  }
  const emptyLibrary = () => ({ schema: SCHEMA, entries: Object.create(null) });
  function toggle(library, paper, flag, now = Date.now()) {
    if (!FLAGS.includes(flag)) throw new Error('Unknown reading state');
    const saved = snapshot(paper), key = baseId(saved.id);
    const old = library.entries[key] || { read: false, later: false, star: false };
    return { schema: SCHEMA, entries: { ...library.entries, [key]: { ...old, [flag]: !old[flag], updatedAt: now, paper: saved } } };
  }
  function mergeLibrary(local, incoming) {
    const validated = validateLibrary(incoming), entries = { ...local.entries };
    for (const [key, value] of Object.entries(validated.entries)) {
      if (!entries[key] || value.updatedAt > entries[key].updatedAt) entries[key] = value;
    }
    return { schema: SCHEMA, entries };
  }
  function readURL(href) {
    const p = new URL(href).searchParams;
    let start = validDate(p.get('from') || p.get('date')), end = validDate(p.get('to')) || start;
    if (start && end && start > end) [start, end] = [end, start];
    const values = key => p.getAll(key).slice(0, 30).map(x => x.slice(0, 120)).filter(Boolean);
    return { start, end, q: text(p.get('q'), 500), category: text(p.get('category'), 40) || 'all',
      mode: p.get('mode') === 'filter' ? 'filter' : 'priority',
      reading: ['unread', 'later', 'star'].includes(p.get('reading')) ? p.get('reading') : 'all',
      view: p.get('view') === 'list' ? 'list' : 'grid', paper: id(p.get('paper')),
      keywords: values('kw'), authors: values('author'), explicit: p.has('from') || p.has('date') || p.has('q') || p.has('paper') };
  }
  function viewURL(href, state, paper = null, share = false) {
    const url = new URL(href); url.search = ''; url.hash = '';
    const p = url.searchParams;
    if (paper) {
      if (validDate(paper.date)) p.set('date', paper.date);
      if (id(paper.id)) p.set('paper', id(paper.id));
    } else {
      if (validDate(state.start)) p.set('from', state.start);
      if (validDate(state.end) && state.end !== state.start) p.set('to', state.end);
      if (state.q) p.set('q', String(state.q).slice(0, 500));
      if (state.category && state.category !== 'all') p.set('category', state.category);
      if (state.mode === 'filter') p.set('mode', state.mode);
      if (!share && state.reading && state.reading !== 'all') p.set('reading', state.reading);
      if (state.view === 'list') p.set('view', state.view);
      for (const key of state.keywords || []) p.append('kw', key);
      for (const author of state.authors || []) p.append('author', author);
    }
    return url.toString();
  }
  return { SCHEMA, STORAGE_KEY, id, baseId, normalize, categories, primaryCategory, categoryInfo, queryTerms, matches, select, uniquePapers, validDate,
    snapshot, validateLibrary, emptyLibrary, toggle, mergeLibrary, readURL, viewURL };
});
