(() => {
  'use strict';

  const FILE_RE = /(?:^|\/)(\d{4}-\d{2}-\d{2})_AI_enhanced_(English|Chinese)\.jsonl$/;
  const TIMEOUT = 10000;
  let rangeStart = '';
  let rangeEnd = '';

  const uniq = values => [...new Set(values.filter(Boolean))];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[char]);
  const localDate = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    return match ? new Date(+match[1], +match[2] - 1, +match[3]) : new Date(value);
  };
  const isoDate = date => [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
  const displayDate = value => {
    const date = localDate(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleDateString('en-US', {
      year: 'numeric', month: 'numeric', day: 'numeric'
    });
  };

  function rawUrls(path) {
    const raw = `https://raw.githubusercontent.com/${DATA_CONFIG.repoOwner}/${DATA_CONFIG.repoName}/${DATA_CONFIG.dataBranch}/${path}`;
    return uniq([DATA_CONFIG.getDataUrl?.(path), raw, `https://gh-proxy.org/${raw}`]);
  }

  function apiUrls(path) {
    const direct = `https://api.github.com${path}`;
    return [`https://gh-proxy.org/${direct}`, direct];
  }

  async function request(url) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT) : null;
    try {
      return await fetch(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function firstText(urls, validator = () => true) {
    const errors = [];
    for (const url of uniq(urls)) {
      try {
        const response = await request(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!validator(text)) throw new Error('unexpected content');
        return text;
      } catch (error) {
        errors.push(`${url}: ${error.message}`);
      }
    }
    throw new Error(errors.join(' | '));
  }

  async function discoverFiles() {
    let files = [];
    try {
      const manifest = await firstText(rawUrls('assets/file-list.txt'), text => text.includes('.jsonl'));
      files = manifest.split(/\r?\n/).map(line => line.trim()).filter(name => FILE_RE.test(name));
    } catch (error) {
      console.warn('Data manifest unavailable:', error);
    }

    const dates = new Set(files.map(name => name.match(FILE_RE)[1]));
    if (dates.size <= 1) {
      try {
        const owner = encodeURIComponent(DATA_CONFIG.repoOwner);
        const repo = encodeURIComponent(DATA_CONFIG.repoName);
        const branch = encodeURIComponent(DATA_CONFIG.dataBranch);
        const text = await firstText(
          apiUrls(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`),
          value => { try { return Array.isArray(JSON.parse(value).tree); } catch { return false; } }
        );
        const treeFiles = JSON.parse(text).tree
          .filter(item => item.type === 'blob' && FILE_RE.test(item.path))
          .map(item => item.path);
        files = uniq([...files, ...treeFiles]);
      } catch (error) {
        console.warn('GitHub tree fallback unavailable:', error);
      }
    }
    return files;
  }

  async function fixedFetchAvailableDates() {
    try {
      const map = new Map();
      (await discoverFiles()).forEach(file => {
        const match = file.match(FILE_RE);
        if (!match) return;
        if (!map.has(match[1])) map.set(match[1], []);
        if (!map.get(match[1]).includes(match[2])) map.get(match[1]).push(match[2]);
      });
      window.dateLanguageMap = map;
      availableDates = [...map.keys()].sort((a, b) => b.localeCompare(a));
      if (!availableDates.length) throw new Error('No enhanced paper files were found');
      if (!availableDates.includes(rangeStart)) rangeStart = availableDates[0];
      if (!availableDates.includes(rangeEnd)) rangeEnd = rangeStart;
      initDatePicker();
      return availableDates;
    } catch (error) {
      const container = document.getElementById('paperContainer') || document.getElementById('papersList');
      if (container) container.innerHTML = errorHtml(error);
      document.getElementById('currentDate').textContent = 'No data';
      console.error(error);
      return [];
    }
  }

  const bounds = () => ({ min: availableDates[availableDates.length - 1], max: availableDates[0] });
  function setRange(start, end = start) {
    [rangeStart, rangeEnd] = start <= end ? [start, end] : [end, start];
  }
  function syncPicker() {
    if (flatpickrInstance) {
      flatpickrInstance.setDate(isRangeMode ? [rangeStart, rangeEnd] : rangeStart, false);
    } else {
      const start = document.getElementById('nativeDateStart');
      const end = document.getElementById('nativeDateEnd');
      if (start) start.value = rangeStart;
      if (end) end.value = rangeEnd;
    }
  }
  function selectDates(start, end = start) {
    setRange(start, end);
    if (document.getElementById('paperContainer') && rangeStart === rangeEnd) loadPapersByDate(rangeStart);
    else loadPapersByDateRange(rangeStart, rangeEnd);
    toggleDatePicker();
  }

  function nativePicker() {
    const host = document.querySelector('.flatpickr-container');
    if (!host) return;
    const { min, max } = bounds();
    host.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:grid;gap:10px';
    const addInput = (id, label, value) => {
      const node = document.createElement('label');
      node.textContent = label;
      node.style.cssText = 'display:grid;gap:4px';
      const input = document.createElement('input');
      Object.assign(input, { id, type: 'date', min, max, value });
      input.style.cssText = 'display:block;width:100%;box-sizing:border-box';
      node.appendChild(input);
      wrap.appendChild(node);
    };
    addInput('nativeDateStart', isRangeMode ? 'Start' : 'Date', rangeStart);
    if (isRangeMode) addInput('nativeDateEnd', 'End', rangeEnd);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'button';
    button.textContent = 'Apply';
    button.onclick = () => {
      const start = document.getElementById('nativeDateStart').value;
      const end = isRangeMode ? document.getElementById('nativeDateEnd').value : start;
      if (!start || !end) return;
      if (!isRangeMode && !availableDates.includes(start)) return alert('No papers are available for that date.');
      selectDates(start, end);
    };
    wrap.appendChild(button);
    host.appendChild(wrap);
  }

  function fixedInitDatePicker() {
    if (!availableDates.length) return;
    if (flatpickrInstance) {
      flatpickrInstance.destroy();
      flatpickrInstance = null;
    }
    if (typeof flatpickr !== 'function') return nativePicker();
    const input = document.getElementById('datepicker');
    const available = new Set(availableDates);
    const { min, max } = bounds();
    const options = {
      inline: true,
      mode: isRangeMode ? 'range' : 'single',
      dateFormat: 'Y-m-d',
      minDate: min,
      maxDate: max,
      defaultDate: isRangeMode ? [rangeStart, rangeEnd] : rangeStart,
      onChange(dates) {
        if (isRangeMode && dates.length === 2) selectDates(isoDate(dates[0]), isoDate(dates[1]));
        if (!isRangeMode && dates.length === 1 && available.has(isoDate(dates[0]))) selectDates(isoDate(dates[0]));
      }
    };
    if (!isRangeMode) options.enable = [date => available.has(isoDate(date))];
    flatpickrInstance = flatpickr(input, options);
    const hidden = document.querySelector('.flatpickr-input');
    if (hidden) hidden.style.display = 'none';
  }

  function fixedToggleRangeMode() {
    isRangeMode = document.getElementById('dateRangeMode').checked;
    if (isRangeMode) rangeEnd ||= rangeStart || availableDates[0];
    else rangeStart = rangeEnd || rangeStart || availableDates[0], rangeEnd = rangeStart;
    initDatePicker();
  }

  function fixedToggleDatePicker() {
    const modal = document.getElementById('datePickerModal');
    if (!modal) return;
    modal.classList.toggle('active');
    const open = modal.classList.contains('active');
    document.body.style.overflow = open ? 'hidden' : '';
    if (open) syncPicker();
  }

  async function paperFile(date) {
    const language = selectLanguageForDate(date);
    const path = `data/${date}_AI_enhanced_${language}.jsonl`;
    const text = await firstText(rawUrls(path), value => !value.trim() || value.trimStart().startsWith('{'));
    return parseJsonlData(text, date);
  }

  async function pool(items, worker, limit = 6) {
    const output = new Array(items.length);
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        try { output[current] = { ok: true, value: await worker(items[current]) }; }
        catch (error) { output[current] = { ok: false, error, item: items[current] }; }
      }
    }));
    return output;
  }

  const datesInRange = (start, end, asc = false) => availableDates
    .filter(date => date >= start && date <= end)
    .sort((a, b) => asc ? a.localeCompare(b) : b.localeCompare(a));
  const loadingHtml = (start, end) => `<div class="loading-container"><div class="loading-spinner"></div><p>Loading papers for ${start === end ? displayDate(start) : `${displayDate(start)} to ${displayDate(end)}`}...</p></div>`;
  const errorHtml = error => `<div class="loading-container"><p>Loading data failed. Please retry.</p><p>Error message: ${esc(error.message)}</p></div>`;

  function installPaperPage() {
    loadPapersByDate = async date => {
      setRange(date);
      currentDate = date;
      document.getElementById('currentDate').textContent = displayDate(date);
      const container = document.getElementById('paperContainer');
      container.innerHTML = loadingHtml(date, date);
      try {
        paperData = await paperFile(date);
        if (!Object.keys(paperData).length) throw new Error('No valid papers were found');
        renderCategoryFilter(getAllCategories(paperData));
        renderPapers();
      } catch (error) {
        paperData = {};
        renderCategoryFilter({ sortedCategories: [], categoryCounts: {} });
        container.innerHTML = errorHtml(error);
      }
    };

    loadPapersByDateRange = async (start, end) => {
      setRange(start, end);
      const dates = datesInRange(rangeStart, rangeEnd);
      if (!dates.length) return alert('No available papers exist in the selected date range.');
      currentDate = `${rangeStart} to ${rangeEnd}`;
      document.getElementById('currentDate').textContent = `${displayDate(rangeStart)} - ${displayDate(rangeEnd)}`;
      const container = document.getElementById('paperContainer');
      container.innerHTML = loadingHtml(rangeStart, rangeEnd);
      try {
        const merged = {};
        (await pool(dates, paperFile)).forEach(result => {
          if (!result.ok) return console.warn(`Failed to load ${result.item}:`, result.error);
          Object.entries(result.value).forEach(([category, papers]) => (merged[category] ||= []).push(...papers));
        });
        if (!Object.keys(merged).length) throw new Error('No files in the selected range could be loaded');
        paperData = merged;
        renderCategoryFilter(getAllCategories(paperData));
        renderPapers();
      } catch (error) {
        container.innerHTML = errorHtml(error);
      }
    };
  }

  const STOP = new Set('about above after again against also among and another approach are artificial based been before being between both but can data dataset datasets deep demonstrate demonstrates evaluation experimental experiments for from framework has have into its learning machine method model models multi network networks new not our paper performance propose proposed results show shows state system task tasks that the their this through towards using via which with without'.split(' '));
  function keywords(title) {
    const words = String(title || '').toLowerCase().replace(/\$[^$]*\$/g, ' ').replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
      .map(word => word.replace(/^-+|-+$/g, '')).filter(word => word.length > 2 && !STOP.has(word) && !/^\d+$/.test(word));
    const terms = new Set(words);
    words.slice(0, -1).forEach((word, i) => terms.add(`${word} ${words[i + 1]}`));
    return terms;
  }

  function keywordStats(papers, dates) {
    const total = new Map();
    const trends = new Map(dates.map(date => [date, new Map()]));
    papers.forEach(paper => keywords(paper.title).forEach(term => {
      total.set(term, (total.get(term) || 0) + 1);
      const day = trends.get(paper.date) || new Map();
      day.set(term, (day.get(term) || 0) + 1);
      trends.set(paper.date, day);
    }));
    return {
      top: [...total].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 30),
      trends
    };
  }

  function drawChart(canvas, dates, terms, trends) {
    const ctx = canvas.getContext('2d');
    const width = canvas.width = 920, height = canvas.height = 400;
    const left = 55, right = 190, top = 25, bottom = 70;
    const plotW = width - left - right, plotH = height - top - bottom;
    const colors = ['#4e79a7','#f28e2c','#59a14f','#e15759','#76b7b2','#edc949','#af7aa1','#ff9da7','#9c755f','#79706e'];
    const series = terms.map(term => dates.map(date => trends.get(date)?.get(term) || 0));
    const max = Math.max(1, ...series.flat());
    const x = i => left + i * plotW / Math.max(1, dates.length - 1);
    const y = value => top + plotH - value * plotH / max;
    ctx.clearRect(0, 0, width, height);
    ctx.font = '12px sans-serif';
    ctx.strokeStyle = '#ddd'; ctx.fillStyle = '#666';
    for (let i = 0; i <= 5; i++) {
      const value = Math.round(max * i / 5), py = y(value);
      ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(left + plotW, py); ctx.stroke();
      ctx.fillText(String(value), 12, py + 4);
    }
    const step = Math.max(1, Math.ceil(dates.length / 8));
    dates.forEach((date, i) => { if (i % step === 0 || i === dates.length - 1) ctx.fillText(date, x(i) - 28, top + plotH + 25); });
    terms.forEach((term, s) => {
      ctx.strokeStyle = colors[s]; ctx.lineWidth = 2; ctx.beginPath();
      series[s].forEach((value, i) => i ? ctx.lineTo(x(i), y(value)) : ctx.moveTo(x(i), y(value)));
      ctx.stroke(); ctx.fillStyle = colors[s]; ctx.fillRect(left + plotW + 22, top + s * 27, 16, 16);
      ctx.fillStyle = '#333'; ctx.fillText(term, left + plotW + 46, top + 12 + s * 27);
    });
  }

  function renderStats(container, dates, stats, showTrend) {
    container.innerHTML = '<div class="statistics-section"><h2>Popular Keywords</h2><div class="statistics-card"><div class="keyword-list"></div></div></div>';
    const section = container.querySelector('.statistics-section');
    const list = container.querySelector('.keyword-list');
    if (!stats.top.length) list.innerHTML = '<div class="loading-container"><p>No keywords could be extracted.</p></div>';
    stats.top.forEach(([term, count], index) => {
      const row = document.createElement('div');
      row.className = 'keyword-item'; row.tabIndex = 0;
      row.innerHTML = `<span class="keyword-rank">${index + 1}</span><span class="keyword-text">${esc(term)}</span><span class="keyword-count">${count}</span>`;
      row.onclick = () => showRelatedPapers(term);
      row.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') row.click(); };
      list.appendChild(row);
    });
    if (showTrend) {
      section.insertAdjacentHTML('beforeend', '<h2 class="trend-title">Keyword Trends</h2><div class="statistics-card"><canvas id="trendChart" style="width:100%;height:400px"></canvas></div>');
      requestAnimationFrame(() => drawChart(document.getElementById('trendChart'), dates, stats.top.slice(0, 10).map(item => item[0]), stats.trends));
    }
  }

  function installStatisticsPage() {
    loadPapersByDateRange = async (start, end) => {
      setRange(start, end);
      const dates = datesInRange(rangeStart, rangeEnd, true);
      if (!dates.length) return alert('No available papers exist in the selected date range.');
      currentDate = rangeStart === rangeEnd ? rangeStart : `${rangeStart} - ${rangeEnd}`;
      document.getElementById('currentDate').textContent = rangeStart === rangeEnd ? displayDate(rangeStart) : `${displayDate(rangeStart)} - ${displayDate(rangeEnd)}`;
      const container = document.getElementById('papersList');
      container.innerHTML = loadingHtml(rangeStart, rangeEnd);
      try {
        const merged = {}, papers = [];
        (await pool(dates, paperFile)).forEach(result => {
          if (!result.ok) return console.warn(`Failed to load ${result.item}:`, result.error);
          Object.entries(result.value).forEach(([category, items]) => {
            (merged[category] ||= []).push(...items); papers.push(...items);
          });
        });
        if (!papers.length) throw new Error('No files in the selected range could be loaded');
        paperData = merged; allPapersData = papers;
        renderStats(container, dates, keywordStats(papers, dates), rangeStart !== rangeEnd);
      } catch (error) {
        container.innerHTML = errorHtml(error);
      }
    };
  }

  function install() {
    const paperPage = !!document.getElementById('paperContainer');
    const statsPage = !!document.getElementById('papersList');
    if (!paperPage && !statsPage) return;
    fetchAvailableDates = fixedFetchAvailableDates;
    initDatePicker = fixedInitDatePicker;
    toggleRangeMode = fixedToggleRangeMode;
    toggleDatePicker = fixedToggleDatePicker;
    formatDateForAPI = isoDate;
    formatDate = displayDate;
    if (paperPage) installPaperPage();
    if (statsPage) installStatisticsPage();
  }

  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', install, { once: true })
    : install();
})();
