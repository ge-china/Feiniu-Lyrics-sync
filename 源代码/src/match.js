import { norm } from './util.js';

export function score(track, cand) {
  let s = 0;
  const t1 = norm(track.title);
  const t2 = norm(cand.title);
  if (t1 && t1 === t2) s += 60;
  else if (t1 && t2 && (t1.indexOf(t2) !== -1 || t2.indexOf(t1) !== -1)) s += 35;
  else s -= 25;

  const a1 = norm(track.artist);
  const a2 = norm(cand.artist);
  if (a1 && a2) {
    if (a1 === a2) s += 30;
    else if (a1.indexOf(a2) !== -1 || a2.indexOf(a1) !== -1) s += 20;
    else s -= 15;
  }

  if (track.duration && cand.duration) {
    const d = Math.abs(track.duration - cand.duration);
    if (d <= 2) s += 30;
    else if (d <= 5) s += 18;
    else if (d <= 10) s += 6;
    else s -= 25;
  }

  if (cand.source === 'lrclib') s += 3;
  return s;
}

// 不按歌词过滤：第一阶段候选可能还没取歌词
export function rankMeta(track, cands) {
  return (cands || [])
    .map(function (c) { return { cand: c, score: score(track, c) }; })
    .sort(function (a, b) { return b.score - a.score; });
}

export function rank(track, cands) {
  return rankMeta(track, cands).filter(function (r) { return r.cand.lrc; });
}

export function pick(track, cands) {
  const r = rank(track, cands);
  return r.length ? r[0] : null;
}
