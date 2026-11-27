#!/bin/sh
# Starts the firmware. Works alone on a card and from MP Selector.
here=$(cd "$(dirname "$0")" && pwd)

systemctl stop ac50.service
# The card cannot run programs, so the program runs from memory.
cp "$here/myapp" /run/myapp && chmod +x /run/myapp
/run/myapp --data "$here/data"
rm -f /run/myapp

# MP Selector shows Cover Flow when this script ends. Alone, Akai comes back.
[ -n "$MPSELECTOR" ] || systemctl start ac50.service
