/* Jarvis — Google Drive storage.
   Sign-in: Google Identity Services token popup (needs only the JavaScript origin
   https://dicksonpjo-sys.github.io, already authorised on the Quote Desk OAuth client).
   Scope: drive.file — Jarvis only sees files it created.
   Layout in My Drive:
     Jarvis/
       jarvis_data.json          ← everything Jarvis knows (ideas, approvals, modules, log, settings)
       Backups/YYYY-MM/jarvis_YYYY-MM-DD.json   ← one per day, written on the first save of the day */
'use strict';

const Drive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER = 'Jarvis';
  const DATA_FILE = 'jarvis_data.json';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const K = { token: 'jv.token', connected: 'jv.connected', ids: 'jv.driveIds', who: 'jv.driveUser', backup: 'jv.lastBackup' };

  const ls = {
    get: (k, d = null) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} }
  };
  const clientId = () => String(window.JARVIS_CLIENT_ID || '').trim();
  const tokenRec = () => ls.get(K.token);
  const token = () => { const t = tokenRec(); return t && t.exp > Date.now() + 60000 ? t.value : null; };
  const isConnected = () => !!ls.get(K.connected);
  const user = () => ls.get(K.who);

  let tokenClient = null, pending = null;
  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }
  function ensureClient() {
    if (tokenClient) return tokenClient;
    if (!gisReady()) throw new Error('Google sign-in is still loading. Try again in a moment.');
    if (!clientId()) throw new Error('No Google Client ID in js/config.js.');
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE,
      callback: r => {
        const p = pending; pending = null;
        if (r.error) { p && p.reject(new Error(r.error_description || r.error)); return; }
        ls.set(K.token, { value: r.access_token, exp: Date.now() + (Number(r.expires_in) || 3600) * 1000 });
        ls.set(K.connected, true);
        p && p.resolve(r.access_token);
      },
      error_callback: e => { const p = pending; pending = null; p && p.reject(new Error(e && e.type === 'popup_closed' ? 'Sign-in window was closed.' : (e && e.message) || 'Sign-in failed.')); }
    });
    return tokenClient;
  }
  /* Must be called from a click or key press (browsers block pop-ups otherwise). */
  function connect({ quiet = false } = {}) {
    return new Promise((resolve, reject) => {
      try {
        const c = ensureClient(); pending = { resolve, reject };
        const hint = user()?.email;
        c.requestAccessToken({ prompt: quiet && isConnected() ? '' : 'select_account', hint });
      } catch (e) { reject(e); }
    });
  }
  function disconnect() {
    const t = tokenRec();
    if (t?.value && gisReady()) try { google.accounts.oauth2.revoke(t.value, () => {}); } catch {}
    [K.token, K.connected, K.ids, K.who].forEach(ls.del);
  }

  async function api(url, opts = {}) {
    const tk = token(); if (!tk) { const e = new Error('Drive session expired'); e.code = 'AUTH'; throw e; }
    const res = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + tk, ...(opts.headers || {}) } });
    if (res.status === 401) { ls.del(K.token); const e = new Error('Drive session expired'); e.code = 'AUTH'; throw e; }
    if (!res.ok) throw new Error('Drive error ' + res.status + ': ' + (await res.text()).slice(0, 200));
    return res;
  }
  const json = async (url, opts) => (await api(url, opts)).json();
  const q = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function whoAmI() {
    let u = user();
    if (!u) { const r = await json(`${API}/about?fields=user(emailAddress,displayName)`); u = { email: String(r.user.emailAddress || '').toLowerCase(), name: r.user.displayName }; ls.set(K.who, u); }
    return u;
  }
  function cache(email) { return (ls.get(K.ids) || {})[email] || {}; }
  function saveCache(email, c) { const all = ls.get(K.ids) || {}; all[email] = c; ls.set(K.ids, all); }
  async function list(query, fields = 'files(id,name,modifiedTime,parents)') {
    const r = await json(`${API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&orderBy=createdTime&pageSize=50`);
    return r.files || [];
  }
  async function folder(name, parent) {
    let query = `name='${q(name)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
    query += parent ? ` and '${parent}' in parents` : ` and 'root' in parents`;
    const f = (await list(query))[0];
    if (f) return f.id;
    const r = await json(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: parent ? [parent] : undefined }) });
    return r.id;
  }
  async function uploadNew(name, parent, text) {
    const body = new FormData();
    body.append('metadata', new Blob([JSON.stringify({ name, parents: [parent], mimeType: 'application/json' })], { type: 'application/json' }));
    body.append('file', new Blob([text], { type: 'application/json' }));
    return json(`${UPLOAD}/files?uploadType=multipart&fields=id,modifiedTime`, { method: 'POST', body });
  }
  async function overwrite(id, text) {
    return json(`${UPLOAD}/files/${id}?uploadType=media&fields=id,modifiedTime`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: text });
  }
  async function locate(me) {
    const c = cache(me.email);
    if (!c.root) c.root = await folder(FOLDER);
    if (!c.data) { const f = (await list(`name='${DATA_FILE}' and trashed=false and '${c.root}' in parents`))[0]; if (f) c.data = f.id; }
    saveCache(me.email, c);
    return c;
  }

  /* Pull the Drive copy, merge with the local copy, push the result. Returns the merged data. */
  async function sync(local, merge) {
    const me = await whoAmI();
    const c = await locate(me);
    let merged = local;
    if (c.data) {
      try {
        const meta = await json(`${API}/files/${c.data}?fields=id,modifiedTime,trashed`);
        if (meta.trashed) { delete c.data; saveCache(me.email, c); }
        else if (meta.modifiedTime !== local.meta?.remoteModified) {
          const remote = await json(`${API}/files/${c.data}?alt=media`);
          merged = merge(local, remote);
        }
      } catch (e) { if (/404/.test(e.message)) { delete c.data; saveCache(me.email, c); } else throw e; }
    }
    const text = JSON.stringify({ ...merged, meta: undefined, savedAt: new Date().toISOString(), savedBy: me.email, app: window.JARVIS_VERSION });
    const res = c.data ? await overwrite(c.data, text) : await uploadNew(DATA_FILE, c.root, text);
    c.data = res.id; saveCache(me.email, c);
    merged.meta = { ...(local.meta || {}), remoteModified: res.modifiedTime, lastSync: new Date().toISOString(), account: me.email };
    dailyBackup(me, c, text).catch(e => console.warn('backup', e));
    return merged;
  }
  async function dailyBackup(me, c, text) {
    const day = new Date().toISOString().slice(0, 10);
    if (ls.get(K.backup) === day) return;
    const b = await folder('Backups', c.root), m = await folder(day.slice(0, 7), b);
    const name = `jarvis_${day}.json`;
    const ex = (await list(`name='${name}' and trashed=false and '${m}' in parents`))[0];
    if (!ex) await uploadNew(name, m, text);
    ls.set(K.backup, day);
  }
  async function folderLink() { const me = await whoAmI(); const c = await locate(me); return 'https://drive.google.com/drive/folders/' + c.root; }

  return { connect, disconnect, sync, whoAmI, folderLink, isConnected, token, user, gisReady, FOLDER, DATA_FILE };
})();
