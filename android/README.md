# Android ad bot (emulator and tablet)

One bot, `ad-bot.js`, for the Android version of Asphalt 8: Airborne. It runs on an Android emulator **or** a real
Android tablet/phone, from Windows or macOS, over ADB. Nothing needs the game window in front or the mouse, so you can
keep using your computer.

| | |
|---|---|
| **[RUNNING.md](RUNNING.md)** | how to start it, run it repeatedly, run it in the background, stop it |
| [EMULATOR.md](EMULATOR.md) | setting up the Android emulator (Windows and Mac) |
| [TABLET.md](TABLET.md) | setting up a real tablet or phone (USB debugging) |

## What it does

PLAY AD! -> the ad plays -> dismiss the store promo -> the ad's close button -> the game's promo popup X -> NEXT -> next
ad. It plays them in a set order (default: **AD RELAY OFFERS**, then **AD REWARDS**, then the wrench and coin buttons;
see [RUNNING.md](RUNNING.md)). It also gets past the title screen, wakes the menu when it hides its buttons, closes Google
Play if an ad opens it, opens the AD REWARDS and AD RELAY OFFERS screens from the main menu's FREE tiles, and for long
runs restarts the game every couple of hours and restarts the emulator if it freezes.

## How it reads the screen

- **Game screens** (no UI tree): raw `screencap` and pixel tests. PLAY AD! buttons are found by their red marker, NEXT
  is a white box with dark text, popup X's by shape, ad tiles by their green FREE tags, ad screens by the red TIME LEFT
  ribbon. Positions are fractions of the screen, so different devices mostly work unchanged.
- **Ad screens** (real Android views): `uiautomator dump`. Each ad network labels its close button differently
  (resource id, content-description or visible text); see `adDismissTarget` in `ad-bot.js`. If the tree has nothing it
  looks for an X in the top corners by shape.

Ad networks seen so far: Fyber/Inneractive, Google AdMob, Meta Audience Network, Unity Ads, ironSource.

## Files

| file | |
|---|---|
| `ad-bot.js` | the bot (plain Node, no npm packages) |
| `png.js` | tiny PNG reader/writer used for screenshots and tests |
| `test.js`, `samples/` | detector tests on real screenshots from the emulator and the tablet (`node test.js`) |
| `package.json` | `npm start`, `npm test`, `npm run devices` shortcuts |

To add a test case: `node ad-bot.js --shot samples/<name>.png` on the screen in question, then add an assertion in
`test.js`.

## Status and known gaps

- **Verified live:** coin and wrench PLAY AD! buttons and ads from Fyber, AdMob, Meta and Unity (emulator), and the
  **AD REWARDS** screen end to end on a Galaxy Tab S11 (tile -> PLAY AD! -> Unity ad -> Close -> popup X -> NEXT; the
  milestone counter went up by one). About 11 rewarded ads in 7 minutes on the emulator before the garage quota ran out.
- **AD RELAY OFFERS:** navigation and the "COME BACK LATER" state are verified live, but its PLAY AD! button was
  exhausted when tested, so that click is only checked against a simulated button on the real screen. It uses the same
  slot and code as AD REWARDS.
- Popups whose X is too faint to detect are closed with BACK, only right after an ad and only when a popup panel is clearly
  on screen. BACK on the plain main menu leaves the game, so this is deliberately narrow.
- ironSource playable ads once got stuck (while the emulator's display was resized with `wm size`); not seen since.
- Ad networks change; if one gets stuck, save a frame and the UI tree (`adb exec-out uiautomator dump /dev/tty`) and extend
  `adDismissTarget`.
