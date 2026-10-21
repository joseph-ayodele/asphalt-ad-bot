# Running the Android bot

The steps are the same for the emulator and for a real tablet or phone, and on Windows and macOS. Run every command from
this `android/` folder. If a device is not set up yet, start with [EMULATOR.md](EMULATOR.md) or [TABLET.md](TABLET.md).

## What you need

1. **Node.js 18 or newer** (`node --version`). On a Mac: `brew install node`.
2. **adb** (Android platform-tools). The bot finds the copy inside Android Studio's SDK by itself. If you installed it
   elsewhere, set the `ADB` environment variable to the adb executable.
3. **A device with Asphalt 8 installed and signed in**: the emulator, or a tablet with USB debugging on.

No `npm install` is needed; the bot has no dependencies.

## The short version

```
cd android
node ad-bot.js --devices                                   # which devices are connected
node ad-bot.js --mode all --loop --serial <id>             # run it, and keep running
node ad-bot.js --stop                                      # stop it (from any terminal)
```

If only one device is connected you can leave out `--serial`. `npm start` is shorthand for
`node ad-bot.js --mode all --loop` (`npm start -- --serial <id>` to pick a device).

## Running it repeatedly

`--loop` is what makes it repeat. The bot plays every ad that is available (garage buttons, **AD REWARDS**, **AD RELAY
OFFERS**). When it finds nothing left to click for 5 minutes, it waits and checks again, forever, until you stop it.

| flag | effect |
|---|---|
| `--loop` | wait 30 minutes between checks |
| `--loop 60` | wait 60 minutes between checks |
| *(no `--loop`)* | do what is available, then exit |
| `--max 10` | stop after 10 ads |

In our testing the garage buttons came back within about 3 hours, and the ad tiles show their own timers, so a check
every 30 to 60 minutes loses little. Each ad takes 30 to 70 seconds and the garage allowed about a dozen per refresh.

## Which ads (`--mode`)

| mode | plays |
|---|---|
| `all` (default) | the garage / main-menu PLAY AD! buttons, then AD REWARDS and AD RELAY OFFERS |
| `garage` | the two PLAY AD! buttons in the top bar only (coin and wrench) |
| `coin`, `wrench` | just one of those |
| `relay` | just AD REWARDS and AD RELAY OFFERS |

## Run it in the background

Close-the-window-and-keep-going versions. `--stop` works the same on both systems.

**Windows (PowerShell):**

```powershell
Start-Process node -ArgumentList 'ad-bot.js','--mode','all','--loop','--serial','<id>' -WindowStyle Hidden `
  -RedirectStandardOutput run.out -RedirectStandardError run.err
Get-Content ad-bot.log -Wait -Tail 20       # watch it (Ctrl+C leaves the bot running)
node ad-bot.js --stop
```

**Mac (Terminal):**

```bash
nohup caffeinate -i node ad-bot.js --mode all --loop --serial <id> > run.out 2>&1 &
tail -f ad-bot.log                          # watch it (Ctrl+C leaves the bot running)
node ad-bot.js --stop
```

`caffeinate -i` stops the Mac from sleeping while the bot runs. Without it a sleeping Mac drops the ADB connection.

## Keep things awake

- **The computer** must not sleep while the bot runs (Windows: Settings > System > Power > Screen and sleep > set
  "plugged in" sleep to Never).
- **A tablet** should be plugged in. The game keeps its screen on while it is in front; Developer options > Stay awake
  also helps.
- **The emulator** can be covered by other windows or sit on another monitor. It does not need focus.

## Using a different computer

A device can only be driven by one computer at a time.

- **Tablet:** unplug it and plug it into the other computer, or use Wireless debugging (see [TABLET.md](TABLET.md)) so it
  can be reached from either one. Then run the same commands there. Clone the repo on that computer first; nothing else
  needs copying.
- **Emulator:** it lives on the computer that runs it. Set one up per computer with EMULATOR.md.
- Windows and Mac use identical commands; only the background-run snippet and the sleep settings above differ.

Stop it on the old computer first (`node ad-bot.js --stop`), or two bots will fight over the device.

## Sharing one account

The emulator and the tablet both sign in to the same Gameloft account. Each keeps its own copy of the save, so after
running ads on both the game can ask: *"We have detected a different version of your data in the cloud. Do you want to
use it?"* The bot never answers that; it is your save. Pick the copy with the higher numbers (stars, play time, coins).

The easiest way to avoid it is to run the bot on one device at a time and let the game finish syncing before you switch.
You can also run one bot per device (`--serial <id>` in two terminals; each has its own pid file), but expect the prompt.

## What it will and will not tap

It taps PLAY AD!, the ad's own close button, popup X's, NEXT/OK and a few menu icons. It never taps buttons labelled
install / download / open / buy / shop and never taps green (purchase) pixels. When an ad opens Google Play it presses
BACK. If an ad will not close after 4 minutes it presses BACK, and as a last resort restarts the game (that ad's reward is
lost).

## When something goes wrong

| what you see | what to do |
|---|---|
| `no Android device found` | emulator not running, cable/USB debugging off, or `adb devices` is empty |
| `more than one device connected` | add `--serial <id>` (ids from `--devices`) |
| `unauthorized` in `adb devices` | accept "Allow USB debugging?" on the device |
| `adb not found` | install platform-tools, or set `ADB` to the adb executable |
| `A bot is already running for ...` | `node ad-bot.js --stop`, then start again |
| `adb failed ... ETIMEDOUT` repeating (emulator) | the emulator's graphics froze; restart it ([EMULATOR.md](EMULATOR.md)) |
| `empty screencap` repeating (tablet) | the screen is off or locked: wake and unlock it, check the cable |
| it keeps saying "nothing to click" | no ads left right now, or the game is on a screen it does not know; see `ad-bot.log` |
| the game asks which save to keep | see "Sharing one account" above |

Everything the bot does is in `ad-bot.log` (next to `ad-bot.js`). To see what it thinks of the current screen without
tapping anything: `node ad-bot.js --probe`. To check the detectors against the saved screenshots: `node test.js`.
