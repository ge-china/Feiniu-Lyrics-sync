import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { rankMeta } from '../match.js';
import { buildQueries } from '../searchplan.js';
import * as lrclib from './lrclib.js';
import * as netease from './netease.js';
import * as qq from './qq.js';
import * as kugou from './kugou.js';
import * as kuwo from './kuwo.js';

export const builtins = { lrclib: lrclib, netease: netease, qq: qq, kugou: kugou, kuwo: kuwo };

export function listSources() {
  return Object.keys(builtins).map(function (k) {
    return { id: k, label: builtins[k].label, builtin: true };
  });
}

export async function loadUserSources(dir) {
  const out = {};
  let files = [];
  try { files = fs.readdirSync(dir); } catch (e) { return out; }
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    try {
      const mod = await import(pathToFileURL(path.join(dir, f)).href + '?t=' + Date.now());
      const id = mod.id || path.basename(f, '.js');
      if (typeof mod.search !== 'function') continue;
      out[id] = { id: id, label: mod.label || id, search: mod.search, resolve: mod.resolve, user: true };
    } catch (e) {}
  }
  return out;
}

const failures = new Map();
const cooldownUntil = new Map();

function isCoolingDown(id) {
  const t = cooldownUntil.get(id);
  return t ? Date.now() < t : false;
}
function noteFailure(id) {
  const n = (failures.get(id) || 0) + 1;
  failures.set(id, n);
  if (n >= 2) { cooldownUntil.set(id, Date.now() + 5 * 60000); failures.set(id, 0); }
}
function noteSuccess(id) { failures.delete(id); }

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise(function (_, rej) { setTimeout(function () { rej(new Error(label + ' 超时')); }, ms); })
  ]);
}

// 单轮检索：query = { title, artist, album }
async function searchOnce(query, cfg, userSources, log, phase) {
  const enabled = cfg.sources || {};
  const jobs = [];
  for (const k of Object.keys(builtins)) {
    if (enabled[k] === false) continue;
    if (typeof builtins[k].search !== 'function') continue;
    jobs.push({ id: k, label: builtins[k].label || k, mod: builtins[k], slow: !!builtins[k].slow });
  }
  for (const k of Object.keys(userSources || {})) {
    if (enabled[k] === false) continue;
    jobs.push({ id: k, label: userSources[k].label || k, mod: userSources[k], user: true });
  }

  const picked = jobs.filter(function (j) {
    if (phase === 'fast') return !j.slow;
    if (phase === 'slow') return j.slow;
    return true;
  });

  const timeoutMs = Number(cfg.sourceTimeoutMs) || 15000;
  const results = await Promise.all(picked.map(async function (job) {
    if (isCoolingDown(job.id)) return { job: job, list: [], error: null, cooling: true };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const list = await withTimeout(Promise.resolve(job.mod.search(query)), timeoutMs, job.label);
        noteSuccess(job.id);
        return { job: job, list: Array.isArray(list) ? list : [], error: null };
      } catch (e) {
        if (attempt === 1 || /超时/.test(e.message || '')) {
          noteFailure(job.id);
          return { job: job, list: [], error: e.message };
        }
      }
    }
    return { job: job, list: [], error: null };
  }));

  const cands = [];
  for (const r of results) {
    if (r.cooling) continue;
    if (r.error) { log('    ' + r.job.id + ' 失败：' + r.error); continue; }
    for (const c of r.list) {
      if (!c.source) c.source = r.job.id;
      c._mod = r.job.mod;
      cands.push(c);
    }
  }
  return cands;
}

function candidateKey(c) {
  return c.source + ':' + (c.id || c.rid || c.mid || c.hash || (c.title + '|' + c.artist));
}

function durOk(track, cand, tol) {
  if (!track.duration || !cand.duration) return true;
  return Math.abs(track.duration - cand.duration) <= tol;
}

async function attachLyrics(ranked, cfg, log) {
  const topN = Math.max(1, Number(cfg.lyricFetchTop) || 3);
  const need = ranked.filter(function (r) { return !r.cand.lrc; }).slice(0, topN);
  if (!need.length) return;
  const timeoutMs = Number(cfg.sourceTimeoutMs) || 15000;
  await Promise.all(need.map(async function (r) {
    try {
      if (typeof r.cand._mod.resolve !== 'function') return;
      const lrc = await withTimeout(Promise.resolve(r.cand._mod.resolve(r.cand)), timeoutMs, r.cand.source);
      if (lrc) r.cand.lrc = lrc;
    } catch (e) {}
  }));
}

/**
 * 按 L1..L7 阶梯检索
 * 返回 { accepted, level, ranked, best }
 */
export async function resolveBest(track, cfg, userSources, log, memory) {
  const queries = buildQueries(track);
  const minScore = Number(cfg.minScore) || 55;
  const tol = Number(cfg.durationTolerance) || 5;
  const mem = memory || {};
  const memKey = (track.artist || '') + '|' + (track.title || '');
  const remembered = mem[memKey] || null;

  let bestEffort = null;

  for (const q of queries) {
    log('  [' + q.level + '] ' + q.title + (q.artist ? ' / ' + q.artist : '') + (q.album ? ' / ' + q.album : ''));

    let cands = await searchOnce(q, cfg, userSources, log, 'fast');

    // 前几级不理想时，补一次慢源（LRCLIB）
    const quick = rankMeta(track, cands);
    const quickOk = quick[0] && quick[0].score >= minScore && durOk(track, quick[0].cand, tol);
    if (!quickOk && q.level === 'L1') {
      const extra = await searchOnce(q, cfg, userSources, log, 'slow');
      if (extra.length) cands = cands.concat(extra);
    }

    let ranked = rankMeta(track, cands);

    // 命中过记忆版本 → 加分
    if (remembered && ranked.length) {
      for (const r of ranked) {
        if (candidateKey(r.cand) === remembered.key) r.score += 50;
      }
      ranked.sort(function (a, b) { return b.score - a.score; });
    }

    if (!ranked.length) continue;

    const top = ranked[0];
    const ok = top.score >= minScore && durOk(track, top.cand, tol);

    if (!bestEffort || top.score > bestEffort.score) {
      bestEffort = { score: top.score, candidate: top.cand, level: q.level, ranked: ranked };
    }

    // 已经有高置信度候选，且已走过 3 级 → 不再无谓降级
    if (bestEffort && bestEffort.score >= minScore + 25 && queries.indexOf(q) >= 2) break;

    if (!ok) continue;

    await attachLyrics(ranked, cfg, log);
    const withLrc = rankMeta(track, ranked.map(function (r) { return r.cand; }).filter(function (c) { return c.lrc; }));
    if (remembered) {
      for (const r of withLrc) if (candidateKey(r.cand) === remembered.key) r.score += 50;
      withLrc.sort(function (a, b) { return b.score - a.score; });
    }
    if (!withLrc.length) continue;

    const topLrc = withLrc[0];
    if (topLrc.score >= minScore && durOk(track, topLrc.cand, tol)) {
      return { accepted: true, level: q.level, ranked: withLrc, best: topLrc };
    }
  }

  if (bestEffort && bestEffort.ranked) {
    await attachLyrics(bestEffort.ranked, cfg, log);
    const withLrc = rankMeta(track, bestEffort.ranked.map(function (r) { return r.cand; }).filter(function (c) { return c.lrc; }));
    if (withLrc.length) return { accepted: false, level: bestEffort.level, ranked: withLrc, best: withLrc[0] };
  }
  return { accepted: false, level: 'none', ranked: [], best: null };
}

export function isAmbiguous(ranked, cfg) {
  if (!ranked || ranked.length < 2) return false;
  const a = ranked[0];
  const b = ranked[1];
  if (a.score - b.score < 15) return true;
  const durA = a.cand.duration || 0;
  const durB = b.cand.duration || 0;
  if (durA && durB && Math.abs(durA - durB) > 5 && a.score - b.score < 25) return true;
  return false;
}

export function choiceKey(track) {
  return (track.artist || '') + '|' + (track.title || '');
}

export function candidateId(c) {
  return candidateKey(c);
}
