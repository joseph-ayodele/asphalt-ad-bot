# AGENTS.md: context for anyone (human or AI) working on this repo

This file records what this project is, how it got here, the decisions and dead ends behind the code, and the rules the
owner has set. Read it before changing anything. Keep it up to date when you change behaviour.

## What this is

Bots that play the rewarded video ads in **Asphalt 8: Airborne** and collect the rewards, so the owner can use their
computer while it runs. Two bots, one per version of the game:

| folder | what | needs the game window in front? |
|---|---|---|
| `windows-ahk/` | the original AutoHotkey v2 bots for the Windows (Microsoft Store) game | yes: screen grabs and real mouse clicks |
| `android/` | one Node.js bot for the Android game, on **an emulator or a real tablet**, over ADB | no |

The original problem: the Windows bots only worked with the game window visible and focused, which tied up the PC. The
Android route was chosen to get a fully background solution. `windows-ahk/` was kept as it was (plus a focus workaround, below).

Docs map: `README.md` (which bot), `android/RUNNING.md` (how to run, background, overnight, troubleshooting),
`android/EMULATOR.md`, `android/TABLET.md` (device setup), `android/README.md` (how the bot works, status),
`windows-ahk/README.md`. This file is the history and the rules.

## The owner's rules and preferences (follow these)

- **Commit and push only when asked.** Pushes go to `main` of the owner's GitHub repo. Commit messages end with the
  `Co-Authored-By` line the tooling specifies.
- **Never enter passwords, PINs or any credential** on the owner's devices, even if given one. If the tablet shows a PIN
  screen, stop and say so. (It has been in a "trusted" state where waking it needed no PIN.)
- **Never answer the game's cloud-save prompt** ("We have detected a different version of your data in the cloud. Do you
  want to use it?"). It is the owner's save. Show the numbers on both sides and ask. (It appeared once; they chose "keep
  local" on the tablet.)
- **Do not change device or system settings on the owner's tablet** (Stay awake, auto-lock, Developer options, etc.). Tell
  them how to do it. Tapping inside the game and navigating its menus is fine.
- **Never tap purchase buttons.** The bot refuses green pixels and anything labelled install / download / open / buy / shop.
- Ask before destructive or outward-facing actions; take the safe default for reversible local ones.
- **Ad priority order is set by the owner: AD RELAY OFFERS, then AD REWARDS, then wrench, then coin.** (They corrected an
  earlier version of this order; it is in `MODE_SOURCES.all`.)
- They want it to run **overnight / indefinitely** on the emulator (hence the periodic game restart and emulator
  watchdog), and also on the tablet.
- Run the bot on **one device at a time** (they share one Gameloft account; running both diverges the saves).
- The owner often works remotely from another room (phone), so make things work unattended and report clearly.

## Environment (the owner's setup, as of the last session)

- Windows 11 PC; repo at `C:\Users\joseph\code\asphalt-ad-bot`. Node 24 (via nvm), no Python. Android Studio installed;
  SDK at `%LOCALAPPDATA%\Android\Sdk` (platform-tools, emulator, cmdline-tools). The owner also has a Mac and plans to run
  the bot from it too; the Mac steps in the docs are untested.
- **Emulator**: AVD named `asphalt` (Pixel 4 profile, Google Play **x86_64 API 35**, not the 16 KB image), config in
  `%USERPROFILE%\.android\avd\asphalt.avd\config.ini`: 6 GB RAM, 8 cores, 16 GB data, `hw.gpu.mode=swangle`, true display
  720x1520 @293 dpi, `hw.keyboard=yes`. Serial `emulator-5554`. Old AVDs and the wrong images were deleted.
- **Tablet**: Samsung Galaxy Tab S11 (SM-X730, Android 16, 2560x1600 landscape), USB debugging on, USB-connected to the PC.
  Same Gameloft account as the emulator.
- The owner moves the bot between devices. At the end of the last session the tablet had been run until it had seen every
  ad available to it (then stopped on purpose), the emulator's game was restarted to pull the cloud save (numbers matched the
  tablet's), and **`node ad-bot.js --loop --serial emulator-5554` was left running overnight**. Check what is running with
  `ls android/.ad-bot-*.pid` and `node android/ad-bot.js --devices`.

## Android bot: how it works (`android/ad-bot.js`, ~800 lines, no npm dependencies)

Sections, top to bottom: constants; adb helpers (device listing, pid files, dry-run switch); screenshots; pixel
detectors; UI-tree reader; ad-source chooser; main loop steps; emulator watchdog; `main()`.

**Perception**
- Game screens (Unity, no UI tree): `adb exec-out screencap` raw RGBA (16-byte header, then pixels) and pixel tests.
  Decoding PNG is only needed for tests (`png.js`, a tiny reader/writer).
- Ad screens (real Android views): `uiautomator dump` (about 2 s, slow while video plays). Close buttons are found by
  resource id / content-description / visible text; see `adDismissTarget` and `NEVER_TAP`.
- The game's UI is laid out in **fractions of the screen**, so most detection is fraction-based and transfers between the
  emulator (1520x720) and tablet (2560x1600). Where layouts differ the bot finds things by appearance, not position.

**Key detectors** (all in `ad-bot.js`, all covered by `test.js` against real screenshots)
- `findGaragePlayAds`: the PLAY AD! 10,000 buttons in the top bar are found by their pure-red marker triangle
  (255,31,31); gold plate = coin, purple = wrench. Present on the main menu and garage.
- `findFreeTiles`: green **FREE** tags in the main menu's top-left column; the first two tiles open **AD REWARDS** then
  **AD RELAY OFFERS** (left to right). The tap goes below the tag (the tag itself is green, which `safeTap` refuses).
- `hasTimeLeftRibbon` / `isRelayScreen`: both ad screens have a long red "TIME LEFT" ribbon (at least 20% of the width);
  nothing else seen exceeds 9%. `findRelayPlayAd`: the orange PLAY AD! in the bottom-right slot (gated by the ribbon, so the
  main menu's orange PLAY button is never mistaken for it, which would start a race).
- `findNext` (white box with dark text), `findPopupX`/`findXShape` (X by shape), `findAdCornerX` (two glyph sizes),
  `findSkipButton` (flat translucent disc with a white skip glyph, top-right), `isMainMenu`, `shopButtonVisible` (the
  green SHOP button is only lit when nothing dims the screen), `popupPanelVisible`, `isTitleScreen`.

**Decision logic**
- `chooseAd` picks the best available source by priority across the whole bot, so a better source that becomes due again
  (tiles are re-checked every 15 minutes after "COME BACK LATER") pre-empts a lesser one between ads. If the screen is
  ambiguous (menu fading in) it waits up to 8 s rather than take a lower-priority button.
- `gameStep` (in the game): title screen tap, NEXT/OK, `chooseAd`, popup X, a narrow BACK fallback, wake tap, idle stop.
- `adStep` (in an ad): UI-tree close target, then corner X, then (after 75 s) the skip button; BACK after 4 minutes, then a
  game restart after three BACKs.
- `foreignStep`: another app got focus (e.g. Google Play opened by an ad): BACK; launcher: reopen the game.
- Overnight: `--loop` waits and re-checks when out of ads; the game restarts every 2 h between ads (`--restart-hours`); if the
  bot cannot read an **emulator's** screen for 8 ticks it restarts the emulator (`--restart-emulator` does it by hand).
- One pid file and one log per device (`.ad-bot-<serial>.pid`, `ad-bot-<serial>.log`, both git-ignored); `--stop` works the
  same on Windows and Mac.

**Flags**: `--order a,b,c` / `--mode all|rewards|relay|garage|coin|wrench`, `--loop [min]`, `--restart-hours N`, `--max N`,
`--serial <id>`, `--devices`, `--stop`, `--probe`, `--shot file.png`, `--test file.png`, `--restart-emulator`,
`--idle-minutes N`. `npm start` = `node ad-bot.js --mode all --loop`.

## Testing

`cd android && node test.js` (55 checks at last count). It runs the detectors on `android/samples/*.png` (real frames from
the emulator and the tablet, ~20 MB) and the ad-chooser logic in a **dry-run mode** (`AD_BOT_DRY_RUN=1`: no adb calls,
actions recorded in `dryCalls` / `logLines`). To add a case: `node ad-bot.js --shot samples/<name>.png --serial <id>` on the
screen, then add an assertion. Always add a negative test when you add a detector (false positives cost real taps).
The samples contain the owner's in-game name and currency numbers.

## What was learned the hard way (so you do not repeat it)

- **BACK exits the game on the plain main menu.** An early "press BACK for faint popups" rule did exactly that. It is now
  limited to a bright popup panel on a dimmed screen (SHOP not lit), seen on several scans in a row, within 90 s after an
  ad. Popups whose X is a faint translucent glyph over bright art cannot be found by any pixel test, hence the BACK fallback.
- **Do not resize the emulator with `adb shell wm size`.** Ad WebViews lay out against the old physical size, so some ads
  draw wider than the screen and their close X is off-screen (stuck ironSource ads). Set the size in the AVD's `config.ini`.
- **Emulator GPU**: `hw.gpu.mode=host` sent the game into an endless `eglGetConfigAttrib ... EGL_BAD_CONFIG` loop on the
  Gameloft logo. `swangle` (software ANGLE) works. Also: 4 GB RAM thrashed; the 16 KB page-size image was a wrong pick.
- **The emulator's graphics can freeze after hours idle**: `adb shell` answers but `screencap` never returns. Restart it.
- The game **hides its menu buttons after a few idle seconds**; a tap on an empty spot at the top (0.40w, 0.04h) brings them back. Do not tap the floor right of the car: on the tablet that is the driver, and tapping it toggles a close-up that hides the menu.
  `hw.keyboard=yes` makes the game show a "Press any key" overlay at every launch (the bot taps through it).
- The in-game ad PLAY buttons exist in three places: top-bar coin and wrench buttons, and the two ad screens.
- Ad networks seen: Fyber/Inneractive (resource-id close button, store-promo card with an unlabeled svg dismiss button),
  Google AdMob ("Reward granted" X in a corner), Meta Audience Network ("Close Ad" content-description), Unity Ads ("Close"
  text; skip glyph, then an X top-left), ironSource (skip glyph top-right, same spot becomes a ✕ on the end card),
  AppLovin (a dead dimmed playable with no close button once; BACK did nothing; a game restart clears it and loses that
  ad's reward). Some ads open Google Play by themselves when they end; BACK returns.
- Reward screens appear after the ad and the promo popup; NEXT may appear twice.
- **On the tablet, `screencap` does not capture some ad layers** (an AdMob app-install ad showed only the game underneath);
  the UI tree still shows it, so ad handling must work from the tree alone. That ad's only way out was a button with
  content-description **"Skip"**, which is why a "Skip" button is tapped once an ad has been up 75 s (never earlier: it can
  forfeit the reward).
- **The emulator process can die outright** (it did once, right after a Vungle ad). `adb` then answers "device not found";
  that is treated as an error so the watchdog restarts the emulator (verified live: dead emulator to game running in ~40 s).
  If the bot starts while the emulator is already dead it still recovers. The watchdog finds the AVD name from
  `emulator -list-avds` when there is exactly one.
- **Do not wake the menu by tapping the floor right of the car**: on the tablet that is where the driver stands, and tapping
  the driver toggles a close-up that hides the whole menu (the bot then sees no buttons and idles). The wake tap is an empty
  spot at the top (0.40w, 0.04h).
- Pace seen: each ad 25-70 s; about a dozen coin/wrench ads per refresh; the garage buttons came back within about 3 h.
- Shell gotchas on this PC: Git Bash rewrites `/sdcard/...` paths (set `MSYS_NO_PATHCONV=1`); PowerShell `>` corrupts binary
  output (use `node ad-bot.js --shot` or Git Bash); `Start-Process` with redirected output is how to background a bot;
  commands that wait can be moved to the background by the harness, so avoid long foreground sleeps.

## The Windows AutoHotkey side (`windows-ahk/`)

Three AHK v2 scripts (`ad-bot.ahk` = Ad Relay Offers screen, `coin-ad-bot.ahk`, `wrench-ad-bot.ahk`), image templates
(`close-x.png`, `close-ring.png`, `wrench-play.png`, keep them beside the scripts), `stop-bots.ps1` and `Stop bots.lnk`
(a shortcut with an absolute path; recreated after the move). Hotkeys F8 pause, F9 status, F10 quit. All three got a
`KeepActive` timer that posts WM_ACTIVATE-style messages to the UWP window so ads keep playing while another monitor has
focus (verified by the owner). They were not otherwise changed. Their run logs are no longer tracked in git.

## Status at the end of the last session

Verified live: coin/wrench buttons; Fyber, AdMob, Meta, Unity ads; AD REWARDS end to end on the tablet; the priority order;
the emulator restart procedure and the watchdog's automatic recovery of a dead emulator; `--loop`, `--stop`, device picking;
the tablet working through AD REWARDS until "COME BACK LATER". Verified only on saved frames or by unit tests: the
ironSource skip-button path, the AdMob "Skip" button, the 2-hour game restart. **Not verified live: the AD RELAY
OFFERS PLAY AD! click** (it was exhausted whenever tried; it shares the slot and code with AD REWARDS, and a simulated
button on the real screen is tested). Unknowns: whether there is a daily cap on ads; whether the third FREE tile that
appeared on the emulator's main menu matters (the bot only uses the first two); how the Mac behaves.

## Races: a possible fourth ad source (explored, NOT built)

The owner found that finishing a career race offers a rewarded ad ("GET YOUR MULTI-CREDITS!", 116 credits x78 = 9,048, for one
ad). We walked the whole flow by hand on the emulator (frames in `android/samples/race-*.png`). It works, and the race drives
itself (autopilot) in about 2.5 minutes. Flow, emulator 1520x720 coordinates:

1. Main menu: **PLAY** (orange, bottom right, 1360,648) -> mode menu: **CAREER** panel (1100,220) -> Season 1 page: first tile
   **ALPS / Dodge Dart GT** (270,340; all 5 stars, repeatable) -> race info: **NEXT** (white box, the bot already finds it)
   -> car select: **START RACE** (grey translucent, 1322,640, not found by any detector) -> boosts screen: **START RACE**
   (white box; never tap APPLY or the green price buttons) -> loading -> race (~2.5 min, no input needed).
2. After the finish: NEXT (finish cutscene), NEXT (results), **SKIP** (the rewards screen shows 0 until it counts up), then
   **"Get your multi-credits"**: PLAY AD! is a **green** button. The bot's purchase-safety check refuses green, so it would need a
   deliberate exception, and the existing NEXT detector would wrongly tap MISS OUT (the white box beside it). The ad is a
   normal AdMob ad that opens a Play Store page afterwards (BACK). Then "CONGRATULATIONS! TOTAL 9,048" with REPLAY and NEXT.
3. REPLAY -> "Replay race?" dialog (YES is a white box the NEXT detector finds; NO is left of it) -> a **Vungle interstitial**
   ad (clean X top-right, in the UI tree) -> presumably straight to the race (not confirmed; the emulator died here).
4. Finishing also completed a Car Hunt quest: a "CAR HUNT QUEST COMPLETED" popup with NOT NOW / CHECK IT and no X (the bot's
   BACK fallback would probably close it).

Why the owner's first manual run showed no ad: the rewards screen shows 0 credits until it counts up, and the offer comes on
the next screen. It was not a missing ad.

To build it: a state machine for step 1 (time-driven taps with a "not the main menu" check), a race state during which the bot
taps nothing except NEXT (the wake tap and the BACK fallback must be suppressed mid-race: BACK opens the pause menu), a
green-PLAY-AD detector for the multi-credits screen (green block at x 0.60-0.97, y 0.64-0.79 plus a white REPLAY box at the
bottom left; the boosts screen's green price buttons start at y 0.80), and REPLAY to loop without the menus. Put it last in the
priority order (below coin). Not done because the owner asked for something simple running overnight.

**Warning found while exploring: the emulator process died twice, each time with a Vungle ad on screen** (once during an AD
RELAY/REWARDS run, once after the replay interstitial), with no Windows crash record. The watchdog restarts it in about 40 s.
`--restart-emulator` and the watchdog now write the emulator's own output to `android/emulator-<avd>.log`, so the next crash
leaves evidence. Races would add a Vungle ad per replay, so expect more of these.

The **third FREE tile (megaphone icon, a timer matching the Car Hunt event) is the owner's "audio ad relay offers"**: it lists
the rewards for playing and listening to ads in the game. It was missing from the main menu right after a race but came back
after the game restarted (7h 08m), so it is not consumed by racing. The owner decided it takes too many steps and should
**not** be automated; the bot deliberately uses only the first two tiles (`TILE_SOURCES`).

## Overnight setup used last (2026-10-21)

Only the emulator ran: `node ad-bot.js --loop --serial emulator-5554`. The tablet had been run until every ad said
"COME BACK LATER" and was stopped. The Windows game was running as well; the owner said to simplify, so it was closed (a
graceful WM_CLOSE, like the X button) and no AutoHotkey bot was run. Reasons: one Gameloft account means shared ad timers and a
cloud-save mismatch whenever two copies run, and only the Android bot loops, restarts the game and recovers a crashed emulator.
The AHK bots stop after 3 idle minutes and never resume, so they are not suited to unattended use without a wrapper.

## First unattended night (emulator only, ~8 h): what it did

13 ads (4 AD RELAY OFFERS, 8 AD REWARDS, 1 other), 3 scheduled 2-hour game restarts, 1 stuck ad (a 240 s timeout and a game
restart), no emulator crashes, no errors. Coins 2,350,934 -> 2,375,934. The game rolled over to new events overnight (new Car
Hunt and Special Event; the third FREE tile came back with 22h). One flaw: at 09:02 UTC the bot spent 4.5 minutes alternating
NEXT/OK taps (1372,676 and 1120,676) and a popup X (1320,111) on a screen it misread, after opening AD RELAY OFFERS
(that tap landed at x=201, between the layouts the tile row has with and without the leading document icon), until the game
left the foreground by itself. The screen was not captured. **Fix: a loop breaker** (`noteDismissTap`): 14 NEXT/OK or popup-X
taps within 2 minutes restarts the game. If that ever fires, save a frame at that moment and find out what screen it is.

Timestamps in the bot's logs are **UTC** (the owner's PC is 5 hours behind).

## Unity "Open Store ⏭" skip (added on the owner's report, not yet seen live)

Unity ads (e.g. Hill Climb Racing 2) show a pill at the top right while the video still plays; its UI-tree text is
**"Skip Open Store"** (the label says "Open Store" but it skips). The owner watched it: the reward is already paid when it
shows. The bot used to ignore it (`NEVER_TAP` blocks anything with "open") and waited out the whole video, up to a minute per
ad. `adDismissTarget` now taps it at once, on the skip glyph at the pill's right end. If a Unity ad ever stops paying, this is
the first thing to suspect: look for `Unity skip (reward already paid)` in the log and revert that rule.

## AppLovin "dead" end cards (fixed on the owner's tip; verified by hand, the automated version not yet seen live)

(The paragraph below replaces an earlier "known weak spot" note about dead AppLovin playables.)

AppLovin MAX test ads ("Congrats! You're seeing a test ad.") can sit on a static end card for minutes with **no UI tree at all
and no visible button**. The bot took them for dead and waited out the 4-minute timeout, three BACKs and a game restart
(about 6 minutes each). They are not dead and **the reward is already paid** (coins moved +50,000 and wrench +25,000 across
that ad and a relay one). The owner's tip: tap the screen and a small "▶| Google Play" skip pill fades in at the top left for
only a couple of seconds. Tapping it ends the ad, opens the Play Store (the bot backs out) and leaves an end card with an X at
the top right that `findAdCornerX` finds. So `appLovinReveal`: after 60 s on an AppLovin activity with no target, one adb call
taps the black margin (0.13w, 0.5h) then 0.6 s later the pill (0.079w, 0.058h), at most 5 tries 20 s apart. Both taps land on
black margin if the pill is not there. The tablet's frozen "Bus Fever" playable was probably the same kind of thing but was
never tested with this trick (BACK did nothing there).

## Unity skip pill that flashes (on-device watcher; unit-tested and run once on the tablet, not yet seen catching a live pill)

The "Skip Open Store" rule above never fired on the tablet (0 taps in a day) because the pill is on screen for about a second
and a check from the PC (adb dump, parse in Node, adb tap) takes 0.4 to 7 s while a video animates. The owner also pointed out
the button is "ready" yet hides. `android/skipwatch.sh` now runs **on the device**: it loops `uiautomator dump`, greps the tree
for `Skip Open Store`, computes the tap (45% of the pill's height in from its right edge) and taps, all in one process.
`unityFastSkip` pushes and runs it for up to 8 s per call, up to 6 calls per Unity ad, starting 6 s in; normal checks resume
afterwards (they still find the Close button). Tablet pill bounds seen: [125,61][529,161] (top left); emulator: top right.
`.gitattributes` forces LF on `*.sh` so Windows checkouts do not break the script. If it still misses, the next step is blind
taps on the pill's known spots, or a faster loop than uiautomator allows.

## Tablet AppLovin privacy end card: hairline X (fixed, verified live)

On the Tab S11 an AppLovin ad ended on a "Privacy Management / GET / Interested / Not interested" card whose only exit is a
hairline ✕ at the top right (arms ~9 px, 2560x1600). The corner detector only tried glyph halves of ~27 and ~18 px, so it
saw nothing and the bot sat on the card, doing useless reveal taps, until the owner noticed. `findAdCornerX` now also tries
a third size (0.33 x the base), **only in the top-right corner**, because in the top-left it matches the "play-skip" glyph of
AppLovin's Google Play pill. Tests cover both. Lesson: when a close button is visible on screen and the bot ignores it,
measure the glyph in a saved frame before touching anything else.

## Ideas not done

Detect dead playables sooner than the 4-minute timeout; OCR the currency counters to log earnings; per-device config file;
a scheduler wrapper (Task Scheduler / launchd) around `--loop`; a way to answer the cloud-save prompt only on the owner's say-so.
