# Using a real Android tablet or phone

The same bot that drives the emulator drives a real device over a USB cable (tested on a Galaxy Tab S11: 2560x1600,
Android 16). No emulator is involved, so the game runs at full speed and your computer stays free. Once the device is
set up, see [RUNNING.md](RUNNING.md) for how to run the bot.

## One-time setup on the device

1. Enable Developer options: Settings > About tablet > Software information > tap **Build number** 7 times.
2. Samsung only: turn **Auto Blocker** off (Settings > Security and privacy > Auto Blocker). It blocks USB commands.
3. Settings > Developer options > turn on **USB debugging**. Optionally turn on **Stay awake** (screen stays on while
   charging).
4. Install **Asphalt 8: Airborne** from Google Play and sign in to your Gameloft account.

## Connect it to a computer

1. Plug it in with a cable that carries data. On the device pull down the USB notification and choose **File transfer**
   rather than Charging only.
2. Accept **Allow USB debugging?** and tick "Always allow from this computer".
3. Check from the computer:

   ```
   cd android
   node ad-bot.js --devices
   ```

   You should see your device's serial number (for example `R5GL23LWH5A  device  SM_X730`). `unauthorized` means the
   dialog on the device still needs accepting; an empty list means a different cable or port.

Cable-free alternative (works on Windows and Mac, untested here): Developer options > **Wireless debugging** > Pair
device with pairing code, then on the computer `adb pair <ip>:<pairing-port>` and `adb connect <ip>:<port>`. The device
then shows up as `<ip>:<port>` in `--devices`. Both must be on the same Wi-Fi.

## Things to know

- **Keep it plugged in and awake.** The game keeps the screen on while it is in front, but charge it anyway and lower the
  brightness; the screen is on for as long as the bot runs.
- **Real ads, real device.** If an ad ever gets stuck, the bot presses BACK and then restarts the game. It never taps
  install / open / buy buttons.
- **Layout differs from the emulator**, which is why the bot finds things by what they look like instead of fixed
  positions: PLAY AD! buttons by their red marker, ad tiles by their green FREE tags, ad screens by the long red TIME
  LEFT ribbon. The tablet's frames are in `samples/tablet-*.png` (and used by `node test.js`). A different device with a
  very different aspect ratio may need more calibration: save frames with `node ad-bot.js --shot samples/<name>.png`.
- **The tablet and the emulator share one Gameloft account.** See "Sharing one account" in [RUNNING.md](RUNNING.md).
- **The game screen sometimes returns an empty screenshot** on real devices; the bot retries on its own.
