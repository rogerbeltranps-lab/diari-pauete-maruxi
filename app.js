/* Diaris Nidia — web-app (first diary: «Diari de Pauete i Maruxi»)
   Content lives in a Google Drive folder (diari.json + fotos/), login with Google (OAuth implicit redirect). */
(() => {
'use strict';
const CFG = window.DIARI_CONFIG || {};
const OLD_NAME = 'Diari Pauete i Mariuxi'; // nom antic: carpeta i títol de diaris ja creats
const FOLDER_NAME = CFG.folderName || 'Diari de Pauete i Maruxi';
const DEFAULT_TITLE = 'Diari de Pauete i Maruxi';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const REDIRECT = location.origin + location.pathname.replace(/index\.html$/, '');
const DATE_LOCALE = 'es';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const ls = {
  get(k) { try { return localStorage.getItem(k) } catch (e) { return null } },
  set(k, v) { try { localStorage.setItem(k, v) } catch (e) {} },
  del(k) { try { localStorage.removeItem(k) } catch (e) {} }
};
class Redirecting extends Error {}

/* ================= auth ================= */
function readHash() {
  if (!location.hash || location.hash.length < 2) return null;
  const p = new URLSearchParams(location.hash.slice(1));
  if (!p.get('access_token') && !p.get('error')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  if (p.get('error')) return { error: p.get('error') };
  if (p.get('state') !== ls.get('diari.state')) return { error: 'state' };
  const tok = { t: p.get('access_token'), exp: Date.now() + (+p.get('expires_in') || 3600) * 1000 };
  ls.set('diari.tok', JSON.stringify(tok));
  return { ok: true };
}
function token(minLeftSec = 60) {
  try { const t = JSON.parse(ls.get('diari.tok') || 'null'); if (t && t.exp - Date.now() > minLeftSec * 1000) return t.t } catch (e) {}
  return null;
}
function login() {
  const st = uid(); ls.set('diari.state', st);
  const q = { client_id: CFG.clientId, redirect_uri: REDIRECT, response_type: 'token', scope: SCOPE, include_granted_scopes: 'true', state: st };
  const hint = ls.get('diari.hint'); if (hint) q.login_hint = hint;
  location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams(q);
  throw new Redirecting();
}
function logout() { ls.del('diari.tok'); ls.del('diari.hint'); ls.del('diari.folder'); location.reload() }
function ensureToken(minLeft = 120) { if (!token(minLeft)) { saveDraft(); login() } return token(minLeft) }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(url, opts = {}) {
  let r = null, lastErr = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const t = ensureToken(30);
    try {
      r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t } });
      if ((r.status === 429 || r.status >= 500 || (r.status === 403 && /rate|quota/i.test(await r.clone().text().catch(() => '')))) && attempt < 4) { await sleep(1500 * 2 ** attempt); continue }
      break;
    } catch (e) { lastErr = e; console.warn('network error, retrying', url.slice(0, 80), e); await sleep(1500 * 2 ** attempt) }
  }
  if (!r) { const err = new Error("No hi ha connexió amb Google (" + (lastErr && lastErr.message) + ")"); err.network = true; throw err }
  if (r.status === 401) { ls.del('diari.tok'); saveDraft(); login() }
  if (!r.ok) { const txt = await r.text().catch(() => ''); const err = new Error('Drive ' + r.status + ' ' + txt.slice(0, 200)); err.status = r.status; throw err }
  return r;
}
const getJSON = async (url, opts) => (await api(url, opts)).json();

/* ================= Drive storage ================= */
let folderId = null, dataFileId = null, photosFolderId = null;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const qs = o => new URLSearchParams(o).toString();
async function list(q, fields = 'files(id,name,ownedByMe,modifiedTime)') {
  const r = await getJSON(`${DRIVE}/files?` + qs({ q, fields, pageSize: 100, spaces: 'drive', supportsAllDrives: true, includeItemsFromAllDrives: true }));
  return r.files || [];
}
const qName = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const DIARI_PROP = { diari: '1' }; // marks the folders the app creates as diaries
async function createFolder(name, parent, props) {
  const body = { name, mimeType: FOLDER_MIME }; if (parent) body.parents = [parent]; if (props) body.appProperties = props;
  const r = await getJSON(`${DRIVE}/files?fields=id&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.id;
}
async function uploadFile(meta, blob, fileId) {
  const b = 'diari' + uid();
  const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${b}--`]);
  const url = `${UPLOAD}/files${fileId ? '/' + fileId : ''}?uploadType=multipart&fields=id&supportsAllDrives=true`;
  const r = await getJSON(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
  return r.id;
}
async function findDataFile() {
  const f = await list(`'${folderId}' in parents and name='diari.json' and trashed=false`);
  dataFileId = f[0] ? f[0].id : null; return dataFileId;
}
async function locateFolder() {
  const stored = ls.get('diari.folder');
  if (stored) {
    try { const f = await getJSON(`${DRIVE}/files/${stored}?fields=id,trashed&supportsAllDrives=true`); if (!f.trashed) { folderId = stored; await findDataFile(); return true } } catch (e) { if (e instanceof Redirecting) throw e }
    ls.del('diari.folder');
  }
  const names = [...new Set([FOLDER_NAME, OLD_NAME])];
  const cands = (await list(`(${names.map(n => `name='${qName(n)}'`).join(' or ')}) and mimeType='${FOLDER_MIME}' and trashed=false`))
    .sort((a, b) => names.indexOf(a.name) - names.indexOf(b.name));
  for (const c of cands) { folderId = c.id; if (await findDataFile()) { ls.set('diari.folder', c.id); return true } }
  if (cands[0]) { folderId = cands[0].id; ls.set('diari.folder', folderId); return true }
  folderId = null; return false;
}
/* every diary is its own Drive folder; the first one was found by name, new ones carry DIARI_PROP */
async function listDiaries() {
  const names = [...new Set([FOLDER_NAME, OLD_NAME])].map(n => `name='${qName(n)}'`).join(' or ');
  return list(`mimeType='${FOLDER_MIME}' and trashed=false and (appProperties has { key='diari' and value='1' } or ${names})`);
}
async function ensurePhotosFolder() {
  if (photosFolderId) return photosFolderId;
  const f = await list(`'${folderId}' in parents and name='fotos' and mimeType='${FOLDER_MIME}' and trashed=false`);
  photosFolderId = f[0] ? f[0].id : await createFolder('fotos', folderId);
  return photosFolderId;
}
const emptyData = () => ({ meta: { title: DEFAULT_TITLE, sub: '' }, entries: [], updated: 0 });
async function readData() {
  if (!dataFileId) await findDataFile();
  if (!dataFileId) return emptyData();
  const d = await getJSON(`${DRIVE}/files/${dataFileId}?alt=media&supportsAllDrives=true`);
  d.meta = d.meta || { title: DEFAULT_TITLE, sub: '' }; d.entries = d.entries || [];
  if (d.meta.title === OLD_NAME) d.meta.title = DEFAULT_TITLE;
  return d;
}
async function writeData(d) {
  const blob = new Blob([JSON.stringify(d)], { type: 'application/json' });
  if (dataFileId) await uploadFile({}, blob, dataFileId);
  else dataFileId = await uploadFile({ name: 'diari.json', mimeType: 'application/json', parents: [folderId] }, blob);
}
async function uploadPhoto(rec, label) {
  await ensurePhotosFolder();
  const name = (label || 'foto').replace(/[^\p{L}\p{N} _-]+/gu, '').slice(0, 40).trim().replace(/\s+/g, '-') + '-' + uid().slice(0, 6) + '.jpg';
  const id = await uploadFile({ name, mimeType: 'image/jpeg', parents: [photosFolderId] }, rec.blob);
  const url = URL.createObjectURL(rec.blob); mem.set(id, url);
  try { const c = await caches.open('diari-fotos'); await c.put('f/' + id, new Response(rec.blob)) } catch (e) {}
  return { id, w: rec.w, h: rec.h };
}
async function trashFile(id) { try { await api(`${DRIVE}/files/${id}?supportsAllDrives=true`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"trashed":true}' }) } catch (e) { if (e instanceof Redirecting) throw e } }

/* ================= photos (lazy, cached) ================= */
const mem = new Map(), pending = new Map();
let active = 0; const waiters = [];
async function limited(fn) {
  while (active >= 4) await new Promise(r => waiters.push(r));
  active++; try { return await fn() } finally { active--; const w = waiters.shift(); w && w() }
}
function photoURL(id) {
  if (mem.has(id)) return Promise.resolve(mem.get(id));
  if (pending.has(id)) return pending.get(id);
  const p = limited(async () => {
    let blob = null;
    try { const c = await caches.open('diari-fotos'); const m = await c.match('f/' + id); if (m) blob = await m.blob() } catch (e) {}
    if (!blob) {
      blob = await (await api(`${DRIVE}/files/${id}?alt=media&supportsAllDrives=true`)).blob();
      try { const c = await caches.open('diari-fotos'); await c.put('f/' + id, new Response(blob)) } catch (e) {}
    }
    const u = URL.createObjectURL(blob); mem.set(id, u); return u;
  }).finally(() => pending.delete(id));
  pending.set(id, p); return p;
}
function loadImg(img) {
  if (img.dataset.done) return Promise.resolve();
  img.dataset.done = '1';
  return photoURL(img.dataset.pid).then(u => new Promise(res => {
    img.onload = () => { img.classList.add('ok'); res() }; img.onerror = () => res(); img.src = u;
  })).catch(e => { if (e instanceof Redirecting) return; delete img.dataset.done });
}
const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { io.unobserve(e.target); loadImg(e.target) } }), { rootMargin: '1200px 0px' });

/* ================= image shrinking ================= */
async function shrink(src, cross) {
  const img = new Image(); if (cross) img.crossOrigin = 'anonymous'; img.src = src;
  try { await img.decode() } catch (e) { return null }
  const w = img.naturalWidth, h = img.naturalHeight; if (!w || !h || (w < 90 && h < 90)) return null;
  const r = Math.min(1, 1800 / Math.max(w, h)), cw = Math.round(w * r), ch = Math.round(h * r);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, cw, ch); x.drawImage(img, 0, 0, cw, ch);
  let blob = null; try { blob = await new Promise(r => c.toBlob(r, 'image/jpeg', .86)) } catch (e) { return null }
  return blob ? { blob, w: cw, h: ch } : null;
}
async function shrinkFile(file) { const u = URL.createObjectURL(file); try { return await shrink(u) } finally { URL.revokeObjectURL(u) } }

/* ================= .docx parsing ================= */
const MONTHS = 'gener|febrer|març|marc|abril|maig|juny|juliol|agost|setembre|octubre|novembre|desembre|enero|febrero|marzo|mayo|junio|julio|septiembre|setiembre|noviembre|diciembre';
const DAYS = 'dilluns|dimarts|dimecres|dijous|divendres|dissabte|diumenge|lunes|martes|miércoles|miercoles|jueves|viernes|sábado|sabado|domingo';
const reNum = /\b\d{1,2}\s*[\/.\-]\s*\d{1,2}(\s*[\/.\-]\s*\d{2,4})?\b/;
const reMon = new RegExp('\\b\\d{1,2}\\s*(de\\s+|d[\'’]\\s*|del\\s+)?(' + MONTHS + ')\\b', 'i');
const reDay = new RegExp('^\\W*(' + DAYS + ')\\b', 'i');
const reYear = /\b(19|20)\d{2}\b/;
const isDateLine = t => t.length <= 70 && (reNum.test(t) || reMon.test(t) || reDay.test(t));
const isChapter = t => t.length <= 60 && reYear.test(t) && !isDateLine(t);
/* blocks: [{t (text, may contain \n), heading, bold, imgs:[]}] → entries. tabTitle starts a chapter. */
function blocksToEntries(blocks, tabTitle) {
  const hasDates = blocks.some(b => b.t && isDateLine(b.t.replace(/\n/g, ' ')));
  const out = []; let cur = null;
  const clean = s => s.replace(/[:.\s]+$/, '');
  const start = (d, ch) => { cur = { date: ch ? '' : d, title: ch ? clean(d) : '', chapter: !!ch, paras: [], imgs: [] }; out.push(cur) };
  if (tabTitle) start(tabTitle, true);
  for (const b of blocks) {
    const t = (b.t || '').trim();
    if (t) {
      const one = t.replace(/\n/g, ' ');
      if (isChapter(one) && (b.heading || !cur || one === one.toUpperCase() || b.bold)) {
        if (cur && cur.chapter && !cur.paras.length && !cur.imgs.length) cur.title = clean(one); else start(one, true);
      }
      else if (hasDates ? isDateLine(one) : b.heading) start(one);
      else if (b.heading && cur && !cur.title && !cur.paras.length) cur.title = one;
      else { if (!cur) start(''); cur.paras.push(t) }
    }
    if (b.imgs && b.imgs.length) { if (!cur) start(''); cur.imgs.push(...b.imgs) }
  }
  return out.filter(e => e.date || e.title || e.paras.length || e.imgs.length);
}
async function parseDocx(buf) {
  const res = await mammoth.convertToHtml({ arrayBuffer: buf });
  const doc = new DOMParser().parseFromString(res.value, 'text/html');
  const els = [];
  (function walk(n) { for (const el of n.children) { const t = el.tagName.toLowerCase(); if (['table', 'tbody', 'thead', 'tr', 'td', 'th', 'ul', 'ol', 'div'].includes(t)) walk(el); else els.push(el) } })(doc.body);
  const blocks = els.map(b => {
    const tag = b.tagName.toLowerCase();
    const imgs = (tag === 'img' ? [b.getAttribute('src')] : [...b.querySelectorAll('img')].map(i => i.getAttribute('src'))).filter(Boolean).map(src => ({ src }));
    b.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
    const t = b.textContent.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
    return { t, heading: /^h[1-6]$/.test(tag), bold: !!b.querySelector('strong'), imgs };
  });
  return blocksToEntries(blocks);
}

/* ---- read the Google Doc directly (Docs API, with tabs) ---- */
const DOCS = 'https://docs.googleapis.com/v1/documents/';
let docCache = null; // {id, at, tabs:[{id,title,dt}]}
function flattenTabs(tabs, out = []) { for (const t of tabs || []) { out.push({ id: t.tabProperties.tabId, title: t.tabProperties.title || '', dt: t.documentTab }); flattenTabs(t.childTabs, out) } return out }
async function fetchDoc(id, force) {
  if (!force && docCache && docCache.id === id && Date.now() - docCache.at < 20 * 60e3) return docCache;
  const d = await getJSON(DOCS + encodeURIComponent(id) + '?includeTabsContent=true');
  docCache = { id, at: Date.now(), name: d.title, tabs: flattenTabs(d.tabs) };
  return docCache;
}
function tabBlocks(tab) {
  const blocks = [];
  const walk = content => {
    for (const se of content || []) {
      if (se.paragraph) {
        const p = se.paragraph; let t = '', bold = false; const imgs = [];
        for (const el of p.elements || []) {
          if (el.textRun) { t += el.textRun.content || ''; if (el.textRun.textStyle && el.textRun.textStyle.bold && (el.textRun.content || '').trim()) bold = true }
          if (el.inlineObjectElement) imgs.push({ tab: tab.id, obj: el.inlineObjectElement.inlineObjectId });
        }
        for (const po of p.positionedObjectIds || []) imgs.push({ tab: tab.id, obj: po, pos: true });
        t = t.replace(/\u000b/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
        const st = (p.paragraphStyle && p.paragraphStyle.namedStyleType) || '';
        blocks.push({ t, heading: /^HEADING|^TITLE/.test(st), bold, imgs });
      } else if (se.table) {
        for (const row of se.table.tableRows || []) for (const cell of row.tableCells || []) walk(cell.content);
      } else if (se.tableOfContents) { /* skip */ }
    }
  };
  walk(tab.dt && tab.dt.body && tab.dt.body.content);
  return blocks;
}
function contentUri(tab, img) {
  const dt = tab && tab.dt; if (!dt) return null;
  const o = img.pos ? (dt.positionedObjects || {})[img.obj] : (dt.inlineObjects || {})[img.obj];
  const props = o && (img.pos ? o.positionedObjectProperties : o.inlineObjectProperties);
  const ip = props && props.embeddedObject && props.embeddedObject.imageProperties;
  return ip && (ip.contentUri || ip.sourceUri) || null;
}
async function docImage(docId, img) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const doc = await fetchDoc(docId);
    const uri = contentUri(doc.tabs.find(t => t.id === img.tab), img); if (!uri) return null;
    try {
      const r = await fetch(uri);
      if (r.ok) { const u = URL.createObjectURL(await r.blob()); try { const out = await shrink(u); if (out) return out } finally { URL.revokeObjectURL(u) } }
      else console.warn('photo fetch status', r.status);
    } catch (e) { console.warn('photo fetch failed, trying <img>', e) }
    const viaImg = await shrink(uri, true); if (viaImg) return viaImg;
    // image links expire after ~30 min: refresh the document once if ours is old
    if (Date.now() - doc.at < 10 * 60e3) break;
    docCache = null;
  }
  return null;
}

/* Photos copied by the Apps Script (copiar-fotos.gs) into «fotos-originals»: name = tabId__objectId.img */
async function listAll(q, fields = 'id,name') {
  const out = []; let pageToken = '';
  do {
    const r = await getJSON(`${DRIVE}/files?` + qs({ q, fields: `nextPageToken,files(${fields})`, pageSize: 1000, spaces: 'drive', supportsAllDrives: true, includeItemsFromAllDrives: true, ...(pageToken ? { pageToken } : {}) }));
    out.push(...(r.files || [])); pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}
async function loadOriginals() {
  const f = await list(`'${folderId}' in parents and name='fotos-originals' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const map = new Map(); if (!f[0]) return map;
  for (const x of await listAll(`'${f[0].id}' in parents and trashed=false`)) map.set(x.name, x.id);
  return map;
}
async function originalImage(map, img) {
  const fid = map.get(img.tab + '__' + img.obj + '.img'); if (!fid) return null;
  const blob = await (await api(`${DRIVE}/files/${fid}?alt=media&supportsAllDrives=true`)).blob();
  const u = URL.createObjectURL(blob); try { return await shrink(u) } finally { URL.revokeObjectURL(u) }
}

/* ================= state ================= */
let data = emptyData();
let group = ls.get('diari.group') || 'all';

function groupsOf(entries) {
  const gs = [{ key: 'inici', title: 'Inici', entries: [] }];
  for (const e of entries) { if (e.chapter) gs.push({ key: e.id, title: e.title || 'Capítol', entries: [] }); gs[gs.length - 1].entries.push(e) }
  return gs.filter(g => g.entries.length);
}
let printSel = null; // {entries, label, cover} while printing a custom selection
function selectedEntries() {
  if (printSel) return printSel.entries;
  if (group === 'all') return data.entries;
  const g = groupsOf(data.entries).find(g => g.key === group);
  return g ? g.entries : data.entries;
}

/* ================= page building ================= */
const chars = e => e.paras.reduce((a, p) => a + p.length, 0);
function chunkParas(paras, first, rest) {
  const out = []; let cur = [], n = 0, cap = first;
  for (const p of paras) {
    if (n + p.length > cap && cur.length) { out.push(cur); cur = []; n = 0; cap = rest }
    if (p.length > cap) {
      const parts = p.match(/[^.!?]+[.!?]*\s*/g) || [p]; let buf = '';
      for (const s of parts) { if ((buf + s).length > cap - n && buf) { cur.push(buf.trim()); out.push(cur); cur = []; n = 0; cap = rest; buf = '' } buf += s }
      if (buf) { cur.push(buf.trim()); n += buf.length }
    } else { cur.push(p); n += p.length }
  }
  if (cur.length) out.push(cur); return out;
}
function groups(list, max) {
  if (!list.length) return []; const g = Math.ceil(list.length / max), base = Math.floor(list.length / g), extra = list.length % g;
  const out = []; let i = 0; for (let k = 0; k < g; k++) { const s = base + (k < extra ? 1 : 0); out.push(list.slice(i, i + s)); i += s } return out;
}
function entryPages(e) {
  const ph = e.photos || [], c = chars(e), pages = [];
  if (e.chapter) {
    const k = c > 600 ? 1 : 2;
    pages.push({ kind: 'chapter', e, paras: e.paras, photos: ph.slice(0, k), first: true });
    groups(ph.slice(k), 4).forEach(g => pages.push({ kind: 'gallery', e, photos: g })); return pages;
  }
  if (c > 1500 || (!ph.length && c > 2900)) {
    chunkParas(e.paras, 2700, 3300).forEach((ch, i) => pages.push({ kind: i ? 'text' : 'entry', e, paras: ch, photos: [], first: !i }));
    groups(ph, 4).forEach(g => pages.push({ kind: 'gallery', e, photos: g }));
  } else {
    const k = !ph.length ? 0 : c < 350 ? 4 : c < 800 ? 3 : 2;
    pages.push({ kind: 'entry', e, paras: e.paras, photos: ph.slice(0, k), first: true });
    groups(ph.slice(k), 4).forEach(g => pages.push({ kind: 'gallery', e, photos: g }));
  }
  return pages;
}
const imgTag = p => `<img data-pid="${esc(p.id)}" alt="">`;
function gridHTML(P, variant) {
  const n = P.length, L = p => p.w >= p.h * 1.05; let areas, cols = '', rows = '';
  if (n === 1) areas = '"a"';
  else if (n === 2) areas = (L(P[0]) && L(P[1])) ? '"a" "b"' : '"a b"';
  else if (n === 3) {
    if (L(P[0])) { areas = variant ? '"b c" "a a"' : '"a a" "b c"'; rows = variant ? '1fr 1.3fr' : '1.3fr 1fr' }
    else { areas = variant ? '"b a" "c a"' : '"a b" "a c"'; cols = variant ? '1fr 1.3fr' : '1.3fr 1fr' }
  } else areas = '"a b" "c d"';
  const ncols = areas.split('"')[1].split(' ').length;
  const st = `grid-template-areas:${areas};grid-template-columns:${cols || `repeat(${ncols},1fr)`};${rows ? `grid-template-rows:${rows};` : ''}`;
  return `<div class="ph" style='${st}'>${P.map((p, i) => `<figure style="grid-area:${'abcd'[i]}"${p.s ? ` class="s-${p.s}"` : ''}>${imgTag(p)}</figure>`).join('')}</div>`;
}
function pageHTML(p, num, ents) {
  if (p.kind === 'cover') {
    const first = ents.flatMap(e => e.photos || [])[0];
    const d = ents.filter(e => !e.chapter).map(e => e.date).filter(Boolean);
    const range = d.length > 1 ? `${d[0]} — ${d[d.length - 1]}` : (d[0] || '');
    const sub = printSel ? printSel.label : group !== 'all' ? (groupsOf(data.entries).find(g => g.key === group) || {}).title : data.meta.sub;
    return `<div class="page p-cover ${first ? '' : 'noimg'}">${first ? `<div class="cimg">${imgTag(first)}</div>` : ''}
      <div class="ct"><h1>${esc(data.meta.title || DEFAULT_TITLE)}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>
      ${range ? `<div class="range">${esc(range)}</div>` : ''}</div>`;
  }
  const e = p.e, v = e.variant || 0, side = num % 2 ? 'verso' : 'recto';
  const pn = `<div class="pn">${num}</div>`, run = !e.chapter && chOf.get(e.id) ? `<div class="run">${esc(chOf.get(e.id))}</div>` : '';
  const txt = l => `<div class="txt">${l.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
  if (p.kind === 'chapter') {
    const y = (e.title.match(reYear) || [''])[0];
    return `<div class="page p-chapter"><div class="chh">${y ? `<div class="yr">${y}</div>` : ''}${e.title && e.title !== y ? `<div class="cht">${esc(e.title)}</div>` : ''}</div>${p.paras.length ? txt(p.paras) : ''}${p.photos.length ? gridHTML(p.photos, v) : ''}${pn}</div>`;
  }
  if (p.kind === 'entry') return `<div class="page p-entry ${side} ${p.photos.length ? '' : 'p-text'} v${v}">${run}
      <div class="eh">${e.date ? `<div class="date">${esc(e.date)}</div>` : ''}${e.title ? `<h2>${esc(e.title)}</h2>` : ''}</div>
      ${p.paras.length ? txt(p.paras) : ''}${p.photos.length ? gridHTML(p.photos, v) : ''}${pn}</div>`;
  if (p.kind === 'text') return `<div class="page p-text ${side}">${run}<div class="rh">${esc(e.date || e.title)} · continua</div>${txt(p.paras)}${pn}</div>`;
  return `<div class="page p-gallery ${side}">${run}<div class="rh">${esc(e.date || e.title)}</div>${gridHTML(p.photos, (v + num) % 2)}${pn}</div>`;
}

/* ================= render ================= */
const book = $('#book');
const listEl = $('#list');
function showScreen(html) {
  const s = $('#s-loading'); s.innerHTML = html; s.hidden = false; $('#layout').hidden = true;
}
function renderNav() {
  const gs = groupsOf(data.entries), nav = $('#nav');
  if (group !== 'all' && !gs.some(g => g.key === group)) group = 'all';
  const item = (key, title) => `<button class="nav-i${group === key ? ' on' : ''}" type="button" data-act="group" data-g="${esc(key)}"${group === key ? ' aria-current="true"' : ''}>${esc(title)}</button>`;
  nav.innerHTML = item('all', 'Tot el llibre') + (gs.length > 1 ? gs.map(g => item(g.key, g.title)).join('') : '');
}
/* entry list (middle column): click jumps to the entry's page */
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function renderList() {
  const q = norm($('#f-search').value.trim());
  const ents = q ? data.entries.filter(e => norm([e.date, e.title, ...(e.paras || [])].join(' ')).includes(q)) : selectedEntries();
  const g = groupsOf(data.entries).find(g => g.key === group);
  const head = q ? 'Resultats' : group === 'all' ? 'Tot el llibre' : (g ? g.title : 'Tot el llibre');
  const nDays = ents.filter(e => !e.chapter).length;
  listEl.innerHTML = `<div class="list-h"><h2>${q ? 'Resultats' : 'Índex'}</h2><span>${q ? '' : esc(head) + ' · '}${nDays} ${nDays === 1 ? 'dia' : 'dies'}</span></div>`
    + (ents.length ? ents.map(e => {
      const pg = pageNo.has(e.id) ? `<span class="li-p">${pageNo.get(e.id)}</span>` : '';
      if (e.chapter) return `<button class="li-ch" type="button" data-act="goto" data-id="${e.id}"><span>${esc(e.title || 'Capítol')}</span>${pg}</button>`;
      return `<button class="li" type="button" data-act="goto" data-id="${e.id}">
        <span class="li-row"><span class="li-h">${esc(e.title || e.date || 'Sense títol')}</span><span class="li-dots"></span>${pg}</span>
        ${e.title && e.date ? `<span class="li-d">${esc(e.date)}</span>` : ''}</button>`;
    }).join('') : `<p class="muted li-none">${q ? 'No hi ha cap entrada amb aquestes paraules.' : 'Encara no hi ha entrades.'}</p>`);
  listEl.querySelectorAll('img[data-pid]').forEach(img => { if (mem.has(img.dataset.pid)) loadImg(img); else io.observe(img) });
  markActive(activeId);
}
let activeId = null;
const pageNo = new Map(), chOf = new Map();
function markActive(id) {
  activeId = id;
  listEl.querySelectorAll('[data-act=goto].on').forEach(b => b.classList.remove('on'));
  const b = id && listEl.querySelector(`[data-act=goto][data-id="${id}"]`); if (!b) return;
  b.classList.add('on');
  if (listEl.scrollHeight > listEl.clientHeight) {
    const top = b.offsetTop, bot = top + b.offsetHeight;
    if (top < listEl.scrollTop + 50) listEl.scrollTop = top - 50; else if (bot > listEl.scrollTop + listEl.clientHeight) listEl.scrollTop = bot - listEl.clientHeight + 12;
  }
}
const seen = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) markActive(e.target.dataset.eid) }), { rootMargin: '-35% 0px -60% 0px' });
function gotoEntry(id) {
  let s = book.querySelector(`.sheet[data-eid="${id}"]`);
  if (!s && group !== 'all') { group = 'all'; ls.set('diari.group', group); render(); s = book.querySelector(`.sheet[data-eid="${id}"]`) }
  if (!s) return;
  s.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  markActive(id);
}
function render() {
  $('#bar').hidden = false; $('#s-loading').hidden = true; $('#layout').hidden = false;
  if (data.meta && data.meta.theme) applyTheme(data.meta.theme);
  $('#brand').textContent = data.meta.title || DEFAULT_TITLE;
  renderNav();
  seen.disconnect();
  if (!data.entries.length) {
    listEl.innerHTML = '';
    book.innerHTML = `<div class="empty"><h2>El diari és buit</h2>
      <p>Pots portar-hi el que ja teniu al Google Docs o començar amb una entrada nova.</p>
      <p class="muted">L'app llegeix el document directament del vostre Google Drive, amb totes les pestanyes i les fotos. No cal baixar res.</p>
      <div class="row"><button class="btn primary" data-act="docsimport">Importa del Google Docs</button><button class="btn" data-act="new">+ Nova entrada</button></div></div>`;
    return;
  }
  const ents = selectedEntries();
  const pages = (printSel && !printSel.cover) ? [] : [{ kind: 'cover' }]; ents.forEach(e => pages.push(...entryPages(e)));
  pageNo.clear(); chOf.clear();
  pages.forEach((p, i) => { if (p.first && !pageNo.has(p.e.id)) pageNo.set(p.e.id, i) });
  { let ch = ''; for (const e of data.entries) { if (e.chapter) ch = e.title || ''; chOf.set(e.id, ch) } }
  book.innerHTML = pages.map((p, i) => {
    const tools = p.kind === 'cover' ? `<button data-act="cover">Edita portada</button>` :
      p.first ? `<button data-act="variant" data-id="${p.e.id}">Canvia disseny</button><button data-act="edit" data-id="${p.e.id}">Edita</button>` : '';
    return `<div class="sheet ${p.kind === 'cover' ? 'cover' : ''}"${p.first ? ` data-eid="${p.e.id}"` : ''}><div class="tools">${tools}</div>${pageHTML(p, i, ents)}</div>`;
  }).join('');
  scale(); fitText(); renderList();
  book.querySelectorAll('.sheet[data-eid]').forEach(s => seen.observe(s));
  book.querySelectorAll('img[data-pid]').forEach(img => { if (mem.has(img.dataset.pid)) loadImg(img); else io.observe(img) });
}
function scale() { const s = book.querySelector('.sheet'); if (s) book.style.setProperty('--s', s.clientWidth / (210 * 96 / 25.4)) }
new ResizeObserver(scale).observe(book);
function fitText() {
  (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => {
    book.querySelectorAll('.txt').forEach(el => { let fs = 11.5; el.style.fontSize = ''; while (el.scrollHeight > el.clientHeight + 1 && fs > 8.5) { fs -= .25; el.style.fontSize = fs + 'pt' } });
  });
}

/* ================= UI helpers ================= */
let toastT; function toast(m, ms = 3200) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, ms) }
const ov = $('#ov'), card = $('#card');
function openCard(html, lock) { card.innerHTML = html; ov.hidden = false; if (lock) ov.dataset.lock = '1'; else delete ov.dataset.lock; const f = card.querySelector('input,textarea,button'); f && f.focus({ preventScroll: true }) }
function closeCard() { ov.hidden = true; card.innerHTML = ''; delete ov.dataset.lock; edit = null }
function busy(title, msg) { openCard(`<h3>${esc(title)}</h3><p id="pmsg">${esc(msg || '')}</p><div class="prog"><i id="pbar"></i></div>`, true) }
function progress(msg, frac) { const m = $('#pmsg'), b = $('#pbar'); if (m) m.textContent = msg; if (b && frac != null) b.style.width = Math.round(frac * 100) + '%' }
ov.addEventListener('click', e => { if (e.target === ov && !ov.dataset.lock) closeCard() });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !ov.hidden && !ov.dataset.lock) closeCard() });
const fmtDate = v => { try { return new Intl.DateTimeFormat(DATE_LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(v + 'T12:00')) } catch (e) { return v } };
function fail(err, what) {
  if (err instanceof Redirecting) return;
  console.error(err);
  openCard(`<h3>No s'ha pogut ${esc(what)}</h3><p>Comprova la connexió i torna-ho a provar. Si continua passant, surt i torna a entrar.</p><p class="muted" style="font-size:12px">${esc(err.message || err)}</p><div class="actions"><button class="btn primary" data-act="close">D'acord</button></div>`);
}

/* every change: read latest from Drive, apply, write back (so two people editing don't overwrite each other) */
async function mutate(fn) {
  const d = await readData(); fn(d);
  d.entries.forEach((e, i) => e.order = i); d.updated = Date.now();
  await writeData(d); data = d;
}

/* ================= import ================= */
$('#f-docx').onchange = async ev => {
  const files = [...ev.target.files].sort((x, y) => x.name.localeCompare(y.name, 'ca', { numeric: true })); ev.target.value = ''; if (!files.length) return;
  if (typeof mammoth === 'undefined') { toast("No s'ha pogut carregar el lector de Word. Revisa la connexió."); return }
  try {
    ensureToken(1500);
    busy('Important el diari', 'Llegint ' + (files.length > 1 ? files.length + ' arxius' : '«' + files[0].name + '»') + '…');
    const groupsList = [];
    for (const f of files) groupsList.push({ key: null, label: f.name, entries: await parseDocx(await f.arrayBuffer()) });
    await runImport(groupsList, img => shrink(img.src));
  } catch (err) { fail(err, 'importar el diari') }
};

/* Import groups of parsed entries (one group = one tab or one file).
   Saves to Drive every few days and remembers how far each tab got, so closing the app doesn't lose progress. */
let importing = false, wakeLock = null;
async function keepAwake(on) {
  try { if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null } } catch (e) {}
}
window.addEventListener('beforeunload', e => { if (importing) { e.preventDefault(); e.returnValue = '' } });
document.addEventListener('visibilitychange', () => { if (importing && document.visibilityState === 'visible') keepAwake(true) });
async function runImport(groupsList, resolveImg) {
  const prog0 = (data.meta && data.meta.importProgress) || {};
  const skip = g => (g.key && prog0[g.key]) || 0;
  const total = groupsList.reduce((a, g) => a + g.entries.slice(skip(g)).reduce((b, e) => b + e.imgs.length, 0), 0);
  let done = 0, nPh = 0, nEn = 0, nCh = 0, failed = 0;
  importing = true; keepAwake(true);
  try {
    for (const [gi, g] of groupsList.entries()) {
      const from = skip(g);
      let out = [];
      const flush = async (last, upto) => {
        const b = out; out = [];
        await mutate(d => {
          d.entries.push(...b);
          if (g.key) {
            d.meta.importProgress = d.meta.importProgress || {};
            if (last) { delete d.meta.importProgress[g.key]; d.meta.imported = d.meta.imported || {}; d.meta.imported[g.key] = Date.now() }
            else d.meta.importProgress[g.key] = upto;
          }
        });
      };
      for (let i = from; i < g.entries.length; i++) {
        if (!token(600)) {
          if (out.length) await flush(false, i);
          importing = false; keepAwake(false);
          openCard(`<h3>Cal tornar a entrar</h3><p>Google demana tornar a entrar cada hora. El que s'ha importat fins ara està desat. Prem Continua i després torna a <b>Importa del Google Docs</b>: continuarà on s'ha quedat.</p>
            <div class="actions"><button class="btn primary" data-act="login">Continua</button></div>`, true);
          render(); return;
        }
        const pe = g.entries[i], ph = [];
        for (const im of pe.imgs) {
          progress(`${g.label}: dia ${i + 1} de ${g.entries.length} · fotos ${++done} de ${total}`, done / Math.max(total, 1));
          try {
            const r = await resolveImg(im);
            if (r) { ph.push(await uploadPhoto(r, pe.date || pe.title)); nPh++ } else failed++;
          } catch (e) { if (e instanceof Redirecting) throw e; console.warn('photo skipped', e); failed++ }
        }
        out.push({ id: uid(), src: g.key || undefined, chapter: pe.chapter, date: pe.date, title: pe.title, paras: pe.paras, photos: ph, variant: i % 2 });
        pe.chapter ? nCh++ : nEn++;
        const last = i === g.entries.length - 1;
        if (last || out.length >= 4) { progress(`${g.label}: desant…`); await flush(last, i + 1) }
      }
      if (g.entries.length === from) await flush(true, from);
    }
  } finally { importing = false; keepAwake(false) }
  closeCard(); render();
  toast(`Fet: ${nCh ? nCh + ' capítols, ' : ''}${nEn} entrades i ${nPh} fotos.${failed ? ` ${failed} fotos no s'han pogut copiar.` : ''}`, 6000);
}

/* ---- import straight from the Google Doc ---- */
const docIdFrom = s => { const m = String(s).match(/\/d\/([a-zA-Z0-9_-]{20,})/) || String(s).match(/^([a-zA-Z0-9_-]{25,})$/); return m ? m[1] : null };
async function openDocsImport() {
  try {
    ensureToken(1500);
    busy('Importa del Google Docs', 'Buscant els teus documents…');
    const r = await getJSON(`${DRIVE}/files?` + qs({ q: "mimeType='application/vnd.google-apps.document' and trashed=false", orderBy: 'modifiedTime desc', pageSize: 15, fields: 'files(id,name,modifiedTime)', supportsAllDrives: true, includeItemsFromAllDrives: true }));
    const docs = r.files || [];
    openCard(`<h3>Importa del Google Docs</h3>
      <p>Tria el document del diari. L'app el llegeix directament, amb totes les pestanyes, sense haver-lo de baixar.</p>
      <div class="menu">${docs.map(d => `<button class="btn" data-act="pickdoc" data-doc="${esc(d.id)}">${esc(d.name)}</button>`).join('') || '<p>No he trobat cap document.</p>'}</div>
      <div class="fld"><label for="d-link">O enganxa l'enllaç del document</label><input type="text" id="d-link" placeholder="https://docs.google.com/document/d/…"></div>
      <div class="actions"><div class="left"><button class="btn" data-act="import">Puja un .docx</button></div><button class="btn" data-act="close">Cancel·la</button><button class="btn primary" data-act="picklink">Obre l'enllaç</button></div>`);
  } catch (err) { fail(err, 'buscar els documents') }
}
async function pickDoc(id) {
  try {
    busy('Llegint el document', 'Pot trigar una mica si té moltes fotos…');
    data = await readData();
    const doc = await fetchDoc(id, true);
    const imp = (data.meta && data.meta.imported) || {};
    const orig = await loadOriginals();
    let totImg = 0, ready = 0;
    const rows = doc.tabs.map(t => {
      const blocks = tabBlocks(t), nImg = blocks.reduce((a, b) => a + b.imgs.length, 0), nDates = blocks.filter(b => b.t && isDateLine(b.t.replace(/\n/g, ' '))).length;
      blocks.forEach(b => b.imgs.forEach(im => { totImg++; if (orig.has(im.tab + '__' + im.obj + '.img')) ready++ }));
      const done = imp[id + ':' + t.id], part = ((data.meta && data.meta.importProgress) || {})[id + ':' + t.id];
      return `<label class="chk"><input type="checkbox" data-tab="${esc(t.id)}" ${done ? '' : 'checked'}> <span><b>${esc(t.title || 'Pestanya')}</b> · ${nDates} dies, ${nImg} fotos${done ? ' · <i>ja importada (si la marques, es torna a importar)</i>' : part ? ' · <i>a mitges, continuarà on es va quedar</i>' : ''}</span></label>`;
    }).join('');
    openCard(`<h3>${esc(doc.name || 'Document')}</h3><p>Tria les pestanyes que vols portar al llibre. Cada pestanya serà un capítol.</p>
      <div class="menu" id="tabs">${rows || '<p>El document és buit.</p>'}</div>
      ${ready < totImg ? `<div class="empty" style="margin:0"><h2 style="font-size:20px">Pas previ: preparar les fotos</h2>
        <p>Fotos preparades: <b>${ready} de ${totImg}</b>. El navegador no pot copiar les fotos d'un Google Docs; un petit script de Google sí.</p>
        <ol style="margin:0;padding-left:20px;line-height:1.6"><li>Prem <b>Copia el script</b>.</li><li>Obre <a href="https://script.google.com/home/projects/create" target="_blank" rel="noopener">script.google.com</a> (projecte nou), esborra el que hi ha i enganxa'l.</li>
        <li>A l'esquerra, a <b>Serveis</b>, prem <b>+</b>, tria <b>Google Docs API</b> i prem <b>Afegeix</b>.</li><li>Prem <b>Desa</b> i després <b>Executa</b> (funció <code>copiarFotos</code>). Accepta els permisos.</li><li>Quan al registre surti <b>FET</b>, torna aquí i prem Importa. Si hi ha moltes fotos, el script continua sol cada minut.</li></ol>
        <div class="row"><button class="btn" data-act="copyscript" data-doc="${esc(id)}">Copia el script</button></div></div>` : `<p class="muted">Les ${totImg} fotos estan preparades.</p>`}
      <p class="muted">Amb moltes fotos pot trigar una estona: deixa la pantalla oberta.</p>
      <div class="actions"><button class="btn" data-act="close">Cancel·la</button><button class="btn primary" data-act="dodocimport" data-doc="${esc(id)}">Importa</button></div>`);
  } catch (err) {
    if (err.status === 403 || err.status === 404) {
      openCard(`<h3>No puc obrir aquest document</h3><p>Comprova que el document està compartit amb el compte amb què has entrat, i que a Google Cloud està activada la <b>Google Docs API</b> (mira el README).</p><div class="actions"><button class="btn primary" data-act="close">D'acord</button></div>`);
    } else fail(err, 'llegir el document');
  }
}
async function doDocImport(id) {
  const tabIds = [...card.querySelectorAll('#tabs input:checked')].map(i => i.dataset.tab);
  if (!tabIds.length) { toast('Tria almenys una pestanya.'); return }
  try {
    ensureToken(1500);
    busy('Important el diari', 'Preparant…');
    const doc = await fetchDoc(id);
    const orig = await loadOriginals();
    const groupsList = doc.tabs.filter(t => tabIds.includes(t.id)).map(t => ({ key: id + ':' + t.id, label: t.title || 'Pestanya', entries: blocksToEntries(tabBlocks(t), t.title) }));
    const again = groupsList.filter(g => data.meta.imported && data.meta.imported[g.key]).map(g => g.key);
    if (again.length) await mutate(d => { d.entries = d.entries.filter(e => !again.includes(e.src)); again.forEach(k => { delete d.meta.imported[k]; if (d.meta.importProgress) delete d.meta.importProgress[k] }) });
    await runImport(groupsList, async img => (await originalImage(orig, img)) || docImage(id, img));
  } catch (err) { fail(err, 'importar el diari') }
}

/* ================= editor ================= */
let edit = null; // {id|null, photos:[{id,w,h}|{tmp,blob,w,h,url}], removed:[]}
function saveDraft() {
  if (!edit || !$('#f-text')) return;
  ls.set('diari.draft', JSON.stringify({ id: edit.id, date: ($('#f-date') || {}).value || '', title: $('#f-title').value, text: $('#f-text').value }));
}
function editorHTML(e, draft) {
  const date = draft ? draft.date : e ? e.date : fmtDate(new Date().toISOString().slice(0, 10));
  const title = draft ? draft.title : e ? e.title : '';
  const text = draft ? draft.text : e ? e.paras.join('\n\n') : '';
  const idx = e ? data.entries.indexOf(e) : -1;
  return `<h3>${e ? (e.chapter ? 'Edita el capítol' : "Edita l'entrada") : 'Nova entrada'}</h3>
  ${e && e.chapter ? '' : `<div class="row"><div class="fld"><label for="f-date">Data</label><input type="text" id="f-date" value="${esc(date)}"></div>
    <div class="fld" style="flex:0 1 170px"><label for="f-pick">Tria al calendari</label><input type="date" id="f-pick"></div></div>`}
  <div class="fld"><label for="f-title">${e && e.chapter ? 'Títol del capítol' : 'Títol (opcional)'}</label><input type="text" id="f-title" value="${esc(title)}"></div>
  <div class="fld"><label for="f-text">${e && e.chapter ? 'Text (opcional)' : 'El que ha passat'}</label><textarea id="f-text" placeholder="Escriu aquí. Deixa una línia en blanc per començar un paràgraf nou.">${esc(text)}</textarea></div>
  <div class="fld"><label>Fotos</label><p class="hint">Toca «Gran» per fer una foto més petita al llibre. Amb ‹ › canvies l'ordre.</p><div class="thumbs" id="thumbs"></div><input class="hid" type="file" id="f-photos" accept="image/*" multiple></div>
  ${e ? '' : `<label class="chk"><input type="checkbox" id="f-chapter"> És l'inici d'un capítol nou (per exemple, un any)</label>`}
  <div class="actions"><div class="left">${e ? `<button class="btn danger" data-act="del">Esborra</button>${idx > 0 ? `<button class="btn" data-act="merge">Uneix amb l'anterior</button>` : ''}` : ''}</div>
    <button class="btn" data-act="close">Cancel·la</button><button class="btn primary" data-act="save">Desa</button></div>`;
}
/* photo size on the page: g = gran (fills its space), m = mitjana, p = petita */
const SIZES = { g: 'Gran', m: 'Mitjana', p: 'Petita' }, NEXT_SIZE = { g: 'm', m: 'p', p: 'g' };
function drawThumbs() {
  const n = edit.photos.length;
  $('#thumbs').innerHTML = edit.photos.map((p, i) => `<div class="thumb">
    <div class="th-img s-${p.s || 'g'}"><img data-tpid="${p.tmp ? '' : esc(p.id)}" src="${p.tmp ? p.url : (mem.get(p.id) || '')}" alt="Foto ${i + 1}"><span class="th-n">${i + 1}</span><button type="button" class="th-rm" data-act="rm" data-i="${i}" aria-label="Treu la foto ${i + 1}">✕</button></div>
    <div class="th-ctl"><button type="button" data-act="left" data-i="${i}" aria-label="Mou la foto ${i + 1} abans"${i ? '' : ' disabled'}>‹</button><button type="button" class="th-size" data-act="size" data-i="${i}" aria-label="Mida de la foto ${i + 1}">${SIZES[p.s || 'g']}</button><button type="button" data-act="right" data-i="${i}" aria-label="Mou la foto ${i + 1} després"${i < n - 1 ? '' : ' disabled'}>›</button></div></div>`).join('')
    + `<button class="add-ph" data-act="addph" type="button">+ Afegeix fotos</button>`;
  $('#thumbs').querySelectorAll('img[data-tpid]').forEach(img => { const id = img.dataset.tpid; if (id && !img.getAttribute('src')) photoURL(id).then(u => img.src = u).catch(() => {}) });
}
function openEditor(e, draft) {
  try { ensureToken(1500) } catch (err) { return }
  edit = { id: e ? e.id : null, photos: e ? (e.photos || []).map(p => ({ ...p })) : [], removed: [] };
  openCard(editorHTML(e, draft)); drawThumbs();
  const pick = $('#f-pick'); if (pick) pick.onchange = ev => { if (ev.target.value) $('#f-date').value = fmtDate(ev.target.value) };
  $('#f-photos').onchange = async ev => {
    const files = [...ev.target.files]; ev.target.value = ''; let bad = 0;
    for (const f of files) { const r = await shrinkFile(f); if (r) { edit.photos.push({ tmp: true, ...r, url: URL.createObjectURL(r.blob) }); drawThumbs() } else bad++ }
    if (bad) toast(`${bad} foto(s) no s'han pogut obrir. Prova-les en format JPG.`);
  };
}
async function saveEditor() {
  const paras = $('#f-text').value.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
  const dateEl = $('#f-date'), chEl = $('#f-chapter');
  const fields = { date: dateEl ? dateEl.value.trim() : '', title: $('#f-title').value.trim(), paras };
  if (!fields.date && !fields.title && !paras.length && !edit.photos.length) { toast("L'entrada està buida."); return }
  const ed = edit; saveDraft();
  try {
    ensureToken(300);
    const fresh = ed.photos.filter(p => p.tmp);
    busy('Desant', fresh.length ? `Pujant fotos: 0 de ${fresh.length}` : 'Desant al Drive…');
    const ph = []; let n = 0;
    for (const p of ed.photos) {
      if (p.tmp) { progress(`Pujant fotos: ${++n} de ${fresh.length}`, n / fresh.length); const up = await uploadPhoto(p, fields.date || fields.title); if (p.s) up.s = p.s; ph.push(up) }
      else ph.push(p);
    }
    progress('Desant al Drive…');
    const sid = ed.id || uid(), before = ed.id && data.entries.find(y => y.id === ed.id);
    const snap = before && ed.removed.length ? JSON.parse(JSON.stringify(before)) : null;
    await mutate(d => {
      const x = ed.id && d.entries.find(y => y.id === ed.id);
      if (x) Object.assign(x, fields, { photos: ph });
      else d.entries.push({ id: sid, variant: d.entries.length % 2, chapter: !!(chEl && chEl.checked), ...fields, photos: ph });
    });
    const bkDone = backupSoon([sid], snap ? [snap] : []);
    if (ed.removed.length) { progress('Desant la còpia de seguretat…'); await bkDone; for (const id of ed.removed) await trashFile(id) }
    ls.del('diari.draft'); closeCard(); render(); toast('Desat');
  } catch (err) { fail(err, 'desar') }
}

/* ================= colour themes (shared by everyone through diari.json, so the printed book matches) ================= */
const THEMES = [
  {"key": "blau", "name": "Blau", "desc": "Blau cel i taronja", "sw": ["#e8edf4", "#2d5da8", "#e09a3b", "#fffefb"], "vars": {"--desk": "#e8edf4", "--panel": "#f6f8fb", "--ink": "#1d2735", "--muted": "#66728a", "--line": "#d3dbe7", "--accent": "#2d5da8", "--accent-soft": "#dbe4f3", "--clay": "#e09a3b", "--paper-ink": "#1d2735", "--paper-soft": "#77829a", "--paper-accent": "#2d5da8", "--paper-clay": "#d08a2c", "--paper-line": "#d5dce8", "--photo-bg": "#e6ebf3"}},
  {"key": "bosc", "name": "Bosc", "desc": "Verd bosc i terracota", "sw": ["#ece5da", "#3e5a48", "#a5583c", "#fffefb"], "vars": {}},
  {"key": "tinta", "name": "Tinta", "desc": "Blau marí i mostassa", "sw": ["#e9e8e4", "#28385a", "#c08a2d", "#fffefb"], "vars": {"--desk": "#e9e8e4", "--panel": "#f7f6f2", "--ink": "#1f2430", "--muted": "#6e717a", "--line": "#d6d4cd", "--accent": "#28385a", "--accent-soft": "#dfe3ec", "--clay": "#c08a2d", "--paper-ink": "#1f2430", "--paper-soft": "#7d7f86", "--paper-accent": "#28385a", "--paper-clay": "#b07c22", "--paper-line": "#d8d6cf"}},
  {"key": "mar", "name": "Mar", "desc": "Verd aigua i corall", "sw": ["#e6ecea", "#2f6f6a", "#d06a4e", "#fffefb"], "vars": {"--desk": "#e6ecea", "--panel": "#f5f8f7", "--ink": "#1f2b2a", "--muted": "#677572", "--line": "#d0dad7", "--accent": "#2f6f6a", "--accent-soft": "#dbe9e6", "--clay": "#d06a4e", "--paper-ink": "#1f2b2a", "--paper-soft": "#76827f", "--paper-accent": "#2f6f6a", "--paper-clay": "#c4603f", "--paper-line": "#d2dbd8", "--photo-bg": "#e8eeec"}},
  {"key": "vi", "name": "Vi", "desc": "Granat i daurat", "sw": ["#efe7e6", "#6e2f45", "#b9864a", "#fffefb"], "vars": {"--desk": "#efe7e6", "--panel": "#faf6f5", "--ink": "#2e2124", "--muted": "#806c70", "--line": "#e0d2d1", "--accent": "#6e2f45", "--accent-soft": "#f0e0e4", "--clay": "#b9864a", "--paper-ink": "#2e2124", "--paper-soft": "#8a777b", "--paper-accent": "#6e2f45", "--paper-clay": "#a97a3f", "--paper-line": "#e2d5d4", "--photo-bg": "#f1e9e8"}},
  {"key": "crema", "name": "Crema", "desc": "Crema i terracota, com la teva imatge", "sw": ["#f7efe4", "#c9694b", "#7a2e20", "#fffaf3"], "vars": {"--desk": "#f7efe4", "--panel": "#fffaf4", "--ink": "#3b2a22", "--muted": "#8b7565", "--line": "#ecdccb", "--accent": "#c9694b", "--accent-soft": "#f9e4d7", "--clay": "#7a2e20", "--paper": "#fffcf7", "--paper-ink": "#3b2a22", "--paper-soft": "#9a8373", "--paper-accent": "#b35a3d", "--paper-clay": "#7a2e20", "--paper-line": "#e6d3c1", "--photo-bg": "#f2e7da"}},
  {"key": "llapis", "name": "Llapis", "desc": "Blanc i negre: estalvia tinta de color", "sw": ["#ebebea", "#333333", "#8c8c86", "#ffffff"], "vars": {"--desk": "#ebebea", "--panel": "#f8f8f7", "--ink": "#222222", "--muted": "#6f6f6c", "--line": "#d8d8d4", "--accent": "#333333", "--accent-soft": "#e6e6e3", "--clay": "#8c8c86", "--paper": "#ffffff", "--paper-ink": "#222222", "--paper-soft": "#7d7d79", "--paper-accent": "#2b2b2b", "--paper-clay": "#7a7a74", "--paper-line": "#d9d9d5", "--photo-bg": "#eeeeee"}}
];
function applyTheme(key) {
  const t = THEMES.find(x => x.key === key) || THEMES[0], st = document.documentElement.style;
  THEMES.forEach(x => Object.keys(x.vars).forEach(v => st.removeProperty(v)));
  Object.entries(t.vars).forEach(([v, c]) => st.setProperty(v, c));
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = t.sw[0];
  document.documentElement.dataset.diariTheme = t.key;
  ls.set('diari.theme', t.key);
}
applyTheme(ls.get('diari.theme'));
function openThemes() {
  const cur = (data.meta && data.meta.theme) || ls.get('diari.theme') || THEMES[0].key;
  openCard(`<h3>Colors del diari</h3><p>Tria els colors que més t'agradin. Es veuen a l'app i al llibre imprès, i els veureu tots dos.</p>
    <div class="themes">${THEMES.map(t => `<button class="theme${t.key === cur ? ' on' : ''}" type="button" data-act="theme" data-k="${t.key}" aria-pressed="${t.key === cur}">
      <span class="sw">${t.sw.map(c => `<i style="background:${c}"></i>`).join('')}</span><b>${esc(t.name)}</b><small>${esc(t.desc)}</small></button>`).join('')}</div>
    <div class="actions"><button class="btn primary" data-act="close">Fet</button></div>`);
}
async function pickTheme(key) {
  applyTheme(key);
  card.querySelectorAll('.theme').forEach(b => { const on = b.dataset.k === key; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on) });
  data.meta.theme = key;
  await mutate(d => { d.meta.theme = key });
}

/* ================= backup: a readable copy in the diary's folder =================
   «Còpia de seguretat» holds copia.json (what has been copied), a Google Doc with all the texts
   and one folder of photo copies per entry. Copies are never deleted, even when an entry or a photo is. */
const BK_NAME = 'Còpia de seguretat';
let bk = null, bkQueue = Promise.resolve();
async function bkLoad() {
  if (bk && bk.diari === folderId) return bk;
  const f = await list(`'${folderId}' in parents and name='${qName(BK_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`);
  const folder = f[0] ? f[0].id : await createFolder(BK_NAME, folderId);
  const j = await list(`'${folder}' in parents and name='copia.json' and trashed=false`);
  const state = { doc: null, entries: {} };
  if (j[0]) { try { Object.assign(state, await getJSON(`${DRIVE}/files/${j[0].id}?alt=media&supportsAllDrives=true`)) } catch (e) { if (e instanceof Redirecting) throw e; console.warn('copia.json', e) } }
  bk = { diari: folderId, folder, fileId: j[0] ? j[0].id : null, state };
  return bk;
}
async function bkSave() {
  const blob = new Blob([JSON.stringify(bk.state)], { type: 'application/json' });
  if (bk.fileId) await uploadFile({}, blob, bk.fileId);
  else bk.fileId = await uploadFile({ name: 'copia.json', mimeType: 'application/json', parents: [bk.folder] }, blob);
}
const safeName = t => String(t || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
const bkLabel = e => safeName([e.date, e.title].filter(Boolean).join(' · ')) || 'Entrada';
const bkChanged = e => { const r = bk.state.entries[e.id]; return !r || r.date !== (e.date || '') || r.title !== (e.title || '') || JSON.stringify(r.paras) !== JSON.stringify(e.paras || []) || (e.photos || []).some(p => !r.photos.includes(p.id)) };
async function bkEntry(e) {
  const r = bk.state.entries[e.id] || (bk.state.entries[e.id] = { photos: [] });
  Object.assign(r, { date: e.date || '', title: e.title || '', chapter: !!e.chapter, paras: (e.paras || []).slice() });
  for (const p of (e.photos || []).filter(p => !r.photos.includes(p.id))) {
    if (!r.folder) r.folder = await createFolder(bkLabel(e), bk.folder);
    try {
      await api(`${DRIVE}/files/${p.id}/copy?fields=id&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `${bkLabel(e)} - ${r.photos.length + 1}.jpg`, parents: [r.folder] }) });
    } catch (err) { if (err instanceof Redirecting) throw err; if (err.status !== 404) throw err; console.warn('photo gone, not copied', p.id) }
    r.photos.push(p.id);
  }
}
function bkHTML() {
  const st = bk.state, cur = new Set(data.entries.map(e => e.id));
  const one = id => {
    const r = st.entries[id]; if (!r) return '';
    const paras = r.paras.map(t => `<p>${esc(t).replace(/\n/g, '<br>')}</p>`).join('');
    if (r.chapter) return `<h1>${esc(r.title || 'Capítol')}</h1>${paras}`;
    return `<h2>${esc([r.date, r.title].filter(Boolean).join(' · ') || 'Entrada')}</h2>${paras}`
      + (r.folder ? `<p><a href="https://drive.google.com/drive/folders/${encodeURIComponent(r.folder)}">Fotos d'aquest dia (${r.photos.length})</a></p>` : '');
  };
  const gone = Object.keys(st.entries).filter(id => !cur.has(id));
  return `<html><head><meta charset="utf-8"></head><body><h1>${esc(data.meta.title || DEFAULT_TITLE)}</h1>
    <p><i>Còpia de seguretat feta per Diaris Nidia. Actualitzada el ${esc(new Date().toLocaleString('ca'))}.</i></p>
    ${data.entries.map(e => one(e.id)).join('')}${gone.length ? `<h1>Entrades esborrades o unides</h1>${gone.map(one).join('')}` : ''}</body></html>`;
}
async function bkWriteDoc() {
  const name = 'Còpia de seguretat — ' + (data.meta.title || DEFAULT_TITLE), blob = () => new Blob([bkHTML()], { type: 'text/html' });
  if (bk.state.doc) {
    try { await uploadFile({ name }, blob(), bk.state.doc); return }
    catch (e) { if (e instanceof Redirecting) throw e; console.warn('doc update failed, making a new one', e) }
  }
  const old = bk.state.doc;
  bk.state.doc = await uploadFile({ name, mimeType: 'application/vnd.google-apps.document', parents: [bk.folder] }, blob());
  if (old) await trashFile(old);
}
/* queue a backup after a change; extra = entry objects no longer in data (deleted ones) */
function backupSoon(ids = [], extra = []) {
  if (!folderId) return bkQueue;
  const fid = folderId;
  bkQueue = bkQueue.then(async () => {
    if (fid !== folderId) return;
    await bkLoad();
    for (const e of extra) await bkEntry(e);
    for (const id of ids) { const e = data.entries.find(x => x.id === id); if (e) await bkEntry(e) }
    await bkWriteDoc(); await bkSave();
  }).catch(err => { if (err instanceof Redirecting) return; console.warn('backup', err); toast("No s'ha pogut fer la còpia de seguretat. Ho pots fer a Més opcions → Còpia de seguretat.", 6000) });
  return bkQueue;
}
const driveLink = (id, doc) => id ? `https://${doc ? 'docs.google.com/document/d/' + encodeURIComponent(id) : 'drive.google.com/drive/folders/' + encodeURIComponent(id)}` : '';
async function openBackup() {
  busy('Còpia de seguretat', 'Mirant què hi ha copiat…');
  await bkQueue; await bkLoad();
  const pend = data.entries.filter(bkChanged).length;
  openCard(`<h3>Còpia de seguretat</h3>
    <p>Cada vegada que deseu una entrada, l'app en guarda una còpia a la carpeta «${esc(BK_NAME)}» del diari: el text va a un Google Docs i les fotos es copien en una carpeta per dia. Si després esborreu una entrada o una foto, la còpia es queda.</p>
    <p>${pend ? `Hi ha <b>${pend}</b> ${pend === 1 ? 'entrada que encara no té' : 'entrades que encara no tenen'} còpia (per exemple, les importades del Google Docs).` : 'Totes les entrades tenen còpia.'}</p>
    <div class="menu">${bk.state.doc ? `<a class="btn" href="${driveLink(bk.state.doc, true)}" target="_blank" rel="noopener">Obre el Google Docs de la còpia</a>` : ''}<a class="btn" href="${driveLink(bk.folder)}" target="_blank" rel="noopener">Obre la carpeta de la còpia</a></div>
    <div class="actions"><button class="btn" data-act="close">Tanca</button>${pend ? `<button class="btn primary" data-act="backupall">Fes la còpia de ${pend === 1 ? "l'entrada" : 'les ' + pend + ' entrades'}</button>` : ''}</div>`);
}
async function backupAll() {
  ensureToken(1500);
  busy('Còpia de seguretat', 'Preparant…');
  await bkQueue; await bkLoad();
  const todo = data.entries.filter(bkChanged);
  importing = true; keepAwake(true);
  try {
    for (const [i, e] of todo.entries()) {
      if (!token(300)) {
        await bkWriteDoc(); await bkSave();
        openCard(`<h3>Cal tornar a entrar</h3><p>Google demana tornar a entrar cada hora. El que s'ha copiat fins ara està desat. Prem Continua i després torna a <b>Més opcions → Còpia de seguretat</b>: continuarà on s'ha quedat.</p>
          <div class="actions"><button class="btn primary" data-act="login">Continua</button></div>`, true);
        return;
      }
      progress(`Copiant: ${i + 1} de ${todo.length}`, (i + 1) / todo.length);
      await bkEntry(e);
      if (i % 15 === 14) await bkSave();
    }
    progress('Escrivint el Google Docs…');
    await bkWriteDoc(); await bkSave();
  } finally { importing = false; keepAwake(false) }
  closeCard(); toast('Còpia de seguretat feta', 4000);
}

/* ================= several diaries ================= */
async function openDiaries() {
  busy('Diaris', 'Buscant els diaris…');
  const ds = await listDiaries();
  if (folderId && !ds.some(d => d.id === folderId)) ds.unshift({ id: folderId, name: data.meta.title || FOLDER_NAME });
  openCard(`<h3>Diaris</h3><p>Podeu tenir més d'un diari. Cadascun té les seves entrades, fotos i colors, i no es barregen. Tria quin vols obrir.</p>
    <div class="menu">${ds.map(d => `<button class="btn diari${d.id === folderId ? ' on' : ''}" type="button" data-act="opendiari" data-id="${esc(d.id)}"${d.id === folderId ? ' aria-current="true"' : ''}><span>${esc(d.name)}</span><small>${d.id === folderId ? 'obert ara' : d.ownedByMe === false ? 'compartit amb tu' : ''}</small></button>`).join('')}</div>
    <div class="row"><div class="fld"><label for="n-name">Crea un diari nou</label><input type="text" id="n-name" placeholder="Per exemple: Viatge a Menorca"></div><button class="btn" data-act="newdiari" type="button">Crea'l</button></div>
    <p class="muted">Crear un diari nou no toca els altres: «${esc(data.meta.title || DEFAULT_TITLE)}» es queda tal com està.</p>
    <div class="actions"><button class="btn primary" data-act="close">Tanca</button></div>`);
}
async function loadDiari(id) {
  folderId = id; dataFileId = null; photosFolderId = null; bk = null; ls.set('diari.folder', id);
  group = 'all'; ls.set('diari.group', group); $('#f-search').value = ''; activeId = null;
  data = await readData();
}
async function switchDiari(id) {
  if (id === folderId) { closeCard(); return }
  busy('Obrint el diari');
  await loadDiari(id);
  applyTheme(data.meta.theme || THEMES[0].key);
  closeCard(); render(); window.scrollTo(0, 0);
}
async function newDiari(name) {
  if (!name) { toast('Posa-li un nom.'); $('#n-name').focus(); return }
  busy('Creant el diari', '«' + name + '»');
  const theme = data.meta.theme || ls.get('diari.theme');
  const id = await createFolder(name, null, DIARI_PROP);
  await loadDiari(id);
  data = emptyData(); data.meta.title = name; if (theme) data.meta.theme = theme;
  await writeData(data);
  closeCard(); render(); window.scrollTo(0, 0); toast('Diari creat: ' + name);
}

/* ================= menu, cover, share, print ================= */
function openMenu() {
  openCard(`<h3>Més opcions</h3><div class="menu">
    <button class="btn" data-act="docsimport">Importa del Google Docs</button>
    <button class="btn" data-act="diaris">Canvia de diari o crea'n un de nou</button>
    <button class="btn" data-act="backup">Còpia de seguretat</button>
    <button class="btn" data-act="themes">Colors del diari</button>
    <button class="btn" data-act="cover">Edita la portada</button>
    <button class="btn" data-act="share">Comparteix el diari amb algú</button>
    <button class="btn" data-act="refresh">Actualitza (veure els canvis de l'altre)</button>
    <button class="btn" data-act="install">Posa-la a la pantalla del mòbil</button>
    <button class="btn" data-act="logout">Surt</button></div>
    <div class="actions"><button class="btn" data-act="close">Tanca</button></div>`);
}
function openCover() {
  openCard(`<h3>Portada</h3>
  <div class="fld"><label for="c-title">Títol</label><input type="text" id="c-title" value="${esc(data.meta.title || DEFAULT_TITLE)}"></div>
  <div class="fld"><label for="c-sub">Subtítol</label><input type="text" id="c-sub" value="${esc(data.meta.sub || '')}"></div>
  <p>La foto de la portada és la primera foto del que estàs veient. Quan tries un any, el subtítol és el nom del capítol.</p>
  <div class="actions"><button class="btn" data-act="close">Cancel·la</button><button class="btn primary" data-act="savecover">Desa</button></div>`);
}
function openShare() {
  openCard(`<h3>Comparteix el diari</h3>
  <p>La persona rebrà un correu de Google Drive i podrà veure i escriure al diari. Abans, el seu correu ha d'estar afegit com a «usuari de prova» a Google Cloud (mira el README).</p>
  <div class="fld"><label for="s-mail">Correu de Google</label><input type="email" id="s-mail" placeholder="nom@gmail.com"></div>
  <div class="actions"><button class="btn" data-act="close">Cancel·la</button><button class="btn primary" data-act="doshare">Comparteix</button></div>`);
}
function openInstall() {
  openCard(`<h3>A la pantalla del mòbil</h3>
  <ol><li><b>iPhone:</b> obre aquesta adreça amb Safari, prem el botó de compartir (el quadrat amb la fletxa) i tria <b>Afegeix a la pantalla d'inici</b>.</li>
  <li><b>Android:</b> obre-la amb Chrome, prem els tres punts i tria <b>Afegeix a la pantalla d'inici</b> o <b>Instal·la l'aplicació</b>.</li></ol>
  <p>L'adreça és: <code>${esc(REDIRECT)}</code></p>
  <div class="actions"><button class="btn primary" data-act="close">Entesos</button></div>`);
}
/* ---- printing: choose what, remember what has been printed ---- */
function printCounts() {
  const c = new Map();
  for (const pr of (data.meta.prints || [])) for (const id of pr.ids || []) c.set(id, (c.get(id) || 0) + 1);
  return c;
}
const fmtWhen = t => { try { return new Intl.DateTimeFormat('ca', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(t)) } catch (e) { return '' } };
function openPrint() {
  if (!data.entries.length) { toast('El diari és buit.'); return }
  const cnt = printCounts(), gs = groupsOf(data.entries);
  const days = es => es.filter(e => !e.chapter);
  const unprinted = days(data.entries).filter(e => !cnt.get(e.id));
  const gStatus = g => {
    const d = days(g.entries); if (!d.length) return '';
    const n = d.filter(e => cnt.get(e.id)).length, max = Math.max(0, ...d.map(e => cnt.get(e.id) || 0));
    return n === 0 ? '<i>no imprès</i>' : n < d.length ? `<i>imprès en part (${n} de ${d.length} dies)</i>` : `<i>imprès${max > 1 ? ' ' + max + ' vegades' : ''}</i>`;
  };
  const opts = data.entries.map((e, i) => e.chapter ? '' : `<option value="${i}">${esc(e.date || e.title || 'Entrada ' + (i + 1))}</option>`).join('');
  const hist = (data.meta.prints || []).slice(-8).reverse().map(pr => `<li>${fmtWhen(pr.at)} · ${esc(pr.label)} · ${pr.days != null ? pr.days : (pr.ids || []).length} dies</li>`).join('');
  openCard(`<h3>Imprimir o fer un PDF</h3>
    <div class="menu">
      <label class="chk"><input type="radio" name="pmode" value="new" ${unprinted.length ? 'checked' : 'disabled'}> <span><b>El que encara no s'ha imprès</b> · ${unprinted.length} dies</span></label>
      <label class="chk"><input type="radio" name="pmode" value="chap" ${unprinted.length ? '' : 'checked'}> <span><b>Per capítols (anys)</b></span></label>
      <div id="p-chaps" class="menu" style="padding-left:26px">${gs.map(g => `<label class="chk"><input type="checkbox" data-g="${esc(g.key)}"> <span>${esc(g.title)} · ${days(g.entries).length} dies · ${gStatus(g)}</span></label>`).join('')}</div>
      <label class="chk"><input type="radio" name="pmode" value="range"> <span><b>Entre dues dates</b></span></label>
      <div class="row" style="padding-left:26px"><div class="fld"><label for="p-from">Des de</label><select id="p-from">${opts}</select></div><div class="fld"><label for="p-to">Fins a</label><select id="p-to">${opts}</select></div></div>
      <label class="chk"><input type="checkbox" id="p-cover" checked> <span>Amb portada</span></label>
    </div>
    ${hist ? `<p class="muted">Últimes impressions:</p><ul class="muted" style="margin:0;padding-left:20px;line-height:1.6">${hist}</ul>` : ''}
    <p class="muted">A la finestra d'impressió: mida <b>A4</b>, marges <b>Cap</b>, activa <b>Gràfics de fons</b>. Per fer un PDF, tria «Desa com a PDF».</p>
    <div class="actions"><button class="btn" data-act="close">Cancel·la</button><button class="btn primary" data-act="doprint">Prepara</button></div>`);
  const to = $('#p-to'); if (to) to.selectedIndex = to.options.length - 1;
  card.querySelectorAll('#p-chaps input, #p-from, #p-to').forEach(el => el.addEventListener('change', () => {
    const v = el.closest('#p-chaps') ? 'chap' : 'range'; const r = card.querySelector(`input[name=pmode][value=${v}]`); if (r) r.checked = true }));
}
function chosenPrint() {
  const mode = (card.querySelector('input[name=pmode]:checked') || {}).value, cnt = printCounts();
  let ents = [], label = '';
  if (mode === 'new') {
    const keep = new Set(data.entries.filter(e => !e.chapter && !cnt.get(e.id)).map(e => e.id));
    // keep the chapter page of each chapter that has new days, if that chapter page was never printed
    let curCh = null; for (const e of data.entries) { if (e.chapter) curCh = e; else if (keep.has(e.id) && curCh && !cnt.get(curCh.id)) keep.add(curCh.id) }
    ents = data.entries.filter(e => keep.has(e.id)); label = 'Pàgines noves';
  } else if (mode === 'chap') {
    const ks = [...card.querySelectorAll('#p-chaps input:checked')].map(i => i.dataset.g);
    const gs = groupsOf(data.entries).filter(g => ks.includes(g.key));
    ents = gs.flatMap(g => g.entries); label = gs.map(g => g.title).join(', ');
  } else if (mode === 'range') {
    let a = +$('#p-from').value, b = +$('#p-to').value; if (a > b) [a, b] = [b, a];
    ents = data.entries.slice(a, b + 1); label = `${data.entries[a].date || ''} — ${data.entries[b].date || ''}`;
  }
  return { entries: ents, label, cover: $('#p-cover') ? $('#p-cover').checked : true };
}
async function doPrint() {
  const sel = chosenPrint();
  if (!sel.entries.length) { toast('No hi ha res per imprimir amb aquesta tria.'); return }
  printSel = sel; render();
  const imgs = [...book.querySelectorAll('img[data-pid]')];
  try {
    busy('Preparant per imprimir', `Carregant fotos: 0 de ${imgs.length}`);
    let n = 0;
    await Promise.all(imgs.map(img => loadImg(img).then(() => progress(`Carregant fotos: ${++n} de ${imgs.length}`, n / imgs.length))));
    await Promise.all(imgs.map(i => i.decode ? i.decode().catch(() => {}) : null));
    await (document.fonts ? document.fonts.ready : null);
    closeCard();
    await new Promise(r => setTimeout(r, 200));
    window.print();
    const nDays = sel.entries.filter(e => !e.chapter).length;
    openCard(`<h3>L'has imprès o desat?</h3><p>${esc(sel.label)} · ${nDays} dies. Si el PDF s'ha desat o s'ha imprès, ho apunto perquè la propera vegada sàpigues què falta.</p>
      <div class="actions"><button class="btn" data-act="printno">No, l'he cancel·lat</button><button class="btn primary" data-act="printyes">Sí, apunta-ho</button></div>`, true);
  } catch (err) { printSel = null; render(); fail(err, 'preparar la impressió') }
}
async function finishPrint(ok) {
  const sel = printSel; printSel = null;
  if (ok && sel) {
    busy('Desant');
    const who = ls.get('diari.hint') || '';
    await mutate(d => { d.meta.prints = d.meta.prints || []; d.meta.prints.push({ at: Date.now(), who, label: sel.label, days: sel.entries.filter(e => !e.chapter).length, ids: sel.entries.filter(e => !e.chapter).map(e => e.id).concat(sel.entries.filter(e => e.chapter).map(e => e.id)) }) });
    toast('Apuntat');
  }
  closeCard(); render();
}

/* ================= events ================= */
$('#b-new').onclick = () => openEditor(null);
$('#b-more').onclick = openMenu;
$('#b-theme').onclick = openThemes;
$('#brand').onclick = () => openDiaries().catch(err => fail(err, 'buscar els diaris'));
$('#brand').onkeydown = ev => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#brand').click() } };
$('#b-print').onclick = openPrint;
let searchT; $('#f-search').oninput = () => { clearTimeout(searchT); searchT = setTimeout(renderList, 150) };

document.addEventListener('click', async ev => {
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, e = data.entries.find(x => x.id === b.dataset.id);
  try {
    if (a === 'close') closeCard();
    else if (a === 'login') login();
    else if (a === 'group') { group = b.dataset.g; ls.set('diari.group', group); $('#f-search').value = ''; render(); window.scrollTo(0, 0) }
    else if (a === 'goto') gotoEntry(b.dataset.id);
    else if (a === 'new') { closeCard(); openEditor(null) }
    else if (a === 'import') { closeCard(); $('#f-docx').click() }
    else if (a === 'docsimport') openDocsImport();
    else if (a === 'pickdoc') pickDoc(b.dataset.doc);
    else if (a === 'picklink') { const id = docIdFrom($('#d-link').value.trim()); if (!id) { toast("Aquest enllaç no sembla d'un Google Docs."); return } pickDoc(id) }
    else if (a === 'dodocimport') doDocImport(b.dataset.doc);
    else if (a === 'edit' && e) openEditor(e);
    else if (a === 'variant' && e) { const id = e.id; e.variant = e.variant ? 0 : 1; render(); await mutate(d => { const x = d.entries.find(y => y.id === id); if (x) x.variant = e.variant }) }
    else if (a === 'cover') openCover();
    else if (a === 'themes') openThemes();
    else if (a === 'backup') await openBackup();
    else if (a === 'backupall') await backupAll();
    else if (a === 'theme') pickTheme(b.dataset.k);
    else if (a === 'savecover') { const t = $('#c-title').value.trim() || DEFAULT_TITLE, s = $('#c-sub').value.trim(); busy('Desant'); await mutate(d => { d.meta = Object.assign(d.meta || {}, { title: t, sub: s }) }); closeCard(); render() }
    else if (a === 'share') openShare();
    else if (a === 'doshare') {
      const mail = $('#s-mail').value.trim(); if (!/^\S+@\S+\.\S+$/.test(mail)) { toast('Escriu un correu vàlid.'); return }
      busy('Compartint');
      await api(`${DRIVE}/files/${folderId}/permissions?sendNotificationEmail=true&supportsAllDrives=true`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: 'writer', type: 'user', emailAddress: mail }) });
      closeCard(); toast('Compartit amb ' + mail, 4500);
    }
    else if (a === 'refresh') { busy('Actualitzant'); data = await readData(); closeCard(); render() }
    else if (a === 'install') openInstall();
    else if (a === 'logout') logout();
    else if (a === 'diaris') await openDiaries();
    else if (a === 'opendiari') await switchDiari(b.dataset.id);
    else if (a === 'newdiari') await newDiari($('#n-name').value.trim());
    else if (a === 'copyscript') {
      const id = b.dataset.doc; let code = '';
      try { code = await (await fetch('copiar-fotos.gs', { cache: 'no-store' })).text() } catch (e) {}
      code = code.replace('ENGANXA_AQUI_L_ID_DEL_DOCUMENT', id);
      try { await navigator.clipboard.writeText(code); toast('Script copiat. Enganxa\'l a script.google.com', 4500) }
      catch (e) { const ta = document.createElement('textarea'); ta.value = code; ta.style.cssText = 'width:100%;height:160px'; b.after(ta); ta.select(); toast('Copia el text seleccionat') }
    }
    else if (a === 'doprint') doPrint();
    else if (a === 'printyes') finishPrint(true);
    else if (a === 'printno') finishPrint(false);
    else if (a === 'addph') $('#f-photos').click();
    else if (a === 'rm') { const p = edit.photos.splice(+b.dataset.i, 1)[0]; if (!p.tmp) edit.removed.push(p.id); drawThumbs() }
    else if (a === 'left' || a === 'right') { const i = +b.dataset.i, j = a === 'left' ? i - 1 : i + 1; if (j < 0 || j >= edit.photos.length) return; [edit.photos[j], edit.photos[i]] = [edit.photos[i], edit.photos[j]]; drawThumbs() }
    else if (a === 'size') { const p = edit.photos[+b.dataset.i], s = NEXT_SIZE[p.s || 'g']; if (s === 'g') delete p.s; else p.s = s; drawThumbs() }
    else if (a === 'save') saveEditor();
    else if (a === 'del') {
      if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = 'Segur? Torna a prémer'; return }
      const ed = edit; const old = data.entries.find(x => x.id === ed.id);
      busy('Esborrant'); await mutate(d => { d.entries = d.entries.filter(x => x.id !== ed.id) });
      if (old) { progress('Desant la còpia de seguretat…'); await backupSoon([], [old]); for (const p of old.photos || []) await trashFile(p.id) }
      ls.del('diari.draft'); closeCard(); render(); toast('Entrada esborrada');
    }
    else if (a === 'merge') {
      const id = edit.id, ix = data.entries.findIndex(x => x.id === id), prevId = ix > 0 ? data.entries[ix - 1].id : null; busy('Unint');
      await mutate(d => { const i = d.entries.findIndex(x => x.id === id); if (i < 1) return; const cur = d.entries[i], prev = d.entries[i - 1];
        prev.paras.push(...(cur.title ? [cur.title] : []), ...(cur.date && cur.date !== prev.date ? [cur.date] : []), ...cur.paras); prev.photos = (prev.photos || []).concat(cur.photos || []); d.entries.splice(i, 1) });
      closeCard(); render(); toast('Entrades unides'); if (prevId) backupSoon([prevId]);
    }
  } catch (err) { fail(err, 'fer-ho') }
});

let lastCheck = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !folderId || !ov.hidden || !token(120) || Date.now() - lastCheck < 30000) return;
  lastCheck = Date.now();
  try { const d = await readData(); if ((d.updated || 0) !== (data.updated || 0)) { data = d; render() } } catch (e) {}
});
window.addEventListener('beforeprint', () => book.querySelectorAll('img[data-pid]').forEach(i => { if (!i.dataset.done) loadImg(i) }));

/* ================= boot ================= */
function setupScreen() {
  showScreen(`<div class="hand">Falta un pas</div><h1>Diaris Nidia</h1>
    <p>L'app ja està penjada, però encara no està connectada amb Google. Cal posar l'«ID de client» de Google Cloud a l'arxiu <code>config.js</code> del repositori.</p>
    <p>Els passos estan explicats al <a href="https://github.com/rogerbeltranps-lab/diari-pauete-maruxi#readme">README del repositori</a>.</p>`);
}
function loginScreen(msg) {
  showScreen(`<div class="hand">els nostres llibres</div><h1>Diaris Nidia</h1>
    <p>Entra amb el teu compte de Google. Les fotos i els textos es guarden a la carpeta «${esc(FOLDER_NAME)}» del vostre Google Drive.</p>
    ${msg ? `<p class="muted">${esc(msg)}</p>` : ''}
    <button class="btn primary big" data-act="login">Entra amb Google</button>`);
}
async function boot() {
  if (!CFG.clientId) { setupScreen(); return }
  const h = readHash();
  if (h && h.error) { loginScreen(h.error === 'access_denied' ? "No s'ha donat permís per accedir al Drive. Sense això l'app no pot guardar el diari." : "No s'ha pogut entrar. Torna-ho a provar."); return }
  if (!token(60)) { if (ls.get('diari.was') && !h) { try { login() } catch (e) { return } } loginScreen(); return }
  ls.set('diari.was', '1');
  try {
    if (!ls.get('diari.hint')) { getJSON(`${DRIVE}/about?fields=user(emailAddress)`).then(r => r.user && ls.set('diari.hint', r.user.emailAddress)).catch(() => {}) }
    const found = await locateFolder();
    if (!found) {
      showScreen(`<div class="hand">primer pas</div><h1>Encara no hi ha cap diari</h1>
        <p>No he trobat la carpeta «${esc(FOLDER_NAME)}» al teu Drive.</p>
        <p class="muted">Si l'altra persona ja l'ha creada, demana-li que te la comparteixi (a l'app: Més… → Comparteix) i torna a mirar.</p>
        <div class="row" style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn primary" id="b-create">Crea el diari</button><button class="btn" id="b-retry">Torna a mirar</button></div>`);
      $('#b-retry').onclick = () => location.reload();
      $('#b-create').onclick = async () => {
        try { $('#b-create').disabled = true; folderId = await createFolder(FOLDER_NAME, null, DIARI_PROP); ls.set('diari.folder', folderId); data = emptyData(); await writeData(data); render() }
        catch (err) { fail(err, 'crear el diari'); $('#b-create').disabled = false }
      };
      return;
    }
    data = await readData();
    render();
    const draft = JSON.parse(ls.get('diari.draft') || 'null');
    if (draft) { ls.del('diari.draft'); const e = draft.id ? data.entries.find(x => x.id === draft.id) : null; openEditor(e, draft); toast("He recuperat el text que estaves escrivint. Si hi havia fotos noves, torna-les a afegir.", 6000) }
  } catch (err) {
    if (err instanceof Redirecting) return;
    console.error(err);
    showScreen(`<h1>No s'ha pogut obrir</h1><p>Comprova la connexió a internet i torna-ho a provar.</p><p class="muted" style="font-size:12px">${esc(err.message || err)}</p><button class="btn primary" onclick="location.reload()">Torna-ho a provar</button>`);
  }
}
boot();
})();
