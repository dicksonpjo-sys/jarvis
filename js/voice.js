/* Jarvis — voice in and out, using the browser's built-in speech engines (free).
   Listening: Web Speech API (Chrome / Edge on PC and Android; Safari on iPhone is partial).
              In Chrome the audio is sent to Google's speech service to be turned into text.
   Speaking:  speechSynthesis with the voices installed on the device.
   Modes:     hold-to-talk (button or Space bar) and wake mode ("Hey Jarvis, …") while the app is open. */
'use strict';

const Voice = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const WAKE = /\b(?:hey|hi|ok|okay)?\s*j[ae]rv[ie]s\b[\s,.:!-]*/i;
  const supported = { listen: !!SR, speak: !!synth };
  const cfg = { lang: 'en-IN', voiceURI: '', rate: 1, pitch: 0.95, speak: true };
  const h = { state: () => {}, interim: () => {}, command: () => {}, error: () => {}, wake: () => {} };

  let rec = null, mode = 'idle', wakeOn = false, awaitingCmd = 0, restartTimer = null, speaking = false;
  let level = 0, audio = null;

  function on(handlers) { Object.assign(h, handlers); }
  function configure(c) { Object.assign(cfg, c || {}); }
  function setMode(m) { mode = m; h.state(m); }

  /* ---------- speaking ---------- */
  function voices() { return synth ? synth.getVoices().filter(v => /^en|^ml|^hi/i.test(v.lang)) : []; }
  function pickVoice() {
    const all = voices();
    if (cfg.voiceURI) { const v = all.find(v => v.voiceURI === cfg.voiceURI); if (v) return v; }
    return all.find(v => /Google UK English Male/i.test(v.name))
      || all.find(v => /en-GB/i.test(v.lang) && /male|daniel|george|ryan|arthur/i.test(v.name))
      || all.find(v => /en-IN/i.test(v.lang))
      || all.find(v => /en-GB/i.test(v.lang))
      || all.find(v => /^en/i.test(v.lang)) || null;
  }
  function plain(html) { const d = document.createElement('div'); d.innerHTML = html; return (d.textContent || '').replace(/\s+/g, ' ').replace(/₹/g, 'rupees ').trim(); }
  function speak(text, { force = false } = {}) {
    return new Promise(resolve => {
      if (!synth || (!cfg.speak && !force) || !text) return resolve();
      synth.cancel();
      const u = new SpeechSynthesisUtterance(plain(text));
      const v = pickVoice(); if (v) { u.voice = v; u.lang = v.lang; }
      u.rate = cfg.rate; u.pitch = cfg.pitch;
      const done = () => { speaking = false; if (mode === 'speaking') setMode(wakeOn ? 'wake' : 'idle'); if (wakeOn) startWake(); resolve(); };
      u.onend = done; u.onerror = done;
      speaking = true; setMode('speaking');
      stopRec(); // don't let Jarvis hear itself
      synth.speak(u);
      // Chrome can stall long utterances; nudge it.
      const keep = setInterval(() => { if (!speaking) return clearInterval(keep); if (synth.paused) synth.resume(); }, 5000);
    });
  }
  function stopSpeaking() { if (synth) synth.cancel(); speaking = false; }

  /* ---------- listening ---------- */
  function build(continuous) {
    const r = new SR();
    r.lang = cfg.lang; r.continuous = continuous; r.interimResults = true; r.maxAlternatives = 1;
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { wakeOn = false; h.error('Microphone blocked. Allow the microphone for this site in the browser\'s address bar, then try again.'); }
      else if (e.error === 'network') h.error('Speech recognition needs an internet connection.');
      else if (e.error === 'audio-capture') h.error('No microphone found.');
      else h.error('Voice error: ' + e.error);
    };
    return r;
  }
  function stopRec() { clearTimeout(restartTimer); if (rec) { const r = rec; rec = null; r.onend = null; try { r.abort(); } catch {} } meter(false); }

  /* Hold-to-talk: listen until released, then send what was heard. */
  let pttText = '', pttFinal = '';
  function startPTT() {
    if (!SR) { h.error('This browser can\'t listen. Use Chrome or Edge on PC or Android.'); return; }
    stopSpeaking(); stopRec();
    pttText = ''; pttFinal = '';
    rec = build(true);
    rec.onresult = e => {
      let interim = '', fin = '';
      for (let i = 0; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else interim += t; }
      pttFinal = fin; pttText = (fin + ' ' + interim).trim(); h.interim(pttText);
    };
    rec.onend = () => { if (mode === 'ptt') finishPTT(); };
    try { rec.start(); setMode('ptt'); meter(true); } catch (e) { h.error('Couldn\'t start the microphone: ' + e.message); }
  }
  function endPTT() {
    if (mode !== 'ptt') return;
    // Give the engine a moment to finalise the last words.
    setTimeout(() => { if (rec) try { rec.stop(); } catch {} }, 350);
  }
  function finishPTT() {
    const text = (pttFinal || pttText).replace(WAKE, '').trim();
    stopRec(); setMode(wakeOn ? 'wake' : 'idle');
    if (text) h.command(text, 'voice'); else h.interim('');
    if (wakeOn && !speaking) startWake();
  }

  /* Wake mode: listen continuously while the app is open; act on "Jarvis, …". */
  function setWake(onOff) {
    wakeOn = !!onOff;
    if (wakeOn) { if (!SR) { wakeOn = false; h.error('This browser can\'t listen. Use Chrome or Edge.'); return false; } startWake(); }
    else { stopRec(); awaitingCmd = 0; if (mode === 'wake') setMode('idle'); }
    return wakeOn;
  }
  function startWake() {
    if (!wakeOn || speaking || mode === 'ptt') return;
    stopRec();
    rec = build(true);
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        const fin = e.results[i].isFinal;
        const m = t.match(WAKE);
        if (m) {
          const after = t.slice(m.index + m[0].length).trim();
          h.wake(true); h.interim(after || '…');
          if (fin) { if (after) { awaitingCmd = 0; h.command(after, 'voice'); } else { awaitingCmd = Date.now(); h.wake('ask'); } }
        } else if (awaitingCmd && Date.now() - awaitingCmd < 9000) {
          h.interim(t);
          if (fin && t) { awaitingCmd = 0; h.command(t, 'voice'); }
        }
      }
    };
    rec.onend = () => { if (wakeOn && !speaking && mode !== 'ptt') restartTimer = setTimeout(startWake, 300); };
    try { rec.start(); setMode('wake'); } catch { restartTimer = setTimeout(startWake, 800); }
  }
  /* Browsers stop listening in background tabs; resume when the tab is visible again. */
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && wakeOn && !rec) startWake(); });

  /* Microphone level for the orb (optional; ignored if not allowed). */
  async function meter(onOff) {
    if (!onOff) { if (audio) { audio.stream.getTracks().forEach(t => t.stop()); audio.ctx.close().catch(() => {}); audio = null; } level = 0; return; }
    if (audio || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (mode !== 'ptt') { stream.getTracks().forEach(t => t.stop()); return; }
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 256; ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      audio = { stream, ctx };
      (function tick() { if (!audio) return; an.getByteFrequencyData(buf); let s = 0; for (const v of buf) s += v; level = s / buf.length / 128; requestAnimationFrame(tick); })();
    } catch { /* level meter is optional */ }
  }

  return { supported, on, configure, speak, stopSpeaking, startPTT, endPTT, setWake, voices, pickVoice,
    get mode() { return mode; }, get level() { return level; }, get wakeOn() { return wakeOn; }, cfg };
})();
