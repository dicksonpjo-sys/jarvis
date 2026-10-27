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
  const cfg = Object.assign({ apiKey: '', model: 'claude-haiku-5-5', budgetUSD: 5, usdToInr: 84, rates: RATES }, ls.get(KEY, {}));
  cfg.rates = { ...RATES, ...(cfg.rates || {}) };
  function save(c) { Object.assign(cfg, c); ls.set(KEY, cfg); }
  const ready = () => !!cfg.apiKey;
  const modelName = id => (MODELS.find(m => m.id === id) || { name: id }).name;
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
  async function ask(text, { context, tools, runTool, usage }) {
    if (!ready()) throw Object.assign(new Error('Add your Claude API key in Settings → AI brain first.'), { code: 'NOKEY' });
    const m = month(); usage[m] = usage[m] || { in: 0, out: 0, usd: 0, calls: 0 };
    if (usage[m].usd >= cfg.budgetUSD) throw Object.assign(new Error(`This month's AI budget of $${cfg.budgetUSD} is used up. Raise it in Settings to keep talking to Claude.`), { code: 'BUDGET' });
    const system = `You are Jarvis, the personal AI operating system of Dickson P Jo, a VFX producer and supervisor in Kochi who runs VishwaaFX (VFX studio) and the businesses Coorgified and Taarora.
Your replies are usually spoken aloud, so: answer in one to four short sentences, plain words, no markdown, no lists unless asked, no emoji. Use Indian rupees for money. Be direct and warm, like a capable chief of staff.
You can save ideas, queue tasks and open pages with your tools. You can never approve anything: approvals need Dickson's tap on screen. If something needs a tool you don't have, say so plainly and suggest saving it as an idea.
Current state of Jarvis:
${context}`;
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
    return { text: out || 'Done.', model: cfg.model, usd, inTok: totalIn, outTok: totalOut };
  }
  async function test() {
    const r = await call({ model: cfg.model, max_tokens: 20, messages: [{ role: 'user', content: 'Reply with exactly: Jarvis brain online.' }] });
    return (r.content || []).map(b => b.text || '').join('').trim();
  }
  function forget() { history = []; }

  return { MODELS, RATES, cfg, save, ready, ask, test, forget, modelName, month, cost };
})();
