#!/bin/sh
# Native Power > MPC APP saves and exits. The selector owns the following screen.
set -eu
[ "$#" = 2 ]
card=$1
log=$2
ram=$(pwd -P)
assets=$card/firmware/melodee/.release
[ "$ram" = /run/mpc-select/fw ] && [ -d "$assets" ]
# Retain the upstream worker's known-firmware and binary self-tests. This
# adapter has only been prepared for the exact 1.4.0.8 stock app.
printf '%s  %s\n' 473fb7260e597e61cc55d9d30595eb9d9aa1304ff1b88960e633ad19457dc91a '/usr/bin/MPC Sample' | sha256sum -c - >/dev/null
(cd "$assets" && sha256sum -c "$ram/stems.sha256" >/dev/null)
printf '%s\n' "$assets" > "$ram/sd-folder"
"$ram/sample-base" --self-test "$ram/self-test.wav"
rm -f "$ram/self-test.wav"
# Melodee expects /run/sample-base to refer to its current release. Give it
# that path only in its service. It creates control.sock in this RAM directory.
quoted=$(printf '%s\n' "$card" | sed 's/[\\"]/\\&/g')
exec systemd-run --unit=mpc-select-melodee --collect --wait \
    --working-directory="$ram" --setenv="HOME=$ram" \
    --property=Type=exec --property=KillMode=control-group \
    --property=BindsTo=mpc-select.service --property=After=mpc-select.service \
    --property=TimeoutStopSec=30s --property=UMask=0077 \
    --property=ProtectSystem=full --property=NoNewPrivileges=yes \
    --property="BindPaths=$ram:/run/sample-base" \
    --property="ReadOnlyPaths=\"$quoted/firmware\" \"$quoted/autorun\" \"$quoted/autorun.sh\"" \
    --property="ExecStopPost=/bin/sh $ram/restore-selector.sh" \
    --property="StandardOutput=append:$log" --property="StandardError=append:$log" \
    "$ram/sample-base" --app melodee
