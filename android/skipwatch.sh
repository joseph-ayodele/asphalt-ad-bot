#!/system/bin/sh
# Runs ON the Android device (pushed to /data/local/tmp by ad-bot.js). Unity ads show a "Skip Open Store" pill for only a
# moment, which a check from the PC (dump over adb, parse in Node, tap over adb) keeps missing. Here the dump, the parse and
# the tap happen in one process on the device, so the tap lands right after the pill appears.
#   sh skipwatch.sh SECONDS      prints "tapped X Y" when it skipped, or "none"
# The tap goes on the skip glyph at the right end of the pill (45% of the pill's height in from its right edge).
dur=${1:-8}
work=${SW_DIR:-/data/local/tmp}
end=$(( $(date +%s) + dur ))
while [ "$(date +%s)" -lt "$end" ]; do
  uiautomator dump "$work/sw.xml" >/dev/null 2>&1
  # a Close button means the ad is over and the bot's normal checks should take it from here
  if grep -q -e 'text="Close"' -e 'content-desc="Close' "$work/sw.xml" 2>/dev/null; then
    echo close
    exit 0
  fi
  line=$(grep -o 'text="Skip Open Store"[^>]*' "$work/sw.xml" 2>/dev/null | head -n 1)
  if [ -n "$line" ]; then
    set -- $(echo "$line" | grep -o 'bounds="[^"]*"' | sed 's/[^0-9]/ /g')
    x2=$3; y1=$2; y2=$4
    h=$((y2 - y1))
    x=$((x2 - h * 45 / 100)); y=$(( (y1 + y2) / 2 ))
    input tap $x $y
    echo "tapped $x $y"
    exit 0
  fi
done
echo none
