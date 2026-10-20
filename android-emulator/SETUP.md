# Asphalt 8 ad bot: Android emulator version

Runs the game in an Android emulator and drives it over ADB (`screencap` for eyes, `input tap` for hands). ADB needs no
window focus, no visible window and no mouse, so the emulator can sit behind other windows or on another monitor while
you work. This replaces the AutoHotkey bots in the repo root, which need the game window in front.

The bot is `ad-bot.js`: plain Node, no npm packages. Developed and tested on Windows; the Mac steps below are untested.

## What the bot does

```
node ad-bot.js --mode all        # default for most people
```

| mode | clicks |
|---|---|
| `coin` | the gold-coin PLAY AD! 10,000 button in the top bar (garage and main menu) |
| `wrench` | the purple-wrench PLAY AD! 10,000 button |
| `garage` | both of the above |
| `relay` | PLAY AD! on the Ad Relay Offers screen (it opens the screen itself from the main menu) |
| `all` | garage buttons first, then the relay |

Other flags: `--max N` (stop after N ads), `--serial emulator-5554`, `--probe` (one detection pass on the live screen, no
taps), `--shot out.png` (save the screen), `--test frame.png` (run the detectors on a saved screenshot). Ctrl+C stops it.
It logs to the console and to `ad-bot.log`.

One cycle: PLAY AD! -> ad plays -> dismiss the store promo card -> ad close X -> game promo popup X -> reward screen
NEXT -> next ad. It also gets past the title screen, "wake clicks" empty floor when the menu hides its buttons, closes
Google Play if an ad opens it, restarts the game if an ad will not close (after 4 minutes and three BACK presses), and
stops after 5 idle minutes ("out of ads").

Safety: it never taps buttons labelled install / download / open / buy / shop, never taps green (purchase) pixels, and
only presses BACK in places where it is known to be safe (see Troubleshooting).

### How it reads the screen

- **Game screens** (Unity, no UI tree): raw `screencap` (RGBA, 16-byte header) and pixel tests in `ad-bot.js`: the
  PLAY AD! buttons are found by their pure-red marker triangle, NEXT is a white box with dark text, popup X's by shape.
- **Ad screens** (real Android views): `uiautomator dump`. Each ad network labels its close button differently
  (resource id, content-description or visible text); see `adDismissTarget`. If the tree has nothing, it looks for an X
  in the top corners by shape.

Ad networks seen so far: Fyber/Inneractive, Google AdMob, Meta Audience Network, Unity Ads, ironSource.

### Tests

```
node test.js
```

Runs the detectors on the screenshots in `samples/` and the UI-tree matcher on synthetic trees. To add a case, save a
frame with `node ad-bot.js --shot samples/<name>.png` and add an assertion in `test.js`.

## Emulator choice: Android Studio's AVD

AVD wins because the whole bot depends on ADB. BlueStacks Air is a possible fallback, but its ADB support was not
confirmed. Use an image with **Google Play**.

## Install (Windows)

A Windows PC is x86_64, so pick an **x86_64** image.

1. Install Android Studio and finish the first-run wizard so the Android SDK gets installed (Welcome screen >
   Projects > More Actions > SDK Manager if it skipped that).
2. Turn on **Windows Hypervisor Platform** (Start > "Turn Windows features on or off"), reboot.
3. Welcome screen > Projects > More Actions > **Virtual Device Manager** > **+**. Pick **Pixel 4**, then the plain
   **Google Play** x86_64 image, **API 35**. Do not pick a "16 KB Page Size" or preview image.
4. The wizard cannot set a true low resolution, so edit the AVD's config file instead. Stop the emulator, then in
   `%USERPROFILE%\.android\avd\<name>.avd\config.ini` set:

   ```
   hw.ramSize=6144
   hw.cpu.ncore=8
   disk.dataPartition.size=16G
   hw.gpu.mode=swangle
   hw.lcd.width=720
   hw.lcd.height=1520
   hw.lcd.density=293
   hw.keyboard=yes
   ```

   Start it cold: `emulator -avd <name> -no-snapshot-load`.
5. In the emulator, sign in to Google Play, install **Asphalt 8: Airborne**, sign in to your Gameloft account (progress
   restores). The first launch downloads about 2.5 GB of asset packs, so expect a long wait on the Gameloft logo.
6. Check ADB: `adb devices` should list `emulator-5554` (adb is in `%LOCALAPPDATA%\Android\Sdk\platform-tools`; the bot
   finds it on its own).

Why those values:

- **720x1520 set in `config.ini`, not with `adb shell wm size`.** Changing the size at runtime makes ad WebViews lay out
  against the old physical size, so some ads draw wider than the screen and their close X ends up off-screen (stuck ads).
  The smaller size also keeps software rendering fast.
- **`swangle` (software GPU).** The `host` GPU mode sent the game into an endless `eglGetConfigAttrib ... EGL_BAD_CONFIG`
  loop on the Gameloft logo. Menus and ads are fine in software; races would be slow.
- **6 GB RAM.** 4 GB made the guest swap until it crawled.
- **`hw.keyboard=yes`** lets you type into the emulator. The game then shows a "Press any key" keyboard overlay on every
  launch, which the bot dismisses; set it back to `no` for a bot-only emulator if you prefer.

## Install (Mac)

Not tested. Same idea with an **arm64** image:

1. Install Android Studio and finish the wizard.
2. Virtual Device Manager > Create Device > Pixel 4 > Google Play **arm64-v8a** system image, API 35 (not the 16 KB one).
3. Edit `~/.android/avd/<name>.avd/config.ini` with the values above (RAM, cores, storage, `hw.lcd.*`, `hw.keyboard`).
   Try `hw.gpu.mode=host` first on Apple Silicon (it uses Metal); if the game loops on the Gameloft logo, switch to
   `swangle` as described under Troubleshooting.
4. `echo 'export PATH="$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$PATH"' >> ~/.zshrc`
5. `emulator -avd <name> -no-snapshot-load`, install the game, then `node ad-bot.js --probe` to check it can see the
   screen. Run `node test.js` as well; the detectors are resolution-based, so the screenshots in `samples/` are 1520x720
   (the 720x1520 display in landscape). A different resolution means different pixel positions for some tests.

Node is needed on the Mac (`brew install node`).

## Troubleshooting

- **Game sits on the Gameloft logo forever.** `adb logcat -d --pid=$(adb shell pidof com.gameloft.android.ANMP.GloftA8HM)`.
  If it is full of `EGL_BAD_CONFIG`, use `hw.gpu.mode=swangle` and cold boot (see above).
- **An ad never closes.** Usually a playable ad (ironSource) whose close X is off-screen; check that the display size is
  set in `config.ini` and that `adb shell wm size` shows no "Override size". The bot presses BACK, then restarts the game
  as a last resort (that ad's reward is lost).
- **BACK exits the game.** On the plain main menu, BACK leaves the game. The bot only presses it for a popup whose X it
  cannot see, and only when a bright popup panel is on screen with the SHOP button dimmed, for several scans in a row,
  within 90 seconds after an ad. If the game ever lands on the home screen it reopens itself.
- **Hardware keyboard does nothing.** `hw.keyboard=yes` in `config.ini`, then restart the emulator.
- **Screenshots from PowerShell.** `adb exec-out screencap -p > shot.png` corrupts the PNG in Windows PowerShell. Use
  `node ad-bot.js --shot shot.png`, Git Bash or cmd.
- **Git Bash mangles `adb shell /sdcard/...` paths.** Set `MSYS_NO_PATHCONV=1`.

## Status and known gaps

- Verified live on Windows: coin and wrench PLAY AD! buttons, ads from Fyber, AdMob, Meta and Unity, store-promo cards,
  game promo popups (several styles), NEXT, popups after ads, title screen, restart recovery. About 11 rewarded ads in
  7 minutes before the garage quota ran out. ironSource was only seen while the display was resized with `wm size`
  (stuck, see Troubleshooting); it has not been seen again since the size moved into `config.ini`.
- **Ad Relay Offers:** navigation (main menu -> relay tile -> back) is verified live, and the "COME BACK LATER" state is
  handled. Its orange PLAY AD! button could not be captured because the relay was exhausted for the day when this was
  written; the detector is tested against a simulated button on the real screen, and the ad flow after the click reuses
  the garage code. Treat the first real relay run as the check.
- Faint-X popups are closed with BACK, not by tapping an X.
- ironSource playables sometimes still get stuck at the end-card and need the 4-minute timeout.
- Ad networks may behave differently over time; if one gets stuck, save a frame and the UI tree
  (`adb exec-out uiautomator dump /dev/tty`) and extend `adDismissTarget`.
