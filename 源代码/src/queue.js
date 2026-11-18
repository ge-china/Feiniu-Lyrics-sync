import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './config.js';

const pendingFile = path.join(dataDir, 'pending.json');
const choicesFile = path.join(dataDir, 'choices.json');

let pendingCache = null;
let choicesCache = null;

export function loadPending() {
  if (pendingCache) return pendingCache;
  try { pendingCache = JSON.parse(fs.readFileSync(pendingFile, 'utf8')); } catch (e) { pendingCache = []; }
  if (!Array.isArray(pendingCache)) pendingCache = [];
  return pendingCache;
}

function savePending() {
  try { fs.writeFileSync(pendingFile, JSON.stringify(pendingCache || []), 'utf8'); } catch (e) {}
}

export function addPending(item) {
  const list = loadPending();
  const i = list.findIndex(function (x) { return x.file === item.file; });
  if (i === -1) list.push(item); else list[i] = item;
  savePending();
  return item;
}

export function removePending(file) {
  const list = loadPending();
  const i = list.findIndex(function (x) { return x.file === file; });
  if (i !== -1) list.splice(i, 1);
  savePending();
}

export function clearPending() {
  pendingCache = [];
  savePending();
}

export function loadChoices() {
  if (choicesCache) return choicesCache;
  try { choicesCache = JSON.parse(fs.readFileSync(choicesFile, 'utf8')); } catch (e) { choicesCache = {}; }
  if (!choicesCache || typeof choicesCache !== 'object') choicesCache = {};
  return choicesCache;
}

export function rememberChoice(track, cand, key) {
  const c = loadChoices();
  c[(track.artist || '') + '|' + (track.title || '')] = {
    key: key,
    source: cand.source,
    title: cand.title,
    artist: cand.artist,
    at: Date.now()
  };
  try { fs.writeFileSync(choicesFile, JSON.stringify(c, null, 2), 'utf8'); } catch (e) {}
}
