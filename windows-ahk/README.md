# Windows AutoHotkey bots

The original bots. They click ads in the **Windows (Microsoft Store) version** of Asphalt 8: Airborne by looking at the
game window and moving the real mouse. Because of that the game window has to be visible on screen (it can be on your
second monitor, but not covered or minimized), and the mouse jumps briefly on every click.

If you want to keep using the computer freely, use the Android bot in [`../android`](../android) instead.

## The bots

Each is an [AutoHotkey v2](https://www.autohotkey.com/) script. Double-click one, or run it with AutoHotkey v2.

| script | clicks |
|---|---|
| `ad-bot.ahk` | PLAY AD! on the **Ad Relay Offers** screen (open that screen first) |
| `coin-ad-bot.ahk` | the gold-coin PLAY AD! 10,000 button in the garage |
| `wrench-ad-bot.ahk` | the purple-wrench PLAY AD! 10,000 button in the garage |

Run one at a time; they all use the mouse. Each handles the whole cycle: PLAY AD! -> close the ad -> NEXT on the reward
screen -> close promo popups -> repeat, and stops when nothing is left to click for 3 minutes.

Hotkeys while a bot runs: **F8** pause/resume, **F9** show what the bot currently sees, **F10** quit.
`/probe` as a command-line argument prints one detection pass and exits without clicking.

While another window has focus the scripts keep telling the game it is still the active window, so ads keep playing when
you work on your other monitor.

## Stopping

Double-click **`Stop bots.lnk`**, or run `stop-bots.ps1`. It stops only the bots in this folder; other AutoHotkey scripts
keep running. (The shortcut points at this folder's path on this computer; recreate it if you move the repo.)

## Files

| file | |
|---|---|
| `*.ahk` | the three bots |
| `close-x.png`, `close-ring.png`, `wrench-play.png` | image templates the bots search for; keep them next to the scripts |
| `stop-bots.ps1`, `Stop bots.lnk` | stop the bots |
| `*.log` | what each bot did (not tracked in git) |
