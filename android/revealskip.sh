#!/system/bin/sh
# Runs ON the Android device (pushed to /data/local/tmp by ad-bot.js). AppLovin ads can sit on a screen with no buttons; a tap makes a
# small "Google Play" skip pill fade in at the top left for a couple of seconds. Its position is a fixed physical size, not a
# fraction of the screen, so it cannot be tapped blind on different devices: reveal it, read where it is, tap it, all in one process.
#   sh revealskip.sh X Y      reveal-tap at X,Y; prints "tapped X Y" after tapping the pill, or "none"
work=${SW_DIR:-/data/local/tmp}
rx=$1; ry=$2
n=0
while [ $n -lt 3 ]; do
  n=$((n + 1))
  input tap $rx $ry
  uiautomator dump "$work/rs.xml" >/dev/null 2>&1
  line=$(grep -o 'text="Google Play"[^>]*' "$work/rs.xml" 2>/dev/null | head -n 1)
  if [ -n "$line" ]; then
    set -- $(echo "$line" | grep -o 'bounds="[^"]*"' | sed 's/[^0-9]/ /g')
    x=$(( ($1 + $3) / 2 )); y=$(( ($2 + $4) / 2 ))
    input tap $x $y
    echo "tapped $x $y"
    exit 0
  fi
done
echo none
