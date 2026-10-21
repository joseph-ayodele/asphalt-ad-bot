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

`cd android && node test.js` (40 checks at last count). It runs the detectors on `android/samples/*.png` (real frames from
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

## Ideas not done

Detect dead playables sooner than the 4-minute timeout; OCR the currency counters to log earnings; per-device config file;
a scheduler wrapper (Task Scheduler / launchd) around `--loop`; a way to answer the cloud-save prompt only on the owner's say-so.
