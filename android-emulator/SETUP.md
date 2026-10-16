# Asphalt 8 ad bot: Android emulator version

Goal: run the game in an Android emulator on the Mac and drive it over ADB (`screencap` for eyes, `input tap` for
hands). ADB needs no window focus, no visible window and no mouse, so the Mac stays free to use.

## Which emulator: Android Studio's emulator (AVD)

| | Android Studio AVD (recommended) | BlueStacks Air |
|---|---|---|
| Apple Silicon | native arm64 image, fast | native, fast |
| ADB | built in, always on | not confirmed for Air; check Settings > Advanced before relying on it |
| Google Play | use a `google_apis_playstore` image | built in |
| Install effort | bigger download, a few steps | one DMG |
| Cost | free | free (shows its own ads) |

AVD wins because the whole bot depends on ADB. BlueStacks Air is the fallback if the game refuses to run on an AVD.
x86 / x86_64 images are unusable on Apple Silicon; always pick `arm64-v8a`. On an Intel Mac, pick x86_64 instead.

## Install (Mac)

1. Install Android Studio (https://developer.android.com/studio), open it once and finish the setup wizard.
2. More Actions > Virtual Device Manager > Create Device.
   - Hardware: a Pixel phone or tablet whose list row shows the Play Store icon.
   - System image: a recent API level that says **Google Play** and arm64. Download it.
   - Advanced settings: RAM 4 GB, enable hardware keyboard, graphics = Hardware.
3. Add `adb` to your shell: `echo 'export PATH="$HOME/Library/Android/sdk/platform-tools:$HOME/Library/Android/sdk/emulator:$PATH"' >> ~/.zshrc`
4. Start it and check the bot's channel works:
   ```bash
   emulator -list-avds
   emulator -avd <name>          # or press play in Device Manager
   adb devices                   # should list emulator-5554
   adb exec-out screencap -p > shot.png
   ```
5. In the emulator, sign in to Google Play and install **Asphalt 8: Airborne**. Sign in to your Gameloft account to
   try to restore progress.

## Resolution

The bot's detectors are fractions of the screen, but the image templates (`close-x.png`, `close-ring.png`) are pixel
matches, so pick one resolution and keep it. Suggested: 1920x1080, landscape, 320 dpi. Change it with
`adb shell wm size 1920x1080` if the AVD profile differs.

## Next step: capture real frames

The AutoHotkey bots are tuned to the Windows version's layout. Before any detection code can be written, I need real
screenshots from your emulator. Once the game is installed, capture these with
`adb exec-out screencap -p > <name>.png` and put them in `samples/`:

1. Garage / offers screen with the PLAY AD! button visible
2. An ad playing (early, and near the end)
3. The ad's close X, and any round X on an end card
4. The reward screen with NEXT / OK
5. A promo popup with its X
6. The gold-coin and purple-wrench PLAY AD! buttons in the garage (if they exist on Android)

## Open risks

- Not confirmed that the Android build has the same Ad Relay Offers and garage ad buttons as the Windows build.
- Ad networks sometimes serve fewer or no ads to emulators.
- Gameloft or the ad SDK may detect the emulator.
