'use strict';
// Regression test for the screen detectors: runs them on the saved screenshots in samples/ and checks the results.
//   node test.js
// Add a frame: save it with `node ad-bot.js --shot samples/<name>.png`, then list what the bot should see below.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readPng } = require('./png');
process.env.AD_BOT_DRY_RUN = '1';   // the decision logic runs without a device; adb calls are recorded instead
const bot = require('./ad-bot');

const near = (got, want, tol = 12) => got && Math.abs(got.x - want[0]) <= tol && Math.abs(got.y - want[1]) <= tol;

const cases = {
  'garage-play-ad-buttons.png': (img) => {
    const plays = bot.findGaragePlayAds(img);
    assert.deepStrictEqual(plays.map((p) => p.kind), ['coin', 'wrench']);
    assert(near(plays[0], [740, 97]) && near(plays[1], [900, 97]), JSON.stringify(plays));
    assert(bot.shopButtonVisible(img));
    assert(!bot.findNext(img) && !bot.findPopupX(img));
  },
  'reward-next.png': (img) => {
    const n = bot.findNext(img);
    assert(n && Math.abs(n.cx - 1270) < 20 && Math.abs(n.cy - 660) < 20, JSON.stringify(n));
    assert(bot.findGaragePlayAds(img).length === 0);
  },
  'popup-lucky-strike.png': (img) => assert(near(bot.findPopupX(img), [1165, 98])),
  'popup-united-nations.png': (img) => assert(near(bot.findPopupX(img), [1108, 160])),
  'popup-car-hunt-cyan-x.png': (img) => assert(near(bot.findPopupX(img), [1425, 70])),
  // the X on this popup is a faint translucent glyph over bright sky: no pixel test finds it, so the bot uses BACK
  'popup-faint-x.png': (img) => {
    assert(!bot.findPopupX(img));
    assert(bot.popupPanelVisible(img) && !bot.shopButtonVisible(img));
  },
  'title-press-any-key.png': (img) => assert(bot.isTitleScreen(img)),
  'ad-admob-reward-granted-x.png': (img) => assert(near(bot.findAdCornerX(img), [1485, 50])),
  'ad-fyber-close-x.png': (img) => assert(near(bot.findAdCornerX(img), [680, 40])),
  'ad-unity-playable-x-top-left.png': (img) => assert(near(bot.findAdCornerX(img), [48, 67])),
  // ironSource ads: a round skip button (⏭) in the top-right, not in the UI tree; tapping it turns it into a ✕ on the
  // end card. Unity draws the same button darker than its background.
  'ad-ironsource-skip-button.png': (img) => {
    assert(near(bot.findSkipButton(img), [1474, 46], 10), JSON.stringify(bot.findSkipButton(img)));
    assert(!bot.findAdCornerX(img), 'a skip glyph is not an X');
  },
  'ad-ironsource-end-card-x.png': (img) => assert(near(bot.findAdCornerX(img), [1474, 46], 10)),
  'ad-unity-skip-button.png': (img) => assert(near(bot.findSkipButton(img), [1467, 72], 10)),
};

Object.assign(cases, {
  'main-menu.png': (img) => {
    assert(bot.isMainMenu(img) && !bot.isRelayScreen(img));
    assert(!bot.findRelayPlayAd(img), 'the big PLAY button is not the relay PLAY AD! slot');
    const tiles = bot.findFreeTiles(img);   // Ad Rewards, then Ad Relay Offers (the second one was opened by hand: 185,168)
    assert(tiles.length === 2 && near(tiles[1], [185, 168], 10), JSON.stringify(tiles));
  },
  // Galaxy Tab S11 (2560x1600): different layout, an extra left tile, a live AD REWARDS PLAY AD! button.
  'tablet-main-menu.png': (img) => {
    assert(bot.isMainMenu(img) && !bot.isRelayScreen(img));
    assert(!bot.findRelayPlayAd(img), 'the big PLAY button must not look like the ad screens\' PLAY AD!');
    const tiles = bot.findFreeTiles(img);
    assert(tiles.length === 2 && near(tiles[0], [299, 350], 12) && near(tiles[1], [492, 352], 12), JSON.stringify(tiles));
    const plays = bot.findGaragePlayAds(img);
    assert(plays.length === 1 && plays[0].kind === 'wrench' && near(plays[0], [1582, 216], 15), JSON.stringify(plays));
  },
  'tablet-ad-rewards-play-ad.png': (img) => {
    assert(bot.isRelayScreen(img) && !bot.isMainMenu(img));
    const b = bot.findRelayPlayAd(img);
    assert(b && Math.abs(b.cx - 2188) < 30 && Math.abs(b.cy - 1504) < 30, JSON.stringify(b));
  },
  // Relay was exhausted when captured ("COME BACK LATER", grey). A live PLAY AD! is simulated by painting an orange
  // button into the same slot, since the real one only appears when the next ad is ready.
  'ad-relay-offers-come-back-later.png': (img) => {
    assert(bot.isRelayScreen(img) && !bot.isMainMenu(img));
    assert(!bot.findRelayPlayAd(img));
    const sim = { w: img.w, h: img.h, data: Buffer.from(img.data) };
    for (let y = 645; y < 710; y++) for (let x = 1130; x < 1470; x++) sim.data.set([255, 170, 20, 255], (y * sim.w + x) * 4);
    const b = bot.findRelayPlayAd(sim);
    assert(b && Math.abs(b.cx - 1300) < 25 && Math.abs(b.cy - 677) < 25, JSON.stringify(b));
  },
});

// Ad screens are read from the UI tree. Each network labels its close button differently; install/open buttons must
// never be tapped.
const node = (o) => ({ cls: 'View', id: '', desc: '', text: '', clickable: true, x1: 0, y1: 0, x2: 60, y2: 60, cx: 30, cy: 30, ...o });
const treeCases = {
  'Fyber close button by resource id': [[node({ id: 'x:id/ia_clickable_close_button' })], true],
  'Fyber store-promo dismiss (svg button)': [[node({ cls: 'Button', text: 'svg+xml;base64,PHN2' })], true],
  'Meta "Close Ad" by content-desc': [[node({ desc: 'Close Ad' })], true],
  'Unity playable "Close" by text': [[node({ cls: 'Button', text: 'Close' })], true],
  'Install Now is never tapped': [[node({ cls: 'Button', text: 'Install Now' })], false],
  'Skip Open Store is never tapped': [[node({ cls: 'Button', text: 'Skip Open Store' })], false],
  'plain video, nothing to tap': [[node({ cls: 'WebView', text: 'Ad Player', clickable: false })], false],
  'AdMob "Skip" is left alone early in an ad': [[node({ cls: 'Button', desc: 'Skip' })], false],
  'AdMob "Skip" is tapped once the ad has been up 80 s': [[node({ cls: 'Button', desc: 'Skip' })], true, 80000],
};
for (const [name, [nodes, want, age]] of Object.entries(treeCases)) cases[`tree: ${name}`] = () => assert.strictEqual(!!bot.adDismissTarget(nodes, age), want);

// ---- which ad is played next ----------------------------------------------------------------------------------------
// The default order is AD RELAY OFFERS, AD REWARDS, wrench, coin. A better source that is due always beats a worse one that
// is visible. `run` feeds a real screenshot to the chooser and reports what it did.
const frame = (name) => readPng(fs.readFileSync(path.join(__dirname, 'samples', name)));
const FUTURE = Date.now() + 3600000;
function run(name, { order, mode, done = [], noFill = {}, tileIdx = 0 } = {}) {
  bot.configure({ order, mode });
  Object.assign(bot.st, { lastAction: 0, lastPlay: 0, lastHomeTap: 0, lastRelayNav: 0, awaitingAd: false, ads: 0, tileIdx,
    tileDoneUntil: done.map((d) => (d ? FUTURE : 0)), noFillUntil: { coin: 0, wrench: 0, rewards: 0, relay: 0, ...noFill } });
  bot.dryCalls.length = 0; bot.logLines.length = 0;
  const acted = bot.chooseAd(frame(name), Date.now());
  return { acted, log: bot.logLines.join(' | '), taps: bot.dryCalls.filter((c) => c.includes('input tap')) };
}
const tapAt = (r) => (r.taps[0] || '').replace('shell input tap ', '');

Object.assign(cases, {
  'order: tablet menu, everything due -> opens AD RELAY OFFERS first, not AD REWARDS or the wrench button': () => {
    const r = run('tablet-main-menu.png');
    assert(r.acted && /opening relay \(tile 2 of 2\)/.test(r.log), r.log);
    assert(near({ x: 492, y: 352 }, tapAt(r).split(' ').map(Number), 12), tapAt(r));
  },
  'order: AD RELAY OFFERS waiting for its timer -> AD REWARDS next, still ahead of the wrench': () => {
    const r = run('tablet-main-menu.png', { done: [false, true] });
    assert(/opening rewards \(tile 1 of 2\)/.test(r.log), r.log);
    assert(near({ x: 299, y: 350 }, tapAt(r).split(' ').map(Number), 12), tapAt(r));
  },
  'order: both tiles waiting -> the wrench button': () => {
    const r = run('tablet-main-menu.png', { done: [true, true] });
    assert(/PLAY AD! #1 \(wrench\)/.test(r.log), r.log);
    assert(near({ x: 1582, y: 216 }, tapAt(r).split(' ').map(Number), 15), tapAt(r));
  },
  'order: a custom --order puts the wrench ahead of the tiles': () => {
    const r = run('tablet-main-menu.png', { order: 'wrench,rewards,relay,coin' });
    assert(/PLAY AD! #1 \(wrench\)/.test(r.log), r.log);
  },
  'order: --order coin never touches the tiles or the wrench': () => {
    const r = run('tablet-main-menu.png', { order: 'coin' });
    assert(!r.acted, r.log);
  },
  'order: in the garage with a tile due -> go home first, not PLAY AD!': () => {
    const r = run('garage-play-ad-buttons.png');
    assert(/going to the main menu for relay/.test(r.log) && !/PLAY AD/.test(r.log), r.log);
  },
  'order: in the garage with the tiles waiting -> wrench before coin': () => {
    const r = run('garage-play-ad-buttons.png', { done: [true, true] });
    assert(/PLAY AD! #1 \(wrench\)/.test(r.log), r.log);
  },
  'order: --order coin,wrench flips it': () => {
    const r = run('garage-play-ad-buttons.png', { order: 'coin,wrench' });
    assert(/PLAY AD! #1 \(coin\)/.test(r.log), r.log);
  },
  // right after the title screen the PLAY AD! buttons can be visible while the SHOP button is not lit yet: wait for the
  // menu to settle instead of taking the wrench ahead of AD RELAY OFFERS, but do not wait forever
  'order: an ambiguous fading-in menu waits, then falls back to the visible button': () => {
    const img = frame('tablet-main-menu.png');
    const dim = { w: img.w, h: img.h, data: Buffer.from(img.data) };
    for (let y = Math.round(img.h * 0.03); y < Math.round(img.h * 0.11); y++)
      for (let x = Math.round(img.w * 0.78); x < Math.round(img.w * 0.92); x++) dim.data.set([20, 40, 20, 255], (y * img.w + x) * 4);
    assert(!bot.shopButtonVisible(dim) && !bot.isMainMenu(dim));
    run('tablet-main-menu.png');                       // resets the state (and performs one action, which we discard)
    bot.dryCalls.length = 0; bot.logLines.length = 0;
    const t0 = Date.now();
    assert(!bot.chooseAd(dim, t0) && bot.dryCalls.length === 0, 'should wait at first');
    assert(bot.chooseAd(dim, t0 + 9000) && /PLAY AD! #1 \(wrench\)/.test(bot.logLines.join(' ')), `then take the wrench: ${bot.logLines.join(' | ')}`);
  },
  'order: --mode garage ignores the tiles': () => {
    const r = run('tablet-main-menu.png', { mode: 'garage' });
    assert(/PLAY AD! #1 \(wrench\)/.test(r.log), r.log);
  },
  'order: on the AD REWARDS screen -> PLAY AD!': () => {
    const r = run('tablet-ad-rewards-play-ad.png', { tileIdx: 0 });
    assert(/PLAY AD! #1 \(rewards\)/.test(r.log), r.log);
    assert(near({ x: 2188, y: 1504 }, tapAt(r).split(' ').map(Number), 30), tapAt(r));
  },
  'order: on the relay screen with no ad ready -> back out and remember it': () => {
    const r = run('ad-relay-offers-come-back-later.png', { tileIdx: 1 });
    assert(/relay has no ad ready/.test(r.log) && bot.st.tileDoneUntil[1] > Date.now(), r.log);
  },
  'order: --order relay opens the second tile on the emulator menu too': () => {
    const r = run('main-menu.png', { order: 'relay' });
    assert(/opening relay \(tile 2 of 2\)/.test(r.log), r.log);
    assert(near({ x: 186, y: 167 }, tapAt(r).split(' ').map(Number), 10), tapAt(r));
  },
});

// ---- overnight: the game is restarted every few hours, but never in the middle of an ad ------------------------------
Object.assign(cases, {
  'restart: due after the interval, only between ads': () => {
    const now = Date.now(), hour = 3600000;
    bot.args.restartHours = 2;
    Object.assign(bot.st, { appStartedAt: now - 1.5 * hour, inAd: false, awaitingAd: false });
    assert(!bot.restartDue(now), 'not yet');
    bot.st.appStartedAt = now - 2.1 * hour;
    assert(bot.restartDue(now), 'due');
    bot.st.inAd = true;
    assert(!bot.restartDue(now), 'never during an ad');
    bot.st.inAd = false; bot.st.awaitingAd = true;
    assert(!bot.restartDue(now), 'never while an ad is loading');
    bot.st.awaitingAd = false; bot.args.restartHours = 0;
    assert(!bot.restartDue(now), 'off with --restart-hours 0');
  },
});

let failed = 0;
for (const [file, check] of Object.entries(cases)) {
  try {
    check(file.endsWith('.png') ? readPng(fs.readFileSync(path.join(__dirname, 'samples', file))) : null);
    console.log(`ok   ${file}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${file}: ${e.message}`);
  }
}
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
