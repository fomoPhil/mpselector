#!/bin/sh
# Top-level card entry for Akai's Developer Mode confirmation on firmware 1.4.
set -eu
PATH=/usr/sbin:/usr/bin:/sbin:/bin
export PATH
SD=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
exec /bin/sh "$SD/autorun/autorun.sh" --developer-mode
