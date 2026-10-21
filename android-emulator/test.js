'use strict';
// Regression test for the screen detectors: runs them on the saved screenshots in samples/ and checks the results.
//   node test.js
// Add a frame: save it with `node ad-bot.js --shot samples/<name>.png`, then list what the bot should see below.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { readPng } = require('./png');
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
};
for (const [name, [nodes, want]] of Object.entries(treeCases)) cases[`tree: ${name}`] = () => assert.strictEqual(!!bot.adDismissTarget(nodes), want);

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
