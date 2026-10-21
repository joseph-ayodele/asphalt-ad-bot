# Asphalt 8 ad bot

Bots that watch the in-game ads in Asphalt 8: Airborne and collect the rewards. There are two bots, one per version of
the game, and the Android one runs on either an emulator or a real tablet.

| | folder | game version | needs the game window in front? | best for |
|---|---|---|---|---|
| **Android emulator** | [`android/`](android) | Android, in an emulator | **no** | working on the same computer while it runs |
| **Android tablet / phone** | [`android/`](android) | Android, on a real device | **no** | fastest and lightest; just a cable to any computer |
| **Windows AutoHotkey** | [`windows-ahk/`](windows-ahk) | Windows (Microsoft Store) | **yes** (it moves the real mouse) | the original setup |

The emulator and the tablet share the same code and the same folder: it is the same bot, pointed at a different device.

## Start here

- **Android (emulator or tablet):** [`android/RUNNING.md`](android/RUNNING.md) has the steps to run it repeatedly, in the
  background, and from Windows or a Mac. Device setup: [`android/EMULATOR.md`](android/EMULATOR.md),
  [`android/TABLET.md`](android/TABLET.md).
- **Windows AutoHotkey:** [`windows-ahk/README.md`](windows-ahk/README.md).

In short, from `android/`:

```
node ad-bot.js --devices
node ad-bot.js --mode all --loop --serial <id>
node ad-bot.js --stop
```

## Good to know

- The Android bot needs only Node.js 18+ and adb; there is nothing to install with npm.
- The emulator and a tablet signed in to the same Gameloft account can disagree about your save. Run on one device at a
  time, and pick the copy with more progress if the game asks. Details in `android/RUNNING.md`.
- These bots click through in-game rewarded ads for you. Using automation may go against the game's or the ad networks'
  terms, so use them at your own risk.
