# Jarvis v1.0.0

Dickson's personal AI operating system. A web app you install on PC and phone; everything it knows is saved in your Google Drive.

**Live address (once published):** https://dicksonpjo-sys.github.io/jarvis/

## What v1 does
- **Brain** home screen: a live 3D graph of you, your businesses, plugged-in modules and their tools, your ideas and anything waiting for approval.
- **Ideas**: capture ideas, shape them, queue them for Jarvis. Queued ideas create a plan approval.
- **Businesses**: VishwaaFX, Coorgified, Taarora. Each takes a dashboard module through `business.json` (contract `jarvis.business-module/1`).
- **Approvals** with an activity log. Approvals need a tap; Jarvis never takes them by voice.
- **Build** tracker; v1 items tick themselves when they work on the device.
- **Voice**
  - Hold the mic button (or hold Space on a PC) and speak.
  - Turn on **Hey Jarvis** to have it listen while the app is open: "Hey Jarvis, morning brief".
  - Jarvis answers aloud. Choose the voice, speed and pitch in Settings.
  - Works in Chrome and Edge on PC and Android. iPhone can type and hear replies.
- **Google Drive**: My Drive / Jarvis / `jarvis_data.json`, plus a daily copy in Jarvis / Backups / month. Every device that signs in sees the same data.

## Things to say
`morning brief` · `idea: …` · `queue: …` · `what needs approval` · `open VishwaaFX` · `search payroll` · `what time is it` · `help` · `stop` · any command from a plugged-in module (e.g. `send quote`).

## How it is built
- Plain HTML/CSS/JS, no build step. Hosted free on GitHub Pages.
- Sign-in uses the **Quote Desk web** OAuth client (Google Cloud project `vishwaafx-quote-desk`) through a sign-in pop-up. Only the JavaScript origin `https://dicksonpjo-sys.github.io` is needed, and it is already authorised.
- Drive permission is `drive.file`: Jarvis only sees files it created.
- Voice uses the browser's own speech engines, so it costs nothing. In Chrome, speech is turned into text by Google's speech service.

## Not in v1 yet
- Free-form questions answered by Claude. This needs the monthly AI budget set first.
- Running module commands. Needs the PC runner.
- An offline wake word that works with the app closed. Needs the PC runner.

## Files
`index.html`, `css/app.css`, `js/config.js` (Client ID, version), `js/drive.js` (Drive storage), `js/voice.js` (speech in/out), `js/app.js` (Brain, pages, commands), `js/sample.js` (Studio Hub prototype module), `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.
