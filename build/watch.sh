#!/usr/bin/env bash
# Auto-rebuild: while pieces/ changes, reassemble dashboard.html so the live
# page (and the browser pane) reloads with every saved edit. Stop with:
#   touch build/watch.stop
cd "$(dirname "$0")/.." || exit 1
rm -f build/watch.stop
last=""
while [ ! -f build/watch.stop ]; do
  now=$(find pieces -type f -printf '%T@ %s %p\n' 2>/dev/null | sort | md5sum | cut -c1-12)
  if [ "$now" != "$last" ]; then
    last="$now"
    if python3 build/make.py >/dev/null 2>build/watch.err; then
      echo "$(date '+%H:%M:%S') rebuilt dashboard.html" >> build/watch.log
    else
      echo "$(date '+%H:%M:%S') rebuild FAILED: $(tail -1 build/watch.err)" >> build/watch.log
    fi
  fi
  sleep 4
done
echo "$(date '+%H:%M:%S') watcher stopped" >> build/watch.log
