import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

const pendingFile = path.join(dataDir, 'cover-pending.json');
const choicesFile = path.join(dataDir, 'cover-choices.json');

let pendingCache = null;
let choicesCache = null;

export function loadCoverPending() {
  if (pendingCache) return pendingCache;
  try { pendingCache = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); } catch (e) { pendingCache = []; }
  if (!Array.isArray(pendingCache)) pendingCache = [];
  return pendingCache;
}

function save() {
  try { fs.writeFileSync(pendingFile, JSON.stringify(pendingCache || []), 'utf8'); } catch (e) {}
}

export function addCoverPending(item) {
  const list = loadCoverPending();
  const i = list.findIndex(function (x) { return x.file === item.file; });
  if (i === -1) list.push(item); else list[i] = item;
  save();
  return item;
}

export function removeCoverPending(file) {
  const list = loadCoverPending();
  const i = list.findIndex(function (x) { return x.file === file; });
  if (i !== -1) list.splice(i, 1);
  save();
}

export function loadCoverChoices() {
  if (choicesCache) return choicesCache;
  try { choicesCache = JSON.parse(fs.readFileSync(choicesFile, 'utf8')); } catch (e) { choicesCache = {}; }
  if (!choicesCache || typeof choicesCache !== 'object') choicesCache = {};
  return choicesCache;
}

export function rememberCoverChoice(track, cand) {
  const c = loadCoverChoices();
  const key = (track.artist || '') + '|' + (track.title || '');
  c[key] = { url: cand.url, source: cand.source, at: Date.now() };
  try { fs.writeFileSync(choicesFile, JSON.stringify(c, null, 2), 'utf8'); } catch (e) {}
}
