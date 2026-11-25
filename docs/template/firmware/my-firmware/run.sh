#!/bin/sh
# Starts My Firmware from MP Selector. Rename the folder, then edit this file.
#
# MP Selector has already stopped the Akai app and copied this folder into
# memory. This script runs from that copy, as root:
#   $1  the card, for example /media/MYCARD
#   $2  a log file you can append to
# When this script ends, Cover Flow comes back. Do not start the Akai app
# yourself and do not reboot.
set -eu
[ "$#" = 2 ]
card=$1
here=$(pwd -P)

# Programs must sit next to this script, because the card cannot run them.
# Large files that are only read can stay on the card in a folder whose name
# starts with a dot. Those are not copied into memory.
data=$card/firmware/my-firmware/.data

# Run in the foreground so the menu returns when your program exits.
exec "$here/my-program" --data "$data"
