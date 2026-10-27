/* Jarvis v1 — app logic.
   Everything Jarvis knows is one JSON document, kept in this browser and synced to
   My Drive / Jarvis / jarvis_data.json. Voice settings stay on each device. */
'use strict';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const nowISO = () => new Date().toISOString();
const hhmm = iso => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayLbl = iso => { const d = new Date(iso), t = new Date(); return d.toDateString() === t.toDateString() ? hhmm(iso) : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + hhmm(iso); };
const LS = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
const CONTRACT = 'jarvis.business-module/1';
const STAGES = [['idea', 'Ideas'], ['shape', 'Shaping'], ['queued', 'Queued for Jarvis'], ['working', 'In progress'], ['done', 'Done']];
const STC = { idea: '#ff5fa8', shape: '#a88bff', queued: '#f2b33d', working: '#3fc8e6', done: '#2fd38a' };

/* ============ data ============ */
const DKEY = 'jarvis.v1.data';
function blank() {
  const t = nowISO();
  const idea = (title, b, st = 'idea') => ({ id: uid(), t: title, b, st, c: t, u: t });
  return {
    v: 1,
    businesses: {
      vfx: { name: 'VishwaaFX', color: '#2fd38a', desc: 'VFX studio · Malayalam films, web series and ad films', u: t },
      coorg: { name: 'Coorgified', color: '#e0a15e', desc: '', u: t },
      taar: { name: 'Taarora', color: '#d58bff', desc: '', u: t }
    },
    modules: {},
    ideas: [
      idea('Decide: Vendor Desk inside the Payroll app or standalone', 'vfx', 'shape'),
      idea('Master Data sheet: move the artists out of Payroll', 'vfx'),
      idea('Set the monthly AI budget for Jarvis', 'me'),
      idea('Describe Coorgified so Jarvis can set it up', 'coorg'),
      idea('Describe Taarora so Jarvis can set it up', 'taar')
    ],
    approvals: [],
    usage: {},
    log: [{ id: uid(), at: t, who: 'Jarvis', what: 'Jarvis v1 set up on this device' }],
    meta: {}
  };
}
let D = LS.get(DKEY, null) || blank();
D.usage = D.usage || {};
const BIZ = () => D.businesses;
const bizName = k => k === 'all' ? 'All businesses' : k === 'me' ? 'Personal' : (BIZ()[k]?.name || k);
const bizCol = k => BIZ()[k]?.color || (k === 'all' ? '#3fc8e6' : '#ff5fa8');
const live = arr => arr.filter(x => !x.del);
const pending = ws => live(D.approvals).filter(a => a.status === 'pending' && (!ws || a.ws === ws));
const mod = k => D.modules[k]?.m || null;

function log(who, what) { D.log.unshift({ id: uid(), at: nowISO(), who, what }); D.log = D.log.slice(0, 300); }
function merge(local, remote) {
  const out = { ...local };
  const byU = (a, b) => (!a ? b : !b ? a : (a.u || '') >= (b.u || '') ? a : b);
  out.businesses = { ...remote.businesses, ...local.businesses };
  for (const k of new Set([...Object.keys(local.businesses || {}), ...Object.keys(remote.businesses || {})])) out.businesses[k] = byU(local.businesses?.[k], remote.businesses?.[k]);
  out.modules = {};
  for (const k of new Set([...Object.keys(local.modules || {}), ...Object.keys(remote.modules || {})])) out.modules[k] = byU(local.modules?.[k], remote.modules?.[k]);
  for (const key of ['ideas', 'approvals']) {
    const m = new Map();
    for (const x of [...(remote[key] || []), ...(local[key] || [])]) m.set(x.id, byU(m.get(x.id), x));
    out[key] = [...m.values()].sort((a, b) => (a.c || '').localeCompare(b.c || ''));
  }
  out.usage = { ...(remote.usage || {}) }; for (const [k, v] of Object.entries(local.usage || {})) if (!out.usage[k] || (v.calls || 0) >= (out.usage[k].calls || 0)) out.usage[k] = v;
  const lg = new Map(); for (const x of [...(remote.log || []), ...(local.log || [])]) lg.set(x.id, x);
  out.log = [...lg.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 300);
  return out;
}

/* ============ saving & Drive sync ============ */
let syncTimer = null, syncState = 'off', syncMsg = '';
function save({ sync = true } = {}) {
  LS.set(DKEY, D);
  if (sync && Drive.isConnected()) { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }
  setSync(Drive.isConnected() ? (Drive.token() ? syncState === 'ok' ? 'pending' : syncState : 'needs') : 'off');
}
async function syncNow() {
  if (!Drive.isConnected()) return setSync('off');
  if (!Drive.token()) return setSync('needs');
  if (!navigator.onLine) return setSync('offline');
  setSync('busy');
  try { D = await Drive.sync(D, merge); LS.set(DKEY, D); setSync('ok'); renderQuiet(); }
  catch (e) { if (e.code === 'AUTH') setSync('needs'); else { syncMsg = e.message; setSync('err'); } }
}
function setSync(s) {
  syncState = s;
  const map = { off: ['Drive not connected', 'warn'], needs: ['Reconnect Drive', 'warn'], busy: ['Saving…', 'busy'], pending: ['Saving…', 'busy'], offline: ['Offline · saved here', 'warn'], err: ['Drive error', 'warn'],
    ok: ['Saved to Drive ' + (D.meta?.lastSync ? hhmm(D.meta.lastSync) : ''), 'ok'] };
  const [t, c] = map[s] || map.off;
  for (const [lbl, chip] of [['#syncLbl', '#tbSync'], ['#railSyncLbl', '#railSync']]) { $(lbl).textContent = t; $(chip).className = 'syncchip ' + c + (chip === '#railSync' ? ' wide' : ''); }
}
async function connectDrive() {
  try { await Drive.connect({ quiet: Drive.isConnected() }); const me = await Drive.whoAmI(); log('You', 'Connected Google Drive · ' + me.email); toast('Connected to ' + me.email); await syncNow(); render(); }
  catch (e) { toast(e.message, true); }
}
addEventListener('online', () => syncNow());
setInterval(() => { if (Drive.token() && document.visibilityState === 'visible') syncNow(); }, 5 * 60000);

/* ============ ui helpers ============ */
let tt; function toast(m, err) { $('.toast')?.remove(); const d = document.createElement('div'); d.className = 'toast' + (err ? ' err' : ''); d.textContent = m; d.setAttribute('role', 'status'); document.body.append(d); clearTimeout(tt); tt = setTimeout(() => d.remove(), 3200); }
function modal(html) { closeModal(); const m = document.createElement('div'); m.className = 'modal'; m.innerHTML = `<div role="dialog" aria-modal="true">${html}</div>`; m.addEventListener('click', e => { if (e.target === m) closeModal(); }); document.body.append(m); return m; }
function closeModal() { $('.modal')?.remove(); }
function copy(text, msg) {
  const fallback = () => { const m = modal(`<b>Copy this</b><textarea class="in" rows="12">${esc(text)}</textarea><div class="btns"><button class="btn" data-close>Close</button></div>`); m.querySelector('textarea').select(); };
  try { navigator.clipboard.writeText(text).then(() => toast(msg), fallback); } catch { fallback(); }
}
const bz = b => `<span class="bz"><i style="background:${bizCol(b)}"></i>${esc(bizName(b))}</span>`;

/* ============ commands (typed or spoken) ============ */
function findBiz(s) { for (const [k, b] of Object.entries(BIZ())) if (s.includes(b.name.toLowerCase()) || s.includes(k)) return k; if (/visual ?fx|vishwa|vfx/.test(s)) return 'vfx'; if (/coorg|kodag/.test(s)) return 'coorg'; if (/tara|taarora|tarora/.test(s)) return 'taar'; return null; }
function moduleCmd(s) {
  let best = null;
  for (const [biz, rec] of Object.entries(D.modules)) { const m = rec?.m; if (!m) continue;
    for (const t of m.tools) for (const c of t.commands || []) if (c.say && s.includes(c.say.toLowerCase()) && (!best || c.say.length > best.c.say.length)) best = { m, c, tool: t.name, biz }; }
  return best;
}
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; }
function brief() {
  const ap = pending(), q = live(D.ideas).filter(i => i.st === 'queued'), w = live(D.ideas).filter(i => i.st === 'working');
  const parts = [], sayParts = [];
  parts.push(`${ap.length ? `<strong>${ap.length} approval${ap.length > 1 ? 's' : ''}</strong> waiting` : 'No approvals waiting'}, ${q.length} idea${q.length === 1 ? '' : 's'} queued, ${w.length} in progress.`);
  sayParts.push(`${ap.length || 'No'} approval${ap.length === 1 ? '' : 's'} waiting, ${q.length} queued, ${w.length} in progress.`);
  for (const [k, rec] of Object.entries(D.modules)) { const m = rec?.m; if (!m?.summary) continue;
    const f = Object.entries(m.summary).filter(([x]) => x !== 'as_of').slice(0, 3).map(([x, v]) => `${fmtK(x).toLowerCase()} ${fmtV(x, v)}`);
    parts.push(`<b>${esc(bizName(k))}</b>${m.sample ? ' (sample numbers)' : ''}: ${f.join(', ')}.`); sayParts.push(`${bizName(k)}${m.sample ? ', sample numbers' : ''}: ${f.join(', ')}.`); }
  const unplugged = Object.keys(BIZ()).filter(k => !mod(k)).map(bizName);
  if (unplugged.length) { const l = unplugged.length > 1 ? unplugged.slice(0, -1).join(', ') + ' and ' + unplugged.at(-1) : unplugged[0]; parts.push(`${l} ${unplugged.length > 1 ? 'have' : 'has'} no dashboard module yet.`); }
  if (ap[0]) { parts.push(`First up: ${esc(ap[0].title)}.`); sayParts.push(`First up: ${ap[0].title}.`); }
  return { html: `<p>${greeting()}, Dickson. ${parts.join(' ')}</p>`, say: `${greeting()}, Dickson. ${sayParts.join(' ')}` };
}
function addIdea(t, b, st = 'idea') {
  const i = { id: uid(), t: t.trim(), b: b || 'me', st, c: nowISO(), u: nowISO() };
  D.ideas.push(i); if (st === 'queued') queueApproval(i);
  log('You', (st === 'queued' ? 'Queued: ' : 'Idea: ') + i.t); save(); graphRefresh(); return i;
}
function queueApproval(i) {
  D.approvals.unshift({ id: uid(), ws: BIZ()[i.b] ? i.b : 'me', title: 'Plan: ' + i.t, type: 'Plan sign-off', from: 'idea:' + i.id,
    why: 'Jarvis drafts the scope, cost and risks first. Nothing is built or spent until you approve.', scope: bizName(i.b), status: 'pending', c: nowISO(), u: nowISO() });
}
const fmtK = k => k.replace(/_inr$/, '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const fmtV = (k, v) => /_inr$/.test(k) ? '₹' + Number(v).toLocaleString('en-IN') : v;

const ROUTES = { brain: 'brain', home: 'brain', ideas: 'me', idea: 'me', me: 'me', approvals: 'approvals', approval: 'approvals', build: 'build', progress: 'build', settings: 'settings', modules: 'modules', 'module plug': 'modules' };
function handle(raw, src = 'text') {
  const q = raw.trim(), s = q.toLowerCase().replace(/[.?!]+$/, '');
  let m, r;
  if (!q) return;
  if (/^(stop|quiet|shut up|cancel|silence)$/.test(s)) { Voice.stopSpeaking(); r = { html: '<p>Okay.</p>', say: '' }; }
  else if (m = q.match(/^\s*(?:(idea|note|remember)\s*[:,-]?\s+(?:to\s+|that\s+)?|add (?:an )?idea\s*[:,-]?\s*)(.+)$/i)) { m[2] = m[2].replace(/^./, c => c.toUpperCase()); const b = findBiz(m[2].toLowerCase()) || curBiz(); const i = addIdea(m[2], b, 'idea'); r = { html: `<p>Saved to your ideas under <b>${esc(bizName(i.b))}</b>.</p>`, say: 'Saved.' }; }
  else if (m = q.match(/^\s*queue\s*[:,-]?\s+(.+)$/i)) { const b = findBiz(m[1].toLowerCase()) || curBiz(); const i = addIdea(m[1], b, 'queued'); r = { html: `<p>Queued under <b>${esc(bizName(i.b))}</b>. A plan approval is waiting for you.</p>`, say: 'Queued. It needs your approval before anything happens.' }; }
  else if (/^(hi|hello|hey)( jarvis)?$/.test(s)) r = { html: `<p>${greeting()}, Dickson.</p>`, say: `${greeting()}, Dickson.` };
  else if (/brief|morning|status|what'?s (up|new|happening)|catch me up|update me/.test(s)) r = brief();
  else if (/approv/.test(s)) { const a = pending(); r = a.length ? { html: `<ol>${a.map(x => `<li>${esc(x.title)} · ${esc(bizName(x.ws))}</li>`).join('')}</ol><p><a href="#approvals">Open approvals</a>. Approvals need a tap, not a voice command.</p>`, say: `${a.length} waiting. First: ${a[0].title}. Approvals need a tap on screen.` } : { html: '<p>Nothing is waiting for you.</p>', say: 'Nothing is waiting for you.' }; }
  else if (/what time|time is it/.test(s)) { const t = new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); r = { html: `<p>It's ${t}.</p>`, say: `It's ${t}.` }; }
  else if (/what('?s| is) (the )?date|today'?s date|what day/.test(s)) { const t = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }); r = { html: `<p>${t}.</p>`, say: t }; }
  else if (/^(help|commands|what can you do)/.test(s)) r = { html: helpHtml(), say: 'You can say: morning brief, idea, queue, what needs approval, open a business, or any command from a plugged-in module.' };
  else if (m = s.match(/^(?:open|show|go to)\s+(.+)$/)) {
    const t = m[1].replace(/^the /, ''); const b = findBiz(t);
    if (b) { location.hash = b; r = { html: `<p>Opened ${esc(bizName(b))}.</p>`, say: `Opening ${bizName(b)}.` }; }
    else if (/dashboard/.test(t) && mod(curBiz() || 'vfx')) { const mm = mod(curBiz() || 'vfx'); r = { html: `<p><a href="${esc(mm.dashboard)}" target="_blank" rel="noopener">Open ${esc(mm.name)} ↗</a></p>`, say: `Here's the ${mm.name} link.` }; }
    else { const key = Object.keys(ROUTES).find(k => t.startsWith(k)); if (key) { location.hash = ROUTES[key]; r = { html: `<p>Opened ${esc(key)}.</p>`, say: 'Done.' }; } }
  }
  else if (m = s.match(/^(?:search|find|look for)\s+(.+)$/)) { const hits = searchNodes(m[1]); if (hits.length) { location.hash = 'brain'; selectNode(hits[0][0]); } r = { html: hits.length ? `<p>Found ${hits.map(h => `<b>${esc(h[1].l)}</b>`).join(', ')}.</p>` : `<p>Nothing in the Brain matches “${esc(m[1])}”.</p>`, say: hits.length ? `Found ${hits[0][1].l}${hits.length > 1 ? ` and ${hits.length - 1} more` : ''}.` : 'Nothing matches.' }; }
  if (!r && (m = moduleCmd(s))) {
    const { m: mm, c, tool, biz } = m;
    if (c.needs_approval) { D.approvals.unshift({ id: uid(), ws: biz, title: `${tool}: ${c.say}`, type: 'Module command', from: 'module:' + mm.business, why: c.does + '.', scope: mm.name + ' · ' + tool, status: 'pending', c: nowISO(), u: nowISO() }); log('Jarvis', `Approval requested · ${tool} · ${c.say}`); save();
      r = { html: `<p><b>${esc(c.say)}</b> (${esc(tool)}) needs your approval. It's in <a href="#approvals">Approvals</a>.</p>`, say: `${c.say} needs your approval. I've added it to approvals.` }; }
    else { log('Jarvis', `${c.say} → ${mm.name} · ${tool}`); save();
      r = { html: `<p>That's <b>${esc(tool)}</b> in ${esc(mm.name)}: ${esc(c.does)}. Jarvis can't run module commands yet (that arrives with the PC runner), so open the <a href="${esc(mm.dashboard)}" target="_blank" rel="noopener">dashboard ↗</a> for now. I've logged the request.</p>`, say: `That's ${tool} in ${mm.name}. I can't run module commands yet, so I've logged it. Open the dashboard for now.` }; }
  }
  if (!r) { askClaude(q, src); return; }
  showReply(q, r.html, src);
  if (r.say && (src === 'voice' || Voice.cfg.speakTyped)) Voice.speak(r.say);
}
let thinking = false;
const usd$ = v => v < 0.1 ? v.toFixed(3) : v.toFixed(2);
function contextText() {
  const now = new Date();
  const lines = [`Now: ${now.toLocaleString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })} (India).`];
  for (const [k, b] of Object.entries(BIZ())) { const m = mod(k); lines.push(`Business ${b.name} (id ${k}): ${b.desc || 'no description yet'}.` + (m ? ` Module ${m.name}${m.sample ? ' (SAMPLE numbers, not real)' : ''}: ${Object.entries(m.summary || {}).filter(([x]) => x !== 'as_of').map(([x, v]) => fmtK(x) + ' ' + fmtV(x, v)).join(', ')}. Tools: ${m.tools.map(t => t.name).join(', ')}.` : ' No dashboard module plugged in.')); }
  const ideas = live(D.ideas).filter(i => i.st !== 'done').slice(-25);
  lines.push('Open ideas: ' + (ideas.map(i => `"${i.t}" [${STAGES.find(s => s[0] === i.st)[1]}, ${bizName(i.b)}]`).join('; ') || 'none') + '.');
  lines.push('Waiting for approval: ' + (pending().map(a => `"${a.title}" (${bizName(a.ws)})`).join('; ') || 'nothing') + '.');
  return lines.join('\n');
}
const AI_TOOLS = [
  { name: 'add_idea', description: 'Save an idea or note to Dickson\'s idea board.', input_schema: { type: 'object', properties: { text: { type: 'string', description: 'The idea, in a short sentence' }, business: { type: 'string', enum: ['vfx', 'coorg', 'taar', 'all', 'me'], description: 'Which business it is for; me = personal' } }, required: ['text'] } },
  { name: 'queue_task', description: 'Queue a task for Jarvis. This creates a plan approval that Dickson must approve before anything happens.', input_schema: { type: 'object', properties: { text: { type: 'string' }, business: { type: 'string', enum: ['vfx', 'coorg', 'taar', 'all', 'me'] } }, required: ['text'] } },
  { name: 'open_page', description: 'Open a page in Jarvis on Dickson\'s screen.', input_schema: { type: 'object', properties: { page: { type: 'string', enum: ['brain', 'me', 'vfx', 'coorg', 'taar', 'modules', 'approvals', 'build', 'settings'] } }, required: ['page'] } }
];
function runTool(name, inp) {
  if (name === 'add_idea') { const i = addIdea(inp.text, inp.business || curBiz() || 'me', 'idea'); return `Saved idea under ${bizName(i.b)}.`; }
  if (name === 'queue_task') { const i = addIdea(inp.text, inp.business || curBiz() || 'me', 'queued'); return `Queued under ${bizName(i.b)}; a plan approval is waiting for Dickson.`; }
  if (name === 'open_page') { location.hash = inp.page; return 'Opened ' + inp.page; }
  return 'Unknown tool';
}
async function askClaude(q, src) {
  if (!Brain.ready()) {
    const what = Brain.cfg.provider === 'hermes' ? 'set up Hermes' : Brain.cfg.provider === 'gemini' ? 'add your Gemini API key' : 'add your Claude API key';
    showReply(q, `<p>I need my AI brain for that: ${what} in <a href="#settings">Settings → AI brain</a>. Until then I can do: morning brief, idea, queue, approvals, open, search.</p>`, src);
    if (src === 'voice' || Voice.cfg.speakTyped) Voice.speak(`I need my AI brain for that. Please ${what} in settings.`);
    return;
  }
  thinking = true; showReply(q, `<p class="dim">Thinking with ${esc(Brain.currentName())}…</p>`, src);
  try {
    const r = await Brain.ask(q, { context: contextText(), tools: AI_TOOLS, runTool, usage: D.usage });
    const who = r.provider === 'gemini' ? Brain.modelName(r.model) : r.provider === 'hermes' ? 'Hermes · ' + (r.model === 'hermes' ? 'its own model' : Brain.modelName(r.model)) : Brain.modelName(r.model);
    log('Jarvis', `Answered with ${who} · ${r.inTok + r.outTok} tokens`); save();
    const meta = r.provider === 'gemini' ? `${esc(Brain.modelName(r.model))} · Gemini` : r.provider === 'hermes' ? `${esc(who)} · free` : `${esc(who)} · about $${r.usd.toFixed(4)} · this month $${usd$(D.usage[Brain.month()]?.usd || 0)} of $${Brain.cfg.budgetUSD}`;
    showReply(q, `<p>${esc(r.text).replace(/\n+/g, '</p><p>')}</p>${r.note ? `<p class="dim" style="font-size:12px">${esc(r.note)}</p>` : ''}<p class="dim" style="font-size:11.5px;margin-top:8px">${meta}</p>`, src);
    thinking = false;
    if (src === 'voice' || Voice.cfg.speakTyped) Voice.speak(r.text);
  } catch (e) {
    thinking = false;
    showReply(q, `<p style="color:var(--red)">${esc(e.message)}</p>`, src);
    if (src === 'voice' || Voice.cfg.speakTyped) Voice.speak(e.message);
  }
}
function helpHtml() {
  const mc = Object.values(D.modules).flatMap(r => r?.m ? r.m.tools.flatMap(t => (t.commands || []).map(c => `<li><b>${esc(c.say)}</b> · ${esc(t.name)}${c.needs_approval ? ' (asks you first)' : ''}</li>`)) : []);
  return `<p>Say “Hey Jarvis” first if wake mode is on, or hold the mic.</p><ul><li><b>morning brief</b> / status</li><li><b>idea:</b> … saves a thought · <b>queue:</b> … asks Jarvis to plan it</li><li><b>what needs approval</b></li><li><b>open</b> VishwaaFX / Coorgified / Taarora / ideas / approvals / settings</li><li><b>search</b> …</li><li><b>stop</b> to stop talking</li><li>Anything else goes to your AI brain (${esc(Brain.currentName())})${Brain.ready() ? '' : ' once it is set up in Settings'}</li>${mc.join('')}</ul>`;
}
function showReply(q, html, src) {
  const out = `<div class="reply"><div class="who">JARVIS <span class="you">${src === 'voice' ? '🎙 ' : ''}“${esc(q)}”</span><button class="x" aria-label="Close" data-closereply>✕</button></div>${html}</div>`;
  $('#breply').innerHTML = out; $('#wreply').innerHTML = out;
}
const curBiz = () => BIZ()[VIEW] ? VIEW : null;

/* ============ graph ============ */
const TYPES = { core: ['Core', '#f2b33d'], business: ['Businesses', '#2fd38a'], module: ['Modules', '#ffd166'], tool: ['Tools', '#3fc8e6'], idea: ['Ideas', '#ff5fa8'], approval: ['Approvals', '#ef8a5b'] };
const G = { rx: -.3, ry: .4, zoom: 1, mode3d: true, sel: -1, hidden: new Set(), disp: { labels: true, links: true, spin: true }, alpha: 1, proj: [], drag: null };
let GD = null, cv, ctx, W = 0, H = 0, DPR = 1, raf = false;
function graphData() {
  const N = [], E = [], ix = {};
  const add = (id, l, type, note, biz) => { ix[id] = N.length; N.push({ id, l, type, note, biz }); };
  const link = (a, b) => { if (ix[a] != null && ix[b] != null) E.push([ix[a], ix[b]]); };
  add('core', 'Jarvis', 'core', 'Your personal AI OS · v' + window.JARVIS_VERSION);
  add('me', 'Dickson', 'core', 'You. Ideas you add start here.'); link('core', 'me');
  for (const [k, b] of Object.entries(BIZ())) {
    add('b:' + k, b.name, 'business', b.desc || 'Not described yet.', k); link('core', 'b:' + k);
    const m = mod(k);
    if (m) { add('m:' + k, m.name, 'module', `Module v${m.version} · ${m.tools.length} tools${m.sample ? ' · sample data' : ''}`, k); link('b:' + k, 'm:' + k);
      for (const t of m.tools) { add('t:' + k + ':' + t.id, t.name, 'tool', `${t.category} · v${t.version || '?'} · ${t.status || ''} · ${(t.commands || []).length} commands`, k); link('m:' + k, 't:' + k + ':' + t.id); } }
  }
  for (const i of live(D.ideas)) { add('i:' + i.id, i.t, 'idea', `${STAGES.find(s => s[0] === i.st)[1]} · ${bizName(i.b)}`, i.b); link('me', 'i:' + i.id); if (BIZ()[i.b]) link('i:' + i.id, 'b:' + i.b); }
  for (const a of pending()) { add('a:' + a.id, a.title, 'approval', `Waiting for you · ${a.type}`, a.ws); link('core', 'a:' + a.id); if (BIZ()[a.ws]) link('a:' + a.id, 'b:' + a.ws); if (a.from?.startsWith('idea:')) link('a:' + a.id, 'i:' + a.from.slice(5)); }
  return { N, E, ix };
}
function graphRefresh() {
  const old = GD ? Object.fromEntries(GD.N.map(n => [n.id, n])) : {};
  const selId = GD && G.sel > -1 ? GD.N[G.sel]?.id : null;
  GD = graphData();
  const deg = GD.N.map(() => 0); GD.E.forEach(([a, b]) => { deg[a]++; deg[b]++; });
  GD.N.forEach((n, i) => { n.deg = deg[i]; const o = old[n.id];
    if (o) Object.assign(n, { x: o.x, y: o.y, z: o.z, vx: o.vx, vy: o.vy, vz: o.vz });
    else { const r = 40 + Math.random() * 160, t = Math.random() * 6.28, p = Math.acos(2 * Math.random() - 1); n.x = r * Math.sin(p) * Math.cos(t); n.y = r * Math.cos(p); n.z = r * Math.sin(p) * Math.sin(t); n.vx = n.vy = n.vz = 0; } });
  GD.nbr = GD.N.map(() => []); GD.E.forEach(([a, b]) => { GD.nbr[a].push(b); GD.nbr[b].push(a); });
  G.sel = selId ? (GD.ix[selId] ?? -1) : -1; G.alpha = Math.max(G.alpha, Object.keys(old).length ? .5 : 1);
  if ($('#gcount')) $('#gcount').textContent = `${GD.N.length} notes · ${GD.E.length} links`;
  brainPanels();
}
function step() {
  const N = GD.N, a = G.alpha; if (a < .004) return;
  for (let i = 0; i < N.length; i++) { const p = N[i]; for (let j = i + 1; j < N.length; j++) { const q = N[j]; let dx = p.x - q.x, dy = p.y - q.y, dz = G.mode3d ? p.z - q.z : 0; const d2 = dx * dx + dy * dy + dz * dz + .01; if (d2 > 90000) continue; const f = 3600 / d2 * a, d = Math.sqrt(d2); dx /= d; dy /= d; dz /= d; p.vx += dx * f; p.vy += dy * f; p.vz += dz * f; q.vx -= dx * f; q.vy -= dy * f; q.vz -= dz * f; } }
  GD.E.forEach(([i, j]) => { const p = N[i], q = N[j]; let dx = q.x - p.x, dy = q.y - p.y, dz = G.mode3d ? q.z - p.z : 0; const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + .01; const L = (p.type === 'core' || q.type === 'core') ? 120 : (p.type === 'business' || q.type === 'business') ? 70 : 52; const f = (d - L) * .035 * a; dx /= d; dy /= d; dz /= d; p.vx += dx * f; p.vy += dy * f; p.vz += dz * f; q.vx -= dx * f; q.vy -= dy * f; q.vz -= dz * f; });
  N.forEach(n => { const k = n.id === 'core' ? .05 : .004; n.vx -= n.x * k * a; n.vy -= n.y * k * a; n.vz -= n.z * k * a; n.vx *= .82; n.vy *= .82; n.vz *= .82; n.x += n.vx; n.y += n.vy; n.z = G.mode3d ? n.z + n.vz : n.z * .85; });
  G.alpha *= .992;
}
function resize() { const r = cv.getBoundingClientRect(); DPR = Math.min(devicePixelRatio || 1, 2); W = r.width; H = r.height; cv.width = W * DPR; cv.height = H * DPR; }
function project() {
  const cX = Math.cos(G.rx), sX = Math.sin(G.rx), cY = Math.cos(G.ry), sY = Math.sin(G.ry), s = Math.min(W, H) / 560 * G.zoom;
  G.proj = GD.N.map(n => { let x = n.x, y = n.y, z = n.z; if (G.mode3d) { const x1 = x * cY - z * sY, z1 = x * sY + z * cY, y1 = y * cX - z1 * sX, z2 = y * sX + z1 * cX; x = x1; y = y1; z = z2; } else z = 0;
    const f = G.mode3d ? 600 / (600 + z) : 1, base = n.id === 'core' ? 13 : n.type === 'core' || n.type === 'business' ? 9 : n.type === 'module' ? 7.5 : 3.6 + Math.min(n.deg, 6) * .45;
    return { x: W / 2 + x * f * s, y: H / 2 + y * f * s, z, f, r: base * f * Math.max(.75, Math.min(s, 1.4)) }; });
}
function draw() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0); ctx.clearRect(0, 0, W, H);
  project(); const P = G.proj, N = GD.N, L = new Set();
  if (G.sel > -1) { L.add(G.sel); GD.nbr[G.sel].forEach(j => L.add(j)); }
  const focus = L.size > 0, vis = i => !G.hidden.has(N[i].type);
  if (G.disp.links) GD.E.forEach(([a, b]) => { if (!vis(a) || !vis(b)) return; const p = P[a], q = P[b], on = !focus || ((a === G.sel || b === G.sel)); ctx.globalAlpha = on ? (focus ? .9 : .22 * Math.min(p.f, q.f)) : .04; ctx.strokeStyle = TYPES[N[b].type === 'core' ? N[a].type : N[b].type][1]; ctx.lineWidth = focus && on ? 1.6 : .8; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke(); });
  [...N.keys()].sort((a, b) => P[b].z - P[a].z).forEach(i => { if (!vis(i)) return; const p = P[i], n = N[i], c = TYPES[n.type][1], on = !focus || L.has(i), depth = Math.min(1, Math.max(.3, (p.f - .55) * 1.7));
    ctx.globalAlpha = on ? depth : .07;
    if (p.r > 5) { const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 3.2); g.addColorStop(0, c); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.globalAlpha *= .4; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 3.2, 0, 7); ctx.fill(); ctx.globalAlpha = on ? depth : .07; }
    ctx.fillStyle = c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    if (i === G.sel) { ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 4, 0, 7); ctx.stroke(); }
    const big = n.type === 'core' || n.type === 'business' || n.type === 'module';
    if (G.disp.labels && (big || (focus && L.has(i)) || G.zoom > 1.6)) { ctx.globalAlpha = on ? Math.max(.55, depth) : .08; ctx.fillStyle = '#e1e9ef'; ctx.font = `${big ? 600 : 500} ${big ? 12.5 : 11}px "IBM Plex Sans",system-ui,sans-serif`; ctx.textAlign = 'center'; ctx.fillText(n.l.length > 32 ? n.l.slice(0, 30) + '…' : n.l, p.x, p.y + p.r + 14); } });
  ctx.globalAlpha = 1;
}
function loop() { if (!raf) return; step(); if (G.disp.spin && G.mode3d && !G.drag && !matchMedia('(prefers-reduced-motion: reduce)').matches) G.ry += .0016; draw(); requestAnimationFrame(loop); }
function startBrain() { if (raf) return; raf = true; resize(); requestAnimationFrame(loop); }
function stopBrain() { raf = false; }
function pickAt(x, y) { let best = -1, bd = 1e9; G.proj.forEach((p, i) => { if (G.hidden.has(GD.N[i].type)) return; const d = Math.hypot(p.x - x, p.y - y); if (d < p.r + 10 && d < bd) { bd = d; best = i; } }); return best; }
function selectNode(i) { G.sel = i; inspector(); }
function fit() { let mx = 0; GD.N.forEach(n => { mx = Math.max(mx, Math.hypot(n.x, n.y, G.mode3d ? n.z : 0)); }); G.zoom = Math.max(.5, Math.min(2.4, 230 / (mx || 1))); }
function searchNodes(q) { q = q.toLowerCase().trim(); return GD.N.map((n, i) => [i, n]).filter(([, n]) => (n.l + ' ' + (n.note || '')).toLowerCase().includes(q)).slice(0, 8); }
function inspector() {
  const el = $('#insp'); if (!el || !GD) return;
  if (G.sel < 0) { el.innerHTML = 'Tap a node to focus it and read its note. Drag to rotate, scroll or pinch to zoom.'; return; }
  const n = GD.N[G.sel];
  let act = '';
  if (n.type === 'business') act = `<a class="btn sm" href="#${n.biz}">Open ${esc(n.l)}</a>`;
  else if (n.type === 'module' && mod(n.biz)) act = `<a class="btn sm" href="${esc(mod(n.biz).dashboard)}" target="_blank" rel="noopener">Open dashboard ↗</a>`;
  else if (n.type === 'idea') act = `<a class="btn sm" href="#me">Open in Ideas</a>`;
  else if (n.type === 'approval') act = `<a class="btn sm" href="#approvals">Review</a>`;
  el.innerHTML = `<span class="tag" style="color:${TYPES[n.type][1]}">${TYPES[n.type][0]}</span><div style="margin-top:6px"><b>${esc(n.l)}</b></div><div style="margin-top:4px">${esc(n.note || '')}</div><div class="label" style="margin-top:10px">${n.deg} links</div><div class="links">${GD.nbr[G.sel].slice(0, 12).map(j => `<button data-node="${j}" style="border-color:${TYPES[GD.N[j].type][1]}66">${esc(GD.N[j].l)}</button>`).join('')}</div>${act ? `<div class="links">${act}</div>` : ''}`;
}
function brainPanels() {
  if (!GD) return;
  const counts = {}; GD.N.forEach(n => counts[n.type] = (counts[n.type] || 0) + 1);
  $('#filt').innerHTML = Object.entries(TYPES).map(([k, [l, c]]) => `<button data-filt="${k}" aria-pressed="${!G.hidden.has(k)}"><i style="background:${c}"></i>${l}<em>${counts[k] || 0}</em></button>`).join('');
  $('#hubs').innerHTML = GD.N.map((n, i) => [i, n]).sort((a, b) => b[1].deg - a[1].deg).slice(0, 7).map(([i, n]) => `<button data-node="${i}"><i style="background:${TYPES[n.type][1]}"></i>${esc(n.l)}<em>${n.deg}</em></button>`).join('');
  $('#disp').innerHTML = [['labels', 'Labels'], ['links', 'Links'], ['spin', 'Slow orbit']].map(([k, l]) => `<button class="tog" data-disp="${k}" aria-pressed="${G.disp[k]}">${l}<span class="sw"></span></button>`).join('');
  const np = pending().length;
  $('#navmini').innerHTML = [['me', 'Ideas', 'i-me'], ['vfx', 'Businesses', 'i-desk'], ['approvals', 'Approvals', 'i-appr'], ['settings', 'Settings', 'i-gear']].map(([h, l, ic]) => `<a href="#${h}"><svg><use href="#${ic}"/></svg>${l}${h === 'approvals' && np ? `<span class="cnt">${np}</span>` : ''}</a>`).join('');
  inspector();
}

/* ============ orb ============ */
let ph = 0;
function orbLoop() {
  const o = $('#orb'), c = o.getContext('2d'), m = Voice.mode; ph += m === 'idle' ? .01 : .04;
  c.clearRect(0, 0, 340, 340); c.lineCap = 'round';
  const main = m === 'speaking' ? '#f2b33d' : m === 'ptt' ? '#3ee0c5' : m === 'wake' ? '#3ee0c5' : '#3fc8e6';
  [[150, 2, main, .55, ph], [134, 7, main, .16, -ph * .7], [120, 3.5, '#f2b33d', .62, ph * 1.25], [102, 1.5, '#3ee0c5', .4, -ph]].forEach(([r, lw, col, len, a]) => { c.strokeStyle = col; c.lineWidth = lw; c.globalAlpha = .9; c.beginPath(); c.arc(170, 170, r, a, a + Math.PI * 2 * len); c.stroke(); });
  const lvl = (m === 'ptt' || m === 'wake' || Voice.checking) ? Voice.level : m === 'speaking' ? .5 + .4 * Math.sin(ph * 6) : thinking ? .3 + .2 * Math.sin(ph * 4) : 0;
  c.globalAlpha = .45; c.strokeStyle = main; c.lineWidth = 2;
  for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2, l = 4 + lvl * (8 + Math.abs(Math.sin(ph * 3 + i)) * 16); c.beginPath(); c.moveTo(170 + Math.cos(a) * 158, 170 + Math.sin(a) * 158); c.lineTo(170 + Math.cos(a) * (158 + l), 170 + Math.sin(a) * (158 + l)); c.stroke(); }
  const wv = Voice.wave;
  if (wv && (m === 'ptt' || m === 'wake' || Voice.checking)) { c.globalAlpha = .95; c.strokeStyle = '#3ee0c5'; c.lineWidth = 2.5; c.beginPath(); for (let i = 0; i < 64; i++) { const v = (wv[Math.floor(i * wv.length / 64)] - 128) / 128, x = 110 + i * (120 / 63), y = 170 + v * 70; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  c.globalAlpha = 1;
  drawWaves();
  requestAnimationFrame(orbLoop);
}
/* Small waveforms next to every mic button, and the big one in Settings. */
function drawWaves() {
  const wv = Voice.wave, m = Voice.mode, active = !!wv && (m === 'ptt' || m === 'wake' || Voice.checking);
  for (const cv of $$('canvas.wv')) {
    if (!cv.offsetParent) continue;
    const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    const g = cv.getContext('2d'), w = cv.width, h = cv.height;
    g.clearRect(0, 0, w, h);
    g.strokeStyle = active ? (Voice.level > .05 ? '#3ee0c5' : '#57697a') : '#26384a'; g.lineWidth = 2 * d; g.beginPath();
    const n = 96;
    for (let i = 0; i < n; i++) { const v = active ? (wv[Math.floor(i * wv.length / n)] - 128) / 128 : 0, x = i * w / (n - 1), y = h / 2 + v * h * .9; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  const bar = $('#micBar'); if (bar) bar.style.width = Math.round((active ? Voice.level : 0) * 100) + '%';
  const lbl = $('#micLevelLbl'); if (lbl) lbl.textContent = !active ? 'Not listening' : Voice.level > .05 ? 'Hearing you ✓' : 'Listening… speak to test';
}

/* ============ workspace views ============ */
let VIEW = 'brain';
const NAV = () => [['brain', 'Brain', 'i-brain'], ['me', 'Ideas', 'i-me'], ...Object.entries(BIZ()).map(([k, b]) => [k, b.name, 'i-desk', b.color]), ['modules', 'Module plug', 'i-plug'], ['approvals', 'Approvals', 'i-appr'], ['build', 'Build', 'i-build'], ['settings', 'Settings', 'i-gear']];
function renderNav() {
  const np = pending().length;
  $('#nav').innerHTML = NAV().map(([k, l, ic, col]) => `<a href="#${k}" class="${VIEW === k ? 'on' : ''} ${k === 'brain' ? 'brainlink' : ''}">${col ? `<svg style="color:${col}"><use href="#${ic}"/></svg>` : `<svg><use href="#${ic}"/></svg>`}${esc(l)}${k === 'approvals' && np ? `<span class="cnt">${np}</span>` : ''}</a>`).join('');
  $('#mnav').innerHTML = [['brain', 'Brain', 'i-brain'], ['me', 'Ideas', 'i-me'], [curBiz() || 'vfx', 'Business', 'i-desk'], ['approvals', 'Approve', 'i-appr'], ['settings', 'Settings', 'i-gear']].map(([k, l, ic]) => `<a href="#${k}" class="${VIEW === k || (l === 'Business' && BIZ()[VIEW]) ? 'on' : ''} ${k === 'brain' ? 'brainlink' : ''}"><svg><use href="#${ic}"/></svg>${l}${k === 'approvals' && np ? `<span class="cnt">${np}</span>` : ''}</a>`).join('');
  $('#verLbl').textContent = 'PERSONAL AI OS · v' + window.JARVIS_VERSION;
}

function vMe() {
  const ideas = live(D.ideas), cnt = s => ideas.filter(i => i.st === s).length;
  return `<div class="top"><div><h1>Ideas</h1><p>Map ideas and hand work to Jarvis. Anything you queue becomes a plan that waits for your approval. Say “idea: …” or “queue: …” from anywhere.</p></div></div>
  <div class="grid">
   <section class="card s12"><header><h2>New idea or task</h2></header>
    <form id="ideaF" class="addf"><div class="field"><input id="ideaT" placeholder="e.g. Auto-send quote PDFs to clients after approval" aria-label="Idea"></div>
     <div class="field"><select id="ideaB" aria-label="Business">${[...Object.keys(BIZ()), 'all', 'me'].map(k => `<option value="${k}" ${k === (curBiz() || 'vfx') ? 'selected' : ''}>${esc(bizName(k))}</option>`).join('')}</select></div>
     <div class="field"><select id="ideaS" aria-label="Stage"><option value="idea">Just an idea</option><option value="queued">Queue for Jarvis</option></select></div>
     <button class="btn go">Add</button></form>
    <div class="stats" style="margin-top:14px">${[['idea', 'Ideas'], ['shape', 'Shaping'], ['queued', 'Queued'], ['done', 'Done']].map(([k, l]) => `<div class="stat"><b class="mono" style="color:${STC[k]}">${cnt(k)}</b><span>${l}</span></div>`).join('')}</div></section>
   <section class="card s12"><header><h2>Board</h2><span class="r label">Saved to Drive</span></header>
    <div class="board">${STAGES.map(([k, l]) => `<div class="col"><h4><i style="width:7px;height:7px;border-radius:50%;background:${STC[k]}"></i>${l}<em>${cnt(k)}</em></h4>${ideas.filter(i => i.st === k).map(i => `<div class="idea"><b>${esc(i.t)}</b><div class="meta">${bz(i.b)} · ${dayLbl(i.c)}</div><div class="btns">${ideaBtns(i)}</div></div>`).join('') || '<div class="empty">Nothing here.</div>'}</div>`).join('')}</div></section>
  </div>`;
}
function ideaBtns(i) {
  const nx = { idea: ['shape', 'Shape it'], shape: ['queued', 'Queue for Jarvis'], queued: null, working: ['done', 'Mark done'] }[i.st];
  return (nx ? `<button class="btn sm ${nx[0] === 'queued' ? 'go' : ''}" data-adv="${i.id}" data-to="${nx[0]}">${nx[1]}</button>` : '') + (i.st === 'queued' ? '<span class="pill p-warn">waiting for approval</span>' : '') + `<button class="btn sm no" data-del="${i.id}">Remove</button>`;
}

function validateModule(m, k) {
  const e = []; if (!m || typeof m !== 'object' || Array.isArray(m)) return ["That isn't a JSON object."];
  if (m.contract !== CONTRACT) e.push(`"contract" must be "${CONTRACT}".`);
  if (!m.business) e.push('"business" is missing.'); else if (k && m.business !== k) e.push(`This module is for "${m.business}", not ${bizName(k)} ("${k}").`);
  ['name', 'version'].forEach(f => { if (!m[f]) e.push(`"${f}" is missing.`); });
  if (!/^https:\/\//.test(m.dashboard || '')) e.push('"dashboard" must be an https link.');
  if (!m.data || typeof m.data.entities !== 'object') e.push('"data.entities" must list record counts.');
  if (!Array.isArray(m.tools) || !m.tools.length) e.push('"tools" must list at least one tool.');
  else m.tools.forEach((t, i) => { if (!t.id || !t.name || !t.category) e.push(`Tool ${i + 1} needs id, name and category.`); if (!Array.isArray(t.commands)) e.push(`Tool ${t.name || i + 1} needs a "commands" list.`); });
  return e;
}
let showPlug = false;
function vBiz(k) {
  const b = BIZ()[k], m = mod(k), ap = pending(k), ideas = live(D.ideas).filter(i => i.b === k || i.b === 'all');
  const head = `<div class="top"><div><h1 style="color:${b.color}">${esc(b.name)}</h1><p>${esc(b.desc || 'No description yet.')}</p></div><div class="aside"><span class="pill ${m ? 'p-ok' : ''}">${m ? 'Module plugged in' : 'No module yet'}</span></div></div>`;
  const ideasCard = `<section class="card ${m ? 's5' : 's6'}"><header><h2>Ideas for ${esc(b.name)}</h2><a class="r btn sm" href="#me">Add</a></header>${ideas.map(i => `<div class="row"><span class="t">${esc(i.t)}</span><span class="m">${STAGES.find(s => s[0] === i.st)[1]}</span></div>`).join('') || '<div class="empty">None yet.</div>'}</section>`;
  const descCard = `<section class="card s6"><header><h2>Description</h2></header><form id="descF" style="display:flex;gap:8px;flex-wrap:wrap"><div class="field" style="flex:1 1 220px"><input id="descI" value="${esc(b.desc || '')}" placeholder="What does ${esc(b.name)} do?" aria-label="Business description"></div><button class="btn go">Save</button></form><p class="dim" style="font-size:12.5px;margin:10px 0 0">This becomes the note on ${esc(b.name)} in the Brain.</p></section>`;
  if (!m || showPlug) return head + `<div class="grid"><section class="card s12"><header><h2>Plug in a dashboard module</h2><span class="r label">${CONTRACT}</span></header>
    <p class="brief" style="font-size:14px">Paste the module's <span class="mono">business.json</span>. Jarvis checks it, adds its tools to the Brain and briefings, and lets you call its commands by voice.</p>
    <form id="plugF" style="display:grid;gap:10px;margin-top:10px"><textarea id="plugT" rows="8" class="in" placeholder='{"contract": "${CONTRACT}", "business": "${k}", …}' aria-label="business.json"></textarea>
    <div class="btns"><button class="btn go">Plug in</button>${k === 'vfx' ? '<button type="button" class="btn" id="plugSample">Use the Studio Hub prototype</button>' : ''}<a class="btn" href="#modules">How modules work</a>${m ? '<button type="button" class="btn" id="plugCancel">Cancel</button>' : ''}</div>
    <div id="plugErr" style="color:var(--red);font-size:13px"></div></form></section>${descCard}${ideasCard}</div>`;
  const cats = [...new Set(m.tools.map(t => t.category))], cmds = m.tools.flatMap(t => (t.commands || []).map(c => ({ ...c, tool: t.name })));
  return head + `<div class="grid">
   <section class="card s12"><header><h2>${esc(m.name)}</h2><span class="pill">v${esc(m.version)}</span>${m.sample ? '<span class="pill p-warn">sample data</span>' : ''}<span class="r"><a class="btn go" href="${esc(m.dashboard)}" target="_blank" rel="noopener">Open dashboard ↗</a><button class="btn" id="plugReplace">Replace</button><button class="btn no" id="plugRemove">Unplug</button></span></header>
    <div class="stats">${Object.entries(m.summary || {}).filter(([x]) => x !== 'as_of').slice(0, 4).map(([x, v]) => `<div class="stat"><b class="mono">${esc(fmtV(x, v))}</b><span>${esc(fmtK(x))}</span></div>`).join('')}</div>
    <p class="dim" style="font-size:12px;margin:12px 0 0">Data: ${esc(m.data.store || '')} · <span class="mono">${esc(m.data.location || '')}</span> · ${Object.entries(m.data.entities).map(([e, n]) => `${n} ${esc(e)}`).join(' · ')}${m.summary?.as_of ? ` · as of ${esc(String(m.summary.as_of).replace('T', ' '))}` : ''}</p></section>
   <section class="card s7"><header><h2>Tools</h2><span class="r label">${m.tools.length}</span></header>${cats.map(c => `<div class="label" style="margin:10px 0 4px">${esc(c)}</div>${m.tools.filter(t => t.category === c).map(t => `<div class="row"><span class="t">${esc(t.name)}</span><span class="m">v${esc(t.version || '')} · ${(t.commands || []).length} commands</span><span class="rr"><span class="pill ${t.status === 'live' ? 'p-ok' : t.status === 'prototype' ? 'p-info' : ''}">${esc(t.status || '')}</span></span></div>`).join('')}`).join('')}</section>
   <section class="card s5"><header><h2>Waiting on you</h2><a class="r label linkish" href="#approvals">Open ›</a></header>${ap.map(a => `<div class="row"><span class="t">${esc(a.title)}</span><span class="m">${esc(a.type)}</span></div>`).join('') || '<div class="empty">Nothing is waiting.</div>'}
    <header style="margin-top:16px"><h2>Say to Jarvis</h2><span class="r label">${cmds.length}</span></header>${cmds.map(c => `<div class="row"><span class="t mono" style="font-size:12.5px">${esc(c.say)}</span><span class="m">${esc(c.tool)} · ${esc(c.does)}</span><span class="rr"><button class="btn sm" data-ask="${esc(c.say)}">${c.needs_approval ? 'Request' : 'Try'}</button></span></div>`).join('')}</section>
   ${ideasCard}${descCard.replace('s6', 's7')}</div>`;
}
function vModules() {
  const tmpl = { contract: CONTRACT, business: 'coorg', name: 'Coorgified Dashboard', version: '0.1', dashboard: 'https://…', data: { store: 'Google Sheet', location: 'Coorgified Hub/00 Master Data', ids: { customer: 'Customer ID', order: 'Order ID' }, entities: { Customers: 0, Orders: 0 } }, summary: { open_orders: 0, revenue_month_inr: 0, as_of: '2026-10-28T09:00' }, categories: ['Sales', 'Operations'], tools: [{ id: 'orders', name: 'Order Desk', category: 'Sales', version: '0.1', status: 'prototype', commands: [{ say: 'open orders', does: 'List orders not yet shipped', needs_approval: false }, { say: 'send invoice', does: 'Email an invoice to a customer', needs_approval: true }] }] };
  const rows = Object.entries(BIZ()).map(([k, b]) => { const m = mod(k); return `<tr><td><span style="color:${b.color};font-weight:600">${esc(b.name)}</span><div class="dim mono" style="font-size:11.5px">"${k}"</div></td><td>${m ? '<span class="pill p-ok">plugged in</span>' : '<span class="pill">empty</span>'}</td><td>${m ? esc(m.name) + ' · v' + esc(m.version) : '—'}</td><td class="n">${m ? m.tools.length : '—'}</td><td><a class="btn sm" href="#${k}">${m ? 'Open' : 'Plug in'}</a></td></tr>`; }).join('');
  return `<div class="top"><div><h1>Module plug</h1><p>Each business dashboard is built separately and plugs into Jarvis with one file, <span class="mono">business.json</span>. The full contract is saved in your VishwaaFX project as <span class="mono">Jarvis_Business_Module_Contract.md</span>.</p></div></div>
  <div class="grid"><section class="card s12"><div class="tw"><table><thead><tr><th>Business</th><th>Status</th><th>Module</th><th class="n">Tools</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></section>
  <section class="card s12"><header><h2>business.json template</h2><button class="r btn sm" id="copyTmpl">Copy</button></header><pre class="code" id="tmplPre">${esc(JSON.stringify(tmpl, null, 2))}</pre></section></div>`;
}
function vApprovals() {
  const list = live(D.approvals), pend = list.filter(a => a.status === 'pending'), done = list.filter(a => a.status !== 'pending').slice(0, 12);
  const card = a => `<div class="appr"><div class="h"><b>${esc(a.title)}</b><span class="pill p-warn">${esc(a.type)}</span>${bz(a.ws)}</div><p>${esc(a.why)}</p><dl><dt>Scope</dt><dd>${esc(a.scope)}</dd><dt>Asked</dt><dd>${dayLbl(a.c)}</dd></dl>${a.status === 'pending' ? `<div class="btns"><button class="btn go" data-ap="${a.id}" data-d="approved">Approve</button><button class="btn no" data-ap="${a.id}" data-d="declined">Decline</button></div>` : `<span class="pill ${a.status === 'approved' ? 'p-ok' : 'p-bad'}">${a.status} · ${dayLbl(a.u)}</span>`}</div>`;
  return `<div class="top"><div><h1>Approvals</h1><p>Each approval covers one action. Approvals need a tap; Jarvis won't take them by voice.</p></div></div>
  <div class="grid"><section class="card s7"><header><h2>Waiting</h2><span class="r label">${pend.length}</span></header>${pend.map(card).join('') || '<div class="empty">Nothing is waiting for you.</div>'}
   ${done.length ? `<header style="margin-top:18px"><h2>Decided</h2></header>${done.map(card).join('')}` : ''}</section>
  <section class="card s5"><header><h2>Activity</h2><span class="r label">Saved to Drive</span></header><div class="log">${D.log.slice(0, 40).map(l => `<div><b>${dayLbl(l.at)}</b> ${esc(l.who)} · ${esc(l.what)}</div>`).join('')}</div></section></div>`;
}
function phases() {
  const onPages = /github\.io$/.test(location.hostname);
  return [
    { n: 'Architecture', items: [['PRD', 1], ['Brain + tab design', 1], ['Business module contract', 1], ['Stack: web app + Google Drive', 1], ['Threat model', 0], ['Monthly AI budget', Brain.claudeReady() || Brain.hermesReady() || Brain.geminiReady() ? 1 : 0]] },
    { n: 'Prototype', items: [['Brain home', 1], ['Ideas', 1], ['Build tracker', 1], ['3 businesses', 1], ['Approvals', 1], ['Studio Hub', 1], ['Module plug', 1]] },
    { n: 'Jarvis v1 (real)', items: [['Hosted online', onPages ? 1 : 0], ['Google sign-in', Drive.isConnected() ? 1 : 0], ['Saves to Drive', D.meta?.lastSync ? 1 : 0], ['Daily Drive backups', D.meta?.lastSync ? 1 : 0], ['Voice in', Voice.supported.listen ? 1 : 0], ['Voice out', Voice.supported.speak ? 1 : 0], ['“Hey Jarvis” wake mode', Voice.supported.listen ? 1 : 0], ['Installable app', 1], ['Live mic visualizer', 1], ['Claude brain (choose model)', Brain.claudeReady() ? 1 : 0], ['Free models via Hermes', Brain.hermesReady() ? 1 : 0], ['Gemini brain', Brain.geminiReady() ? 1 : 0], ['Monthly AI budget guard', 1]] },
    { n: 'PC runner', items: [['Runner on studio PC', 0], ['Folder access', 0], ['Modules run commands', 0], ['Offline wake word', 0], ['Premium voice', 0]] },
    { n: 'Agents & cost', items: [['Planner', 0], ['Specialist agents', 0], ['Approval gateway', 0], ['Usage & budget', 0]] },
    { n: 'Expansion', items: [['VishwaaFX real module', 0], ['Coorgified module', 0], ['Taarora module', 0], ['Shared skills', 0]] }
  ];
}
function vBuild() {
  const P = phases(), all = P.flatMap(p => p.items), pct = Math.round(all.filter(i => i[1]).length / all.length * 100), cur = P.findIndex(p => p.items.some(i => !i[1])), R = 70, C = 2 * Math.PI * R;
  return `<div class="top"><div><h1>Build</h1><p>Jarvis is a project of its own. Version 1 items tick themselves when they're working on this device.</p></div></div>
  <div class="grid"><section class="card s4" style="display:grid;place-items:center;gap:10px;text-align:center">
   <svg viewBox="0 0 180 180" width="170" height="170" role="img" aria-label="${pct}% built"><circle cx="90" cy="90" r="${R}" fill="none" stroke="#1a2733" stroke-width="12"/><circle cx="90" cy="90" r="${R}" fill="none" stroke="#2fd38a" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C * pct / 100} ${C}" transform="rotate(-90 90 90)"/><text x="90" y="94" text-anchor="middle" fill="#e1e9ef" font-size="34" font-weight="600" font-family="Oxanium,system-ui">${pct}%</text><text x="90" y="116" text-anchor="middle" fill="#57697a" font-size="10" letter-spacing="2" font-family="JetBrains Mono,monospace">BUILT</text></svg>
   <span class="pill p-info">Phase ${cur} · ${P[cur].n}</span></section>
  <section class="card s8">${P.map((p, i) => { const d = p.items.filter(x => x[1]).length, pc = Math.round(d / p.items.length * 100); return `<div class="phase ${pc === 100 ? 'done' : i === cur ? 'cur' : ''}"><div class="num">${i}</div><span class="t">${p.n}</span><span class="mono">${pc}%</span><div style="grid-column:2/4"><div class="bar"><i style="width:${pc}%;background:${i === cur ? 'var(--cyan)' : 'var(--green)'}"></i></div></div><div class="items">${p.items.map(x => `<span class="${x[1] ? 'ok' : ''}">${x[1] ? '✓ ' : ''}${x[0]}</span>`).join('')}</div></div>`; }).join('')}</section></div>`;
}
function vSettings() {
  const u = Drive.user(), vs = Voice.voices(), cur = Voice.pickVoice();
  const u2 = D.usage[Brain.month()] || { usd: 0, calls: 0, in: 0, out: 0 }, pctB = Math.min(100, u2.usd / (Brain.cfg.budgetUSD || 1) * 100);
  return `<div class="top"><div><h1>Settings</h1><p>Drive is shared by every device you sign in on. Voice and AI settings belong to this device.</p></div></div>
  <div class="grid">
   ${Voice.inClaudeApp ? '<section class="card s12"><div class="note"><b>You\'re in the Claude app\'s browser.</b> It blocks the microphone, so Jarvis can\'t hear you here. Open <span class="mono">dicksonpjo-sys.github.io/jarvis</span> in <b>Chrome</b> or <b>Edge</b> (Edge has the most natural voices), and install it from there.</div></section>' : ''}
   <section class="card s6"><header><h2>Audio</h2><span class="r pill ${micPerm === 'granted' ? 'p-ok' : micPerm === 'denied' ? 'p-bad' : ''}">${micPerm === 'granted' ? 'allowed' : micPerm === 'denied' ? 'blocked' : 'not asked yet'}</span></header>
    <div class="set" style="margin-bottom:12px">
     <label for="aMic">Microphone</label><select class="in" id="aMic"><option value="">System default</option>${micList.map(d => `<option value="${esc(d.deviceId)}" ${Voice.cfg.micId === d.deviceId ? 'selected' : ''}>${esc(d.label || 'Microphone ' + d.deviceId.slice(0, 5))}</option>`).join('')}</select>
     <label for="aSens">Meter sensitivity</label><input type="range" id="aSens" min="0.5" max="3" step="0.1" value="${Voice.cfg.sensitivity || 1}">
     <label for="aVol">Jarvis volume</label><input type="range" id="aVol" min="0" max="1" step="0.05" value="${Voice.cfg.volume ?? 1}">
    </div>
    <canvas class="wv" style="width:100%;height:90px;display:block;background:var(--panel);border:1px solid var(--line);border-radius:10px"></canvas>
    <div class="bar" style="height:8px;margin-top:10px"><i id="micBar" style="width:0;background:var(--teal);transition:width .08s"></i></div>
    <div style="display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:12.5px"><span id="micLevelLbl" class="dim">Not listening</span><span class="dim mono" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(Voice.micLabel)}</span></div>
    <div class="btns" style="margin-top:12px"><button class="btn ${Voice.checking ? 'no' : 'go'}" id="micChk">${Voice.checking ? 'Stop mic test' : 'Test microphone'}</button><button class="btn" id="spkChk">Test speaker</button></div>
    <p class="dim" style="font-size:12px;margin:8px 0 0">Speech-to-text listens through the browser's default microphone. If you pick a different one here and Jarvis can't hear you, set the same mic as default in Windows Sound settings or in Chrome → Settings → Privacy → Site settings → Microphone.</p>
    ${micPerm === 'denied' ? '<p class="dim" style="font-size:12.5px;margin:10px 0 0">The browser has blocked the mic for this site. Click the lock or tune icon left of the address, set <b>Microphone</b> to Allow, then reload.</p>' : '<p class="dim" style="font-size:12.5px;margin:10px 0 0">Talk while the check runs: the wave and bar should move. The same wave shows next to the mic button whenever Jarvis listens.</p>'}</section>
   <section class="card s6"><header><h2>AI brain</h2><span class="r pill ${Brain.ready() ? 'p-ok' : 'p-warn'}">${Brain.ready() ? 'ready' : 'not set up'}</span></header>
    <div class="set">
     <label>Provider</label><div class="btns"><button class="btn ${Brain.cfg.provider === 'claude' ? 'go' : ''}" data-prov="claude">Claude (paid)</button><button class="btn ${Brain.cfg.provider === 'gemini' ? 'go' : ''}" data-prov="gemini">Gemini (free tier)</button><button class="btn ${Brain.cfg.provider === 'hermes' ? 'go' : ''}" data-prov="hermes">Hermes · NVIDIA (free)</button></div>
    </div>
    ${Brain.cfg.provider === 'gemini' ? (() => { const list = Brain.cfg.geminiList?.length ? Brain.cfg.geminiList : Brain.GEMINI_MODELS; const has = list.some(m => m.id === Brain.cfg.geminiModel); return `
    <div class="set" style="margin-top:12px">
     <label for="gModel">Model</label><div style="display:flex;gap:6px;min-width:0"><select class="in" id="gModel" style="flex:1;min-width:0">${has ? '' : `<option value="${esc(Brain.cfg.geminiModel)}" selected>${esc(Brain.cfg.geminiModel)}</option>`}${list.map(m => `<option value="${esc(m.id)}" ${Brain.cfg.geminiModel === m.id ? 'selected' : ''}>${esc(m.name)}${m.name !== m.id ? ' · ' + esc(m.id) : ''}</option>`).join('')}</select><button class="btn sm" id="gLoad" type="button" ${Brain.geminiReady() ? '' : 'disabled'}>Load models</button></div>
     <span></span><span class="dim" style="font-size:12px">${esc((Brain.GEMINI_MODELS.find(m => m.id === Brain.cfg.geminiModel) || { note: Brain.cfg.geminiList?.length ? 'From your key\'s live model list.' : '' }).note)}</span>
     <label for="gKey">Gemini API key</label><div class="field"><input id="gKey" type="password" autocomplete="off" spellcheck="false" placeholder="${Brain.geminiReady() ? '•••• saved on this device' : 'AIza…'}" aria-label="Gemini API key"><button class="btn sm" id="gKeySave" type="button">Save</button></div>
     <label>If Gemini fails</label><button class="tog" id="hFall" aria-pressed="${!!Brain.cfg.fallback}">Let Claude answer instead${Brain.claudeReady() ? '' : ' (needs a Claude key)'}<span class="sw"></span></button>
    </div>
    <div class="btns" style="margin-top:14px"><button class="btn go" id="gTest" ${Brain.geminiReady() ? '' : 'disabled'}>Test Gemini</button><button class="btn" id="aiForget">New conversation</button>${Brain.geminiReady() ? '<button class="btn no" id="gKeyDel">Remove key</button>' : ''}</div>
    <p class="dim" style="font-size:12px;margin:12px 0 0">Get a free key at aistudio.google.com → Get API key. Flash models are free within Google's daily limits; Pro needs billing. On the free tier Google may use what you send to improve its products, so keep private business details for Claude. The key stays in this browser only. Gemini answers this month: ${(D.usage[Brain.month()]?.gemini || 0)}.</p>`; })()
    : Brain.cfg.provider === 'hermes' ? `
    <div class="set" style="margin-top:12px">
     <label for="hModel">Model</label><select class="in" id="hModel">${Brain.HERMES_MODELS.map(m => `<option value="${m.id}" ${Brain.cfg.hermesModel === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}<option value="custom" ${Brain.cfg.hermesModel === 'custom' ? 'selected' : ''}>Another NVIDIA model…</option></select>
     <span></span><span class="dim" style="font-size:12px">${esc((Brain.HERMES_MODELS.find(m => m.id === Brain.cfg.hermesModel) || { note: 'Type the model ID from build.nvidia.com, e.g. vendor/model-name.' }).note)}</span>
     ${Brain.cfg.hermesModel === 'custom' ? `<label for="hCustom">Model ID</label><div class="field"><input id="hCustom" value="${esc(Brain.cfg.hermesCustom)}" placeholder="vendor/model-name" aria-label="NVIDIA model ID"></div>` : ''}
     <label for="hUrl">Hermes address</label><div class="field"><input id="hUrl" value="${esc(Brain.cfg.hermesUrl)}" aria-label="Hermes address"></div>
     <label for="hKey">Hermes key</label><div class="field"><input id="hKey" type="password" autocomplete="off" spellcheck="false" placeholder="${Brain.hermesReady() ? '•••• saved on this device' : 'API_SERVER_KEY from Hermes'}" aria-label="Hermes key"><button class="btn sm" id="hKeySave" type="button">Save</button></div>
     <span></span><div class="btns"><button class="btn sm" id="hMake" type="button">Make a new key</button></div>
     <label>If Hermes fails</label><button class="tog" id="hFall" aria-pressed="${!!Brain.cfg.fallback}">Let Claude answer instead${Brain.claudeReady() ? '' : ' (needs a Claude key)'}<span class="sw"></span></button>
    </div>
    <div class="btns" style="margin-top:14px"><button class="btn go" id="hTest" ${Brain.hermesReady() ? '' : 'disabled'}>Test Hermes</button><button class="btn" id="hGuide">Setup steps</button><button class="btn" id="aiForget">New conversation</button></div>
    <p class="dim" style="font-size:12px;margin:12px 0 0">Free, but NVIDIA's free tier is rate-limited and sometimes times out. Hermes runs on your PC and can use its own tools there; Jarvis asks it only to answer and to save ideas. Calls this month: ${(D.usage[Brain.month()]?.free || 0)} via Hermes.</p>`
    : `
    <div class="set" style="margin-top:12px">
     <label for="aiModel">Model</label><select class="in" id="aiModel">${Brain.MODELS.map(m => `<option value="${m.id}" ${Brain.cfg.model === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select>
     <span></span><span class="dim" style="font-size:12px">${esc((Brain.MODELS.find(m => m.id === Brain.cfg.model) || {}).note || '')}</span>
     <label for="aiKey">Claude API key</label><div class="field"><input id="aiKey" type="password" autocomplete="off" spellcheck="false" placeholder="${Brain.claudeReady() ? '•••• saved on this device' : 'sk-ant-…'}" aria-label="Claude API key"><button class="btn sm" id="aiKeySave" type="button">Save</button></div>
     <label for="aiBudget">Monthly budget (USD)</label><div class="field"><input id="aiBudget" type="number" min="0" step="1" value="${Brain.cfg.budgetUSD}" aria-label="Monthly budget in US dollars"></div>
     <label>This month</label><div><div class="bar" style="height:8px"><i style="width:${pctB}%;background:${pctB > 80 ? 'var(--amber)' : 'var(--green)'}"></i></div><span class="dim mono" style="font-size:12px">$${usd$(u2.usd)} of $${Brain.cfg.budgetUSD} · ${u2.calls} answers · ≈ ₹${Math.round(u2.usd * Brain.cfg.usdToInr)} (estimate)</span></div>
    </div>
    <div class="btns" style="margin-top:14px"><button class="btn go" id="aiTest" ${Brain.claudeReady() ? '' : 'disabled'}>Test connection</button><button class="btn" id="aiForget">New conversation</button>${Brain.claudeReady() ? '<button class="btn no" id="aiKeyDel">Remove key</button>' : ''}</div>
    <details style="margin-top:12px"><summary class="dim" style="cursor:pointer;font-size:12.5px">Price estimates (edit to match your Anthropic Console)</summary><div class="set" style="margin-top:10px">${Brain.MODELS.map(m => `<label>${m.name}</label><span class="mono" style="font-size:12px">$<input class="in" style="width:64px;padding:3px 6px" type="number" step="0.05" min="0" data-rate="${m.id}|0" value="${Brain.cfg.rates[m.id][0]}" aria-label="${m.name} input price"> in · $<input class="in" style="width:64px;padding:3px 6px" type="number" step="0.05" min="0" data-rate="${m.id}|1" value="${Brain.cfg.rates[m.id][1]}" aria-label="${m.name} output price"> out per million tokens</span>`).join('')}</div></details>
    <p class="dim" style="font-size:12px;margin:12px 0 0">Get a key at console.anthropic.com → API keys, and set a spend limit there too. The key stays in this browser only; it is never saved to Drive. Jarvis stops calling Claude when the monthly budget is reached.</p>`}</section>
   <section class="card s6"><header><h2>Google Drive</h2></header>
    ${Drive.isConnected() ? `<div class="set"><label>Account</label><span>${esc(u?.email || 'Connected')}</span><label>Status</label><span>${$('#railSyncLbl').textContent}${syncState === 'err' ? ` · <span style="color:var(--red)">${esc(syncMsg)}</span>` : ''}</span><label>Data file</label><span class="mono" style="font-size:12px">My Drive / Jarvis / jarvis_data.json</span><label>Backups</label><span class="mono" style="font-size:12px">Jarvis / Backups / month / one per day</span></div>
     <div class="btns" style="margin-top:14px"><button class="btn go" id="syncBtn">${Drive.token() ? 'Sync now' : 'Reconnect'}</button><button class="btn" id="folderBtn">Open folder ↗</button><button class="btn no" id="discBtn">Disconnect</button></div>`
     : `<p class="brief" style="font-size:14px">Connect once on each device. Jarvis creates a <b>Jarvis</b> folder in your My Drive and can only see files it made.</p><div class="btns" style="margin-top:12px"><button class="btn go" id="connBtn">Connect Google Drive</button></div><p class="dim" style="font-size:12px">Until then everything is saved in this browser only.</p>`}
   </section>
   <section class="card s6"><header><h2>Voice</h2></header>
    ${!Voice.supported.listen ? '<div class="note" style="margin-bottom:12px"><b>Listening isn\'t available in this browser.</b> Use Chrome or Edge on your PC or Android phone. On iPhone, type instead; Jarvis can still speak.</div>' : ''}
    <div class="set">
     <label for="vLang">I speak</label><select class="in" id="vLang">${[['en-IN', 'English (India)'], ['en-GB', 'English (UK)'], ['en-US', 'English (US)'], ['ml-IN', 'Malayalam'], ['hi-IN', 'Hindi']].map(([v, l]) => `<option value="${v}" ${Voice.cfg.lang === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
     <label for="vVoice">Jarvis's voice</label><select class="in" id="vVoice"><option value="">Automatic${cur ? ' (' + esc(cur.name) + ')' : ''}</option>${vs.map(v => `<option value="${esc(v.voiceURI)}" ${Voice.cfg.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} · ${esc(v.lang)}</option>`).join('')}</select>
     <label for="vRate">Speed</label><input type="range" id="vRate" min="0.7" max="1.4" step="0.05" value="${Voice.cfg.rate}">
     <label for="vPitch">Pitch</label><input type="range" id="vPitch" min="0.6" max="1.3" step="0.05" value="${Voice.cfg.pitch}">
     <label>Speak replies</label><button class="tog" id="vSpeak" aria-pressed="${Voice.cfg.speak}">To voice commands<span class="sw"></span></button>
     <label>Also to typing</label><button class="tog" id="vTyped" aria-pressed="${!!Voice.cfg.speakTyped}">Speak replies to typed questions<span class="sw"></span></button>
     <label>“Hey Jarvis”</label><button class="tog" id="vWake" aria-pressed="${Voice.wakeOn}" ${Voice.supported.listen ? '' : 'disabled'}>Listen while the app is open<span class="sw"></span></button>
    </div>
    <div class="btns" style="margin-top:14px"><button class="btn" id="vTest">Test voice</button></div>
    <p class="dim" style="font-size:12px;margin:12px 0 0">Hold the mic button, or hold the Space bar on a PC. In Chrome your speech is turned into text by Google's speech service. Wake mode only works while Jarvis is open on screen.</p></section>
   <section class="card s12"><header><h2>Your data</h2></header><div class="btns"><button class="btn" id="expBtn">Copy all data (JSON)</button><button class="btn no" id="resetBtn">Reset this device</button></div></section>
  </div>`;
}

/* ============ router ============ */
function render() {
  const isBrain = VIEW === 'brain';
  $('#brain').hidden = !isBrain; $('#app').hidden = isBrain; $('#wcmd').hidden = isBrain; $('#mnav').hidden = isBrain;
  if (isBrain) { startBrain(); brainPanels(); return; }
  stopBrain();
  $('#main').innerHTML = BIZ()[VIEW] ? vBiz(VIEW) : ({ me: vMe, modules: vModules, approvals: vApprovals, build: vBuild, settings: vSettings }[VIEW] || vMe)();
  renderNav();
}
/* Re-render after a background sync without losing what the user is typing. */
function renderQuiet() { graphRefresh(); const a = document.activeElement; if (VIEW !== 'brain' && !(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) render(); else if (VIEW !== 'brain') renderNav(); }
function route() { const h = location.hash.slice(1); VIEW = (h === 'brain' || BIZ()[h] || ['me', 'modules', 'approvals', 'build', 'settings'].includes(h)) ? h : 'brain'; showPlug = false; render(); $('#main').scrollTop = 0; }
addEventListener('hashchange', route);

/* ============ events ============ */
document.addEventListener('click', e => {
  const t = e.target; let el;
  if (t.closest('[data-close]')) return closeModal();
  if (t.closest('[data-closereply]')) { $('#breply').innerHTML = ''; $('#wreply').innerHTML = ''; return; }
  if (el = t.closest('[data-node]')) { selectNode(+el.dataset.node); $('#gres').innerHTML = ''; return; }
  if (el = t.closest('[data-filt]')) { const k = el.dataset.filt; G.hidden.has(k) ? G.hidden.delete(k) : G.hidden.add(k); brainPanels(); return; }
  if (t.closest('#filtAll')) { G.hidden.clear(); brainPanels(); return; }
  if (el = t.closest('[data-disp]')) { const k = el.dataset.disp; G.disp[k] = !G.disp[k]; brainPanels(); return; }
  if (el = t.closest('[data-ask]')) { handle(el.dataset.ask, 'text'); return; }
  if (el = t.closest('[data-adv]')) { const i = D.ideas.find(x => x.id === el.dataset.adv); i.st = el.dataset.to; i.u = nowISO(); if (i.st === 'queued') queueApproval(i); log('You', `${STAGES.find(s => s[0] === i.st)[1]}: ${i.t}`); save(); graphRefresh(); render(); toast(i.st === 'queued' ? 'Queued · approval added' : 'Moved to ' + STAGES.find(s => s[0] === i.st)[1]); return; }
  if (el = t.closest('[data-del]')) { const i = D.ideas.find(x => x.id === el.dataset.del); i.del = true; i.u = nowISO(); log('You', 'Removed idea: ' + i.t); save(); graphRefresh(); render(); return; }
  if (el = t.closest('[data-ap]')) { const a = D.approvals.find(x => x.id === el.dataset.ap); a.status = el.dataset.d; a.u = nowISO();
    if (a.from?.startsWith('idea:')) { const i = D.ideas.find(x => x.id === a.from.slice(5)); if (i) { i.st = a.status === 'approved' ? 'working' : 'shape'; i.u = nowISO(); } }
    log('You', `${a.status === 'approved' ? 'Approved' : 'Declined'}: ${a.title}`); save(); graphRefresh(); render(); toast(a.status === 'approved' ? 'Approved' : 'Declined'); return; }
  if (t.closest('#plugSample')) { $('#plugT').value = JSON.stringify(VFX_SAMPLE_MODULE, null, 2); return; }
  if (t.closest('#plugReplace')) { showPlug = true; render(); return; }
  if (t.closest('#plugCancel')) { showPlug = false; render(); return; }
  if (t.closest('#plugRemove')) { const k = VIEW, m = mod(k); const md = modal(`<b>Unplug ${esc(m.name)}?</b><p style="margin:0" class="dim">Its tools leave the Brain and briefings. The dashboard and its data aren't touched.</p><div class="btns"><button class="btn no" id="unY">Unplug</button><button class="btn" data-close>Cancel</button></div>`);
    md.querySelector('#unY').onclick = () => { D.modules[k] = { m: null, u: nowISO() }; log('You', 'Unplugged ' + m.name); save(); closeModal(); graphRefresh(); render(); toast(m.name + ' unplugged'); }; return; }
  if (t.closest('#copyTmpl')) { copy($('#tmplPre').textContent, 'Template copied'); return; }
  if (t.closest('#connBtn') || t.closest('#tbSync') || t.closest('#railSync')) { if (!Drive.isConnected() || !Drive.token()) connectDrive(); else syncNow(); return; }
  if (t.closest('#syncBtn')) { Drive.token() ? syncNow().then(render) : connectDrive(); return; }
  if (t.closest('#folderBtn')) { Drive.folderLink().then(u => window.open(u, '_blank', 'noopener')).catch(err => toast(err.message, true)); return; }
  if (t.closest('#discBtn')) { Drive.disconnect(); log('You', 'Disconnected Google Drive on this device'); save({ sync: false }); render(); toast('Disconnected. Data stays in your Drive.'); return; }
  if (t.closest('#vTest')) { Voice.speak(`${greeting()}, Dickson. Jarvis online. Voice systems ready.`, { force: true }); return; }
  if (t.closest('#vSpeak')) { setVoice({ speak: !Voice.cfg.speak }); render(); return; }
  if (t.closest('#vTyped')) { setVoice({ speakTyped: !Voice.cfg.speakTyped }); render(); return; }
  if (t.closest('#vWake') || t.closest('#wakeBtn')) { toggleWake(); if (VIEW === 'settings') render(); return; }
  if (t.closest('#spkBtn')) { setVoice({ speak: !Voice.cfg.speak }); return; }
  if (t.closest('#micChk')) { Voice.micCheck(!Voice.checking).then(() => { refreshPerm(); }); setTimeout(render, 50); return; }
  if (el = t.closest('[data-prov]')) { Brain.save({ provider: el.dataset.prov }); Brain.forget(); log('You', 'AI brain → ' + (el.dataset.prov === 'hermes' ? 'Hermes (free)' : 'Claude')); save(); render(); return; }
  if (t.closest('#gKeySave')) { const k = $('#gKey').value.trim(); if (!/^AIza[\w-]{20,}$/.test(k)) { toast('That doesn\'t look like a Gemini key (it starts with AIza).', true); return; } Brain.save({ geminiKey: k }); log('You', 'Added a Gemini API key on this device'); save(); render(); toast('Gemini key saved on this device'); Brain.geminiModels().then(() => render()).catch(() => {}); return; }
  if (t.closest('#gKeyDel')) { Brain.save({ geminiKey: '', geminiList: [] }); render(); toast('Gemini key removed from this device'); return; }
  if (t.closest('#gLoad')) { Brain.geminiModels().then(l => { toast(l.length + ' Gemini models available on your key'); render(); }).catch(e => toast(e.message, true)); return; }
  if (t.closest('#gTest')) { const b = $('#gTest'); b.disabled = true; b.textContent = 'Testing…'; Brain.geminiTest().then(x => { toast('Gemini says: ' + (x.reply || 'ok')); Voice.speak(x.reply || 'Gemini is online.', { force: true }); }).catch(e => toast(e.message, true)).finally(() => render()); return; }
  if (t.closest('#hKeySave')) { const k = $('#hKey').value.trim(); if (k.length < 12) { toast('The key looks too short. Use the same value as API_SERVER_KEY in Hermes.', true); return; } Brain.save({ hermesKey: k }); render(); toast('Hermes key saved on this device'); return; }
  if (t.closest('#hMake')) { hermesGuide(Brain.makeKey()); return; }
  if (t.closest('#hGuide')) { hermesGuide(null); return; }
  if (t.closest('#hFall')) { Brain.save({ fallback: !Brain.cfg.fallback }); render(); return; }
  if (t.closest('#hTest')) { const b = $('#hTest'); b.disabled = true; b.textContent = 'Testing… (free models can take a while)'; Brain.hermesTest().then(x => { toast('Hermes says: ' + (x.reply || 'ok')); Voice.speak(x.reply || 'Hermes is online.', { force: true }); }).catch(e => toast(e.message, true)).finally(() => render()); return; }
  if (t.closest('#spkChk')) { Voice.speak('Testing, one, two, three. This is Jarvis, at this volume.', { force: true }); return; }
  if (t.closest('#aiKeySave')) { const k = $('#aiKey').value.trim(); if (!/^sk-ant-/.test(k)) { toast('That doesn\'t look like a Claude API key (it starts with sk-ant-).', true); return; } Brain.save({ apiKey: k }); log('You', 'Added a Claude API key on this device'); save(); render(); toast('Key saved on this device'); return; }
  if (t.closest('#aiKeyDel')) { Brain.save({ apiKey: '' }); render(); toast('Key removed from this device'); return; }
  if (t.closest('#aiForget')) { Brain.forget(); toast('Started a new conversation'); return; }
  if (t.closest('#aiTest')) { const b = $('#aiTest'); b.disabled = true; b.textContent = 'Testing…'; Brain.test().then(x => { toast('Claude says: ' + x); Voice.speak(x, { force: true }); }).catch(e => toast(e.message, true)).finally(() => render()); return; }
  if (t.closest('#expBtn')) { copy(JSON.stringify(D, null, 2), 'All data copied'); return; }
  if (t.closest('#resetBtn')) { const md = modal(`<b>Reset this device?</b><p style="margin:0" class="dim">Clears Jarvis from this browser. Your Drive copy is kept, and comes back when you connect again.</p><div class="btns"><button class="btn no" id="rsY">Reset</button><button class="btn" data-close>Cancel</button></div>`);
    md.querySelector('#rsY').onclick = () => { try { Object.keys(localStorage).filter(k => k.startsWith('jarvis.') || k.startsWith('jv.')).forEach(k => localStorage.removeItem(k)); } catch {} location.reload(); }; return; }
  if (t.closest('#tgL')) { $('#bpL').classList.toggle('open'); $('#bpR').classList.remove('open'); return; }
  if (t.closest('#tgR')) { $('#bpR').classList.toggle('open'); $('#bpL').classList.remove('open'); return; }
  if (t.closest('#ideaBtn')) { ideaModal(); return; }
  if (t.closest('#tbFit')) { fit(); return; }
  if (t.closest('#tb3d')) { G.mode3d = !G.mode3d; $('#tb3d').setAttribute('aria-pressed', G.mode3d); $('#tb3d span').textContent = G.mode3d ? '3D' : '2D'; if (!G.mode3d) { G.rx = 0; G.ry = 0; } else { G.rx = -.3; GD.N.forEach(n => n.z = (Math.random() - .5) * 80); } G.alpha = 1; return; }
});
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.matches('[data-cmd]')) { const inp = f.querySelector('input'), v = inp.value.trim(); if (!v) return; inp.value = ''; handle(v, 'text'); return; }
  if (f.id === 'ideaF') { const t = $('#ideaT').value.trim(); if (!t) { toast('Write the idea first', true); return; } addIdea(t, $('#ideaB').value, $('#ideaS').value); render(); toast('Added'); return; }
  if (f.id === 'descF') { const k = VIEW; BIZ()[k].desc = $('#descI').value.trim(); BIZ()[k].u = nowISO(); log('You', 'Described ' + BIZ()[k].name); save(); graphRefresh(); render(); toast('Saved'); return; }
  if (f.id === 'plugF') { let m; try { m = JSON.parse($('#plugT').value); } catch (err) { $('#plugErr').textContent = "That isn't valid JSON: " + err.message; return; }
    const errs = validateModule(m, VIEW); if (errs.length) { $('#plugErr').innerHTML = errs.map(x => '• ' + esc(x)).join('<br>'); return; }
    D.modules[VIEW] = { m, u: nowISO() }; showPlug = false; log('You', `Plugged in ${m.name} v${m.version} → ${bizName(VIEW)}`); save(); graphRefresh(); render(); toast(`${m.name} plugged in · ${m.tools.length} tools`); return; }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'vLang') setVoice({ lang: t.value });
  if (t.id === 'gModel') { Brain.save({ geminiModel: t.value }); Brain.forget(); log('You', 'Gemini model → ' + t.value); save(); render(); toast('Now using ' + Brain.modelName(t.value)); }
  if (t.id === 'hModel') { Brain.save({ hermesModel: t.value }); Brain.forget(); render(); }
  if (t.id === 'hCustom') Brain.save({ hermesCustom: t.value.trim() });
  if (t.id === 'hUrl') Brain.save({ hermesUrl: t.value.trim() || 'http://127.0.0.1:8642' });
  if (t.id === 'aMic') { setVoice({ micId: t.value }); Voice.restartMeter(); toast('Microphone changed'); }
  if (t.id === 'aiModel') { Brain.save({ model: t.value }); Brain.forget(); log('You', 'Switched AI model to ' + Brain.modelName(t.value)); save(); render(); toast('Now using ' + Brain.modelName(t.value)); }
  if (t.id === 'aiBudget') { Brain.save({ budgetUSD: Math.max(0, +t.value || 0) }); render(); }
  if (t.dataset?.rate) { const [id, ix] = t.dataset.rate.split('|'); const r = [...Brain.cfg.rates[id]]; r[+ix] = Math.max(0, +t.value || 0); Brain.save({ rates: { ...Brain.cfg.rates, [id]: r } }); }
  if (t.id === 'vVoice') { setVoice({ voiceURI: t.value }); Voice.speak('This is my voice now.', { force: true }); }
});
document.addEventListener('input', e => { const t = e.target; if (t.id === 'vRate') setVoice({ rate: +t.value }); if (t.id === 'aSens') setVoice({ sensitivity: +t.value }); if (t.id === 'aVol') setVoice({ volume: +t.value }); if (t.id === 'vPitch') setVoice({ pitch: +t.value }); if (t.id === 'gq') gsearch(t.value); });
function hermesGuide(newKey) {
  const env = `API_SERVER_ENABLED=true
API_SERVER_KEY=${newKey || '<the key you saved in Jarvis>'}
API_SERVER_CORS_ORIGINS=https://dicksonpjo-sys.github.io`;
  const md = modal(`<b>Connect Hermes (free NVIDIA models)</b>
   <ol style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:13px;color:var(--muted)">
    <li><b style="color:var(--fg)">Install Hermes</b> on this PC. In PowerShell: <span class="mono" style="color:var(--fg)">iex (irm https://hermes-agent.nousresearch.com/install.ps1)</span>, or use the Hermes desktop app.</li>
    <li><b style="color:var(--fg)">Get a free NVIDIA key</b> at build.nvidia.com → Generate API Key (starts with nvapi-).</li>
    <li>Run <span class="mono" style="color:var(--fg)">hermes model</span> → <b style="color:var(--fg)">NVIDIA NIM</b> → paste your nvapi key → base URL <span class="mono" style="color:var(--fg)">https://integrate.api.nvidia.com/v1</span> → pick <span class="mono" style="color:var(--fg)">deepseek-ai/deepseek-v4-flash</span>.</li>
    <li>Open the Hermes <span class="mono" style="color:var(--fg)">.env</span> file (usually <span class="mono" style="color:var(--fg)">C:\\Users\\&lt;you&gt;\\.hermes\\.env</span>) and add these three lines:</li></ol>
   <textarea class="in" rows="4" id="envTxt" readonly>${esc(env)}</textarea>
   <ol start="5" style="margin:0;padding-left:18px;display:grid;gap:8px;font-size:13px;color:var(--muted)">
    <li>Run <span class="mono" style="color:var(--fg)">hermes gateway</span> and leave it running.</li>
    <li>Back here press <b style="color:var(--fg)">Test Hermes</b>. If the browser asks to let Jarvis reach apps on this device, choose <b style="color:var(--fg)">Allow</b>.</li></ol>
   ${newKey ? '<p class="dim" style="margin:0;font-size:12.5px">A new key was made and saved in Jarvis on this device. It is already in the lines above.</p>' : ''}
   <div class="btns"><button class="btn go" id="envCopy">Copy the three lines</button><button class="btn" data-close>Close</button></div>`);
  if (newKey) { Brain.save({ hermesKey: newKey }); render(); }
  md.querySelector('#envCopy').onclick = () => copy(env, 'Copied. Paste into the Hermes .env file.');
}
function ideaModal() {
  const md = modal(`<b>New idea</b><form id="qIdea" style="display:grid;gap:10px"><div class="field"><input id="qT" placeholder="What's the idea?" aria-label="Idea"></div><div class="field"><select id="qB" aria-label="Business">${[...Object.keys(BIZ()), 'all', 'me'].map(k => `<option value="${k}">${esc(bizName(k))}</option>`).join('')}</select></div><div class="btns"><button class="btn go" value="idea">Add idea</button><button class="btn" value="queued">Queue for Jarvis</button><button type="button" class="btn" data-close>Cancel</button></div></form>`);
  md.querySelector('#qIdea').addEventListener('submit', ev => { ev.preventDefault(); ev.stopPropagation(); const t = $('#qT').value.trim(); if (!t) return; const i = addIdea(t, $('#qB').value, ev.submitter?.value || 'idea'); closeModal(); selectNode(GD.ix['i:' + i.id]); toast('Added to the Brain'); });
  setTimeout(() => $('#qT')?.focus(), 30);
}
function gsearch(q) { const el = $('#gres'); if (!q.trim()) { el.innerHTML = ''; return; } const hits = searchNodes(q); el.innerHTML = hits.length ? hits.map(([i, n]) => `<button data-node="${i}"><i style="background:${TYPES[n.type][1]}"></i>${esc(n.l)}</button>`).join('') : '<div class="empty">No match.</div>'; }

/* ============ voice wiring ============ */
let micPerm = 'unknown', micList = [];
function refreshPerm() { Promise.all([Voice.permission(), Voice.inputs()]).then(([p, l]) => { const ch = p !== micPerm || l.length !== micList.length || (l[0] && !micList[0]?.label && l[0].label); micPerm = p; micList = l; if (ch && VIEW === 'settings') render(); }); }
const VKEY = 'jarvis.v1.voice';
function setVoice(c) { Voice.configure(c); LS.set(VKEY, { ...Voice.cfg }); syncVoiceUI(); }
function syncVoiceUI() { $('#spkBtn').setAttribute('aria-pressed', Voice.cfg.speak); $('#spkBtn').textContent = Voice.cfg.speak ? 'VOICE ON' : 'VOICE OFF'; $('#wakeBtn').setAttribute('aria-pressed', Voice.wakeOn); $('#wakeBtn').textContent = 'HEY JARVIS · ' + (Voice.wakeOn ? 'ON' : 'OFF'); }
function toggleWake() { const on = Voice.setWake(!Voice.wakeOn); LS.set('jarvis.v1.wake', on); syncVoiceUI(); toast(on ? 'Listening for “Hey Jarvis” while this window is open' : 'Wake mode off'); }
const STATE_LBL = { idle: 'Ready', wake: 'Listening for “Hey Jarvis”', ptt: 'Listening…', speaking: 'Speaking' };
Voice.on({
  state: m => { refreshPerm(); $('#orbState').textContent = STATE_LBL[m] || m; $$('[data-mic]').forEach(b => b.classList.toggle('on', m === 'ptt')); $('#ptt').classList.toggle('on', m === 'ptt'); $('#ptt').textContent = m === 'ptt' ? '◉ LISTENING' : '◉ HOLD TO TALK'; },
  interim: t => { $('#heard').textContent = t ? '“' + t + '”' : ''; },
  wake: k => { $('#orbState').textContent = k === 'ask' ? 'Yes, Dickson?' : 'Heard you'; if (k === 'ask') Voice.speak('Yes?'); },
  command: (t) => { $('#heard').textContent = '“' + t + '”'; handle(t, 'voice'); },
  error: m => toast(m, true)
});
function bindPTT(el) {
  el.addEventListener('pointerdown', e => { e.preventDefault(); el.setPointerCapture?.(e.pointerId); Voice.startPTT(); });
  const up = () => Voice.endPTT();
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  el.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); Voice.startPTT(); } });
  el.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') Voice.endPTT(); });
}
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || document.activeElement?.closest?.('button');
  if (e.code === 'Space' && !typing && !e.repeat && !$('.modal')) { e.preventDefault(); Voice.startPTT(); }
  if (VIEW === 'brain' && e.key === '/' && !typing) { e.preventDefault(); $('#bpL').classList.add('open'); $('#gq').focus(); }
  if (e.key === 'Escape') { closeModal(); G.sel = -1; inspector(); }
});
document.addEventListener('keyup', e => { if (e.code === 'Space' && Voice.mode === 'ptt') Voice.endPTT(); });

/* ============ graph input ============ */
function bindGraph() {
  cv = $('#gcv'); ctx = cv.getContext('2d');
  new ResizeObserver(() => { if (!$('#brain').hidden) resize(); }).observe(cv);
  const pts = new Map(); let pinch0 = 0, zoom0 = 1;
  cv.addEventListener('pointerdown', e => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); cv.setPointerCapture(e.pointerId); if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = G.zoom; } else { G.drag = { x: e.clientX, y: e.clientY, moved: 0 }; cv.classList.add('dragging'); } });
  cv.addEventListener('pointermove', e => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (pts.size === 2) { const [a, b] = [...pts.values()]; G.zoom = Math.min(3, Math.max(.4, zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / pinch0)); return; } if (!G.drag) return; const dx = e.clientX - G.drag.x, dy = e.clientY - G.drag.y; G.drag.x = e.clientX; G.drag.y = e.clientY; G.drag.moved += Math.abs(dx) + Math.abs(dy); if (G.mode3d) { G.ry += dx * .007; G.rx += dy * .007; } });
  cv.addEventListener('pointerup', e => { const tap = G.drag && pts.size === 1 && G.drag.moved < 6; pts.delete(e.pointerId); cv.classList.remove('dragging'); if (tap) { const r = cv.getBoundingClientRect(), i = pickAt(e.clientX - r.left, e.clientY - r.top); selectNode(i === G.sel ? -1 : i); } G.drag = null; });
  cv.addEventListener('pointercancel', e => { pts.delete(e.pointerId); G.drag = null; });
  cv.addEventListener('wheel', e => { e.preventDefault(); G.zoom = Math.min(3, Math.max(.4, G.zoom * (e.deltaY > 0 ? .92 : 1.08))); }, { passive: false });
}

/* ============ start ============ */
function welcome() {
  if (LS.get('jarvis.v1.welcomed', false) || Drive.isConnected()) return;
  const md = modal(`<div class="welcome"><h2>Jarvis is online</h2><p class="dim" style="margin:0">Two quick steps on this device:</p><ol><li><b style="color:var(--fg)">Connect Google Drive</b> so everything is saved in your Drive and shows up on your other devices.</li><li><b style="color:var(--fg)">Test the voice</b>, then hold the mic (or Space) and say “morning brief”.</li></ol><div class="btns"><button class="btn go" id="wConn">Connect Google Drive</button><button class="btn" id="wVoice">Test voice</button><button class="btn" data-close>Later</button></div></div>`);
  LS.set('jarvis.v1.welcomed', true);
  md.querySelector('#wConn').onclick = () => { closeModal(); connectDrive(); };
  md.querySelector('#wVoice').onclick = () => Voice.speak(`${greeting()}, Dickson. Jarvis online.`, { force: true });
}
(function start() {
  Voice.configure(LS.get(VKEY, {}));
  if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (VIEW === 'settings') render(); };
  bindGraph(); graphRefresh(); setTimeout(fit, 1300);
  [$('#ptt'), ...$$('[data-mic]')].forEach(bindPTT);
  syncVoiceUI(); orbLoop(); route(); save({ sync: false });
  if (Drive.token()) syncNow(); else if (Drive.isConnected()) setSync('needs');
  refreshPerm();
  if (Voice.inClaudeApp) setTimeout(() => toast('Voice input needs Chrome or Edge. The Claude app\'s browser blocks the microphone.', true), 1500);
  if (LS.get('jarvis.v1.wake', false) && Voice.supported.listen) toast('Tap “Hey Jarvis” to start listening again');
  setTimeout(welcome, 600);
})();
