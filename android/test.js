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
  'Fyber close button by resource id (trusted after the 10 s grace period)': [[node({ id: 'x:id/ia_clickable_close_button' })], true, 15000],
  'a close button known only by resource id is not trusted in the first seconds of an ad': [[node({ id: 'x:id/ia_clickable_close_button' })], false, 3000],

  'ironSource closeButton (the real one) is a target once the grace period is over': [[node({ id: 'com.x:id/closeButton', x1: 2440, y1: 70, x2: 2520, y2: 150 })], true, 15000],
  'Fyber store-promo dismiss (svg button)': [[node({ cls: 'Button', text: 'svg+xml;base64,PHN2' })], true],
  'Meta "Close Ad" by content-desc': [[node({ desc: 'Close Ad' })], true],
  'Unity playable "Close" by text': [[node({ cls: 'Button', text: 'Close' })], true],
  'Install Now is never tapped': [[node({ cls: 'Button', text: 'Install Now' })], false],
  'Unity "Skip Open Store" pill is tapped at once, on its skip end': [[node({ cls: 'Button', text: 'Skip Open Store', x1: 1217, y1: 34, x2: 1450, y2: 93, cx: 1333, cy: 63 })], true],
  'a bare "Open Store" (no skip) is never tapped': [[node({ cls: 'Button', text: 'Open Store' })], false],
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

// ---- loop breaker ---------------------------------------------------------------------------------------------------
Object.assign(cases, {
  'loop breaker: a normal ad (a few NEXT/popup taps) never trips it': () => {
    bot.st.dismissTaps = []; bot.dryCalls.length = 0;
    const t0 = Date.now();
    for (let i = 0; i < 5; i++) assert(!bot.noteDismissTap(t0 + i * 3000));
    assert(!bot.dryCalls.some((c) => c.includes('force-stop')));
  },
  'loop breaker: 14 taps in two minutes restarts the game once, then starts over': () => {
    bot.st.dismissTaps = []; bot.dryCalls.length = 0; bot.logLines.length = 0;
    const t0 = Date.now();
    let tripped = 0;
    for (let i = 0; i < 14; i++) if (bot.noteDismissTap(t0 + i * 4000)) tripped++;
    assert.strictEqual(tripped, 1);
    assert(bot.dryCalls.some((c) => c.includes('force-stop')) && /tap loop/.test(bot.logLines.join(' ')));
    assert(!bot.noteDismissTap(t0 + 60000), 'the count restarts after a trip');
  },
  'loop breaker: slow taps spread over hours never trip it': () => {
    bot.st.dismissTaps = []; bot.dryCalls.length = 0;
    const t0 = Date.now();
    for (let i = 0; i < 40; i++) assert(!bot.noteDismissTap(t0 + i * 600000));
  },
});

Object.assign(cases, {
  'unity skip: the tap lands on the skip glyph at the right end of the pill, not on "Open Store"': () => {
    const t = bot.adDismissTarget([node({ cls: 'Button', text: 'Skip Open Store', x1: 1217, y1: 34, x2: 1450, y2: 93, cx: 1333, cy: 63 })]);
    assert(t && t.x > 1400 && t.x < 1450 && t.y === 63, JSON.stringify(t));
  },
});

// ---- AppLovin "dead" end card: reveal tap + skip pill ---------------------------------------------------------------------
Object.assign(cases, {
  'applovin: from 10 s it runs the on-device reveal script (reveal tap at 13%/50%, then reads and taps the pill)': () => {
    const img = frame('ad-applovin-max-test-ad.png');
    bot.st.reveals = 0; bot.st.lastReveal = 0; bot.dryCalls.length = 0;
    const f = { act: 'com.applovin.adview.AppLovinFullscreenActivity' };
    assert(!bot.appLovinReveal(f, img, 5000, Date.now()), 'too early');
    assert(bot.appLovinReveal(f, img, 12000, Date.now()));
    assert(bot.dryCalls.includes('shell sh /data/local/tmp/revealskip.sh 198 360'), JSON.stringify(bot.dryCalls));
  },
  'applovin: only AppLovin ads, and not again within 15 s': () => {
    const img = frame('ad-applovin-max-test-ad.png'), t = Date.now();
    bot.st.reveals = 0; bot.st.lastReveal = 0; bot.dryCalls.length = 0;
    assert(!bot.appLovinReveal({ act: 'com.fyber.inneractive.sdk.activities.InneractiveFullscreenAdActivity' }, img, 90000, t));
    const f = { act: 'com.applovin.adview.AppLovinFullscreenActivity' };
    assert(bot.appLovinReveal(f, img, 90000, t));
    assert(!bot.appLovinReveal(f, img, 95000, t + 5000), 'wait before trying again');
    assert(bot.appLovinReveal(f, img, 111000, t + 16000));
  },
  'applovin: back from the Play Store it looks at once (no reveal tap, no 15 s wait), once per return': () => {
    const img = frame('ad-applovin-max-test-ad.png'), t = Date.now();
    bot.st.reveals = 0; bot.st.lastReveal = t; bot.st.revealSoon = true; bot.dryCalls.length = 0;
    const f = { act: 'com.applovin.adview.AppLovinFullscreenActivity' };
    assert(bot.appLovinReveal(f, img, 90000, t + 1000));
    assert(bot.dryCalls.includes('shell sh /data/local/tmp/revealskip.sh -1 -1'), JSON.stringify(bot.dryCalls));
    assert(!bot.appLovinReveal(f, img, 91000, t + 2000), 'the flag is spent');
  },
  'applovin: gives up after 10 tries': () => {
    const img = frame('ad-applovin-max-test-ad.png');
    bot.st.reveals = 0; bot.st.lastReveal = 0; bot.dryCalls.length = 0;
    const f = { act: 'com.applovin.adview.AppLovinFullscreenActivity' };
    let n = 0;
    for (let i = 0; i < 12; i++) if (bot.appLovinReveal(f, img, 90000, i * 21000 + 1)) n++;
    assert.strictEqual(n, 10);
  },
  'applovin on-device script: finds the REAL tablet pill (80,42-216,55), taps its centre (148,48); with no pill it ends in "none"': () => {
    if (!haveSh) throw { skip: 'no sh on this machine' };
    const pill = path.join(__dirname, 'samples', 'ui-applovin-google-play-pill-tablet.xml').replace(/\\/g, '/');
    const run = (tree) => {
      const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'revealskip-'));
      const w = `uiautomator(){ cp "${tree}" "$SW_DIR/rs.xml"; }; input(){ echo "INPUT $*"; }; . "${path.join(__dirname, 'revealskip.sh').replace(/\\/g, '/')}" 333 800`;
      return spawnSync('sh', ['-c', w], { env: { ...process.env, SW_DIR: dir.replace(/\\/g, '/') }, encoding: 'utf8' }).stdout.trim();
    };
    assert.strictEqual(run(pill), 'INPUT tap 148 48\ntapped 148 48', 'a pill that is already up is tapped without a reveal tap first');
    assert.strictEqual(run(noPillTree), 'INPUT tap 333 800\nINPUT tap 333 800\nnone', 'look first, then reveal-tap');
  },
  'applovin: the tablet\'s privacy end card has a hairline X (9 px arms) top right; it used to be invisible and the bot sat on it': () => {
    assert(near(bot.findAdCornerX(frame('ad-applovin-privacy-card-tablet-x.png')), [2494, 56], 8));
  },
  'applovin: the "play-skip / Google Play" pill glyph is not mistaken for an X': () => {
    assert(!bot.findAdCornerX(frame('ad-applovin-max-skip-pill.png')));
  },
  'applovin: the end card that follows the skip has an X the corner detector finds': () => {
    assert(near(bot.findAdCornerX(frame('ad-applovin-skip-end-card.png')), [1464, 48], 8));
  },
});

Object.assign(cases, {
  'garage buttons: on the tablet the coin button (alone) is found as coin; the 1-pixel probe used to throw it away': () => {
    const plays = bot.findGaragePlayAds(frame('tablet-main-menu-coin-only.png'));
    assert.deepStrictEqual(plays.map((p) => p.kind), ['coin']);
    assert(near(plays[0], [1329, 216], 15), JSON.stringify(plays));
  },
  'garage buttons: no false hits on a menu with no PLAY AD! buttons': () => {
    assert.strictEqual(bot.findGaragePlayAds(frame('main-menu.png')).length, 0);
    assert.strictEqual(bot.findGaragePlayAds(frame('popup-lucky-strike.png')).length, 0);
  },
});

// ---- stuck screens after a game restart: press the ONE button of a single-button dialog, never answer a two-button question -------
Object.assign(cases, {
  'dialog OK: the two-button "Replay race?" dialog (NO + YES) is never matched: those questions belong to the owner': () => {
    assert.strictEqual(bot.findSingleOkButton(frame('race-replay-confirm.png')), null);
  },
  'dialog OK: the same dialog with the NO button blanked out has exactly one button: it is found (the YES at 996,550)': () => {
    const img = frame('race-replay-confirm.png');
    const one = { w: img.w, h: img.h, data: Buffer.from(img.data) };
    for (let y = 510; y < 590; y++) for (let x = 360; x < 690; x++) one.data.set([40, 120, 200, 255], (y * one.w + x) * 4);   // paint over NO with the panel colour
    const ok = bot.findSingleOkButton(one);
    assert(ok && near({ x: ok.cx, y: ok.cy }, [996, 550], 25), JSON.stringify(ok));
  },
  'dialog OK: no ordinary screen has a single-OK match (main menus, ad screens, popups, reward screens, the tablet)': () => {
    const bad = fs.readdirSync(path.join(__dirname, 'samples')).filter((f) => f.endsWith('.png') && f !== 'race-replay-confirm.png')
      .filter((f) => bot.findSingleOkButton(frame(f)));
    assert.deepStrictEqual(bad, []);
  },
});

Object.assign(cases, {
  'skip disc: an ironSource ad dimmed to near black (disc 10, glyph 26, background 6) still finds the faint skip button (tablet, 2488,104)': () => {
    assert(near(bot.findSkipButton(frame('ad-ironsource-dimmed-skip-tablet.png')), [2488, 104], 10));
  },
  'skip disc: pure black and the other dark screens (title, loading) never produce a skip button': () => {
    const black = { w: 2560, h: 1600, data: Buffer.alloc(2560 * 1600 * 4, 0) };
    for (let i = 3; i < black.data.length; i += 4) black.data[i] = 255;
    assert.strictEqual(bot.findSkipButton(black), null);
    const noisy = { w: 2560, h: 1600, data: Buffer.alloc(2560 * 1600 * 4, 0) };       // compression noise: values 0-3
    for (let i = 0; i < noisy.data.length; i += 4) { const v = (i / 4 * 7) % 4; noisy.data.set([v, v, v, 255], i); }
    assert.strictEqual(bot.findSkipButton(noisy), null);
    assert.strictEqual(bot.findSkipButton(frame('title-press-any-key.png')), null);
  },
});

Object.assign(cases, {
  // The real tree from the stuck Marines ad (ironSource): the sliver `mrail_close` (2547,6-2560,95) comes before the real `closeButton`
  // (2460,76-2505,142). The wrapper is not banned (it closed 12 ads at their end), but once it rests the real button is chosen.
  'resting: on the real ironSource tree, once the mrail decoys rest, the real closeButton is chosen': () => {
    const nodes = bot.parseNodes(fs.readFileSync(path.join(__dirname, 'samples', 'ui-ironsource-decoy-and-real-close.xml'), 'utf8'));
    const first = bot.adDismissTarget(nodes, 60000);
    assert(first && /mrail_close/.test(first.why), 'without resting the first match is still the mrail one: ' + JSON.stringify(first));
    const resting = new Set();
    let t = first;
    for (let i = 0; i < 4 && t && /mrail/.test(t.why); i++) { resting.add(`${t.x},${t.y}`); t = bot.adDismissTarget(nodes, 60000, resting); }
    assert(t && /closeButton/.test(t.why) && near(t, [2482, 109], 4), JSON.stringify(t));
  },
});

// ---- "Ask Claude" fallback: everything except the call itself is tested, with a fake `claude` ------------------------------------
const ai = require('./ai');
const fakeClaude = (answer, { isError = false, result } = {}) => () => ({
  status: 0,
  stdout: JSON.stringify({ type: 'system' }) + '\n' + JSON.stringify({ type: 'result', is_error: isError, result: result !== undefined ? result : JSON.stringify(answer), structured_output: isError ? undefined : answer, total_cost_usd: 0.02 }) + '\n',
});
const dark = (w, h) => { const d = Buffer.alloc(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set([8, 8, 8, 255], i); return { w, h, data: d }; };
const aiAd = { act: 'com.applovin.adview.AppLovinFullscreenActivity' };
function aiReset() {
  process.env.AD_BOT_AI_USAGE_FILE = path.join(require('os').tmpdir(), `ai-usage-test-${process.pid}.json`);
  try { fs.unlinkSync(process.env.AD_BOT_AI_USAGE_FILE); } catch (_) { /* none yet */ }
  Object.assign(bot.st, { aiRuns: 0, lastAi: 0, aiFails: 0, aiDisabled: false, resting: new Map(), adStart: Date.now() - 90000 });
  bot.args.noAi = false; bot.args.aiAfter = undefined; bot.args.aiDailyMax = undefined;
  bot.dryCalls.length = 0; bot.logLines.length = 0;
}

Object.assign(cases, {
  'ai: the corner image is two 640x400 full-resolution crops with a divider, and the right panel maps back to the right corner': () => {
    const img = { w: 2560, h: 1600, data: Buffer.alloc(2560 * 1600 * 4, 200) };
    img.data.set([255, 0, 0, 255], (50 * 2560 + 2540) * 4);                        // a red dot 20 px from the right edge, y=50
    const c = ai.buildCornerImage(img);
    assert.strictEqual(c.w, 1290); assert.strictEqual(c.h, 400);
    assert.deepStrictEqual([...c.data.subarray((50 * 1290 + 650 + 620) * 4, (50 * 1290 + 650 + 620) * 4 + 3)], [255, 0, 0]);
    assert.deepStrictEqual(ai.mapCornerPoint(1270, 50, c.panels), { x: 2540, y: 50 });
    assert.deepStrictEqual(ai.mapCornerPoint(93, 130, c.panels), { x: 93, y: 130 });
    assert.strictEqual(ai.mapCornerPoint(645, 50, c.panels), null, 'the divider is not a place');
    assert.strictEqual(ai.mapCornerPoint(100, 450, c.panels), null, 'below the crop');
  },
  'ai: a dark screen is brightened before it is sent, a bright one is left alone': () => {
    assert(ai.buildCornerImage(frame('ad-ironsource-dimmed-skip-tablet.png')).gain > 4, 'the dimmed ironSource ad needs a big gain');
    assert.strictEqual(ai.buildCornerImage(frame('ad-admob-reward-granted-x.png')).gain, 1);
  },
  'ai: labels - close and skip controls pass; install, download, buy, open, mute, info, privacy and price labels never do': () => {
    for (const l of ['Close ad button (X)', 'Skip arrow (>>)', 'skip button', 'X', 'Close', 'Skip Ad']) assert(ai.labelAllowed(l), l);
    for (const l of ['Install Now', 'Learn more', 'Download', 'PLAY NOW', 'Mute', 'Info (i)', 'Privacy', 'GET', 'Play Ad', 'Open Store', 'Buy now', '$11.99', '']) assert(!ai.labelAllowed(l), l);
    for (const l of ['OK', 'Close', 'Continue', 'Got it']) assert(ai.labelAllowed(l, 'dialog'), l);
    for (const l of ['Yes', 'NO', 'CHECK IT', 'Replay', 'Install', 'Update', 'Buy']) assert(!ai.labelAllowed(l, 'dialog'), l);
  },
  'ai: askCorners turns the model\'s composite coordinates into real screen coordinates (tablet right corner)': () => {
    ai.setRunner(fakeClaude({ action: 'tap', x: 1217, y: 105, label: 'Close ad button (X)' }));
    const r = ai.askCorners({ w: 2560, h: 1600, data: Buffer.alloc(2560 * 1600 * 4, 90) });
    ai.setRunner(null);
    assert.strictEqual(r.x, 2487); assert.strictEqual(r.y, 105); assert.strictEqual(r.label, 'Close ad button (X)');
  },
  'ai: "none", an answer on the divider, a login failure and garbage are all handled without a tap': () => {
    const img = { w: 2560, h: 1600, data: Buffer.alloc(2560 * 1600 * 4, 90) };
    ai.setRunner(fakeClaude({ action: 'none' })); assert(ai.askCorners(img).none);
    ai.setRunner(fakeClaude({ action: 'tap', x: 645, y: 50, label: 'X' })); assert(ai.askCorners(img).outside);
    ai.setRunner(fakeClaude(null, { isError: true, result: 'Failed to authenticate: OAuth session expired' }));
    assert.throws(() => ai.askCorners(img), /claude auth login/);
    ai.setRunner(() => ({ status: 0, stdout: 'not json', stderr: '' })); assert.throws(() => ai.askCorners(img), /no result/);
    ai.setRunner(() => ({ error: Object.assign(new Error('x'), { code: 'ENOENT' }) })); assert.throws(() => ai.askCorners(img), /not found/);
    ai.setRunner(null);
  },
  'ai: asked only for an ad that has overstayed 60 s, 25 s apart, 3 times per ad, within the daily cap, and not with --no-ai': () => {
    aiReset(); const t = Date.now();
    assert(!bot.aiDue(t, 30000), 'too early');
    assert(bot.aiDue(t, 65000));
    bot.st.lastAi = t - 10000; assert(!bot.aiDue(t, 65000), 'too soon after the last question');
    bot.st.lastAi = t - 30000; bot.st.aiRuns = 3; assert(!bot.aiDue(t, 65000), 'per-ad cap');
    bot.st.aiRuns = 0; bot.args.noAi = true; assert(!bot.aiDue(t, 65000), '--no-ai');
    bot.args.noAi = false; bot.args.aiAfter = 20; assert(bot.aiDue(t, 25000), '--ai-after 20');
    bot.args.aiAfter = undefined; bot.args.aiDailyMax = 2; ai.recordUsage(0.02); ai.recordUsage(0.02); assert(!bot.aiDue(t, 65000), 'daily cap');
    bot.st.aiDisabled = true; bot.args.aiDailyMax = undefined; assert(!bot.aiDue(t, 65000), 'switched off after failures');
  },
  'ai: a good answer is tapped; a bad label, a repeated spot, a purchase-green pixel or an ad that already ended is not': () => {
    const img = frame('tablet-ad-rewards-play-ad.png');          // 2560x1600
    const run = (answer, focusAct) => {
      aiReset(); bot.setFocusProbe(() => ({ pkg: 'x', act: focusAct || aiAd.act }));
      ai.setRunner(fakeClaude(answer));
      const r = bot.aiAssist(aiAd, img, Date.now(), bot.st.resting);
      ai.setRunner(null); bot.setFocusProbe(null);
      return { r, taps: bot.dryCalls.filter((c) => c.includes('input tap')), log: bot.logLines.join(' | ') };
    };
    let o = run({ action: 'tap', x: 1217, y: 105, label: 'Close ad button (X)' });
    assert(o.r === true && o.taps.length === 1 && /tapping "Close ad button/.test(o.log), JSON.stringify(o));
    assert(bot.st.resting.has('2487,105'), 'the tapped spot rests so it is not suggested again at once');
    o = run({ action: 'tap', x: 1217, y: 105, label: 'Install Now' }); assert(o.taps.length === 0 && /refused to tap "Install Now"/.test(o.log), o.log);
    o = run({ action: 'none' }); assert(o.taps.length === 0 && /no close or skip control/.test(o.log), o.log);
    aiReset(); bot.st.resting.set('2487,105', Date.now() + 10000); bot.setFocusProbe(() => ({ pkg: 'x', act: aiAd.act })); ai.setRunner(fakeClaude({ action: 'tap', x: 1217, y: 105, label: 'X' }));
    const again = bot.aiAssist(aiAd, img, Date.now(), bot.st.resting); ai.setRunner(null); bot.setFocusProbe(null);
    assert(again === false && bot.dryCalls.filter((c) => c.includes('input tap')).length === 0, 'a spot that already did nothing is not tapped again');
    o = run({ action: 'tap', x: 1217, y: 105, label: 'Close' }, 'com.gameloft.android.ANMP.GloftA8HM.MainActivity');
    assert(o.taps.length === 0 && /ad ended while waiting/.test(o.log), o.log);
  },
  'ai: two failures in a row (for example the login expired) switch the fallback off for the run instead of retrying forever': () => {
    const img = frame('tablet-ad-rewards-play-ad.png');
    aiReset(); ai.setRunner(fakeClaude(null, { isError: true, result: 'Failed to authenticate' }));
    assert.strictEqual(bot.aiAssist(aiAd, img, Date.now(), bot.st.resting), false); assert(!bot.st.aiDisabled);
    assert.strictEqual(bot.aiAssist(aiAd, img, Date.now(), bot.st.resting), false); assert(bot.st.aiDisabled);
    ai.setRunner(null);
    assert(/switched off/.test(bot.logLines.join(' ')));
  },
});

// ---- BidMachine: the skip is a bare "»" glyph, an unlabelled ~46 px clickable image in the top-right corner -----------------
Object.assign(cases, {
  'tiny corner skip: the real BidMachine tree gives the » glyph, but only once the ad is 10 s old': () => {
    const nodes = bot.parseNodes(fs.readFileSync(path.join(__dirname, 'samples', 'ui-bidmachine-tiny-skip.xml'), 'utf8'));
    assert(!bot.adDismissTarget(nodes, 6000), 'too early: it could forfeit the reward');
    const t = bot.adDismissTarget(nodes, 15000);
    assert(t && t.x === 2516 && t.y === 44, JSON.stringify(t));
  },
  'tiny corner skip: never the top-left mute button, a labelled button, or a big image': () => {
    const nodes = bot.parseNodes(fs.readFileSync(path.join(__dirname, 'samples', 'ui-bidmachine-tiny-skip.xml'), 'utf8'))
      .filter((n) => !(n.x1 > 2000 && n.y1 < 100));          // drop the real » : the mute button (top-left) must not match
    assert(!bot.adDismissTarget(nodes, 80000));
    const labelled = [node({ cls: 'ImageView', desc: 'Info', x1: 2493, y1: 21, x2: 2539, y2: 67 }), node({ x1: 0, y1: 0, x2: 2560, y2: 1568 })];
    assert(!bot.adDismissTarget(labelled, 80000), 'a labelled image is not an unknown skip');
    const big = [node({ cls: 'ImageView', x1: 2000, y1: 20, x2: 2560, y2: 700 }), node({ x1: 0, y1: 0, x2: 2560, y2: 1568 })];
    assert(!bot.adDismissTarget(big, 80000), 'a big image is content, not a button');
  },
});

// ---- Unity "Skip Open Store" pill: caught by a script that runs on the device ------------------------------------------------
const { spawnSync } = require('child_process');
const haveSh = !spawnSync('sh', ['-c', 'true']).error;
const SKIP = Symbol('skip');
function runSkipwatch(trees) {   // trees: file the stubbed `uiautomator dump` copies on each look, in order (last one repeats)
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'skipwatch-'));
  const stub = trees.map((t, i) => `[ "$n" = ${i + 1} ] && cp "${t}" "$SW_DIR/sw.xml"`).join('; ');
  const wrapper = `n=0; uiautomator(){ n=$((n+1)); ${stub}; [ "$n" -gt ${trees.length} ] && cp "${trees[trees.length - 1]}" "$SW_DIR/sw.xml"; }; input(){ echo "INPUT $*"; }; . "${path.join(__dirname, 'skipwatch.sh').replace(/\\/g, '/')}" 4`;
  return spawnSync('sh', ['-c', wrapper], { env: { ...process.env, SW_DIR: dir.replace(/\\/g, '/') }, encoding: 'utf8' }).stdout.trim();
}
const pillTree = path.join(__dirname, 'samples', 'ui-unity-skip-open-store.xml').replace(/\\/g, '/');
const noPillTree = (() => {   // the same real tree with the pill's label changed
  const p = path.join(require('os').tmpdir(), 'ui-no-pill.xml');
  fs.writeFileSync(p, fs.readFileSync(path.join(__dirname, 'samples', 'ui-unity-skip-open-store.xml'), 'utf8').replace(/Skip Open Store/g, 'Privacy info'));
  return p.replace(/\\/g, '/');
})();
Object.assign(cases, {
  'unity fast skip: the device script taps the skip end of the real pill (484,111)': () => {
    if (!haveSh) throw { skip: 'no sh on this machine' };
    assert.strictEqual(runSkipwatch([pillTree]), 'INPUT tap 484 111\ntapped 484 111');
  },
  'unity fast skip: a pill that only flashes up on the 3rd look is still caught': () => {
    if (!haveSh) throw { skip: 'no sh on this machine' };
    assert.strictEqual(runSkipwatch([noPillTree, noPillTree, pillTree]), 'INPUT tap 484 111\ntapped 484 111');
  },
  'unity fast skip: a Close button ends the watch at once ("close"), without tapping it': () => {
    if (!haveSh) throw { skip: 'no sh on this machine' };
    const p = path.join(require('os').tmpdir(), 'ui-close.xml');
    fs.writeFileSync(p, fs.readFileSync(path.join(__dirname, 'samples', 'ui-unity-skip-open-store.xml'), 'utf8').replace(/Skip Open Store/g, 'Close'));
    assert.strictEqual(runSkipwatch([p.replace(/\\/g, '/')]), 'close');
  },
  'unity fast skip: with no pill it taps nothing': () => {
    if (!haveSh) throw { skip: 'no sh on this machine' };
    assert.strictEqual(runSkipwatch([noPillTree]), 'none');
  },
  'unity fast skip: only Unity ads, not before 6 s, at most 8 watches that never swallow the tick, and never after a skip': () => {
    const f = { act: 'com.unity3d.ads.adplayer.FullScreenWebViewDisplay' }, t = Date.now();
    Object.assign(bot.st, { adStart: t - 20000, unitySkipped: false, watchRuns: 0 }); bot.dryCalls.length = 0;
    assert(!bot.unityFastSkip({ act: 'com.fyber.inneractive.sdk.activities.InneractiveFullscreenAdActivity' }, t), 'not Unity');
    bot.st.adStart = t - 3000;
    assert(!bot.unityFastSkip(f, t), 'too early');
    bot.st.adStart = t - 20000;
    for (let i = 0; i < 8; i++) assert(!bot.unityFastSkip(f, t), `watch ${i + 1} never swallows the tick`);
    assert.strictEqual(bot.dryCalls.filter((c) => c.startsWith('shell sh ') && c.includes('skipwatch.sh')).length, 8);
    assert(!bot.unityFastSkip(f, t));
    assert.strictEqual(bot.dryCalls.filter((c) => c.startsWith('shell sh ') && c.includes('skipwatch.sh')).length, 8, 'gives up after 8 watches');
    bot.st.watchRuns = 0; bot.st.unitySkipped = true;
    assert(!bot.unityFastSkip(f, t), 'already skipped');
  },
});

let failed = 0, skipped = 0;
for (const [file, check] of Object.entries(cases)) {
  try {
    check(file.endsWith('.png') ? readPng(fs.readFileSync(path.join(__dirname, 'samples', file))) : null);
    console.log(`ok   ${file}`);
  } catch (e) {
    if (e && e.skip) { skipped++; console.log(`skip ${file}: ${e.skip}`); continue; }
    failed++;
    console.log(`FAIL ${file}: ${e.message}`);
  }
}
if (skipped) console.log(`${skipped} skipped`);
console.log(failed ? `${failed} failed` : 'all passed');
process.exit(failed ? 1 : 0);
