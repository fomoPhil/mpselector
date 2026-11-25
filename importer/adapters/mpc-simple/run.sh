#!/bin/sh
# Give the app its normal writable projects and samples. Its control-link updater
# sees a RAM executable directory and read-only views of the selector on the card.
set -eu
[ "$#" = 2 ]
SD=$1
case "$SD" in /*) ;; *) exit 1 ;; esac
# Quote each path as a systemd unit setting, including literal quotes and slashes.
quoted=$(printf '%s' "$SD" | sed 's/[\\"]/\\&/g')
paths="\"$quoted/firmware\" \"$quoted/autorun\" \"$quoted/autorun.sh\""
exec systemd-run --unit=mpc-select-simple --wait --collect \
    --working-directory="$PWD" --setenv="HOME=$PWD" --setenv="MPCS_EXTERNAL=$SD" \
    --property=Type=exec --property=KillMode=control-group \
    --property=BindsTo=mpc-select.service --property=After=mpc-select.service \
    --property="ReadOnlyPaths=$paths" --property=TimeoutStopSec=30s \
    --property="StandardOutput=append:$2" --property="StandardError=append:$2" \
    /bin/sh "$PWD/app.sh"
