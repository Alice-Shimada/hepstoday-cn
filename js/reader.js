/* Reading tools for both sites. Site identity comes only from DATA_CONFIG. */
(() => {
  'use strict';
  const C = window.HepsReaderCore;
  if (!C) return;
  const chinese = DATA_CONFIG.repoName.endsWith('-cn');
  const labels = {
    title: ['文献阅读器', 'Paper reader'], all: ['全部论文', 'All papers'], unread: ['未读', 'Unread'], later: ['待读', 'Read later'], star: ['收藏', 'Saved'],
    priority: ['匹配优先', 'Matches first'], filter: ['只显示匹配', 'Matching only'], mode: ['搜索方式', 'Search mode'],
    scope: ['日期范围', 'Date range'], latest: ['最新一期', 'Latest batch'], week: ['最近 7 天', 'Last 7 days'], history: ['全部历史', 'All history'],
    share: ['复制当前筛选链接', 'Copy view link'], copied: ['链接已复制。', 'Link copied.'], copyManually: ['请复制链接：', 'Copy this link:'],
    search: ['标题、作者、arXiv ID；支持 "短语" 和 -排除词', 'Title, author, arXiv ID; supports "phrases" and -exclusions'],
    searchHelp: ['空格连接的条件同时满足；支持 title:、author:、id:、cat:。输入文字时暂不使用兴趣标签。', 'Space-separated terms use AND. Supports title:, author:, id:, cat:. Text search temporarily takes precedence over interest tags.'],
    clear: ['清空搜索', 'Clear search'], library: ['本地阅读清单', 'Local reading list'],
    local: ['阅读状态只保存在此浏览器。中英文站及不同设备不会自动同步；可用备份导入导出迁移。', 'Reading state stays in this browser. The two sites and other devices do not sync automatically; use backup export/import to transfer it.'],
    export: ['导出清单备份', 'Export backup'], import: ['合并导入备份', 'Merge backup'], markdown: ['导出当前结果 Markdown', 'Export results as Markdown'],
    imported: ['备份已合并；相同论文保留较新的标记。', 'Backup merged; newer marks win for the same paper.'],
    invalid: ['导入失败，原清单未改动：', 'Import failed; the existing list was not changed: '],
    storage: ['浏览器存储不可用或已满。新标记仅在当前页面有效，请导出备份。', 'Browser storage is unavailable or full. New marks last only on this page; export a backup.'],
    corrupt: ['已保存的清单无法解析；原数据未覆盖。请先导出原始备份，再恢复清单。', 'The saved list could not be read; it has not been overwritten. Export the original backup before recovery.'],
    read: ['标为已阅', 'Mark read'], readOn: ['已阅', 'Read'], laterOn: ['已加入待读', 'In read later'], starOn: ['已收藏', 'Saved'],
    details: ['查看详情', 'Details'], paperLink: ['复制论文链接', 'Copy paper link'], loadPdf: ['点击加载 PDF 预览', 'Load PDF preview'],
    source: ['AI 解读基于作者摘要生成，未阅读全文。请核对下方原始摘要和论文。', "AI explanations use the authors’ abstract, not the full paper. Check the original abstract and paper below."],
    authors: ['作者', 'Authors'], categories: ['分类', 'Categories'], date: ['本站数据日期', 'Site data date'],
    motivation: ['研究动机', 'Motivation'], method: ['研究方法', 'Method'], result: ['结果', 'Results'], conclusion: ['结论', 'Conclusion'], abstract: ['原始摘要', 'Original abstract'],
    empty: ['没有符合当前条件的论文。可调整搜索、分类或阅读状态。', 'No papers match this view. Adjust the search, category or reading state.'],
    emptyLibrary: ['清单中还没有论文。可在论文卡片上加入待读或收藏。', 'This list is empty. Use the read-later or save button on a paper card.'],
    more: ['显示更多', 'Show more'], retry: ['只重试失败日期', 'Retry failed dates'], refresh: ['重新获取索引', 'Reload index'],
    loading: ['正在加载', 'Loading'], loaded: ['已加载', 'Loaded'], files: ['个数据文件', 'data files'], latestData: ['最新可用数据', 'Latest available data'],
    complete: ['所选范围的已索引文件均已加载。', 'All indexed files in the selected range are loaded.'],
    partial: ['内容不完整，失败日期：', 'Incomplete results. Failed dates: '], noFiles: ['所选范围没有已索引文件；这不能用于判断 arXiv 当日是否有公告。', 'No indexed files in this range; this does not establish whether arXiv announced papers that day.'],
    noIndex: ['暂时无法取得数据索引；不能据此判断今日无论文。', 'The data index is unavailable; this does not mean there are no papers today.'],
    localScope: ['显示跨日期保存的本地清单；下方日期加载状态不代表清单的完整性。', 'Showing your saved list across dates; the loading status below is not a completeness check of your list.'],
    knownOnly: ['完整性仅针对本站索引，不代表已核验 arXiv 全部公告。', 'Completeness refers to this site’s index, not a verification of every arXiv announcement.'],
    notFound: ['指定论文未能在该日期的数据中找到。请检查加载状态或打开 arXiv 原文。', 'The linked paper was not found in this date’s data. Check loading status or open the arXiv original.'],
    count: ['篇不同论文', 'unique papers'], matched: ['篇匹配', 'matching'], showing: ['正在显示', 'Showing'], matchedLabel: ['匹配搜索或兴趣条件', 'Matches search or interests'],
    close: ['关闭详情', 'Close details'], resultSource: ['本地收藏中的文字来自保存时的页面，可能与当前语言不同。', 'Saved text is a snapshot and may be in a different language.']
  };
  const t = key => labels[key][chinese ? 0 : 1];
  const state = { start: '', end: '', q: '', mode: 'priority', reading: 'all', category: 'all', keywords: [], authors: [], view: 'grid' };
  let library = C.emptyLibrary(), storageWarning = '', corruptBackup = '', mounted = false, restoring = false, opened = null, returnFocus = null;
  let loadStatus = null, pageSize = 60, renderSignature = '', urlTimer = null;
  let resultPapers = [], restoreSequence = 0;
  const $ = id => document.getElementById(id);
  function el(tag, className, content) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (content !== undefined) node.textContent = content;
    return node;
  }
  function button(label, handler, className = 'reader-button') {
    const node = el('button', className, label); node.type = 'button';
    node.addEventListener('click', handler); return node;
  }
  function notice(message) { if ($('readerNotice')) $('readerNotice').textContent = message; }
  function readLibrary() {
    try {
      const raw = localStorage.getItem(C.STORAGE_KEY);
      if (raw) {
        try { library = C.validateLibrary(JSON.parse(raw)); }
        catch { corruptBackup = raw; storageWarning = t('corrupt'); }
      }
    } catch { storageWarning = t('storage'); }
  }
  function persist(next) {
    library = next;
    if (corruptBackup) { notice(t('corrupt')); return; }
    try { localStorage.setItem(C.STORAGE_KEY, JSON.stringify(library)); storageWarning = ''; }
    catch { storageWarning = t('storage'); }
    if ($('readerStorage')) $('readerStorage').textContent = storageWarning || t('local');
  }
  function syncGlobals() {
    state.q = textSearchQuery; state.category = currentCategory; state.keywords = [...activeKeywords];
    state.authors = [...activeAuthors]; state.view = currentView;
  }
  function commitURL(push = false) {
    if (restoring || !mounted || opened) return;
    syncGlobals();
    const target = C.viewURL(location.href, state);
    clearTimeout(urlTimer);
    if (target !== location.href) {
      try { history[push ? 'pushState' : 'replaceState']({ hepsReader: true }, '', target); } catch { /* Restricted embedded browser. */ }
    }
    updateLanguageLink();
  }
  function updateLanguageLink() {
    const link = $('readerLanguage'); if (!link) return;
    const target = new URL(opened ? C.viewURL(location.href, state, opened) : C.viewURL(location.href, state, null, true));
    target.protocol = 'https:'; target.host = chinese ? 'en.heps.today' : 'cn.heps.today';
    link.href = target.toString();
  }
  async function copyLink(href) {
    try { await navigator.clipboard.writeText(href); notice(t('copied')); }
    catch { window.prompt(t('copyManually'), href); }
  }
  function download(name, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const link = el('a'); link.href = url; link.download = name;
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function markdownExport() {
    const escape = value => String(value || '').replace(/([\\`*_{}\[\]<>])/g, '\\$1');
    const lines = ['# HEPS Today reading list', '', `Exported: ${new Date().toISOString()}`, '',
      ...resultPapers.flatMap(p => [`## ${escape(p.title)}`, '', escape(p.authors), '', `https://arxiv.org/abs/${C.id(p.id)}`, '', escape(p.summary), ''])];
    download('heps-reading-list.md', lines.join('\n'), 'text/markdown;charset=utf-8');
  }
  function selectControl(id, label, options, handler) {
    const wrap = el('label', 'reader-select'); wrap.appendChild(el('span', '', label));
    const select = el('select'); select.id = id;
    options.forEach(([value, key]) => { const option = el('option', '', t(key)); option.value = value; select.appendChild(option); });
    select.addEventListener('change', () => handler(select.value)); wrap.appendChild(select); return wrap;
  }
  function mount() {
    if (mounted) return; mounted = true;
    readLibrary(); document.documentElement.lang = chinese ? 'zh-CN' : 'en';
    const panel = el('section', 'reader-panel'); panel.setAttribute('aria-label', t('title'));
    $('paperContainer').before(panel);
    const heading = el('div', 'reader-heading'); heading.appendChild(el('h1', '', t('title')));
    const language = el('a', 'reader-button', chinese ? 'English' : '中文'); language.id = 'readerLanguage'; heading.appendChild(language); panel.appendChild(heading);
    const toolbar = el('div', 'reader-toolbar');
    panel.appendChild(toolbar);
    const search = $('textSearchContainer');
    if (search) { toolbar.appendChild(search); $('textSearchInput').placeholder = t('search'); $('textSearchInput').setAttribute('aria-label', t('search')); $('textSearchClear').title = t('clear'); }
    toolbar.appendChild(selectControl('readerMode', t('mode'), [['priority', 'priority'], ['filter', 'filter']], value => { state.mode = value; commitURL(true); render(); }));
    panel.appendChild(el('p', 'reader-help', t('searchHelp')));
    const tabs = el('div', 'reader-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', t('library'));
    ['all', 'unread', 'later', 'star'].forEach(value => {
      const node = button(t(value), () => { state.reading = value; commitURL(true); render(); });
      node.dataset.reading = value; tabs.appendChild(node);
    });
    panel.appendChild(tabs);
    const range = el('div', 'reader-range');
    [['latest', () => loadPapersByDate(availableDates[0])], ['week', () => {
      const last = availableDates[0], first = new Date(last + 'T00:00:00Z'); first.setUTCDate(first.getUTCDate() - 6);
      return loadPapersByDateRange(first.toISOString().slice(0, 10), last);
    }], ['history', () => loadPapersByDateRange(availableDates[availableDates.length - 1], availableDates[0])]].forEach(([key, action]) => {
      const node = button(t(key), () => { if (!availableDates.length) return; state.reading = 'all'; action(); }); node.dataset.range = key; range.appendChild(node);
    });
    range.appendChild(button(t('share'), () => { syncGlobals(); copyLink(C.viewURL(location.href, state, null, true)); }));
    panel.appendChild(range);
    const localScope = el('p', 'reader-help'); localScope.id = 'readerLocalScope'; panel.appendChild(localScope);
    const status = el('div', 'reader-status'); status.id = 'readerStatus'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.appendChild(status);
    const count = el('p', 'reader-count'); count.id = 'readerCount'; panel.appendChild(count);
    const noticeNode = el('p', 'reader-notice'); noticeNode.id = 'readerNotice'; noticeNode.setAttribute('role', 'status'); panel.appendChild(noticeNode);
    const tools = el('details', 'reader-tools'); tools.appendChild(el('summary', '', t('library')));
    const storage = el('p', 'reader-help', storageWarning || t('local')); storage.id = 'readerStorage'; tools.appendChild(storage);
    const actions = el('div', 'reader-range');
    actions.appendChild(button(t('export'), () => download('heps-reading-backup.json', corruptBackup || JSON.stringify(library, null, 2), 'application/json')));
    const importFile = el('input'); importFile.type = 'file'; importFile.accept = '.json,application/json'; importFile.hidden = true; importFile.id = 'readerImport';
    actions.appendChild(button(t('import'), () => importFile.click())); actions.appendChild(importFile);
    importFile.addEventListener('change', async () => {
      const file = importFile.files[0]; if (!file) return;
      try {
        if (file.size > 8 * 1024 * 1024) throw new Error('Maximum backup size: 8 MB');
        if (corruptBackup) throw new Error(t('corrupt'));
        const merged = C.mergeLibrary(library, JSON.parse(await file.text()));
        persist(merged); render(); notice(t('imported'));
      } catch (error) { notice(t('invalid') + error.message); }
      importFile.value = '';
    });
    actions.appendChild(button(t('markdown'), markdownExport)); tools.appendChild(actions); panel.appendChild(tools);
    const modal = $('paperModal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-labelledby', 'modalTitle');
    $('closeModal').setAttribute('aria-label', t('close'));
    window.addEventListener('popstate', () => restore(location.href));
    window.addEventListener('storage', event => {
      if (event.key !== C.STORAGE_KEY) return;
      try { library = event.newValue ? C.validateLibrary(JSON.parse(event.newValue)) : C.emptyLibrary(); render(); refreshMarks(); }
      catch { notice(t('corrupt')); }
    });
    modal.addEventListener('keydown', event => {
      if (event.key !== 'Tab') return;
      const nodes = [...modal.querySelectorAll('button, a[href], input, select, iframe')].filter(node => !node.hidden && node.getClientRects().length);
      if (!nodes.length) return;
      if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes[nodes.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === nodes[nodes.length - 1]) { event.preventDefault(); nodes[0].focus(); }
    });
    updateStatus(); updateLanguageLink();
  }
  function updateStatus() {
    const host = $('readerStatus'); if (!host) return; host.replaceChildren();
    const s = loadStatus;
    if (!s) { host.appendChild(el('span', '', t('noIndex'))); host.appendChild(button(t('refresh'), () => location.reload())); return; }
    host.classList.toggle('reader-status-warning', !!s.failed.length || !s.total);
    const line = `${t('latestData')}: ${s.latest || '—'} · ${t(s.loading ? 'loading' : 'loaded')} ${s.loaded}/${s.total} ${t('files')}`;
    host.appendChild(el('p', '', line));
    if (s.failed.length) {
      host.appendChild(el('p', '', t('partial') + s.failed.join(', ')));
      const retry = button(t('retry'), () => window.HEPS_LOAD?.retry()); retry.disabled = s.loading; host.appendChild(retry);
    } else if (!s.loading) host.appendChild(el('p', '', s.total ? t('complete') : t('noFiles')));
    host.appendChild(el('small', '', t('knownOnly')));
  }
  function markButtons(paper) {
    const group = el('div', 'reader-marks');
    const key = C.baseId(paper.id);
    ['read', 'later', 'star'].forEach(flag => {
      const active = !!library.entries[key]?.[flag];
      const label = t(active ? flag + 'On' : flag);
      const node = button(label, event => {
        event.stopPropagation(); persist(C.toggle(library, paper, flag));
        const focusedFlag = flag; render(); refreshMarks();
        const selector = `[data-paper-key="${CSS.escape(key)}"] [data-mark="${focusedFlag}"]`;
        const replacement = (opened ? $('modalBody') : $('paperContainer')).querySelector(selector);
        if (replacement) replacement.focus();
      });
      node.dataset.mark = flag; node.setAttribute('aria-pressed', String(active)); group.appendChild(node);
    });
    group.dataset.paperKey = key; return group;
  }
  function refreshMarks() {
    if (!opened) return;
    const old = $('modalBody').querySelector('.reader-marks'); if (old) old.replaceWith(markButtons(opened));
  }
  function render() {
    if (!mounted) return;
    syncGlobals();
    const savedView = state.reading === 'later' || state.reading === 'star';
    const source = savedView ? Object.values(library.entries).filter(entry => entry[state.reading]).map(entry => entry.paper) : Object.values(paperData).flat();
    const result = C.select(source, state, library.entries); resultPapers = result.papers; currentFilteredPapers = result.papers;
    const signature = JSON.stringify([state, result.papers.map(p => p.id)]);
    if (signature !== renderSignature) pageSize = 60;
    renderSignature = signature;
    const container = $('paperContainer'); container.replaceChildren(); container.className = `paper-container reader-cards ${currentView === 'list' ? 'list-view' : ''}`;
    $('readerMode').value = state.mode;
    document.querySelectorAll('[data-reading]').forEach(node => { node.setAttribute('aria-pressed', String(node.dataset.reading === state.reading)); });
    $('readerLocalScope').textContent = savedView ? t('localScope') + ' ' + t('resultSource') : '';
    $('readerCount').textContent = `${result.total} ${t('count')}${result.hasQuery ? ` · ${result.matched} ${t('matched')}` : ''} · ${t('showing')} ${Math.min(pageSize, result.papers.length)}/${result.papers.length}`;
    if (!result.papers.length) container.appendChild(el('p', 'reader-empty', savedView && !source.length ? t('emptyLibrary') : t('empty')));
    const fragment = document.createDocumentFragment();
    result.papers.slice(0, pageSize).forEach((paper, index) => {
      const card = el('article', `paper-card${paper.isMatched ? ' matched-paper' : ''}`); card.dataset.id = paper.id;
      if (paper.isMatched) card.title = t('matchedLabel');
      const head = el('div', 'paper-card-header');
      const title = el('h3', 'paper-card-title'); const link = el('a', 'reader-paper-title', paper.title);
      link.href = C.viewURL(location.href, state, paper);
      link.addEventListener('click', event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); show(paper, index + 1); } });
      title.appendChild(link); head.appendChild(title);
      const authors = el('p', 'paper-card-authors', paper.authors); authors.title = paper.authors; head.appendChild(authors);
      const tags = el('div', 'paper-card-categories'); C.categories(paper).forEach(category => tags.appendChild(el('span', 'category-tag', category))); head.appendChild(tags); card.appendChild(head);
      const body = el('div', 'paper-card-body'); body.appendChild(el('p', 'paper-card-summary', paper.summary));
      const footer = el('div', 'paper-card-footer'); footer.appendChild(el('span', 'paper-card-date', `${paper.date || '—'} · ${paper.id}`)); body.appendChild(footer);
      body.appendChild(markButtons(paper)); card.appendChild(body);
      card.addEventListener('click', event => { if (!event.target.closest('button,a')) show(paper, index + 1); }); fragment.appendChild(card);
    });
    container.appendChild(fragment);
    if (result.papers.length > pageSize) {
      const more = button(`${t('more')} (${result.papers.length - pageSize})`, () => { pageSize += 60; render(); }, 'reader-button reader-more'); container.appendChild(more);
    }
    clearTimeout(urlTimer); urlTimer = setTimeout(() => commitURL(), 180);
  }
  function safeExternal(value) {
    try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; }
  }
  function inertBackground(value) {
    document.querySelectorAll('header, main, footer, #backToTop').forEach(node => { node.inert = value; });
  }
  function show(paper, index) {
    const paperId = C.id(paper.id); if (!paperId) return;
    const wasOpen = !!opened;
    if (!wasOpen) { commitURL(); returnFocus = document.activeElement; }
    opened = paper;
    currentPaperIndex = currentFilteredPapers.findIndex(p => p.id === paper.id);
    if (currentPaperIndex < 0) { currentFilteredPapers = [paper]; currentPaperIndex = 0; }
    const body = $('modalBody'); body.replaceChildren(); body.scrollTop = 0;
    $('modalTitle').textContent = paper.title;
    body.appendChild(markButtons(paper));
    const actions = el('div', 'reader-range'); actions.appendChild(button(t('paperLink'), () => copyLink(C.viewURL(location.href, state, paper))));
    const otherLanguage = el('a', 'reader-button', chinese ? 'English' : '中文');
    const translatedURL = new URL(C.viewURL(location.href, state, paper)); translatedURL.protocol = 'https:';
    translatedURL.host = chinese ? 'en.heps.today' : 'cn.heps.today'; otherLanguage.href = translatedURL.toString();
    actions.appendChild(otherLanguage); body.appendChild(actions);
    for (const [key, content] of [['authors', paper.authors], ['categories', C.categories(paper).join(', ')], ['date', paper.date || '—']]) {
      const row = el('p', 'reader-meta'); row.appendChild(el('strong', '', t(key) + ': ')); row.appendChild(document.createTextNode(content)); body.appendChild(row);
    }
    body.appendChild(el('p', 'reader-source', t('source')));
    body.appendChild(el('h3', '', 'TL;DR')); body.appendChild(el('p', 'reader-prose', paper.summary));
    for (const key of ['motivation', 'method', 'result', 'conclusion', 'details']) {
      if (!paper[key]) continue;
      body.appendChild(el('h3', '', t(key === 'details' ? 'abstract' : key))); body.appendChild(el('p', 'reader-prose', paper[key]));
    }
    const pdf = el('div', 'reader-pdf');
    pdf.appendChild(button(t('loadPdf'), event => {
      const iframe = el('iframe'); iframe.src = `https://arxiv.org/pdf/${paperId}`; iframe.title = 'PDF: ' + paper.title;
      iframe.loading = 'lazy'; iframe.referrerPolicy = 'no-referrer'; iframe.className = 'reader-pdf-frame';
      event.currentTarget.replaceWith(iframe);
    })); body.appendChild(pdf);
    $('paperLink').href = `https://arxiv.org/abs/${paperId}`; $('pdfLink').href = `https://arxiv.org/pdf/${paperId}`; $('htmlLink').href = `https://arxiv.org/html/${paperId}`;
    const code = safeExternal(paper.code_url); $('githubLink').href = code || '#'; $('githubLink').style.display = code ? 'flex' : 'none';
    const kimi = new URL('https://www.kimi.com/_prefill_chat');
    kimi.searchParams.set('prefill_prompt', (chinese ? '请阅读并解释这篇论文：' : 'Read and explain this paper: ') + `https://arxiv.org/pdf/${paperId}`);
    $('kimiChatLink').href = kimi.href;
    $('paperModal').querySelectorAll('a[target="_blank"]').forEach(link => { link.rel = 'noopener noreferrer'; });
    $('paperPosition').textContent = `${currentPaperIndex + 1} / ${currentFilteredPapers.length}`;
    $('paperModal').classList.add('active'); document.body.style.overflow = 'hidden'; inertBackground(true); $('closeModal').focus();
    if (!restoring) {
      try { history[wasOpen ? 'replaceState' : 'pushState']({ hepsReaderModal: true }, '', C.viewURL(location.href, state, paper)); } catch { /* No history access. */ }
    }
    updateLanguageLink();
  }
  function hide() {
    opened = null; $('paperModal').classList.remove('active'); $('modalBody').replaceChildren(); document.body.style.overflow = ''; inertBackground(false);
    if (returnFocus?.isConnected) returnFocus.focus(); updateLanguageLink();
  }
  function close() {
    const goBack = !!history.state?.hepsReaderModal;
    hide(); if (goBack) history.back(); else commitURL();
  }
  async function restore(href) {
    const sequence = ++restoreSequence;
    restoring = true; clearTimeout(urlTimer); hide();
    const parsed = C.readURL(href); Object.assign(state, parsed);
    if (!parsed.explicit) { state.keywords = [...activeKeywords]; state.authors = [...activeAuthors]; }
    activeKeywords = [...state.keywords]; activeAuthors = [...state.authors]; previousActiveKeywords = null; previousActiveAuthors = null;
    // Keep shared-link interests available for toggling without changing saved preferences.
    userKeywords = [...new Set([...userKeywords, ...state.keywords])];
    userAuthors = [...new Set([...userAuthors, ...state.authors])];
    textSearchQuery = state.q; currentCategory = state.category; currentView = state.view;
    $('textSearchInput').value = state.q; $('textSearchClear').style.display = state.q ? 'inline-flex' : 'none'; renderFilterTags();
    state.start ||= availableDates[0] || ''; state.end ||= state.start;
    if (state.start) await loadPapersByDateRange(state.start, state.end); else { render(); updateStatus(); }
    if (sequence !== restoreSequence) return;
    if (parsed.paper) {
      const paper = C.uniquePapers(Object.values(paperData).flat()).find(p => C.baseId(p.id) === C.baseId(parsed.paper));
      if (paper) show(paper); else notice(t('notFound'));
    }
    restoring = false; commitURL();
  }
  document.addEventListener('heps:load-status', event => {
    loadStatus = event.detail;
    const changed = state.start !== loadStatus.start || state.end !== loadStatus.end;
    if (changed && opened) hide();
    state.start = loadStatus.start; state.end = loadStatus.end;
    updateStatus(); if (changed) commitURL(true);
    if (!loadStatus.loading && mounted) updateLanguageLink();
  });
  function renderInterests() {
    const host = $('filterTags'); if (!host) return;
    host.replaceChildren();
    const groups = [
      ['author', [...new Set([...userAuthors, ...activeAuthors])], activeAuthors, toggleAuthorFilter],
      ['keyword', [...new Set([...userKeywords, ...activeKeywords])], activeKeywords, toggleKeywordFilter]
    ];
    for (const [kind, values, active, toggle] of groups) {
      for (const value of values) {
        const node = button(value, () => { toggle(value); renderInterests(); }, `category-button ${kind}-button${active.includes(value) ? ' active' : ''}`);
        node.dataset[kind] = value; node.setAttribute('aria-pressed', String(active.includes(value))); host.appendChild(node);
      }
    }
    host.style.display = host.childElementCount ? 'flex' : 'none';
    const parent = document.querySelector('.filter-label-container');
    // Before mount the search box still lives here; never hide it prematurely.
    if (parent) parent.style.display = mounted && !host.childElementCount ? 'none' : 'flex';
  }
  window.HEPS_READER = { boot: async () => { mount(); await restore(location.href); }, render, show, close, renderInterests };
})();
