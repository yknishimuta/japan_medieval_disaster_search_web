'use strict';

/*
 * 『日本中世気象災害史年表稿』の静的検索アプリ。
 * 外部JavaScriptライブラリ不要。CSVの引用符・改行・BOMを考慮。
 * DOMにはtextContentのみで原文を挿入し、HTMLとして解釈しない。
 */

const REQUIRED_HEADERS = ['年号', '月', 'ウ', '日', 'グレゴリオ暦', '地域', '天変地異などの記事', '原出典', '掲載書誌'];

function parseCsv(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && field.length === 0) {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      // Ignore blank lines, but preserve quoted empty fields inside rows.
      if (row.some(cell => cell !== '')) rows.push(row);
      row = []; field = '';
    } else {
      field += ch;
    }
  }
  if (inQuotes) throw new Error('CSVの引用符が閉じられていません。');
  if (row.length !== 0 || field !== '') {
    row.push(field);
    if (row.some(cell => cell !== '')) rows.push(row);
  }
  return rows;
}

function normalizeDigits(s) {
  return String(s ?? '').replace(/[０-９]/g, ch => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0));
}

function normalizeEra(era) {
  const value = normalizeDigits(era).trim();
  const match = value.match(/^(.*?)(\d+)$/);
  return match ? match[1] + String(Number(match[2])) : value;
}

function formatJapaneseDate(record) {
  const era = normalizeEra(record['年号']);
  const month = Number(record['月']);
  const day = Number(record['日']);
  const leap = record['ウ'] === '1';
  let result = `${era}年`;
  if (month > 0) {
    result += `${leap ? '閏' : ''}${month}月`;
    if (day > 0) result += `${day}日`;
  } else if (day > 0) {
    result += `（月未詳・日欄${day}）`;
  }
  return result;
}

function normalizeDateForSearch(s) {
  return normalizeDigits(s).replace(/\d+/g, value => String(Number(value))).replace(/\s+/g, '');
}

// 利用者が「1月」と指定した際に「11月」が誤一致しないよう、
// 年号・月・日について認識できる書式はCSVの別々のフィールドを比較する。
// 「閏」を省略した月指定は通常月・閏月双方に一致する（v2との互換性）。
// 「延喜」など年月日構造を持たない自由入力は従来の部分一致を維持する。
function buildJapaneseDateMatcher(normalizedQuery) {
  if (!normalizedQuery) return null;
  if (normalizedQuery === '閏') return rec => rec.isLeap;

  const m = normalizedQuery.match(/^(?:(.*?)(\d+)年)?(閏)?(\d+)月(?:(\d+)日)?$/);
  if (m) {
    const era = m[1] || '';
    const year = m[2] === undefined ? null : Number(m[2]);
    const leapOnly = Boolean(m[3]);
    const month = Number(m[4]);
    const day = m[5] === undefined ? null : Number(m[5]);
    return rec => {
      if (year !== null && (rec.eraNumber !== year || (era && rec.eraName !== era))) return false;
      return rec.month === month
        && (day === null || rec.day === day)
        && (!leapOnly || rec.isLeap);
    };
  }
  const y = normalizedQuery.match(/^(.*?)(\d+)年$/);
  if (y) {
    const era = y[1];
    const year = Number(y[2]);
    return rec => {
      return rec.eraNumber === year && (!era || rec.eraName === era);
    };
  }
  const d = normalizedQuery.match(/^(\d+)日$/);
  if (d) return rec => rec.day === Number(d[1]);

  return rec => {
    const date = normalizeDateForSearch(rec.japaneseDisplay);
    return normalizedQuery.includes('閏')
      ? date.includes(normalizedQuery)
      : date.replace(/年閏(?=\d+月)/, '年').includes(normalizedQuery);
  };
}

function matchesJapaneseDate(record, normalizedQuery) {
  return (buildJapaneseDateMatcher(normalizedQuery) ?? (() => true))(record);
}

function dateParts(value) {
  const raw = String(value ?? '').trim();
  if (!/^\d{7,8}$/.test(raw)) throw new Error(`グレゴリオ暦欄に不正な値があります: ${raw}`);
  const digits = raw.padStart(8, '0');
  const year = Number(digits.slice(0, 4));
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  return { year, month, day, sortKey: year * 10000 + month * 100 + day,
    display: day === 0 ? `${year}年${month}月（日未詳）` : `${year}年${month}月${day}日` };
}

function prepareRecords(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('CSVが空です。');
  const headers = rows[0];
  for (const h of REQUIRED_HEADERS) {
    if (!headers.includes(h)) throw new Error(`必要な列「${h}」が見つかりません。`);
  }
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (values.length !== headers.length) {
      throw new Error(`CSVの${i + 1}行目の列数が一致しません（${values.length}列）。`);
    }
    const raw = Object.fromEntries(headers.map((h, index) => [h, values[index]]));
    const date = dateParts(raw['グレゴリオ暦']);
    const eraMatch = normalizeEra(raw['年号']).match(/^(.*?)(\d+)$/);
    records.push({
      raw,
      index: i - 1,
      csvLine: i + 1,
      year: date.year,
      sortKey: date.sortKey,
      eraName: eraMatch ? eraMatch[1] : null,
      eraNumber: eraMatch ? Number(eraMatch[2]) : null,
      month: Number(raw['月']),
      day: Number(raw['日']),
      isLeap: raw['ウ'] === '1',
      gregorianDisplay: date.display,
      japaneseDisplay: formatJapaneseDate(raw)
    });
  }
  return records;
}

function filterRecords(records, q) {
  const keywords = String(q.keywords || '').replace(/　/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map(s => s.toLocaleLowerCase());
  const region = String(q.region || '').trim().toLocaleLowerCase();
  const source = String(q.source || '').trim().toLocaleLowerCase();
  const bibliography = String(q.bibliography || '').trim().toLocaleLowerCase();
  const japaneseDate = normalizeDateForSearch(String(q.japaneseDate || '').trim());
  const japaneseDateMatcher = buildJapaneseDateMatcher(japaneseDate);
  const lower = s => s.toLocaleLowerCase();
  const minYear = q.minYear ? Number(normalizeDigits(q.minYear)) : null;
  const maxYear = q.maxYear ? Number(normalizeDigits(q.maxYear)) : null;

  return records.filter(rec => {
    const r = rec.raw;
    if (minYear !== null && rec.year < minYear) return false;
    if (maxYear !== null && rec.year > maxYear) return false;
    if (japaneseDateMatcher && !japaneseDateMatcher(rec)) return false;
    if (region && !lower(r['地域']).includes(region)) return false;
    if (source) {
      const actual = lower(r['原出典']);
      if (q.sourceExact ? actual !== source : !actual.includes(source)) return false;
    }
    if (bibliography) {
      const actual = lower(r['掲載書誌']);
      if (q.bibliographyExact ? actual !== bibliography : !actual.includes(bibliography)) return false;
    }
    if (keywords.length) {
      const text = lower(r['天変地異などの記事']);
      if (q.keywordMode === 'and' ? !keywords.every(kw => text.includes(kw)) : !keywords.some(kw => text.includes(kw))) {
        return false;
      }
    }
    return true;
  }).sort((a, b) => (q.sortOrder === 'desc' ? b.sortKey - a.sortKey : a.sortKey - b.sortKey) || a.index - b.index);
}

function csvEscape(value) {
  // Avoid spreadsheet formula interpretation if future input CSVs contain leading formulas.
  let valueText = String(value ?? '');
  if (/^[\s\uFEFF]*[=+\-@]/u.test(valueText)) valueText = "'" + valueText;
  return '"' + valueText.replace(/"/g, '""') + '"';
}

function exportCsvText(records) {
  const output = [REQUIRED_HEADERS.map(csvEscape).join(',')];
  for (const rec of records) output.push(REQUIRED_HEADERS.map(key => csvEscape(rec.raw[key])).join(','));
  return '\uFEFF' + output.join('\r\n') + '\r\n';
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseCsv, normalizeEra, formatJapaneseDate, normalizeDateForSearch, buildJapaneseDateMatcher, matchesJapaneseDate, dateParts, prepareRecords, filterRecords, exportCsvText, REQUIRED_HEADERS };
}

if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
  const $ = id => document.getElementById(id);
  const form = $('search-form');
  const status = $('status');
  const tbody = $('results-body');
  let records = [];
  let filtered = [];
  let currentPage = 1;
  let perPage = 20;

  function setStatus(message, type = '') {
    status.textContent = message;
    status.className = `status ${type}`.trim();
  }

  function getQuery() {
    const data = new FormData(form);
    return {
      keywords: data.get('keywords'),
      keywordMode: data.get('keywordMode'),
      minYear: data.get('minYear'), maxYear: data.get('maxYear'),
      japaneseDate: data.get('japaneseDate'),
      region: data.get('region'),
      source: data.get('source'), sourceExact: data.has('sourceExact'),
      bibliography: data.get('bibliography'), bibliographyExact: data.has('bibliographyExact'),
      sortOrder: data.get('sortOrder'), perPage: Number(data.get('perPage'))
    };
  }

  function refreshResults(q = getQuery()) {
    if (!records.length) return;
    const min = q.minYear !== '' ? Number(q.minYear) : null;
    const max = q.maxYear !== '' ? Number(q.maxYear) : null;
    if (min !== null && max !== null && min > max) {
      setStatus('開始年は終了年以下にしてください。', 'error');
      return;
    }
    filtered = filterRecords(records, q);
    perPage = [20, 50, 100].includes(q.perPage) ? q.perPage : 20;
    currentPage = 1;
    renderResults();
    setStatus('検索できます。条件を変更したら「検索する」を押してください。', 'success');
  }

  function appendCell(row, label, value, className = '') {
    const cell = document.createElement('td');
    cell.dataset.label = label;
    if (className) cell.className = className;
    cell.textContent = value;
    row.appendChild(cell);
    return cell;
  }

  function renderResults() {
    const count = filtered.length;
    const pageCount = Math.max(1, Math.ceil(count / perPage));
    currentPage = Math.max(1, Math.min(currentPage, pageCount));
    const start = (currentPage - 1) * perPage;
    const showing = filtered.slice(start, start + perPage);
    $('results-summary').textContent = count ? `${count.toLocaleString('ja-JP')}件見つかりました（${start + 1}〜${start + showing.length}件目を表示）` : '0件見つかりました';
    $('no-results').hidden = count !== 0;
    $('table-wrap').hidden = count === 0;
    $('pagination').hidden = count <= perPage;
    $('page-indicator').textContent = `${currentPage.toLocaleString('ja-JP')} / ${pageCount.toLocaleString('ja-JP')}ページ`;
    $('first-page').disabled = currentPage <= 1;
    $('prev-page').disabled = currentPage <= 1;
    $('next-page').disabled = currentPage >= pageCount;
    $('last-page').disabled = currentPage >= pageCount;
    $('export-button').disabled = !count;

    const fragment = document.createDocumentFragment();
    for (const rec of showing) {
      const r = rec.raw;
      const row = document.createElement('tr');
      appendCell(row, '和暦', rec.japaneseDisplay);
      const gregorian = appendCell(row, 'グレゴリオ暦', rec.gregorianDisplay);
      gregorian.title = `原CSV：${r['グレゴリオ暦']}`;
      appendCell(row, '地域', r['地域']);
      const articleCell = appendCell(row, '記事', r['天変地異などの記事'], 'article-text');
      articleCell.title = `CSVデータ行：${rec.csvLine}`;
      appendCell(row, '原出典', r['原出典']);
      appendCell(row, '掲載書誌', r['掲載書誌']);
      fragment.appendChild(row);
    }
    tbody.replaceChildren(fragment);
  }

  function onPageChange(which) {
    const pageCount = Math.max(1, Math.ceil(filtered.length / perPage));
    if (which === 'first') currentPage = 1;
    else if (which === 'prev') currentPage--;
    else if (which === 'next') currentPage++;
    else if (which === 'last') currentPage = pageCount;
    renderResults();
    $('results-title').scrollIntoView({ block: 'start', behavior: 'auto' });
  }

  function installData(csvText, sourceDescription) {
    const result = prepareRecords(csvText);
    if (!result.length) throw new Error('記事データが含まれていません。');
    records = result;
    $('dataset-count').textContent = records.length.toLocaleString('ja-JP');
    $('search-button').disabled = false;
    $('reset-button').disabled = false;
    $('local-file-panel').hidden = true;
    refreshResults();
    setStatus(`${sourceDescription}：${records.length.toLocaleString('ja-JP')}件を読み込みました。検索処理はブラウザ内で行います。`, 'success');
  }

  form.addEventListener('submit', event => { event.preventDefault(); refreshResults(); });
  $('reset-button').addEventListener('click', () => { form.reset(); refreshResults(); });
  $('first-page').addEventListener('click', () => onPageChange('first'));
  $('prev-page').addEventListener('click', () => onPageChange('prev'));
  $('next-page').addEventListener('click', () => onPageChange('next'));
  $('last-page').addEventListener('click', () => onPageChange('last'));
  $('export-button').addEventListener('click', () => {
    if (!filtered.length) return;
    const csv = exportCsvText(filtered);
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'medieval_disaster_results.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    // The object URL is needed only during the click.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  $('csv-file').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 30 * 1024 * 1024) {
      setStatus('CSVファイルが30MBを超えています。', 'error');
      return;
    }
    try {
      setStatus('選択したCSVを読み込んでいます…');
      installData(await file.text(), '選択したCSV');
    } catch (error) { setStatus(`読み込みに失敗しました：${error.message}`, 'error'); }
  });

  (async () => {
    try {
      const embedded = $('embedded-dataset');
      if (embedded) {
        installData(JSON.parse(embedded.textContent), 'HTML内蔵CSV');
        return;
      }
      const response = await fetch('./cmdjm-latest.csv');
      if (!response.ok) throw new Error(`CSVの取得に失敗しました（HTTP ${response.status}）。`);
      installData(await response.text(), '同梱CSV');
    } catch (error) {
      setStatus(`CSVを自動取得できませんでした：${error.message}。下の欄からCSVを選択できます。`, 'error');
      $('local-file-panel').hidden = false;
      $('results-summary').textContent = 'CSVの読み込みが必要です';
    }
  })();
});
