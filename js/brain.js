/* Jarvis — AI brain: the Claude API, called straight from this device.
   The API key is kept only in this browser (never in Drive, never in the code).
   Every call is counted against the monthly budget you set; Jarvis stops before going over it. */
'use strict';

const Brain = (() => {
  const URL = 'https://api.anthropic.com/v1/messages';
  const KEY = 'jarvis.v1.brain';
  const MODELS = [
    { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', note: 'Fastest and cheapest. Good for everyday voice.' },
    { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', note: 'Smarter, still quick. Good default for planning.' },
    { id: 'claude-opus-5-5', name: 'Claude Opus 5.5', note: 'Most capable for hard problems. Slower, costs more.' },
    { id: 'claude-fable-5-1', name: 'Claude Fable 5.1', note: 'Top tier. Use sparingly.' }
  ];
  /* Estimated USD per million tokens [input, output]. Edit in Settings to match your Anthropic Console. */
  const RATES = { 'claude-haiku-5-5': [1, 5], 'claude-sonnet-5-5': [2, 10], 'claude-opus-5-5': [4, 20], 'claude-fable-5-1': [5, 25] };
  const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} } };
  /* Free route: Hermes Agent running on this PC, using NVIDIA's free hosted models.
     NVIDIA's API refuses calls from web pages, so Jarvis talks to Hermes on localhost and Hermes talks to NVIDIA. */
  const HERMES_MODELS = [
    { id: '', name: 'Hermes\'s own setting', note: 'Uses whatever you picked with “hermes model”. Most reliable.' },
    { id: 'deepseek-ai/deepseek-v4-flash', name: 'DeepSeek V4 Flash (NVIDIA, free)', note: 'Quick replies, light on the free rate limit.' },
    { id: 'z-ai/glm-5.1', name: 'GLM 5.1 (NVIDIA, free)', note: 'Stronger reasoning; free tier often times out.' }
  ];
  const cfg = Object.assign({ provider: 'claude', apiKey: '', model: 'claude-haiku-5-5', budgetUSD: 5, usdToInr: 84, rates: RATES,
    hermesUrl: 'http://127.0.0.1:8642', hermesKey: '', hermesModel: '', hermesCustom: '', hermesProvider: 'nvidia', fallback: true }, ls.get(KEY, {}));
  cfg.rates = { ...RATES, ...(cfg.rates || {}) };
  function save(c) { Object.assign(cfg, c); ls.set(KEY, cfg); }
  const claudeReady = () => !!cfg.apiKey;
  const hermesReady = () => !!cfg.hermesKey;
  const ready = () => cfg.provider === 'hermes' ? hermesReady() : claudeReady();
  const hermesModelId = () => (cfg.hermesModel === 'custom' ? cfg.hermesCustom.trim() : cfg.hermesModel);
  const modelName = id => (MODELS.find(m => m.id === id) || HERMES_MODELS.find(m => m.id && m.id === id) || { name: id || 'Hermes' }).name;
  const currentName = () => cfg.provider === 'hermes' ? 'Hermes · ' + (hermesModelId() ? modelName(hermesModelId()) : 'its own model') : modelName(cfg.model);
  const month = () => new Date().toISOString().slice(0, 7);
  const cost = (model, inTok, outTok) => { const r = cfg.rates[model] || [5, 25]; return (inTok * r[0] + outTok * r[1]) / 1e6; };

  let history = []; // this session's conversation, so follow-ups make sense

  async function call(body) {
    let res;
    try {
      res = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
    } catch { throw new Error('Couldn\'t reach Claude. Check the internet connection.'); }
    if (!res.ok) {
      let msg = ''; try { msg = (await res.json()).error?.message || ''; } catch {}
      if (res.status === 401) throw new Error('The API key was rejected. Check it in Settings → AI brain.');
      if (res.status === 403) throw new Error('This API key isn\'t allowed to do that. ' + msg);
      if (res.status === 404) throw new Error(`The model "${body.model}" isn't available on this key. Pick another in Settings.`);
      if (res.status === 429) throw new Error('Claude is rate-limiting this key. Try again in a minute.');
      if (res.status === 529 || res.status >= 500) throw new Error('Claude is busy right now. Try again shortly.');
      throw new Error('Claude error ' + res.status + (msg ? ': ' + msg : ''));
    }
    return res.json();
  }

  /* ask(text, {context, tools, runTool, usage}) → {text, model, usd}
     usage: object kept in Jarvis data ({ 'YYYY-MM': {in, out, usd, calls} }) so the budget follows you across devices. */
  async function ask(text, opts) {
    const { usage } = opts; const m = month(); usage[m] = usage[m] || { in: 0, out: 0, usd: 0, calls: 0 };
    if (cfg.provider === 'hermes') {
      if (!hermesReady()) throw Object.assign(new Error('Set up Hermes in Settings → AI brain first.'), { code: 'NOKEY' });
      try {
        const r = await askHermes(text, { system: systemPrompt(opts.context), runTool: opts.runTool });
        Object.assign(usage[m], { in: usage[m].in + r.inTok, out: usage[m].out + r.outTok, calls: usage[m].calls + 1, free: (usage[m].free || 0) + 1 });
        return { ...r, model: hermesModelId() || 'hermes', provider: 'hermes', usd: 0 };
      } catch (e) {
        if (!(cfg.fallback && claudeReady())) throw e;
        const r = await askClaude(text, opts); r.note = 'Hermes failed (' + e.message.split('.')[0] + '), so Claude answered.'; return r;
      }
    }
    return askClaude(text, opts);
  }
  function systemPrompt(context) {
    return `You are Jarvis, the personal AI operating system of Dickson P Jo, a VFX producer and supervisor in Kochi who runs VishwaaFX (VFX studio) and the businesses Coorgified and Taarora.
Your replies are usually spoken aloud, so: answer in one to four short sentences, plain words, no markdown, no lists unless asked, no emoji. Use Indian rupees for money. Be direct and warm, like a capable chief of staff.
You can save ideas, queue tasks and open pages. You can never approve anything: approvals need Dickson's tap on screen. If something needs a tool you don't have, say so plainly and suggest saving it as an idea.
Current state of Jarvis:
${context}`;
  }
  async function askClaude(text, { context, tools, runTool, usage }) {
    if (!claudeReady()) throw Object.assign(new Error('Add your Claude API key in Settings → AI brain first.'), { code: 'NOKEY' });
    const m = month(); usage[m] = usage[m] || { in: 0, out: 0, usd: 0, calls: 0 };
    if (usage[m].usd >= cfg.budgetUSD) throw Object.assign(new Error(`This month's AI budget of $${cfg.budgetUSD} is used up. Raise it in Settings to keep talking to Claude.`), { code: 'BUDGET' });
    const system = systemPrompt(context);
    history.push({ role: 'user', content: text });
    history = history.slice(-16);
    while (history.length && history[0].role !== 'user') history.shift();
    let msgs = [...history], out = '', totalIn = 0, totalOut = 0;
    for (let round = 0; round < 4; round++) {
      const r = await call({ model: cfg.model, max_tokens: 700, system, tools, messages: msgs });
      totalIn += r.usage?.input_tokens || 0; totalOut += r.usage?.output_tokens || 0;
      const said = (r.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (said) out = said;
      const uses = (r.content || []).filter(b => b.type === 'tool_use');
      if (r.stop_reason !== 'tool_use' || !uses.length) { msgs.push({ role: 'assistant', content: r.content }); break; }
      msgs.push({ role: 'assistant', content: r.content });
      msgs.push({ role: 'user', content: uses.map(u => { let res; try { res = runTool(u.name, u.input || {}); } catch (e) { res = 'Error: ' + e.message; } return { type: 'tool_result', tool_use_id: u.id, content: String(res) }; }) });
    }
    history = msgs.slice(-16);
    while (history.length && history[0].role !== 'user') history.shift();
    const usd = cost(cfg.model, totalIn, totalOut);
    Object.assign(usage[m], { in: usage[m].in + totalIn, out: usage[m].out + totalOut, usd: usage[m].usd + usd, calls: usage[m].calls + 1 });
    return { text: out || 'Done.', model: cfg.model, provider: 'claude', usd, inTok: totalIn, outTok: totalOut };
  }
  async function test() {
    const r = await call({ model: cfg.model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with exactly: Jarvis brain online.' }] });
    return (r.content || []).map(b => b.text || '').join('').trim();
  }
  function forget() { history = []; hHistory = []; }

  /* ---------- Hermes (OpenAI-style API on this PC) ---------- */
  let hHistory = [];
  const ACTIONS = `
To act, add one line per action at the very end of your reply, exactly like:
ACTION: {"tool":"add_idea","text":"…","business":"vfx"}
Tools: add_idea (save an idea), queue_task (queue for Jarvis; creates an approval), open_page (field "page": brain, me, vfx, coorg, taar, modules, approvals, build, settings). business is one of vfx, coorg, taar, all, me.
Do not run terminal commands, browse, or change files on this PC unless Dickson clearly asks you to.`;
  async function hermesCall(messages, { timeout = 120000 } = {}) {
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), timeout);
    const body = { model: hermesModelId() || 'hermes-agent', messages, stream: false };
    if (hermesModelId() && cfg.hermesProvider) body.provider = cfg.hermesProvider;
    let res;
    try { res = await fetch(cfg.hermesUrl.replace(/\/+$/, '') + '/v1/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.hermesKey }, body: JSON.stringify(body) }); }
    catch (e) { clearTimeout(timer); if (e.name === 'AbortError') throw Object.assign(new Error('Hermes took too long. The free NVIDIA tier often times out; try again, or switch to DeepSeek V4 Flash.'), { code: 'HERMES' }); throw Object.assign(new Error('Can\'t reach Hermes on this PC. Is “hermes gateway” running, and did you allow Jarvis in the browser\'s local network prompt?'), { code: 'HERMES' }); }
    clearTimeout(timer);
    if (!res.ok) { let m = ''; try { m = (await res.json()).error?.message || ''; } catch {}
      if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Hermes rejected the key. It must match API_SERVER_KEY in your Hermes .env file.'), { code: 'HERMES' });
      if (res.status === 429) throw Object.assign(new Error('NVIDIA\'s free rate limit was hit. Wait a minute and ask again.'), { code: 'HERMES' });
      throw Object.assign(new Error('Hermes error ' + res.status + (m ? ': ' + m : '')), { code: 'HERMES' }); }
    return res.json();
  }
  async function askHermes(text, { system, runTool }) {
    hHistory.push({ role: 'user', content: text }); hHistory = hHistory.slice(-12);
    while (hHistory.length && hHistory[0].role !== 'user') hHistory.shift();
    const r = await hermesCall([{ role: 'system', content: system + ACTIONS }, ...hHistory]);
    let reply = (r.choices?.[0]?.message?.content || '').trim();
    const acts = [...reply.matchAll(/^\s*ACTION:\s*(\{.*\})\s*$/gm)];
    for (const a of acts) { try { const o = JSON.parse(a[1]); runTool(o.tool, o); } catch {} }
    reply = reply.replace(/^\s*ACTION:.*$/gm, '').trim();
    hHistory.push({ role: 'assistant', content: reply || 'Done.' });
    return { text: reply || 'Done.', inTok: r.usage?.prompt_tokens || 0, outTok: r.usage?.completion_tokens || 0 };
  }
  async function hermesTest() {
    const base = cfg.hermesUrl.replace(/\/+$/, '');
    try { const h = await fetch(base + '/health'); if (!h.ok) throw 0; } catch { throw new Error('Can\'t reach Hermes at ' + base + '. Start it with “hermes gateway”, and allow the browser\'s local network prompt.'); }
    let models = [];
    try { const m = await fetch(base + '/v1/models', { headers: { authorization: 'Bearer ' + cfg.hermesKey } }); if (m.status === 401 || m.status === 403) throw new Error('Hermes is running, but rejected the key. Check API_SERVER_KEY in the Hermes .env file.'); models = (await m.json()).data?.map(x => x.id) || []; }
    catch (e) { if (/key|rejected/.test(e.message)) throw e; throw new Error('Hermes answered, but blocked Jarvis. Add API_SERVER_CORS_ORIGINS=https://dicksonpjo-sys.github.io to the Hermes .env file and restart the gateway.'); }
    const r = await hermesCall([{ role: 'user', content: 'Reply with exactly: Jarvis brain online.' }], { timeout: 90000 });
    return { reply: (r.choices?.[0]?.message?.content || '').trim(), models };
  }
  function makeKey() { const a = new Uint8Array(24); crypto.getRandomValues(a); return 'jv-' + [...a].map(b => b.toString(16).padStart(2, '0')).join(''); }

  return { MODELS, HERMES_MODELS, RATES, cfg, save, ready, claudeReady, hermesReady, ask, test, hermesTest, makeKey, forget, modelName, currentName, hermesModelId, month, cost };
})();
