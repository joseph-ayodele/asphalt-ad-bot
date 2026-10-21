#!/usr/bin/env node
'use strict';
// Asphalt 8 ad bot for an Android emulator or a real Android tablet/phone. Runs over ADB, so the emulator window can
// be covered or on another monitor: screenshots come from `screencap`, taps go through `input tap`, and ad screens are
// read from the UI tree (`uiautomator dump`) where possible.
//
//   node ad-bot.js [--mode all|garage|coin|wrench|relay] [--loop [minutes]] [--max N] [--serial <id>]
//   node ad-bot.js --devices            list connected devices
//   node ad-bot.js --stop [--serial <id>]   stop a bot running in the background (all of them without --serial)
//   node ad-bot.js --probe              one detection pass on the live screen, no taps
//   node ad-bot.js --shot out.png       save the current screen
//   node ad-bot.js --test frame.png     run the screen detectors on a saved screenshot
//
// Flow: PLAY AD! -> ad plays -> dismiss store promo -> ad close X -> game promo popup X -> NEXT -> repeat.
// --loop: when no ads are left, wait (default 30 minutes) and check again instead of exiting.
// Plain Node, no npm packages.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readPng, writePng } = require('./png');

const GAME = 'com.gameloft.android.ANMP.GloftA8HM';
const TICK_MS = 1000;
const PLAY_COOLDOWN_MS = 8000;      // the garage stays visible a moment after PLAY AD!
const AD_OPEN_WAIT_MS = 15000;      // PLAY AD! tapped but no ad screen appeared: no ad filled
const AD_TIMEOUT_MS = 240000;       // ads run up to ~150s; past this, press BACK
const NO_FILL_BACKOFF_MS = 60000;
const IDLE_STOP_MS = 300000;        // nothing recognisable for this long -> out of ads or on the wrong screen
const POPUP_SCAN_EVERY_MS = 2000;
const QUIET_BEFORE_POPUP_SCAN_MS = 2500;
const POPUP_WINDOW_MS = 90000;      // promo popups show up in this stretch after an ad closes
const MAX_POPUP_BACKS = 4;
const RELAY_RECHECK_MS = 15 * 60000; // after "COME BACK LATER", look again this much later
const WAKE_AFTER_QUIET_MS = 5000;
const WAKE_EVERY_MS = 8000;

// ---------------------------------------------------------------- adb

function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const roots = [process.env.ANDROID_SDK_ROOT, process.env.ANDROID_HOME,
    path.join(os.homedir(), 'Library', 'Android', 'sdk'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')].filter(Boolean);
  for (const r of roots) {
    const p = path.join(r, 'platform-tools', exe);
    if (fs.existsSync(p)) return p;
  }
  return 'adb';
}

const ADB = process.env.ADB || findAdb();
let serial = null;

function adb(args, opts = {}) {
  const full = serial ? ['-s', serial, ...args] : args;
  const r = spawnSync(ADB, full, { maxBuffer: 64 * 1024 * 1024, timeout: opts.timeout || 30000 });
  if (r.error) {
    throw new Error(r.error.code === 'ENOENT'
      ? 'adb not found. Install Android platform-tools, or set the ADB environment variable to the adb executable.'
      : `adb failed: ${r.error.message}`);
  }
  return r.stdout;
}

// Connected devices: [{ id, kind: 'emulator' | 'device', model }]
function listDevices() {
  const r = spawnSync(ADB, ['devices', '-l'], { timeout: 15000 });
  if (r.error) throw new Error(r.error.code === 'ENOENT' ? 'adb not found. Install Android platform-tools, or set the ADB environment variable.' : r.error.message);
  return r.stdout.toString('utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device')
    .map((p) => ({ id: p[0], kind: p[0].startsWith('emulator-') ? 'emulator' : 'device', model: ((p.find((x) => x.startsWith('model:')) || '').slice(6)) }));
}

// With one device connected adb picks it by itself; with several the bot must be told which (--serial or ANDROID_SERIAL).
function pickDevice() {
  if (serial) return;
  const devices = listDevices();
  if (devices.length === 0) throw new Error('no Android device found. Start the emulator, or plug in the tablet with USB debugging on, then check `adb devices`.');
  if (devices.length > 1) {
    throw new Error(`more than one device connected:\n${devices.map((d) => `  ${d.id}  (${d.kind}${d.model ? `, ${d.model}` : ''})`).join('\n')}\nChoose one with --serial <id>.`);
  }
  serial = devices[0].id;
}

const sh = (cmd) => adb(['shell', cmd]).toString('utf8');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Raw framebuffer: 16-byte header (w, h, format, colorspace; 12 bytes on old Android) then RGBA.
function screencap() {
  let buf = adb(['exec-out', 'screencap']);
  // real devices now and then return nothing while the display is changing; one retry is enough
  if (buf.length < 16) { sleep(600); buf = adb(['exec-out', 'screencap']); }
  if (buf.length < 16) {
    adb(['shell', 'input', 'keyevent', '224']);   // KEYCODE_WAKEUP, in case the display went to sleep
    throw new Error('empty screencap (is the device connected and awake?)');
  }
  const w = buf.readUInt32LE(0), h = buf.readUInt32LE(4);
  const header = buf.length - w * h * 4;
  if (header !== 12 && header !== 16) throw new Error(`unexpected screencap size ${buf.length} for ${w}x${h}`);
  return { w, h, data: buf.subarray(header) };
}

function focus() {
  const m = sh('dumpsys window').match(/mCurrentFocus=Window\{[^}]*? (?:u\d+ )?([\w.]+)\/([\w.$]+)\}/);
  return m ? { pkg: m[1], act: m[2] } : null;
}

const tap = (x, y) => adb(['shell', 'input', 'tap', String(Math.round(x)), String(Math.round(y))]);
const back = () => adb(['shell', 'input', 'keyevent', '4']);
// force-stop first: relaunching a running game would just resume the stuck ad screen inside its task.
function launchGame(fresh = false) {
  if (fresh) adb(['shell', 'am', 'force-stop', GAME]);
  adb(['shell', 'monkey', '-p', GAME, '-c', 'android.intent.category.LAUNCHER', '1']);
}

// ---------------------------------------------------------------- pixels

const px = (img, x, y) => {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return [0, 0, 0];
  const i = (y * img.w + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const minCh = (c) => Math.min(c[0], c[1], c[2]);
const isWhite = (c) => minCh(c) > 230;
const isRed = (c) => c[0] > 235 && c[1] < 70 && c[2] < 70;
const isBuyGreen = (c) => c[1] > 150 && c[1] - c[0] > 60 && c[1] - c[2] > 60;

// Distance stepped from (x,y) while pixels stay pred-coloured; one stray step is tolerated (text, gradients).
function runLength(img, x, y, dx, dy, pred) {
  let len = 0, misses = 0;
  for (let i = 1; i < 4000; i++) {
    const sx = x + dx * i, sy = y + dy * i;
    if (sx >= img.w || sy >= img.h) break;
    if (pred(px(img, sx, sy))) { len = (dx || dy) * i; misses = 0; } else if (++misses > 1) break;
  }
  return len;
}

// First solid block of pred-coloured pixels at least minW x minH, scanning rows top-down.
function findBlock(img, x1, y1, x2, y2, pred, minW, minH, step = 4) {
  for (let y = y1; y < y2; y += step) {
    for (let x = x1; x < x2;) {
      if (pred(px(img, x, y))) {
        const bw = runLength(img, x, y + 6, step, 0, pred);
        const bh = runLength(img, x + 12, y, 0, step, pred);
        if (bw >= minW && bh >= minH) return { x, y, bw, bh, cx: x + (bw >> 1), cy: y + (bh >> 1) };
        x += Math.max(bw, step);
      } else x += step;
    }
  }
  return null;
}

// Reward / dialog confirm: a bounded white box with dark text in the middle, bottom right.
function findNext(img) {
  const { w, h } = img;
  const b = findBlock(img, Math.round(w * 0.55), Math.round(h * 0.60), w - 1, h - 1, isWhite, Math.round(w * 0.12), Math.round(h * 0.05));
  if (!b || isWhite(px(img, b.x - 12, b.cy)) || isWhite(px(img, b.x + b.bw + 12, b.cy))) return null;
  for (let y = b.cy - (b.bh >> 2); y <= b.cy + (b.bh >> 2); y += 3)
    for (let x = b.x + Math.floor(b.bw / 3); x < b.x + Math.floor(2 * b.bw / 3); x += 2)
      if (minCh(px(img, x, y)) < 120) return b;
  return null;
}

// Garage PLAY AD! buttons ("10,000" under the currency bar). Each carries a pure-red marker triangle; the plate to its
// right is gold for coins and purple for the wrench currency.
function findGaragePlayAds(img) {
  const { w, h } = img;
  const x0 = Math.round(w * 0.38), x1 = Math.round(w * 0.75), y0 = Math.round(h * 0.05), y1 = Math.round(h * 0.16);
  const hits = [];
  for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) if (isRed(px(img, x, y))) hits.push([x, y]);
  hits.sort((a, b) => a[0] - b[0]);
  const clusters = [];
  for (const [x, y] of hits) {
    const c = clusters[clusters.length - 1];
    if (c && x - c.maxX <= 30) { c.n++; c.maxX = x; c.minY = Math.min(c.minY, y); c.maxY = Math.max(c.maxY, y); c.sumX += x; c.sumY += y; }
    else clusters.push({ n: 1, minX: x, maxX: x, minY: y, maxY: y, sumX: x, sumY: y });
  }
  const out = [];
  for (const c of clusters) {
    if (c.n < 40 || c.maxX - c.minX > Math.round(w * 0.03)) continue;
    const cx = Math.round(c.sumX / c.n), cy = Math.round(c.sumY / c.n);
    const probe = px(img, cx + Math.round(w * 0.069), cy + Math.round(h * 0.042));
    const kind = probe[2] > probe[1] + 30 ? 'wrench' : probe[0] > 180 && probe[2] < probe[1] ? 'coin' : null;
    if (kind) out.push({ kind, x: cx + Math.round(w * 0.037), y: cy + Math.round(h * 0.039) });
  }
  return out;
}

// The green SHOP button in the garage's top bar is fully lit only when nothing (popup, dialog) is dimming the screen.
function shopButtonVisible(img) {
  let n = 0;
  for (let y = Math.round(img.h * 0.04); y < Math.round(img.h * 0.10); y += 3)
    for (let x = Math.round(img.w * 0.80); x < Math.round(img.w * 0.90); x += 3) if (isBuyGreen(px(img, x, y))) n++;
  return n > 20;
}

const isOrange = (c) => c[0] > 200 && c[1] > 110 && c[1] < 225 && c[2] < 90 && c[0] - c[1] > 25;

function countColour(img, x0, y0, x1, y1, pred) {
  let n = 0;
  for (let y = Math.round(img.h * y0); y < Math.round(img.h * y1); y += 2)
    for (let x = Math.round(img.w * x0); x < Math.round(img.w * x1); x += 2) if (pred(px(img, x, y))) n++;
  return n;
}

// The red TIME LEFT ribbon on the ad screens ("AD RELAY OFFERS", "AD REWARDS") is a long red bar: at least 20% of the
// screen width in one row. Nothing else seen so far (popup banners, RACING PASS) is wider than 9%. Its height differs
// per device, so every row from 10% to 65% down is checked.
function hasTimeLeftRibbon(img) {
  const need = Math.round(img.w * 0.2);
  for (let y = Math.round(img.h * 0.10); y < Math.round(img.h * 0.65); y += 3) {
    let run = 0;
    for (let x = 0; x < img.w; x += 2) {
      const c = px(img, x, y);
      if (c[0] > 170 && c[1] < 70 && c[2] < 70) { if (++run * 2 >= need) return true; } else run = 0;
    }
  }
  return false;
}

const isRelayScreen = hasTimeLeftRibbon;

// Main menu: the big orange PLAY button bottom right, with the SHOP button lit (no popup on top). The ad screens also
// have an orange button down there, so the ribbon rules them out.
const isMainMenu = (img) => shopButtonVisible(img) && !hasTimeLeftRibbon(img) && countColour(img, 0.78, 0.82, 0.99, 0.97, isOrange) > 2000;

// PLAY AD! on the relay screen sits in the bottom-right slot, orange. The slot is bounded so the main menu's PLAY
// button, Lucky Box and purchase buttons never match. Geometry carried over from the Windows bot.
function findRelayPlayAd(img) {
  const { w, h } = img;
  const b = findBlock(img, Math.round(w * 0.70), Math.round(h * 0.88), w - 1, h - 1, isOrange, Math.round(w * 0.17), Math.round(h * 0.06));
  return b && b.x <= Math.round(w * 0.80) && b.y <= Math.round(h * 0.93) ? b : null;
}

// The main menu's top-left column has tiles for the ad screens, each topped by a small green FREE tag: the first opens
// AD REWARDS, the second AD RELAY OFFERS. Their positions differ per device (the tablet has an extra tile), so they
// are found by their tags. The tag itself is green (a purchase colour for safeTap), so the tap goes just below it, on the
// icon.
function findFreeTiles(img) {
  const pts = [];
  for (let y = Math.round(img.h * 0.10); y < Math.round(img.h * 0.32); y++)
    for (let x = Math.round(img.w * 0.02); x < Math.round(img.w * 0.45); x++) {
      const c = px(img, x, y);
      if (c[1] > 150 && c[1] - c[0] > 40 && c[1] - c[2] > 90) pts.push([x, y]);
    }
  pts.sort((a, b) => a[0] - b[0]);
  const tags = [];
  for (const [x, y] of pts) {
    const t = tags[tags.length - 1];
    if (t && x - t.maxX <= img.w * 0.02) { t.maxX = x; t.minY = Math.min(t.minY, y); t.maxY = Math.max(t.maxY, y); t.n++; }
    else tags.push({ minX: x, maxX: x, minY: y, maxY: y, n: 1 });
  }
  return tags.filter((t) => t.n > 60).map((t) => {
    const w = t.maxX - t.minX;
    return { x: Math.round((t.minX + t.maxX) / 2), y: Math.round((t.minY + t.maxY) / 2 + w * 0.6) };
  });
}
const backArrow = (img) => ({ x: Math.round(img.w * 0.058), y: Math.round(img.h * 0.072) });

// The title screen after a (re)launch: "Press any key to continue" in white at the bottom centre, nothing else down there.
function isTitleScreen(img) {
  let n = 0;
  for (let y = Math.round(img.h * 0.92); y < Math.round(img.h * 0.99); y += 2)
    for (let x = Math.round(img.w * 0.40); x < Math.round(img.w * 0.60); x += 2) if (minCh(px(img, x, y)) > 225) n++;
  return n > 150;
}

// A popup is a large bright panel on a dimmed screen. A black or half-drawn screen (loading, ad hand-back) is not.
function popupPanelVisible(img) {
  let n = 0, total = 0;
  for (let y = Math.round(img.h * 0.2); y < Math.round(img.h * 0.8); y += 6)
    for (let x = Math.round(img.w * 0.25); x < Math.round(img.w * 0.75); x += 6) { total++; if (minCh(px(img, x, y)) > 110) n++; }
  return n / total >= 0.12;
}

// Close X by shape: two light diagonal strokes brighter than the pixels on the axes around them. Works on popups
// (any colour) and on ad corners (white on black). Region is pixel bounds.
function findXShape(img, x0, y0, x1, y1, minDiff = 22, minBright = 40, step = 3, tol = 0) {
  const hh = Math.max(4, Math.round(Math.min(img.w, img.h) * 0.034) >> 1);
  const diag = [], bg = [[hh, 0], [-hh, 0], [0, hh], [0, -hh], [hh * 5 >> 2, 0], [-hh * 5 >> 2, 0], [0, hh * 5 >> 2], [0, -hh * 5 >> 2]];
  for (const d of [hh >> 2, hh >> 1, 3 * hh >> 2, hh]) diag.push([d, d], [-d, -d], [d, -d], [-d, d]);
  // thin strokes (3 px) need the diagonal samples to tolerate a pixel of misalignment
  const strokeAt = (x, y) => {
    let m = 0;
    for (let dy = -tol; dy <= tol; dy++) for (let dx = -tol; dx <= tol; dx++) m = Math.max(m, minCh(px(img, x + dx, y + dy)));
    return m;
  };
  for (let y = Math.max(y0, hh); y < Math.min(y1, img.h - hh); y += step) {
    for (let x = Math.max(x0, hh); x < Math.min(x1, img.w - hh); x += step) {
      if (strokeAt(x, y) < minBright) continue;
      let bgMax = 0;
      for (const o of bg) bgMax = Math.max(bgMax, minCh(px(img, x + o[0], y + o[1])));
      let dMin = 255;
      for (const o of diag) dMin = Math.min(dMin, strokeAt(x + o[0], y + o[1]));
      if (dMin >= minBright && dMin - bgMax >= minDiff) return { x, y };
    }
  }
  return null;
}

// Game promo popups: the X sits in the top-right of a big panel.
const findPopupX = (img) => findXShape(img, Math.round(img.w * 0.45), 0, img.w, Math.round(img.h * 0.45));

// Ad screens: X in either top corner.
function findAdCornerX(img) {
  const s = Math.round(Math.min(img.w, img.h) * 0.16);
  return findXShape(img, img.w - s, 0, img.w, s, 40, 200, 1, 1) || findXShape(img, 0, 0, s, s, 40, 200, 1, 1);
}

// ---------------------------------------------------------------- ui tree

function uiNodes() {
  const xml = adb(['exec-out', 'uiautomator', 'dump', '/dev/tty'], { timeout: 20000 }).toString('utf8');
  const nodes = [];
  for (const m of xml.matchAll(/<node [^>]*>/g)) {
    const g = (k) => (m[0].match(new RegExp(` ${k}="([^"]*)"`)) || [])[1] || '';
    const b = g('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nodes.push({ cls: g('class').split('.').pop(), id: g('resource-id'), desc: g('content-desc'), text: g('text'),
      clickable: g('clickable') === 'true', x1, y1, x2, y2, cx: (x1 + x2) >> 1, cy: (y1 + y2) >> 1 });
  }
  return nodes;
}

const NEVER_TAP = /install|download|learn more|more info|open|get it|play now|shop|buy|visit|subscribe|sign up/i;

// Where to tap to move an ad screen along. Ordered by confidence.
function adDismissTarget(nodes) {
  // Networks label the same button differently: resource id (Fyber), content-desc (Meta, "Close Ad"), or visible text
  // (Unity playables, "Close").
  const close = nodes.find((n) => (/close|dismiss/i.test(`${n.id} ${n.desc}`) || /^(close|dismiss)\b/i.test(n.text)) &&
    !NEVER_TAP.test(n.text) && n.x2 > n.x1 && n.y2 > n.y1 && n.x2 - n.x1 < 400);
  if (close) return { why: `close button ${close.id || close.desc}`, x: close.cx, y: close.cy };
  // Store-promo end cards (Digital Turbine / Fyber) dismiss with a small unlabeled svg button in a corner.
  const svg = nodes.find((n) => n.clickable && n.cls === 'Button' && /^svg\+xml/.test(n.text) && n.x2 - n.x1 <= 120 && n.y2 - n.y1 <= 120);
  if (svg) return { why: 'store promo dismiss', x: svg.cx, y: svg.cy };
  return null;
}

// ---------------------------------------------------------------- bot

const args = (() => {
  const a = { mode: 'all', max: 0, loop: 0 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    if (v[i] === '--mode') a.mode = v[++i];
    else if (v[i] === '--loop') a.loop = /^\d+(\.\d+)?$/.test(v[i + 1] || '') ? Number(v[++i]) : 30;
    else if (v[i] === '--devices') a.devices = true;
    else if (v[i] === '--stop') a.stop = true;
    else if (v[i] === '--idle-minutes') a.idleMinutes = Number(v[++i]);   // how long with nothing to click counts as "out of ads"
    else if (v[i] === '--max') a.max = Number(v[++i]);
    else if (v[i] === '--serial') a.serial = v[++i];
    else if (v[i] === '--shot') a.shot = v[++i];
    else if (v[i] === '--test') a.test = v[++i];
    else if (v[i] === '--probe') a.probe = true;
    else if (v[i] === '--help') a.help = true;
  }
  return a;
})();

const LOG_FILE = path.join(__dirname, 'ad-bot.log');
function log(msg) {
  const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + '\n'); } catch (_) { /* a log reader must never stop the bot */ }
}

const st = {
  popupWindowUntil: 0, popupBacks: 0, popupSeen: 0, lastBack: 0, returnedAt: 0, lastTitleTap: 0,
  ads: 0, inAd: false, awaitingAd: false, kind: 'coin', adStart: 0, lastPlay: 0, lastAction: Date.now(), lastPopupScan: 0, backs: 0,
  noFillUntil: { coin: 0, wrench: 0, relay: 0 }, lastTarget: '', sameTarget: 0, foreign: 0,
  tileDoneUntil: [], tileIdx: 0, lastRelayNav: 0, lastHomeTap: 0, titleSeen: 0, lastWake: 0,
};

function describe(img) {
  const fmt = (b) => (b ? `${b.cx ?? b.x},${b.cy ?? b.y}` : 'no');
  const plays = findGaragePlayAds(img);
  return `screen ${img.w}x${img.h} | title ${isTitleScreen(img)} | SHOP lit ${shopButtonVisible(img)} | popup panel ${popupPanelVisible(img)} | NEXT ${fmt(findNext(img))} | garage PLAY AD: ${plays.length ? plays.map((p) => `${p.kind}@${p.x},${p.y}`).join(' ') : 'no'}` +
    ` | popupX ${fmt(findPopupX(img))} | adCornerX ${fmt(findAdCornerX(img))} | main menu ${isMainMenu(img)} | relay screen ${isRelayScreen(img)} | relay PLAY AD ${fmt(findRelayPlayAd(img))}`;
}

function safeTap(img, x, y, what) {
  if (isBuyGreen(px(img, Math.round(x), Math.round(y)))) { log(`refused ${what} at ${x},${y}: green (purchase) button`); return false; }
  log(`${what} at ${Math.round(x)},${Math.round(y)}`);
  tap(x, y);
  st.lastAction = Date.now();
  return true;
}

function wantsKind(kind) {
  return args.mode === 'garage' || args.mode === 'all' || args.mode === kind;
}

const relayEnabled = () => args.mode === 'relay' || args.mode === 'all';

// Out of ads: stop, or with --loop wait and look again (the garage buttons and ad tiles come back over time).
function idleStop(why) {
  if (!args.loop) { log(`${why} Stopping.`); process.exit(0); }
  log(`${why} Checking again in ${args.loop} min.`);
  sleep(args.loop * 60000);
  Object.assign(st, { lastAction: Date.now(), lastHomeTap: 0, lastRelayNav: 0, tileDoneUntil: [], noFillUntil: { coin: 0, wrench: 0, relay: 0 } });
  log('checking for ads again');
}

function gameStep() {
  const now = Date.now();
  if (st.inAd) {
    st.inAd = false;
    st.popupWindowUntil = now + POPUP_WINDOW_MS;
    st.returnedAt = now;
    st.popupBacks = 0;
    st.popupSeen = 0;
    log('back in the game');
  }
  const img = screencap();

  // The title screen stays until tapped; a transition frame with white text does not, so insist on two scans in a row.
  st.titleSeen = isTitleScreen(img) && !shopButtonVisible(img) ? st.titleSeen + 1 : 0;
  if (st.titleSeen >= 2 && now - st.lastTitleTap > 3000) {
    st.lastTitleTap = now;
    st.titleSeen = 0;
    safeTap(img, img.w / 2, img.h / 2, 'title screen: any key');
    sleep(3000);
    return;
  }

  const next = findNext(img);
  if (next) { safeTap(img, next.cx, next.cy, 'NEXT/OK'); sleep(1500); return; }

  const garageBtn = args.mode !== 'relay' && now - st.lastPlay > PLAY_COOLDOWN_MS
    ? findGaragePlayAds(img).find((p) => wantsKind(p.kind) && now > st.noFillUntil[p.kind]) : null;

  if (relayEnabled() && !garageBtn && now - st.lastPlay > PLAY_COOLDOWN_MS) {
    if (isRelayScreen(img)) {
      const play = findRelayPlayAd(img);
      if (play && now > st.noFillUntil.relay) {
        if (args.max && st.ads >= args.max) { log(`started ${st.ads} ads, stopping`); process.exit(0); }
        st.ads++;
        log(`PLAY AD! #${st.ads} (relay)`);
        tap(play.cx, play.cy);
        st.lastPlay = st.lastAction = Date.now();
        st.kind = 'relay';
        st.awaitingAd = true;
        return;
      }
      if (!play && now - st.lastAction > 4000) {
        log(`ad screen ${st.tileIdx + 1} has no ad ready (COME BACK LATER): leaving`);
        st.tileDoneUntil[st.tileIdx] = now + RELAY_RECHECK_MS;
        const b = backArrow(img);
        safeTap(img, b.x, b.y, 'back arrow');
        sleep(2500);
        return;
      }
    } else if (isMainMenu(img) && now - st.lastRelayNav > 20000) {
      // open the next ad tile that has not just reported "COME BACK LATER"
      const tiles = findFreeTiles(img);
      const idx = tiles.findIndex((_, i) => now > (st.tileDoneUntil[i] || 0));
      if (idx >= 0) {
        st.lastRelayNav = now;
        st.tileIdx = idx;
        safeTap(img, tiles[idx].x, tiles[idx].y, `opening ad tile ${idx + 1} of ${tiles.length}`);
        sleep(3000);
        return;
      }
      if (args.mode === 'relay') { idleStop('no ad tile has an ad ready.'); return; }
    } else if (shopButtonVisible(img) && now - st.lastAction > 15000 && now - st.lastHomeTap > 30000 && [0, 1].some((i) => now > (st.tileDoneUntil[i] || 0))) {
      // Parked in the garage (or another submenu) with nothing to play: the home icon leads to the main menu.
      st.lastHomeTap = now;
      safeTap(img, Math.round(img.w * 0.94), Math.round(img.h * 0.072), 'going to the main menu');
      sleep(3000);
      return;
    }
  }

  if (garageBtn) {
    if (args.max && st.ads >= args.max) { log(`started ${st.ads} ads, stopping`); process.exit(0); }
    st.ads++;
    log(`PLAY AD! #${st.ads} (${garageBtn.kind})`);
    tap(garageBtn.x, garageBtn.y);
    st.lastPlay = st.lastAction = Date.now();
    st.kind = garageBtn.kind;
    st.awaitingAd = true;
    return;
  }

  if (now - st.lastAction > QUIET_BEFORE_POPUP_SCAN_MS && now - st.lastPopupScan > POPUP_SCAN_EVERY_MS) {
    st.lastPopupScan = now;
    const p = findPopupX(img);
    if (p) { safeTap(img, p.x, p.y, 'popup X'); sleep(1500); return; }
    // Some popups draw a faint translucent X that no pixel test can tell from the artwork. BACK closes every popup
    // seen so far, but it also leaves menus, so only press it in the stretch right after an ad where popups appear.
    if (now < st.popupWindowUntil && st.popupBacks < MAX_POPUP_BACKS && now - st.lastBack > 3500 && now - st.returnedAt > 6000) {
      // BACK on the plain menu leaves the game, so insist on the same dimmed popup across scans before pressing it.
      if (!shopButtonVisible(img) && popupPanelVisible(img)) st.popupSeen++; else st.popupSeen = 0;
      if (st.popupSeen >= 2) {
        st.popupBacks++;
        st.popupSeen = 0;
        st.lastBack = now;
        log(`popup with no visible X: BACK (${st.popupBacks}/${MAX_POPUP_BACKS})`);
        back();
        st.lastAction = Date.now();
        sleep(1500);
        return;
      }
    }
  }

  // The menus hide their buttons after a few idle seconds; a tap on empty floor brings them back. It does not count as
  // activity, so a button that never returns (no ads left) still ends in the idle stop.
  if (!shopButtonVisible(img) && !popupPanelVisible(img) && now - st.lastAction > WAKE_AFTER_QUIET_MS && now - st.lastWake > WAKE_EVERY_MS) {
    st.lastWake = now;
    const x = Math.round(img.w * 0.78), y = Math.round(img.h * 0.69);
    log(`wake click at ${x},${y} (menu buttons hidden)`);
    tap(x, y);
    sleep(1200);
    return;
  }

  const idleMs = args.idleMinutes ? args.idleMinutes * 60000 : IDLE_STOP_MS;
  if (now - st.lastAction > idleMs) idleStop(`nothing to click for ${idleMs / 60000} min: out of ads or on the wrong screen.`);
}

function adStep(f) {
  const now = Date.now();
  st.lastAction = now;   // time spent in an ad is activity, not idleness
  if (!st.inAd) { st.inAd = true; st.awaitingAd = false; st.adStart = now; st.backs = 0; st.lastTarget = ''; st.sameTarget = 0; }
  log(`ad screen ${f.act.split('.').pop()} (${Math.round((now - st.adStart) / 1000)}s)`);

  if (now - st.adStart > AD_TIMEOUT_MS) {
    if (st.backs++ >= 3) { log('ad will not close: restarting the game'); launchGame(true); st.backs = 0; st.inAd = false; st.awaitingAd = false; sleep(25000); st.lastAction = Date.now(); }
    else { log('ad timeout: BACK'); back(); st.adStart = now - AD_TIMEOUT_MS + 30000; }
    return;
  }

  const nodes = uiNodes();
  let target = adDismissTarget(nodes);
  let img = null;
  if (!target && now - st.adStart > 8000) {
    img = screencap();
    const c = findAdCornerX(img);
    if (c) target = { why: 'X in ad corner', x: c.x, y: c.y };
  }
  if (!target) return;

  const key = `${target.why}@${target.x},${target.y}`;
  st.sameTarget = key === st.lastTarget ? st.sameTarget + 1 : 0;
  st.lastTarget = key;
  if (st.sameTarget >= 3) { log(`${target.why} did nothing 3 times: BACK`); back(); st.sameTarget = 0; return; }
  log(`${target.why} at ${target.x},${target.y}`);
  tap(target.x, target.y);
  st.lastAction = Date.now();
  sleep(1500);
}

function foreignStep(f) {
  // Backed out to the home screen (or a system UI): BACK would do nothing, so reopen the game.
  if (/launcher|systemui|home/i.test(f.pkg)) {
    log(`game is no longer in front (${f.pkg}): reopening it`);
    launchGame();
    sleep(12000);
    st.lastAction = Date.now();
    return;
  }
  log(`left the game (${f.pkg}): BACK`);
  if (st.foreign++ >= 3) { log('could not get back: relaunching the game'); launchGame(); st.foreign = 0; sleep(8000); return; }
  if (st.foreign > 3) st.foreign = 0;
  back();
  sleep(1500);
}

function tick() {
  const f = focus();
  if (!f) { sleep(1000); return; }
  if (f.pkg !== GAME) return foreignStep(f);
  st.foreign = 0;
  if (/MainActivity$/.test(f.act)) {
    if (st.awaitingAd) {
      if (Date.now() - st.lastPlay < AD_OPEN_WAIT_MS) return;   // the ad is still loading
      log(`no ad opened after ${st.kind} PLAY AD!, backing off ${NO_FILL_BACKOFF_MS / 1000}s`);
      st.noFillUntil[st.kind] = Date.now() + NO_FILL_BACKOFF_MS;
      st.awaitingAd = false;
    }
    return gameStep();
  }
  return adStep(f);
}

// One pid file per device, so `--stop` works the same on Windows and Mac and two devices can run side by side.
const pidFile = (id) => path.join(__dirname, `.ad-bot-${String(id).replace(/[^\w.-]/g, '_')}.pid`);

function claimPidFile() {
  const file = pidFile(serial);
  try {
    const old = Number(fs.readFileSync(file, 'utf8'));
    if (old && old !== process.pid) {
      try { process.kill(old, 0); console.error(`A bot is already running for ${serial} (pid ${old}). Stop it first with --stop.`); process.exit(1); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  fs.writeFileSync(file, String(process.pid));
  const release = () => { try { if (Number(fs.readFileSync(file, 'utf8')) === process.pid) fs.unlinkSync(file); } catch (_) { /* already gone */ } };
  process.on('exit', release);
  process.on('SIGINT', () => process.exit(130));
  process.on('SIGTERM', () => process.exit(143));
}

function stopBots(onlySerial) {
  const files = fs.readdirSync(__dirname).filter((f) => /^\.ad-bot-.*\.pid$/.test(f) && (!onlySerial || f === path.basename(pidFile(onlySerial))));
  if (!files.length) { console.log('no bot is running'); return; }
  for (const f of files) {
    const pid = Number(fs.readFileSync(path.join(__dirname, f), 'utf8'));
    try { process.kill(pid); console.log(`stopped ${f.slice(8, -4)} (pid ${pid})`); } catch (e) { console.log(`${f.slice(8, -4)}: pid ${pid} was not running (${e.code})`); }
    try { fs.unlinkSync(path.join(__dirname, f)); } catch (_) { /* ignore */ }
  }
}

function main() {
  if (args.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 15).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  if (args.test) { console.log(describe(readPng(fs.readFileSync(args.test)))); return; }
  serial = args.serial || process.env.SERIAL || process.env.ANDROID_SERIAL || null;
  if (args.devices) {
    const d = listDevices();
    console.log(d.length ? d.map((x) => `${x.id}  ${x.kind}${x.model ? `  ${x.model}` : ''}`).join('\n') : 'no devices connected');
    return;
  }
  if (args.stop) { stopBots(serial); return; }
  try { pickDevice(); } catch (e) { console.error(e.message); process.exit(1); }
  if (args.shot) { fs.writeFileSync(args.shot, writePng(screencap())); console.log('saved', args.shot); return; }
  if (args.probe) { console.log(`focus ${JSON.stringify(focus())}`); console.log(describe(screencap())); return; }

  claimPidFile();
  log(`ad bot started on ${serial} (mode ${args.mode}${args.loop ? `, loop ${args.loop} min` : ''}${args.max ? `, max ${args.max}` : ''}). Ctrl+C to stop.`);
  const f0 = focus();
  if (!f0 || f0.pkg !== GAME) { log('game not in front: launching it'); launchGame(); sleep(8000); }
  for (;;) {
    try { tick(); } catch (e) { log(`error: ${e.message}`); sleep(3000); }
    sleep(TICK_MS);
  }
}

if (require.main === module) main();
module.exports = { findNext, findGaragePlayAds, findXShape, findPopupX, findAdCornerX, shopButtonVisible, popupPanelVisible, isTitleScreen,
  isMainMenu, isRelayScreen, findRelayPlayAd, findFreeTiles, adDismissTarget, px, minCh };
