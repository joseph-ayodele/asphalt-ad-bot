#Requires AutoHotkey v2.0
#SingleInstance Force
; Asphalt 8 garage bot: press the gold-coin "PLAY AD! 10,000" button -> close the ad -> NEXT/OK on any reward screen -> close popups -> repeat.
;   F8  pause / resume     F9  show what the bot currently sees     F10  quit
; Run with /probe to print one detection pass to stdout and exit without clicking.

WIN_TITLE := "Asphalt 8: Airborne ahk_exe ApplicationFrameHost.exe"
CLOSE_TEMPLATE := A_ScriptDir "\close-x.png"
RING_TEMPLATE := A_ScriptDir "\close-ring.png"
TICK_MS := 700
PLAY_COOLDOWN_MS := 6000        ; the offers screen stays visible a moment after PLAY AD!
FALLBACK_AFTER_MS := 300000     ; ads run up to ~150s, and a click on a still-playing ad pauses it or opens its store page
FALLBACK_EVERY_MS := 30000
FALLBACK_MAX := 4
POPUP_SCAN_EVERY_MS := 2000     ; the popup-X shape scan is the slow one
QUIET_BEFORE_POPUP_SCAN_MS := 6000
WAKE_AFTER_QUIET_MS := 3000
WAKE_EVERY_MS := 8000
IDLE_STOP_MS := 180000          ; nothing recognisable for this long -> relay finished or stuck
MAX_ADS := 0                    ; 0 = until the relay runs out

; Coordinates from DwmGetWindowAttribute are physical pixels; the script must match or clicks
; land in the wrong place on a scaled monitor.
DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")
CoordMode "Mouse", "Screen"
CoordMode "Pixel", "Screen"

global paused := false, inAd := false, adStart := 0, lastPlay := 0, lastSeen := A_TickCount
global fallbackCount := 0, lastFallback := 0, lastPopupScan := 0, lastWake := 0, adsStarted := 0

if !FileExist(CLOSE_TEMPLATE) {
    MsgBox "Missing " CLOSE_TEMPLATE
    ExitApp
}

if (A_Args.Length && A_Args[1] = "/probe") {
    FileAppend Describe() "`n", "*"
    ExitApp
}
; /test <window-sized png>: run the screenshot detectors on a saved capture instead of the screen.
if (A_Args.Length >= 2 && A_Args[1] = "/test") {
    s := LoadSnap(A_Args[2])
    w := {l: 0, t: 0, w: s.w, h: s.h, cap: Round(s.h * 40 / 1380), scale: 1}
    Found(b) => b ? b.cx "," b.cy : "no"
    FileAppend "AD " (AdPlaying(s, w) ? "yes" : "no") " | NEXT " Found(FindNext(s, w)) " | PLAY " Found(FindPlayAd(s, w)) " | popupX " Found(FindPopupX(s, w)) "`n", "*"
    ExitApp
}

F8:: {
    global paused := !paused, lastSeen := A_TickCount, adStart := A_TickCount, fallbackCount := 0
    Status(paused ? "PAUSED (F8 to resume)" : "running")
}
F9:: Status(Describe(), 8000)
F10:: ExitApp

Status("coin bot running - F8 pause, F9 status, F10 quit")
SetTimer KeepActive, 250
SetTimer Tick, TICK_MS

Tick() {
    global inAd, adStart, lastPlay, lastSeen, fallbackCount, lastFallback, lastPopupScan, lastWake, adsStarted
    DllCall("SetThreadDpiAwarenessContext", "ptr", -4, "ptr")
    if paused
        return
    w := GameRect()
    if !w {
        Status("game window not found")
        return
    }

    if FindAdCloseX(w, &x, &y) {
        Act("ad close X", x, y, 1500)
        inAd := false
        return
    }
    if FindRingX(w, &x, &y) {
        Act("ad round X", x, y, 1500)
        inAd := false
        return
    }

    s := Snap(w)
    adOn := AdPlaying(s, w)

    if !adOn && (b := FindNext(s, w)) {
        Act("NEXT/OK", w.l + b.cx, w.t + b.cy, 1500)
        inAd := false
        return
    }

    if !adOn && (A_TickCount - lastPlay > PLAY_COOLDOWN_MS) && (b := FindPlayAd(s, w)) {
        if (MAX_ADS && adsStarted >= MAX_ADS) {
            Stop("started " adsStarted " ads")
            return
        }
        adsStarted += 1
        Act("PLAY AD! (#" adsStarted ")", w.l + b.cx, w.t + b.cy, 0)
        lastPlay := adStart := A_TickCount
        inAd := true
        fallbackCount := 0
        Status("ad " adsStarted " playing")
        return
    }

    if inAd {
        lastSeen := A_TickCount
        ; Some ad networks draw a different close button; it still sits under the window's own close button.
        if (A_TickCount - adStart > FALLBACK_AFTER_MS && A_TickCount - lastFallback > FALLBACK_EVERY_MS) {
            if (fallbackCount >= FALLBACK_MAX) {
                Stop("ad would not close after " FALLBACK_MAX " blind clicks - close it by hand, then F8")
                return
            }
            fallbackCount += 1
            lastFallback := A_TickCount
            Act("blind ad-close " fallbackCount, w.r - Round(34 * w.scale), w.t + w.cap + Round(3 * w.scale), 1500)
        }
        return
    }

    ; Popups come in many styles (some dim the screen, some don't), so any quiet stretch with no ad playing triggers the X scan.
    if !adOn && (A_TickCount - lastSeen > QUIET_BEFORE_POPUP_SCAN_MS) && (A_TickCount - lastPopupScan > POPUP_SCAN_EVERY_MS) {
        lastPopupScan := A_TickCount
        if (p := FindPopupX(s, w)) {
            Act("popup X", w.l + p.cx, w.t + p.cy, 1500)
            return
        }
    }

    ; The menu hides its buttons after a few idle seconds; a click on empty floor brings them back. It does not
    ; refresh lastSeen, so a button that never returns (no ads left) still ends in the idle stop.
    if !adOn && (A_TickCount - lastSeen > WAKE_AFTER_QUIET_MS) && (A_TickCount - lastWake > WAKE_EVERY_MS) {
        lastWake := A_TickCount
        wx := w.l + Round(w.w * 0.78), wy := w.t + Round(w.h * 0.69)
        Log("wake click at " wx "," wy)
        SafeClick(wx, wy)
        return
    }

    if (A_TickCount - lastSeen > IDLE_STOP_MS)
        Stop("no PLAY AD! button for " IDLE_STOP_MS // 60000 " min - out of ads or on the wrong screen")
}

; Ads pause when the game loses focus. Only one window can hold focus, so while another one does, keep telling the
; game it is still the active window. Posted, not sent: a send to a busy window would freeze the bot.
KeepActive() {
    if !(frame := WinExist(WIN_TITLE)) || WinActive("ahk_id " frame)
        return
    core := DllCall("FindWindowEx", "ptr", frame, "ptr", 0, "str", "Windows.UI.Core.CoreWindow", "ptr", 0, "ptr")
    for hwnd in [frame, core] {
        if !hwnd
            continue
        PostMessage 0x0086, 1, 0, , "ahk_id " hwnd     ; WM_NCACTIVATE
        PostMessage 0x001C, 1, 0, , "ahk_id " hwnd     ; WM_ACTIVATEAPP
        PostMessage 0x0006, 1, 0, , "ahk_id " hwnd     ; WM_ACTIVATE
        PostMessage 0x0007, 0, 0, , "ahk_id " hwnd     ; WM_SETFOCUS
    }
}

Act(what, x, y, settleMs) {
    global lastSeen := A_TickCount
    Log(what " at " x "," y)
    SafeClick(x, y)
    if settleMs
        Sleep settleMs
}

; Visible frame of the game window (GetWindowRect includes invisible resize borders).
GameRect() {
    hwnd := WinExist(WIN_TITLE)
    if !hwnd
        return 0
    rect := Buffer(16)
    if DllCall("dwmapi\DwmGetWindowAttribute", "ptr", hwnd, "uint", 9, "ptr", rect, "uint", 16)
        return 0
    scale := DllCall("GetDpiForWindow", "ptr", hwnd, "uint") / 96
    l := NumGet(rect, 0, "int"), t := NumGet(rect, 4, "int"), r := NumGet(rect, 8, "int"), b := NumGet(rect, 12, "int")
    ; UWP caption bar is 32 DIPs; its close button would quit the game, so no click may land in it.
    return {hwnd: hwnd, l: l, t: t, r: r, b: b, w: r - l, h: b - t, scale: scale, cap: Round(32 * scale)}
}

; One BitBlt of the window per tick; PixelGetColor per pixel is far too slow for the shape scan.
Snap(w) {
    sdc := DllCall("GetDC", "ptr", 0, "ptr")
    mdc := DllCall("CreateCompatibleDC", "ptr", sdc, "ptr")
    bi := Buffer(40, 0)
    NumPut("uint", 40, "int", w.w, "int", -w.h, "ushort", 1, "ushort", 32, bi)
    bits := 0
    hbm := DllCall("CreateDIBSection", "ptr", mdc, "ptr", bi, "uint", 0, "ptr*", &bits, "ptr", 0, "uint", 0, "ptr")
    old := DllCall("SelectObject", "ptr", mdc, "ptr", hbm, "ptr")
    DllCall("BitBlt", "ptr", mdc, "int", 0, "int", 0, "int", w.w, "int", w.h, "ptr", sdc, "int", w.l, "int", w.t, "uint", 0x40CC0020)
    buf := Buffer(w.w * w.h * 4)
    DllCall("RtlMoveMemory", "ptr", buf, "ptr", bits, "uptr", buf.Size)
    DllCall("SelectObject", "ptr", mdc, "ptr", old)
    DllCall("DeleteObject", "ptr", hbm)
    DllCall("DeleteDC", "ptr", mdc)
    DllCall("ReleaseDC", "ptr", 0, "ptr", sdc)
    return {buf: buf, w: w.w, h: w.h}
}

LoadSnap(file) {
    hbm := LoadPicture(file)
    bm := Buffer(32, 0)
    DllCall("GetObject", "ptr", hbm, "int", bm.Size, "ptr", bm)
    sw := NumGet(bm, 4, "int"), sh := NumGet(bm, 8, "int")
    bi := Buffer(40, 0)
    NumPut("uint", 40, "int", sw, "int", -sh, "ushort", 1, "ushort", 32, bi)
    buf := Buffer(sw * sh * 4)
    dc := DllCall("GetDC", "ptr", 0, "ptr")
    DllCall("GetDIBits", "ptr", dc, "ptr", hbm, "uint", 0, "uint", sh, "ptr", buf, "ptr", bi, "uint", 0)
    DllCall("ReleaseDC", "ptr", 0, "ptr", dc)
    DllCall("DeleteObject", "ptr", hbm)
    return {buf: buf, w: sw, h: sh}
}

Px(s, x, y) => (x < 0 || y < 0 || x >= s.w || y >= s.h) ? 0 : NumGet(s.buf, (y * s.w + x) * 4, "uint") & 0xFFFFFF
MinCh(c) => Min(c >> 16, (c >> 8) & 0xFF, c & 0xFF)

IsOrange(c) {
    r := c >> 16, g := (c >> 8) & 0xFF, b := c & 0xFF
    return r > 200 && g > 110 && g < 225 && b < 90 && r - g > 25
}
IsDimOrange(c) {
    r := c >> 16, g := (c >> 8) & 0xFF, b := c & 0xFF
    return r > 30 && r < 120 && b < 15 && g >= r * 0.45 && g <= r * 0.85
}
IsWhite(c) => MinCh(c) > 230
IsBuyGreen(c) {
    r := c >> 16, g := (c >> 8) & 0xFF, b := c & 0xFF
    return g > 150 && g - r > 60 && g - b > 60
}

; The ad's X hides under the window's caption buttons; only the bottom of its glyph shows below the caption.
FindAdCloseX(w, &x, &y) {
    try {
        if ImageSearch(&fx, &fy, w.r - Round(120 * w.scale), w.t, w.r - 1, w.t + w.cap + Round(30 * w.scale), "*60 " CLOSE_TEMPLATE) {
            x := fx + 18
            y := Max(fy + 3, w.t + w.cap + Round(3 * w.scale))
            return true
        }
    }
    return false
}

; Playable end cards draw their own round X in the corner of the video area.
FindRingX(w, &x, &y) {
    try {
        if ImageSearch(&fx, &fy, w.r - Round(w.w * 0.12), w.t + w.cap, w.r - 1, w.t + w.cap + Round(w.h * 0.15), "*70 " RING_TEMPLATE) {
            x := fx + 36
            y := fy + 40
            return true
        }
    }
    return false
}

IsAdDownloadBlue(c) {
    r := c >> 16, g := (c >> 8) & 0xFF, b := c & 0xFF
    return b > 230 && r > 60 && r < 120 && g > 70 && g < 130
}

; The purple Download bar is on every playing ad and on no game screen; white or orange blocks in
; ad footage must not be taken for game buttons.
AdPlaying(s, w) => HasAdSidebars(s, w) || HasDownloadBar(s, w)

; Ads are letterboxed in solid black; game screens fill the window edge to edge.
HasAdSidebars(s, w) {
    for edge in [10, s.w - 11] {
        black := 0, n := 0, y := w.cap + 8
        while (y < s.h) {
            n += 1
            c := Px(s, edge, y)
            if ((c >> 16) <= 3 && ((c >> 8) & 0xFF) <= 3 && (c & 0xFF) <= 3)
                black += 1
            y += 8
        }
        if (n = 0 || black < n * 0.9)
            return false
    }
    return true
}

HasDownloadBar(s, w) => FindBlock(s, Round(w.w * 0.55), Round(w.h * 0.80), w.w - 1, w.h - 1, IsAdDownloadBlue, Round(w.w * 0.08), Round(w.h * 0.03))

; PLAY AD! sits in the bottom-right slot; NEXT / OK buttons sit higher on dialogs, so they get a taller region.
Region(s, w, x0Frac, y0Frac, pred, minWFrac, minHFrac) => FindBlock(s, Round(w.w * x0Frac), Round(w.h * y0Frac), w.w - 1, w.h - 1, pred, Round(w.w * minWFrac), Round(w.h * minHFrac))

IsGold(c) {
    r := c >> 16, g := (c >> 8) & 0xFF, b := c & 0xFF
    return r >= 140 && g >= 50 && r - g >= 30 && b <= 90
}

; The gold-coin "PLAY AD! 10,000" button under the currency bar: a gold gradient that shifts a pixel or so between
; frames, so it is measured as a colour blob. The box ends left of the purple-wrench button (that button is
; deliberately out of range) and is too short to reach the currency counters above or the car below.
FindPlayAd(s, w) {
    x1 := Round(w.w * 0.495), x2 := Round(w.w * 0.585), y1 := Round(w.h * 0.12), y2 := Round(w.h * 0.20)
    n := 0, minX := 99999, maxX := 0, minY := 99999, maxY := 0
    y := y1
    while (y < y2) {
        x := x1
        while (x < x2) {
            if IsGold(Px(s, x, y)) {
                n += 1
                minX := Min(minX, x), maxX := Max(maxX, x), minY := Min(minY, y), maxY := Max(maxY, y)
            }
            x += 3
        }
        y += 3
    }
    bw := maxX - minX, bh := maxY - minY
    ; The "AD REWARDS" title is also gold but thinner and lighter than the solid button.
    if (n < 900 || bw < Round(w.w * 0.05) || bh < Round(w.h * 0.05) || bw > Round(w.w * 0.12) || bh > Round(w.h * 0.075))
        return 0
    return {cx: (minX + maxX) // 2, cy: (minY + maxY) // 2}
}

; Ad end cards can be white too, so NEXT must also be a bounded box with dark text in the middle.
FindNext(s, w) {
    b := Region(s, w, 0.55, 0.60, IsWhite, 0.12, 0.05)
    if !b || IsWhite(Px(s, b.x - 12, b.cy)) || IsWhite(Px(s, b.x + b.bw + 12, b.cy))
        return 0
    y := b.cy - b.bh // 4
    while (y <= b.cy + b.bh // 4) {
        x := b.x + b.bw // 3
        while (x < b.x + 2 * b.bw // 3) {
            if MinCh(Px(s, x, y)) < 120
                return b
            x += 2
        }
        y += 3
    }
    return 0
}

; First solid block of pred-coloured pixels at least minW x minH, scanning rows top-down.
FindBlock(s, x1, y1, x2, y2, pred, minW, minH, step := 4) {
    y := y1
    while (y < y2) {
        x := x1
        while (x < x2) {
            if pred(Px(s, x, y)) {
                bw := RunLength(s, x, y + 6, step, 0, pred)
                bh := RunLength(s, x + 12, y, 0, step, pred)
                if (bw >= minW && bh >= minH)
                    return {x: x, y: y, bw: bw, bh: bh, cx: x + bw // 2, cy: y + bh // 2}
                x += Max(bw, step)
            } else {
                x += step
            }
        }
        y += step
    }
    return 0
}

; Distance stepped from (x,y) while pixels stay pred-coloured; one stray step is tolerated (button text, gradients).
RunLength(s, x, y, dx, dy, pred) {
    len := 0, misses := 0, i := 0
    while (++i < 4000) {
        sx := x + dx * i, sy := y + dy * i
        if (sx >= s.w || sy >= s.h)
            break
        if pred(Px(s, sx, sy)) {
            len := (dx ? dx : dy) * i
            misses := 0
        } else if (++misses > 1) {
            break
        }
    }
    return len
}

; Promo popups differ in colour, so their close X is found by shape: two light diagonal strokes, darker between them.
; Semi-transparent white over the popup's own colour, so it is judged against its surroundings, not a fixed colour.
FindPopupX(s, w) {
    L := Round(w.h * 0.034), h := L // 2
    ; The axis samples sit beyond the stroke width, so they are background even for a heavy X.
    diag := [], bg := [[h, 0], [-h, 0], [0, h], [0, -h], [h * 5 // 4, 0], [-h * 5 // 4, 0], [0, h * 5 // 4], [0, -h * 5 // 4]]
    for d in [h // 4, h // 2, 3 * h // 4, h]
        diag.Push([d, d], [-d, -d], [d, -d], [-d, d])
    y := w.cap + h, yEnd := Round(w.h * 0.45)
    while (y < yEnd) {
        x := Round(w.w * 0.45)
        while (x < w.w - h) {
            if (MinCh(Px(s, x, y)) >= 40) {
                bgMax := 0
                for o in bg
                    bgMax := Max(bgMax, MinCh(Px(s, x + o[1], y + o[2])))
                dMin := 255
                for o in diag
                    dMin := Min(dMin, MinCh(Px(s, x + o[1], y + o[2])))
                if (dMin - bgMax >= 22)
                    return {cx: x, cy: y}
            }
            x += 3
        }
        y += 3
    }
    return 0
}

; Never a purchase: refuse anything green (the price buttons and SHOP) and anything in the caption bar.
SafeClick(x, y) {
    w := GameRect()
    if !w || x < w.l || x >= w.r || y < w.t + w.cap || y >= w.b {
        Log("refused click outside game content at " x "," y)
        return
    }
    if IsBuyGreen(Integer(PixelGetColor(x, y))) {
        Log("refused click on a green (purchase) button at " x "," y)
        return
    }
    MouseGetPos &mx, &my
    Click x, y
    Sleep 50
    MouseMove mx, my, 0
}

Describe() {
    w := GameRect()
    if !w
        return "game window not found (" WIN_TITLE ")"
    s := Snap(w)
    Found(b) => b ? "FOUND -> click " (w.l + b.cx) "," (w.t + b.cy) : "no"
    out := "window " w.l "," w.t " " w.w "x" w.h " scale " w.scale " caption " w.cap "px"
    out .= "`nad close X: " (FindAdCloseX(w, &cx, &cy) ? "FOUND -> click " cx "," cy : "no")
    out .= "`nad round X: " (FindRingX(w, &cx, &cy) ? "FOUND -> click " cx "," cy : "no")
    out .= "`nNEXT: " Found(FindNext(s, w))
    out .= "`nPLAY AD!: " Found(FindPlayAd(s, w))
    out .= "`npopup X: " Found(FindPopupX(s, w))
    out .= "`nstate: " (paused ? "paused" : inAd ? "in ad" : "waiting") ", ads started " adsStarted
    return out
}

Status(msg, ms := 3000) {
    ToolTip "Coin bot: " msg
    SetTimer ClearTip, -ms
}

ClearTip() => ToolTip()

Stop(why) {
    global paused := true
    Log("stopped: " why)
    SoundBeep 750, 300
    Status("stopped - " why, 15000)
}

; A log reader holding the file must never take the bot down.
Log(msg) {
    try FileAppend FormatTime(, "yyyy-MM-dd HH:mm:ss") " " msg "`n", A_ScriptDir "\coin-ad-bot.log"
}
