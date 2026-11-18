import fs from 'node:fs';
import { libraryFile } from './config.js';
import path from 'node:path';
function normKey(p) {
  try { return path.resolve(String(p)).toLowerCase(); } catch (e) { return String(p).toLowerCase(); }
}



let cache = null;
let dirty = false;
let timer = null;

export function loadLibrary() {
  if (cache) return cache;
  let raw = { updatedAt: 0, tracks: [] };
  try { raw = JSON.parse(fs.readFileSync(libraryFile, 'utf8')); } catch (e) {}
  cache = raw && Array.isArray(raw.tracks) ? raw : { updatedAt: 0, tracks: [] };
  return cache;
}

export function saveLibrary(lib) {
  cache = lib;
  lib.updatedAt = Date.now();
  fs.writeFileSync(libraryFile, JSON.stringify(lib), 'utf8');
  dirty = false;
}

export function flushLibrary() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (dirty && cache) {
    cache.updatedAt = Date.now();
    try { fs.writeFileSync(libraryFile, JSON.stringify(cache), 'utf8'); } catch (e) {}
    dirty = false;
  }
}

function scheduleFlush() {
  if (timer) return;
  timer = setTimeout(function () { timer = null; flushLibrary(); }, 1500);
}

export function patchTrack(file, patch) {
  const lib = loadLibrary();
  const key = normKey(file);
  const i = lib.tracks.findIndex(function (t) { return normKey(t.file) === key; });
  if (i === -1) return null;
  lib.tracks[i] = Object.assign({}, lib.tracks[i], patch, { updatedAt: Date.now() });
  dirty = true;
  scheduleFlush();
  return lib.tracks[i];
}

export function stats() {
  const lib = loadLibrary();
  const t = lib.tracks || [];
  const withLyrics = t.filter(function (x) { return x.hasLyrics; }).length;
  const nomatch = t.filter(function (x) { return x.status === 'nomatch'; }).length;
  return {
    writable: lib.writable !== false,
    writeError: lib.writeError || '',
    total: t.length,
    withLyrics: withLyrics,
    missing: t.length - withLyrics,
    nomatch: nomatch,
    updatedAt: lib.updatedAt
  };
}
