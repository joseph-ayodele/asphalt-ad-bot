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

## The order ads are played in

Most wanted first. The default order is:

1. **AD RELAY OFFERS** (second FREE tile on the main menu)
2. **AD REWARDS** (first FREE tile)
3. the **wrench** PLAY AD! button
4. the **coin** PLAY AD! button

The order is applied all the time, not just at the start. After "COME BACK LATER" a tile is checked again every 15
minutes, and as soon as a better source is available again the bot finishes the ad it is on and goes back to it before
continuing with the lesser ones. Change the order, or leave sources out, with `--order`:

```
node ad-bot.js --loop --order relay,rewards,wrench,coin      # the default
node ad-bot.js --loop --order rewards,coin                   # only these two, in this order
```

There may be a daily cap on ads that we have not seen; when a source stops offering ads the bot simply moves down the
list and comes back to it later.

Presets for `--order`, via `--mode`: see "Which ads" below.

## Running it repeatedly

`--loop` is what makes it repeat. The bot plays every ad that is available, best first. When it finds nothing left to
click for 5 minutes, it waits and checks again, forever, until you stop it.

| flag | effect |
|---|---|
| `--loop` | wait 30 minutes between checks |
| `--loop 60` | wait 60 minutes between checks |
| *(no `--loop`)* | do what is available, then exit |
| `--max 10` | stop after 10 ads |
| `--restart-hours 3` | restart the game every 3 hours (default 2 with `--loop`; `0` turns it off) |

In our testing the garage buttons came back within about 3 hours, and the ad tiles show their own timers, so a check
every 30 to 60 minutes loses little. Each ad takes 30 to 70 seconds and the garage allowed about a dozen per refresh.

## Overnight or indefinitely

```
node ad-bot.js --loop --serial <id>
```

is meant to be left running (see "Run it in the background" below for how to detach it). Things it does by itself:

- **Restarts the game every 2 hours**, only between ads, so a leaking or wedged app does not end the run. Change it with
  `--restart-hours`.
- **Restarts the emulator if it stops responding.** The emulator's graphics froze once after hours idle (adb answers, but
  screenshots never come back). After about 5 minutes of errors the bot restarts the emulator (`emulator -avd <name>
  -no-snapshot-load`), waits for it to boot, and starts the game again. This only applies to emulators. You can run the
  same recovery by hand with `node ad-bot.js --restart-emulator --serial emulator-5554`.
- **Recovers from stuck ads**: BACK, then a game restart after 4 minutes, and the ironSource skip button.
- **Re-checks ad sources** that said "COME BACK LATER" every 15 minutes, and everything after each idle wait.

You still need to keep the computer awake (see below) and, for the emulator, to have created it as described in
[EMULATOR.md](EMULATOR.md); the watchdog needs Android Studio's `emulator` program, which it finds in the SDK folder (or
set `ANDROID_SDK_ROOT`).

## Which ads (`--mode`)

`--mode` is a shortcut for `--order`:

| mode | same as |
|---|---|
| `all` (default) | `--order relay,rewards,wrench,coin` |
| `rewards` | `--order rewards` |
| `relay` | `--order relay,rewards` |
| `garage` | `--order wrench,coin` |
| `coin`, `wrench` | just that button |

## When the bot cannot find a close button: it asks Claude

The bot's own rules handle most ads. When an ad has been on screen for **60 seconds** and none of them can find anything to tap
(a new ad network, a faint or tiny button), the bot sends a picture of the two top corners of the screen to Claude (the cheap
Haiku model, through the `claude` command) and asks where the close or skip control is. It only taps an answer that passes its own
checks: the label must say close, skip or X (never install, download, learn more, buy, open, play, mute or info), the spot must not
be a green purchase colour, and a spot that already did nothing is not tried again. If a restart leaves the game stuck on a message
with a single OK button, it asks about that too, but never answers a question with two or more choices.

- **Needs** a logged-in `claude` command: run `claude auth login` once. If the login expires, the bot says so in its log, switches
  this feature off for the run after two failures, and carries on with its normal rules.
- **Limits**: at most 3 questions per ad, 25 seconds apart, 150 per day. Each takes about 10 seconds and costs roughly 1.5 to 2 cents
  at API prices (it uses your Claude Code login, not an API key). The day's count is in `ai-usage.json`.
- **Flags**: `--no-ai` never asks; `--ai-after 30` asks after 30 seconds instead of 60; `--ai-daily-max 50` lowers the daily cap.
- **In the log** look for `Claude (call 1/3 for this ad, 10 s, today 4 calls ~$0.07): tapping "Close (X)" at 2487,105`.
- The pictures are sent to Anthropic: ad screens and, for the stuck-screen question, your game screen (it shows your driver name).

## Run it in the background

Close-the-window-and-keep-going versions. `--stop` works the same on both systems.

**Windows (PowerShell):**

```powershell
Start-Process node -ArgumentList 'ad-bot.js','--mode','all','--loop','--serial','<id>' -WindowStyle Hidden `
  -RedirectStandardOutput run.out -RedirectStandardError run.err
Get-Content ad-bot-<id>.log -Wait -Tail 20      # watch it (Ctrl+C leaves the bot running)
node ad-bot.js --stop
```

**Mac (Terminal):**

```bash
nohup caffeinate -i node ad-bot.js --mode all --loop --serial <id> > run.out 2>&1 &
tail -f ad-bot-<id>.log                        # watch it (Ctrl+C leaves the bot running)
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
| `adb failed ... ETIMEDOUT` repeating (emulator) | the emulator's graphics froze. The bot restarts it by itself after a few minutes; to do it now: `node ad-bot.js --restart-emulator --serial emulator-5554` |
| `empty screencap` repeating (tablet) | the screen is off or locked: wake and unlock it, check the cable |
| it keeps saying "nothing to click" | no ads left right now, or the game is on a screen it does not know; see `ad-bot-<id>.log` |
| the game asks which save to keep | see "Sharing one account" above |

Everything the bot does is in `ad-bot-<id>.log` (next to `ad-bot.js`, one file per device, e.g. `ad-bot-emulator-5554.log`). To see what it thinks of the current screen without
tapping anything: `node ad-bot.js --probe`. To check the detectors against the saved screenshots: `node test.js`.
