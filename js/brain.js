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
  /* Google Gemini: called straight from the browser with an AI Studio key. Free tier covers the Flash models. */
  const GEMINI_MODELS = [
    { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash', note: 'Free tier. Fast; good everyday brain.' },
    { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', note: 'Free tier. Newest Flash.' },
    { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite', note: 'Free tier. Lightest and quickest.' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (preview)', note: 'Paid only. Needs billing on your Google AI Studio project.' }
  ];
  const cfg = Object.assign({ provider: 'claude', geminiKey: '', geminiModel: 'gemini-3.6-flash', geminiList: [], apiKey: '', model: 'claude-haiku-5-5', budgetUSD: 5, usdToInr: 84, rates: RATES,
    hermesUrl: 'http://127.0.0.1:8642', hermesKey: '', hermesModel: '', hermesCustom: '', hermesProvider: 'nvidia', fallback: true }, ls.get(KEY, {}));
  cfg.rates = { ...RATES, ...(cfg.rates || {}) };
  function save(c) { Object.assign(cfg, c); ls.set(KEY, cfg); }
  const claudeReady = () => !!cfg.apiKey;
  const hermesReady = () => !!cfg.hermesKey;
  const geminiReady = () => !!cfg.geminiKey;
  const ready = () => cfg.provider === 'hermes' ? hermesReady() : cfg.provider === 'gemini' ? geminiReady() : claudeReady();
  const hermesModelId = () => (cfg.hermesModel === 'custom' ? cfg.hermesCustom.trim() : cfg.hermesModel);
  const modelName = id => (MODELS.find(m => m.id === id) || GEMINI_MODELS.find(m => m.id === id) || (cfg.geminiList || []).find(m => m.id === id) || HERMES_MODELS.find(m => m.id && m.id === id) || { name: id || 'Hermes' }).name;
  const currentName = () => cfg.provider === 'gemini' ? modelName(cfg.geminiModel) : cfg.provider === 'hermes' ? 'Hermes · ' + (hermesModelId() ? modelName(hermesModelId()) : 'its own model') : modelName(cfg.model);
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
    if (cfg.provider === 'gemini') {
      if (!geminiReady()) throw Object.assign(new Error('Add your Gemini API key in Settings → AI brain first.'), { code: 'NOKEY' });
      try {
        const r = await askGemini(text, { system: systemPrompt(opts.context), runTool: opts.runTool, tools: opts.tools });
        Object.assign(usage[m], { in: usage[m].in + r.inTok, out: usage[m].out + r.outTok, calls: usage[m].calls + 1, gemini: (usage[m].gemini || 0) + 1 });
        return { ...r, model: cfg.geminiModel, provider: 'gemini', usd: 0 };
      } catch (e) {
        if (!(cfg.fallback && claudeReady())) throw e;
        const r = await askClaude(text, opts); r.note = 'Gemini failed (' + e.message.split('.')[0] + '), so Claude answered.'; return r;
      }
    }
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
  function forget() { history = []; hHistory = []; gHistory = []; }

  /* ---------- Gemini ---------- */
  let gHistory = [];
  const GURL = 'https://generativelanguage.googleapis.com/v1beta';
  const toSchema = sc => { if (!sc || typeof sc !== 'object') return sc; const o = {}; for (const [k, v] of Object.entries(sc)) { if (k === 'type') o.type = String(v).toUpperCase(); else if (k === 'properties') o.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toSchema(pv)])); else if (k === 'items') o.items = toSchema(v); else o[k] = v; } return o; };
  async function gCall(path, body) {
    let res;
    try { res = await fetch(GURL + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.geminiKey }, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw new Error('Couldn\'t reach Gemini. Check the internet connection.'); }
    if (!res.ok) { let m = ''; try { m = (await res.json()).error?.message || ''; } catch {}
      if (res.status === 400 && /API key/i.test(m)) throw new Error('Google rejected the Gemini key. Check it in Settings → AI brain.');
      if (res.status === 403) throw new Error('This Gemini key isn\'t allowed to use that. ' + m);
      if (res.status === 404) throw new Error(`The model "${cfg.geminiModel}" isn't available on this key. Press “Load models” and pick another.`);
      if (res.status === 429) throw new Error('Gemini\'s free limit was hit. Wait a minute, or try a Flash-Lite model.');
      throw new Error('Gemini error ' + res.status + (m ? ': ' + m.slice(0, 160) : '')); }
    return res.json();
  }
  async function askGemini(text, { system, runTool, tools }) {
    gHistory.push({ role: 'user', parts: [{ text }] }); gHistory = gHistory.slice(-16);
    while (gHistory.length && (gHistory[0].role !== 'user' || gHistory[0].parts.some(p => p.functionResponse))) gHistory.shift();
    const decl = (tools || []).map(t => ({ name: t.name, description: t.description, parameters: toSchema(t.input_schema) }));
    let contents = [...gHistory], out = '', inTok = 0, outTok = 0;
    for (let round = 0; round < 4; round++) {
      const r = await gCall(`/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`, {
        systemInstruction: { parts: [{ text: system }] }, contents,
        tools: decl.length ? [{ functionDeclarations: decl }] : undefined,
        generationConfig: { maxOutputTokens: 800, temperature: 0.6 } });
      inTok += r.usageMetadata?.promptTokenCount || 0; outTok += r.usageMetadata?.candidatesTokenCount || 0;
      const c = r.candidates?.[0];
      if (!c?.content) { const why = c?.finishReason || r.promptFeedback?.blockReason || 'no answer'; throw new Error('Gemini gave no answer (' + why + ').'); }
      const parts = c.content.parts || [];
      const said = parts.filter(p => p.text && !p.thought).map(p => p.text).join(' ').trim();
      if (said) out = said;
      contents.push({ role: 'model', parts });
      const calls = parts.filter(p => p.functionCall);
      if (!calls.length) break;
      contents.push({ role: 'user', parts: calls.map(p => { let res; try { res = runTool(p.functionCall.name, p.functionCall.args || {}); } catch (e) { res = 'Error: ' + e.message; } return { functionResponse: { name: p.functionCall.name, response: { result: String(res) } } }; }) });
    }
    gHistory = contents.slice(-16);
    return { text: out || 'Done.', inTok, outTok };
  }
  async function geminiModels() {
    const r = await gCall('/models?pageSize=200');
    const list = (r.models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/embedding|image|tts|audio|live|vision/i.test(m.name))
      .map(m => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name.replace(/^models\//, '') }))
      .sort((a, b) => b.id.localeCompare(a.id, undefined, { numeric: true }));
    save({ geminiList: list });
    return list;
  }
  async function geminiTest() {
    const list = await geminiModels();
    if (list.length && !list.some(m => m.id === cfg.geminiModel)) throw new Error(`Connected, but "${cfg.geminiModel}" isn't on this key. Pick one from the list.`);
    const r = await gCall(`/models/${encodeURIComponent(cfg.geminiModel)}:generateContent`, { contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: Jarvis brain online.' }] }], generationConfig: { maxOutputTokens: 30 } });
    return { reply: (r.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim(), count: list.length };
  }

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

  return { MODELS, HERMES_MODELS, GEMINI_MODELS, geminiReady, geminiTest, geminiModels, RATES, cfg, save, ready, claudeReady, hermesReady, ask, test, hermesTest, makeKey, forget, modelName, currentName, hermesModelId, month, cost };
})();
