'use strict';
// "Ask Claude" fallback for screens the bot's own rules cannot read. The bot runs the `claude` command in print mode with the
// Haiku model and a screenshot, and gets back where the close/skip control is (or "none"). No API key is needed, only a logged-in
// `claude` command (`claude auth login`). Everything here is pure or injectable so it can be tested without calling anything:
// ad-bot.js decides WHEN to ask and checks every answer before tapping it.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { writePng } = require('./png');

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MODEL = process.env.AD_BOT_AI_MODEL || 'haiku';
const WORK_DIR = path.join(os.tmpdir(), 'asphalt-ad-bot-ai');

// The model describes what it sees BEFORE it decides. Measured on saved stuck screens: 20/20 correct with this, against roughly 8 in 10
// when it had to answer straight away (it sometimes said "none" for an X that was plainly there).
const ANSWER = { action: { type: 'string', enum: ['tap', 'none'] }, x: { type: 'integer' }, y: { type: 'integer' }, label: { type: 'string' } };
const CORNER_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    left_corner: { type: 'string', description: 'what is in the top-left crop, including any small or faint icons' },
    right_corner: { type: 'string', description: 'what is in the top-right crop, including any small or faint icons' },
    ...ANSWER,
  },
  required: ['left_corner', 'right_corner', 'action'],
});
const DIALOG_SCHEMA = JSON.stringify({
  type: 'object',
  properties: { what_i_see: { type: 'string', description: 'the message box (if any), its text and every button on it' }, ...ANSWER },
  required: ['what_i_see', 'action'],
});

// ---- what may be tapped ---------------------------------------------------------------------------------------------------------
// The model's label is checked against these before anything is tapped. Close/skip controls pass; anything that opens a store, a
// website, buys something or is not a close control does not.
const CLOSE_LABEL = /(\bclose\b|\bskip\b|\bdismiss\b|\bx\b|\bcross\b|\bexit\b|>>|»|⏭|\bfast.?forward\b|\bno thanks\b)/i;
const NEVER_LABEL = /(install|download|learn more|buy|purchase|shop|get\b|open\b|play now|play ad|play\b|visit|subscribe|sign.?up|mute|volume|sound|privacy|\binfo\b|\(i\)|\bupdate\b|\$|free)/i;
const DIALOG_LABEL = /^\W*(ok|okay|close|continue|got it|dismiss|retry|try again)\W*$/i;

function labelAllowed(label, mode = 'close') {
  const l = String(label || '').trim();
  if (!l) return false;
  if (mode === 'dialog') return DIALOG_LABEL.test(l);
  return CLOSE_LABEL.test(l) && !NEVER_LABEL.test(l.replace(/\bskip\b/i, ''));   // "Skip" may be in labels like "Skip ad"
}

// ---- images --------------------------------------------------------------------------------------------------------------------
const CROP_W = 640, CROP_H = 400, GAP = 10;

// The two top corners at FULL resolution, side by side (a shrunken whole screen made tiny buttons unreadable and Haiku answered
// "none"). Dark crops (some ironSource ads dim the screen to near black) are brightened so the controls are visible.
function buildCornerImage(img) {
  const cw = Math.min(CROP_W, Math.floor(img.w / 2)), ch = Math.min(CROP_H, img.h), W = cw * 2 + GAP;
  const data = Buffer.alloc(W * ch * 4, 128);
  const hist = new Uint32Array(256);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      for (const [sx, ox] of [[0, 0], [img.w - cw, cw + GAP]]) {
        const i = (y * img.w + sx + x) * 4, j = (y * W + ox + x) * 4;
        data[j] = img.data[i]; data[j + 1] = img.data[i + 1]; data[j + 2] = img.data[i + 2]; data[j + 3] = 255;
        hist[Math.max(img.data[i], img.data[i + 1], img.data[i + 2])]++;
      }
    }
  }
  let total = 0; hist.forEach((v) => { total += v; });
  let acc = 0, p99 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * 0.99) { p99 = v; break; } }
  let gain = 1;
  if (p99 < 110) {
    gain = Math.min(12, 220 / Math.max(p99, 10));
    for (let y = 0; y < ch; y++) for (let x = 0; x < W; x++) { const j = (y * W + x) * 4; for (let c = 0; c < 3; c++) data[j + c] = Math.min(255, data[j + c] * gain); }
  }
  for (let y = 0; y < ch; y++) for (let x = cw; x < cw + GAP; x++) data.set([255, 0, 255, 255], (y * W + x) * 4);   // magenta divider
  return { w: W, h: ch, data, gain, panels: { cw, ch, gap: GAP, srcRightX0: img.w - cw } };
}

// the whole screen at half size, for dialogs (they are big, so nothing is lost)
function buildScreenImage(img, k = 2) {
  const w = Math.floor(img.w / k), h = Math.floor(img.h / k), data = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) { const i = ((y * k + dy) * img.w + x * k + dx) * 4; r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; }
      const j = (y * w + x) * 4, n = k * k;
      data[j] = r / n; data[j + 1] = g / n; data[j + 2] = b / n; data[j + 3] = 255;
    }
  }
  return { w, h, data, scale: k };
}

// a point in the composite image -> a point on the real screen (null if it is on the divider or outside)
function mapCornerPoint(x, y, panels) {
  const { cw, ch, gap, srcRightX0 } = panels;
  if (!(y >= 0 && y < ch)) return null;
  if (x >= 0 && x < cw) return { x, y };
  if (x >= cw + gap && x < 2 * cw + gap) return { x: srcRightX0 + (x - cw - gap), y };
  return null;
}

// ---- prompts ---------------------------------------------------------------------------------------------------------------------
function cornerPrompt(panels) {
  const { cw, ch, gap } = panels;
  return `The image is made of two crops side by side, separated by a magenta stripe. The LEFT crop (x 0-${cw - 1}) is the top-left corner of a phone-sized screen showing a full-screen video ad inside a mobile game, and the RIGHT crop (x ${cw + gap}-${2 * cw + gap - 1}) is its top-right corner. Both are ${ch} pixels tall.
Find the control a viewer would press to close the ad or skip it: an X or cross, a skip arrow (>> or a play-skip glyph) or the word Skip. It may be small or faint. NEVER choose install, download, learn more, buy, open, play-now, mute, info (i), or any button that opens a store or website. If you see no such control, say none.
Give the control's centre as x,y pixel coordinates in THIS image (x counts from the left edge of the whole image, y from the top).
First describe what is in each corner (small icons count: a circle with an X, a skip arrow, a faint glyph). Most video ads show a close or skip control in one of the two corners at some point; only answer none if both corners really contain nothing of that kind.`;
}

function dialogPrompt(w, h) {
  return `This is a screenshot (${w}x${h} pixels) of a mobile racing game that appears to be stuck on a message after restarting. Is there a message box with exactly ONE button that only acknowledges it (OK, Close, Continue, Got it)? If there is more than one choice (Yes/No, Cancel/Confirm, Buy, Update, Install, Replay, Check it...), or the message asks the player a question, or it is just a loading screen, or there is no message box, answer none. Never choose a button that buys, installs, updates or opens something. Give the button's centre as x,y pixel coordinates in THIS image and its label. First describe the message box and every button on it.`;
}

// ---- calling the claude command ----------------------------------------------------------------------------------------------------
function defaultRun(args, opts) {
  return spawnSync(CLAUDE_BIN, args, { encoding: 'utf8', timeout: 100000, windowsHide: true, maxBuffer: 16 * 1024 * 1024, ...opts });
}

// Returns { action, x, y, label, costUsd, seconds }. Throws on any failure, with a message that says what to fix.
let runner = defaultRun;                       // tests replace this with a fake `claude`
function setRunner(fn) { runner = fn || defaultRun; }

// The screenshot goes INSIDE the message (a base64 image block), not as a file the model is asked to open: no tools are needed and
// there is one round trip fewer. Returns { action, x, y, label, costUsd, seconds, ...description fields }. Throws on any failure,
// with a message that says what to fix.
function ask(image, prompt, schema, run = runner) {
  const message = { type: 'user', message: { role: 'user', content: [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: writePng(image).toString('base64') } },
    { type: 'text', text: prompt },
  ] } };
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', MODEL, '--tools', '',
    '--safe-mode', '--no-session-persistence', '--json-schema', schema];
  const started = Date.now();
  fs.mkdirSync(WORK_DIR, { recursive: true });
  // cwd is a temp folder, not the repo: a repo's own instructions would be loaded into every question.
  const r = run(args, { cwd: WORK_DIR, input: JSON.stringify(message) + '\n' });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'the `claude` command was not found (install Claude Code, or set CLAUDE_BIN)' : `claude failed: ${r.error.message}`);
  let out = null;
  for (const line of String(r.stdout || '').split(/\r?\n/)) { if (!line.trim()) continue; try { const ev = JSON.parse(line); if (ev.type === 'result') out = ev; } catch (_) { /* not an event line */ } }
  if (!out) throw new Error(`claude gave no result (unreadable output): ${String(r.stdout || r.stderr).slice(0, 160)}`);
  if (out.is_error) throw new Error(`claude error: ${String(out.result).slice(0, 160)}${/auth|login|expired/i.test(out.result) ? ' (run: claude auth login)' : ''}`);
  let a = out.structured_output;
  if (!a && typeof out.result === 'string') { try { a = JSON.parse(out.result); } catch (_) { /* fall through */ } }
  if (!a || (a.action !== 'tap' && a.action !== 'none')) throw new Error(`claude answered something unexpected: ${String(out.result).slice(0, 120)}`);
  return { ...a, costUsd: out.total_cost_usd || 0, seconds: (Date.now() - started) / 1000 };
}

// Where is the close/skip control, in REAL screen pixels? Returns null for "none" (or an answer that does not map onto the screen).
function askCorners(img, run) {
  const crop = buildCornerImage(img);
  const a = ask(crop, cornerPrompt(crop.panels), CORNER_SCHEMA, run);
  const meta = { costUsd: a.costUsd, seconds: a.seconds, label: a.label || '', gain: crop.gain, seen: { left: a.left_corner, right: a.right_corner } };
  if (a.action !== 'tap' || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return { none: true, ...meta };
  const p = mapCornerPoint(a.x, a.y, crop.panels);
  return p ? { x: p.x, y: p.y, ...meta } : { none: true, outside: true, ...meta };
}

function askDialog(img, run) {
  const small = buildScreenImage(img, 2);
  const a = ask(small, dialogPrompt(small.w, small.h), DIALOG_SCHEMA, run);
  const meta = { costUsd: a.costUsd, seconds: a.seconds, label: a.label || '', seen: a.what_i_see };
  if (a.action !== 'tap' || !Number.isFinite(a.x) || !Number.isFinite(a.y)) return { none: true, ...meta };
  if (a.x < 0 || a.y < 0 || a.x >= small.w || a.y >= small.h) return { none: true, outside: true, ...meta };
  return { x: Math.round(a.x * small.scale), y: Math.round(a.y * small.scale), ...meta };
}

// ---- spending guard ----------------------------------------------------------------------------------------------------------------
const USAGE_FILE = process.env.AD_BOT_AI_USAGE_FILE || path.join(__dirname, 'ai-usage.json');
function today() { return new Date().toISOString().slice(0, 10); }
function readUsage() {
  try { const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (u.date === today()) return u; } catch (_) { /* first call of the day */ }
  return { date: today(), calls: 0, costUsd: 0 };
}
function recordUsage(costUsd) {
  const u = readUsage(); u.calls++; u.costUsd = +(u.costUsd + (costUsd || 0)).toFixed(4);
  try { fs.writeFileSync(USAGE_FILE, JSON.stringify(u)); } catch (_) { /* the guard is best effort */ }
  return u;
}

module.exports = { setRunner, askCorners, askDialog, ask, buildCornerImage, buildScreenImage, mapCornerPoint, labelAllowed, cornerPrompt, dialogPrompt, readUsage, recordUsage, CLOSE_LABEL, NEVER_LABEL };
