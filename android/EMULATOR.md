# Setting up the Android emulator

Use this if you want the bot to run on your computer without a physical device. For a real tablet or phone see
[TABLET.md](TABLET.md). Once the emulator is set up, running the bot is the same for both: [RUNNING.md](RUNNING.md).

## Which emulator: Android Studio's AVD

The bot depends on ADB, and the Android Studio emulator has it built in. BlueStacks Air is a possible fallback, but its
ADB support was not confirmed. Use a system image that has **Google Play**.

## Windows

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

   Start it cold: `emulator -avd <name> -no-snapshot-load` (the `emulator` program is in
   `%LOCALAPPDATA%\Android\Sdk\emulator`).
5. In the emulator, sign in to Google Play, install **Asphalt 8: Airborne**, sign in to your Gameloft account (progress
   restores). The first launch downloads about 2.5 GB of asset packs, so expect a long wait on the Gameloft logo.
6. `adb devices` should list `emulator-5554` (adb is in `%LOCALAPPDATA%\Android\Sdk\platform-tools`; the bot finds it on
   its own).

## Mac (not tested)

Same idea with an **arm64** image:

1. Install Android Studio and finish the wizard.
2. Virtual Device Manager > Create Device > Pixel 4 > Google Play **arm64-v8a** system image, API 35 (not the 16 KB one).
3. Edit `~/.android/avd/<name>.avd/config.ini` with the values above (RAM, cores, storage, `hw.lcd.*`, `hw.keyboard`).
   Try `hw.gpu.mode=host` first on Apple Silicon (it uses Metal); if the game loops on the Gameloft logo, switch to
   `swangle` as described under Troubleshooting.
4. `echo 'export PATH="$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$PATH"' >> ~/.zshrc`
5. `emulator -avd <name> -no-snapshot-load`, install the game, then `node ad-bot.js --probe` to check the bot can see the
   screen. Run `node test.js` as well. The screenshots in `samples/` are 1520x720 (the 720x1520 display in landscape),
   so a different emulator resolution changes pixel positions in some tests.

Install Node on the Mac with `brew install node`.

## Why those values

- **720x1520 set in `config.ini`, not with `adb shell wm size`.** Changing the size at runtime makes ad WebViews lay out
  against the old physical size, so some ads draw wider than the screen and their close X ends up off-screen (stuck ads).
  The smaller size also keeps software rendering fast.
- **`swangle` (software GPU).** The `host` GPU mode sent the game into an endless `eglGetConfigAttrib ... EGL_BAD_CONFIG`
  loop on the Gameloft logo. Menus and ads are fine in software; races would be slow.
- **6 GB RAM.** 4 GB made the guest swap until it crawled.
- **`hw.keyboard=yes`** lets you type into the emulator. The game then shows a "Press any key" keyboard overlay on every
  launch, which the bot dismisses; set it back to `no` for a bot-only emulator if you prefer.

## Troubleshooting

- **Game sits on the Gameloft logo forever.** `adb logcat -d --pid=$(adb shell pidof com.gameloft.android.ANMP.GloftA8HM)`.
  If it is full of `EGL_BAD_CONFIG`, use `hw.gpu.mode=swangle` and cold boot (see above).
- **`adb failed ... ETIMEDOUT` over and over in the bot's log.** The emulator's graphics got stuck (seen once after a long
  idle: `adb shell echo` answers but `screencap` never returns). Restart it with
  `adb -s emulator-5554 emu kill`, then `emulator -avd <name> -no-snapshot-load`.
- **An ad never closes.** Usually a playable ad (ironSource) whose close X is off-screen; check that the display size is
  set in `config.ini` and that `adb shell wm size` shows no "Override size".
- **Hardware keyboard does nothing.** `hw.keyboard=yes` in `config.ini`, then restart the emulator.
- **Screenshots from PowerShell.** `adb exec-out screencap -p > shot.png` corrupts the PNG in Windows PowerShell. Use
  `node ad-bot.js --shot shot.png`, Git Bash or cmd.
- **Git Bash mangles `adb shell /sdcard/...` paths.** Set `MSYS_NO_PATHCONV=1`.
- **Cloud save prompt.** If the emulator and a tablet use the same Gameloft account, the game may ask which copy of your
  data to keep; see "Sharing one account" in [RUNNING.md](RUNNING.md).
