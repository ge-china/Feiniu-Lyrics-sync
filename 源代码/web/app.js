const api = async (p, opt) => {
  const url = String(p).replace(/^\/+/, '');
  const r = await fetch(url, opt);
  return r.json();
};
const $ = (s) => document.querySelector(s);
let state = null;
let timer = null;

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}
function fmtDur(sec) {
  if (!sec) return '-';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return m + ':' + String(s).padStart(2, '0');
}

async function refresh() {
  state = await api('/api/state');
  render();
  const libTab = document.querySelector('#tab-library');
  if (libTab && libTab.classList.contains('active')) await loadLibrary();
}

function render() {
  const st = state.stats || {};
  $('#badges').innerHTML = '<span>共 ' + (st.total || 0) + '</span><span>已有 ' + (st.withLyrics || 0) + '</span><span>缺 ' + (st.missing || 0) + '</span>';
  if (document.activeElement !== $('#root')) $('#root').value = state.config.libraryRoot || '';
  renderSources();
  renderDiag();
  renderJob();
  fillSettings();
}

function fillSettings() {
  const c = state.config;
  $('#downloadMode').value = c.downloadMode || 'ask';
  if ($('#coverMode')) $('#coverMode').value = c.coverMode || 'sidecar';
  $('#writeMode').value = c.writeMode || 'lrc';
  $('#minScore').value = c.minScore;
  $('#concurrency').value = c.concurrency;
  $('#delay').value = c.requestDelayMs;
  $('#fetchTop').value = c.lyricFetchTop;
  $('#skipInstr').checked = c.skipInstrumental !== false;
  $('#keepExisting').checked = !!c.keepExisting;
  $('#backupBeforeEmbed').checked = !!c.backupBeforeEmbed;
  $('#autoEnabled').checked = !!c.autoEnabled;
  $('#autoInterval').value = c.autoIntervalMinutes;
  $('#srcDir').value = state.dataDir ? state.dataDir + '\\sources' : '';
}

function renderDiag() {
  const st = state.stats || {};
  const rt = state.runtime || {};
  const el = $('#diag');
  if (!el) return;
  el.textContent =
    '运行环境: ' + (rt.fnos ? '飞牛 NAS' : '本地调试') + '  Node ' + (rt.node || '') + '\n' +
    '数据目录: ' + (state.dataDir || '') + '\n' +
    '曲库根目录: ' + ((state.config && state.config.libraryRoot) || '(未设置)') + '\n' +
    '曲目: ' + (st.total || 0) + ' 首 | 已有歌词 ' + (st.withLyrics || 0) + ' | 缺歌词 ' + (st.missing || 0) + ' | 未匹配 ' + (st.nomatch || 0) + '\n' +
    '上次扫描: ' + (st.updatedAt ? new Date(st.updatedAt).toLocaleString() : '从未扫描');
}

function renderSources() {
  const box = $('#sourceBox');
  box.innerHTML = (state.sources || []).map(function (s) {
    const on = state.config.sources && state.config.sources[s.id] !== false;
    return '<label><input type="checkbox" data-src="' + esc(s.id) + '"' + (on ? ' checked' : '') + '> ' + esc(s.label) + (s.builtin ? '' : ' <span class="muted">(自定义)</span>') + '</label>';
  }).join('');
}

function renderJob() {
  const j = state.job || {};
  const pct = j.total ? Math.round(j.done / j.total * 100) : 0;
  $('#bar').style.width = (j.running ? pct : (j.total ? 100 : 0)) + '%';
  let text = '空闲';
  if (j.running) text = (j.kind === 'scan' ? '扫描中 ' : '补全中 ') + j.done + '/' + j.total + '  成功 ' + j.ok + '  失败 ' + j.fail + (j.current ? '  ·  ' + j.current : '');
  else if (j.finishedAt) text = j.summary || ('上次任务结束：成功 ' + j.ok + '，失败 ' + j.fail);
  $('#ptext').textContent = text;
  const lines = (j.messages || []).map(function (m) { return m.line; }).join('\n');
  $('#logBox').textContent = lines;
  if (j.running && !timer) {
    timer = setInterval(async function () {
      const jj = await api('/api/job');
      state.job = jj;
      renderJob();
      if (!jj.running) { clearInterval(timer); timer = null; await refresh(); await loadLibrary(); }
    }, 1200);
  }
}

async function loadLibrary() {
  const filter = $('#filter').value;
  const q = $('#q').value;
  const d = await api('/api/library?filter=' + filter + '&q=' + encodeURIComponent(q) + '&limit=500');
  $('#tbody').innerHTML = (d.items || []).map(function (t) {
    const cls = t.hasLyrics ? 'ok' : (t.status === 'nomatch' ? 'no' : 'miss');
    const label = t.hasLyrics ? '已有' : (t.status === 'nomatch' ? '未匹配' : '缺失');
    return '<tr><td><input type="checkbox" class="rowchk" data-file="' + esc(t.file) + '"></td><td>' + esc(t.title) + '</td><td>' + esc(t.artist) + '</td><td>' + esc(t.album) + '</td><td>' + fmtDur(t.duration) + '</td>' +
      '<td><span class="tag ' + cls + '">' + label + '</span></td><td>' + esc(t.source || '') + '</td>' +
      '<td><button data-search-file="' + esc(t.file) + '" data-title="' + esc(t.title) + '" data-artist="' + esc(t.artist) + '" data-dur="' + (t.duration || 0) + '">手动搜索</button> ' +
      '<button data-cover-file="' + esc(t.file) + '" data-title="' + esc(t.title) + '" data-artist="' + esc(t.artist) + '" data-album="' + esc(t.album || '') + '" data-dur="' + (t.duration || 0) + '">封面</button> ' +
      '<button data-del-file="' + esc(t.file) + '" class="danger">删歌词</button></td></tr>';
  }).join('');
  const wb = $('#permWarn');
  if (wb) {
    const s2 = (state && state.stats) || {};
    if (s2.writable === false && s2.total > 0) {
      wb.style.display = 'block';
      wb.innerHTML = '⚠ 应用对音乐目录没有写权限（' + (s2.writeError || '') + '），歌词写不进去。<br>请到「应用中心 → 飞牛歌词同步 → 设置 → 授权目录」把音乐文件夹授权给应用，然后重新扫描。';
    } else {
      wb.style.display = 'none';
    }
  }
  $('#libInfo').textContent = '显示 ' + (d.items || []).length + ' / ' + d.total + ' 首' + (d.total === 0 ? '（没有数据：先扫描曲库）' : '');
  if (!$('#tbody').innerHTML) $('#tbody').innerHTML = '<tr><td colspan="8" class="muted">没有匹配的歌曲。请先「扫描曲库」，或清空搜索条件。</td></tr>';
}

document.addEventListener('click', function (e) {
  const t = e.target;
  if (t.dataset && t.dataset.tab) {
    document.querySelectorAll('.tabs button').forEach(function (b) { b.classList.remove('active'); });
    document.querySelectorAll('.tab').forEach(function (s) { s.classList.remove('active'); });
    t.classList.add('active');
    $('#tab-' + t.dataset.tab).classList.add('active');
    if (t.dataset.tab === 'library') loadLibrary();
    if (t.dataset.tab === 'pending') loadPending();
  }
  if (t.dataset && t.dataset.searchFile) {
    $('#sTitle').value = t.dataset.title || '';
    $('#sArtist').value = t.dataset.artist || '';
    document.querySelector('.tabs button[data-tab="search"]').click();
    doSearch(t.dataset.searchFile, Number(t.dataset.dur || 0));
  }
  if (t.dataset && t.dataset.applyIdx != null) applyHit(Number(t.dataset.applyIdx), t.dataset.file || '', Number(t.dataset.dur || 0));
});

$('#btnScan').onclick = async function () {
  const root = $('#root').value.trim();
  if (!root) return alert('请填写音乐目录');
  const r = await api('/api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: root }) });
  if (!r.ok) return alert(r.error || '启动失败');
  setTimeout(refresh, 400);
};
$('#btnFill').onclick = async function () {
  const r = await api('/api/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  if (!r.ok) return alert(r.error || '启动失败');
  setTimeout(refresh, 400);
};
$('#btnStop').onclick = async function () { await api('/api/job/stop', { method: 'POST' }); };
$('#btnQuery').onclick = loadLibrary;
$('#filter').onchange = loadLibrary;

$('#btnSearch').onclick = function () { doSearch('', 0); };

let lastHits = [];
async function doSearch(file, dur) {
  const title = $('#sTitle').value.trim();
  const artist = $('#sArtist').value.trim();
  if (!title) return alert('请填写歌名');
  $('#searchResults').innerHTML = '<div class="muted">搜索中…</div>';
  const r = await api('/api/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title, artist: artist, duration: dur }) });
  if (!r.ok) { $('#searchResults').innerHTML = '<div class="warn">' + esc(r.error) + '</div>'; return; }
  lastHits = r.items || [];
  if (!lastHits.length) { $('#searchResults').innerHTML = '<div class="muted">没有找到带时间轴的歌词。日志：' + esc((r.log || []).join(' / ')) + '</div>'; return; }
  $('#searchResults').innerHTML = lastHits.map(function (h, i) {
    return '<div class="hit"><div class="top"><span class="score">' + h.score + ' 分</span><b>' + esc(h.title) + '</b><span class="muted">' + esc(h.artist) + ' · ' + esc(h.album) + ' · ' + fmtDur(h.duration) + ' · ' + esc(h.source) + '</span>' +
      '<button data-apply-idx="' + i + '" data-file="' + esc(file) + '" data-dur="' + dur + '">写入</button></div>' +
      '<pre class="code">' + esc(String(h.lrc).slice(0, 600)) + '</pre></div>';
  }).join('');
}

async function applyHit(i, file, dur) {
  const h = lastHits[i];
  if (!h) return;
  if (!file) { alert('请从「曲库」列表点「手动搜索」进入，才能知道写到哪个文件'); return; }
  const r = await api('/api/apply', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: file, lrc: h.lrc, source: h.source, score: h.score }) });
  if (r.ok) { alert('已写入（' + (r.lrc ? '.lrc ' : '') + (r.embed ? '内嵌' : '') + '）'); refresh(); }
  else alert('写入失败：' + (r.error || ''));
}

$('#btnSave').onclick = async function () {
  const sources = {};
  document.querySelectorAll('#sourceBox input[data-src]').forEach(function (cb) { sources[cb.dataset.src] = cb.checked; });
  const body = {
    downloadMode: $('#downloadMode').value,
    coverMode: $('#coverMode') ? $('#coverMode').value : undefined,
    writeMode: $('#writeMode').value,
    minScore: Number($('#minScore').value),
    concurrency: Number($('#concurrency').value),
    requestDelayMs: Number($('#delay').value),
    lyricFetchTop: Number($('#fetchTop').value),
    skipInstrumental: $('#skipInstr').checked,
    keepExisting: $('#keepExisting').checked,
    backupBeforeEmbed: $('#backupBeforeEmbed').checked,
    autoEnabled: $('#autoEnabled').checked,
    autoIntervalMinutes: Number($('#autoInterval').value),
    sources: sources
  };
  await api('api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  $('#saveMsg').textContent = '已保存';
  await refresh();
};

function checkedFiles() {
  return Array.from(document.querySelectorAll('.rowchk:checked')).map(function (c) { return c.dataset.file; });
}

function updateSelInfo() {
  const n = checkedFiles().length;
  const el = $('#selInfo');
  if (el) el.textContent = n ? ('已选 ' + n + ' 首') : '未选择';
  const all = document.querySelectorAll('.rowchk');
  const chk = $('#chkAll');
  if (chk) chk.checked = all.length > 0 && n === all.length;
}

document.addEventListener('change', function (e) {
  const t = e.target;
  if (!t) return;
  if (t.id === 'chkAll') {
    document.querySelectorAll('.rowchk').forEach(function (c) { c.checked = t.checked; });
    updateSelInfo();
    return;
  }
  if (t.classList && t.classList.contains('rowchk')) updateSelInfo();
});

async function deleteLyrics(files) {
  if (!files.length) { alert('请先勾选歌曲'); return; }
  const mode = $('#delMode').value;
  if (!confirm('确认删除所选 ' + files.length + ' 首的歌词？删除后不可恢复。')) return;
  const r = await api('api/delete-lyrics', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: files, mode: mode || undefined })
  });
  if (!r.ok) return alert('删除失败：' + (r.error || ''));
  alert('已删除 ' + r.done + ' / ' + r.total + ' 首');
  await refresh();
  await loadLibrary();
}

$('#btnDelSel').onclick = function () { deleteLyrics(checkedFiles()); };

document.addEventListener('click', function (e) {
  const t = e.target;
  if (t.dataset && t.dataset.delFile) deleteLyrics([t.dataset.delFile]);
});

$('#btnTpl').onclick = async function () {
  const r = await api('api/source-template');
  $('#tplBox').textContent = r.template + '\n\n目录：' + r.dir;
};

$('#btnReloadSrc').onclick = async function () { await refresh(); alert('已刷新'); };

$('#btnAuth').onclick = async function () {
  const r = await api('api/authorized-paths');
  if (!r.ok) { alert('读取授权目录失败：' + (r.error || '（需要在飞牛 NAS 中运行，并在应用设置里授权目录）')); return; }
  const paths = r.paths || [];
  if (!paths.length) { alert('还没有授权目录。请到 应用中心 → 飞牛歌词同步 → 设置 → 授权目录 添加音乐文件夹。'); return; }
  if (paths.length === 1) { $('#root').value = paths[0]; return; }
  const pick = prompt('选择目录（输入序号）：\n' + paths.map(function (p, i) { return (i + 1) + '. ' + p; }).join('\n'), '1');
  const idx = Number(pick) - 1;
  if (paths[idx]) $('#root').value = paths[idx];
};

$('#btnTestSrc').onclick = async function () {
  $('#srcTestMsg').textContent = '测试中…（每个源最多等 12 秒）';
  const r = await api('api/test-sources');
  if (!r.ok) { $('#srcTestMsg').textContent = '测试失败'; return; }
  const lines = r.results.map(function (x) {
    if (x.enabled === false) return x.label + '：已关闭';
    return x.label + '：' + (x.ok ? ('成功 ' + x.count + ' 条 / ' + x.ms + 'ms') : ('失败 ' + (x.error || '')));
  });
  $('#srcTestMsg').textContent = '';
  alert('歌词源测试（' + r.probe.title + ' / ' + r.probe.artist + '）\n\n' + lines.join('\n'));
};

async function loadPending() {
  const d = await api('api/pending');
  const badge = $('#tabBtnPending');
  if (badge) badge.textContent = '待确认' + (d.count ? ' (' + d.count + ')' : '');
  const box = $('#pendingList');
  if (!box) return;
  const info = $('#pendingInfo');
  if (info) info.textContent = d.count ? ('共 ' + d.count + ' 首待确认') : '';
  if (!d.count) { box.innerHTML = '<div class="muted">没有待确认的歌曲。</div>'; return; }
  box.innerHTML = d.items.map(function (it) {
    const cands = (it.candidates || []).map(function (c, i) {
      return '<div class="cand"><div class="candmeta"><span class="tag">' + esc(c.source) + '</span> <b>' + esc(c.title) + '</b> <span class="muted">' + esc(c.artist) + ' · ' + esc(c.album || '无专辑') + ' · ' + fmtDur(c.duration) + ' · ' + c.score + ' 分</span></div>' +
        '<button data-choose-file="' + esc(it.file) + '" data-choose-idx="' + i + '">写入这个</button>' +
        '<pre class="code mini">' + esc(String(c.lrc || '').slice(0, 200)) + '</pre></div>';
    }).join('');
    return '<div class="hit"><div class="top"><b>' + esc(it.title) + '</b><span class="muted">' + esc(it.artist) + ' · ' + esc(it.album || '') + ' · ' + fmtDur(it.duration) + ' · 命中 ' + esc(it.level || '') + '</span><button class="ghost" data-skip-file="' + esc(it.file) + '">跳过</button></div>' + cands + '</div>';
  }).join('');
}

document.addEventListener('click', async function (e) {
  const t = e.target;
  if (t.dataset && t.dataset.chooseFile) {
    const r = await api('api/pending/choose', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: t.dataset.chooseFile, index: Number(t.dataset.chooseIdx) }) });
    if (!r.ok) alert('写入失败：' + (r.error || r.reason || ''));
    await loadPending(); await refresh();
    return;
  }
  if (t.dataset && t.dataset.skipFile) {
    await api('api/pending/skip', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ file: t.dataset.skipFile }) });
    await loadPending(); await refresh();
  }
});

const btnAutoAll = document.querySelector('#btnAutoAll');
if (btnAutoAll) btnAutoAll.onclick = async function () {
  const r = await api('api/pending/auto-all', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  alert('已处理 ' + (r.done || 0) + ' 首，剩余 ' + (r.remaining || 0));
  await loadPending(); await refresh();
};

refresh();

/* ---------------- 封面 ---------------- */
let coverTarget = '';

async function doCoverSearch(file, title, artist, album, dur) {
  coverTarget = file || '';
  const t = title || $('#cTitle').value.trim();
  const ar = artist || $('#cArtist').value.trim();
  if (!t) { alert('请填写歌名'); return; }
  $('#coverTarget').textContent = coverTarget ? ('目标：' + coverTarget.split(/[\\/]/).pop()) : '仅搜索（不写入）';
  $('#coverGrid').innerHTML = '<div class="muted">搜索中…</div>';
  const r = await api('api/cover/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: t, artist: ar, album: album || '', duration: dur || 0 })
  });
  if (!r.ok) { $('#coverGrid').innerHTML = '<div class="warn">' + esc(r.error || '搜索失败') + '</div>'; return; }
  if (!r.count) { $('#coverGrid').innerHTML = '<div class="muted">没找到封面。日志：' + esc((r.log || []).join(' / ')) + '</div>'; return; }
  $('#coverGrid').innerHTML = r.items.map(function (c, i) {
    return '<div class="covercard">' +
      '<img src="' + c.proxy + '" loading="lazy" alt="">' +
      '<div class="meta"><b>' + esc(c.title) + '</b><br>' + esc(c.artist) + ' · ' + esc(c.album || '') + '<br>' + esc(c.source) + ' · ' + (c.score || 0) + ' 分</div>' +
      '<button data-cover-url="' + esc(c.url) + '" data-cover-src="' + esc(c.source) + '" data-cover-idx="' + i + '">写入封面</button>' +
      '</div>';
  }).join('');
}

$('#btnCoverSearch').onclick = function () {
  const file = coverTarget;
  doCoverSearch(file, $('#cTitle').value.trim(), $('#cArtist').value.trim(), '', 0);
};

document.addEventListener('click', async function (e) {
  const t = e.target;
  if (t.dataset && t.dataset.coverFile) {
    $('#cTitle').value = t.dataset.title || '';
    $('#cArtist').value = t.dataset.artist || '';
    document.querySelector('.tabs button[data-tab="cover"]').click();
    doCoverSearch(t.dataset.coverFile, t.dataset.title, t.dataset.artist, t.dataset.album, Number(t.dataset.dur || 0));
    return;
  }
  if (t.dataset && t.dataset.coverUrl) {
    if (!coverTarget) { alert('请从「曲库」点「封面」进入，才能知道写到哪个文件'); return; }
    t.disabled = true;
    const r = await api('api/cover/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: coverTarget, url: t.dataset.coverUrl, source: t.dataset.coverSrc })
    });
    t.disabled = false;
    if (r.ok) {
      alert('封面已写入' + (r.sidecar ? '：' + r.sidecar.split(/[\\/]/).pop() : '') + (r.embed ? '（内嵌）' : ''));
      refresh();
    } else alert('写入失败：' + (r.error || ''));
  }
});
