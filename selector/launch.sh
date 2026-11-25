#!/bin/sh
# Replaces the running Akai app with the selector session.
set -eu
case "$#:${2-}" in
    1:|2:--developer-mode) ;;
    *) exit 1 ;;
esac
D=$1
shift
[ -d "$D" ] && [ ! -L "$D" ]
[ "$(id -u)" = 0 ]
RAM=/run/mpc-select
[ -x "$RAM/mpc-select" ]
SD=$(CDPATH= cd -- "$D/.." && pwd -P)
if ! mount_id=$(/bin/sh "$RAM/session.sh" --card-mount-id "$SD"); then
    printf '%s\n' 'Selector card is no longer mounted' >&2
    exit 1
fi
systemctl is-active --quiet ac50.service
if [ "$#" = 1 ]; then
    # Stock sampler extracted from Akai's public macOS updater for 1.4.0.8.
    if ! printf '%s  %s\n' '473fb7260e597e61cc55d9d30595eb9d9aa1304ff1b88960e633ad19457dc91a' \
        '/usr/bin/MPC Sample' | sha256sum -c - >/dev/null; then
        printf '%s\n' 'This test launcher requires Akai firmware 1.4.0.8' >&2
        exit 1
    fi
fi
# systemd expands ${NAME} in a service's arguments and reads $$ as a literal $.
SD_ARG=$(printf '%s\n' "$SD" | sed 's/\$/$$/g')
systemd-run --unit=mpc-select --collect \
    --working-directory="$RAM" --setenv="HOME=$RAM" \
    --property=TimeoutStartSec=30s --property=TimeoutStopSec=10s \
    --property='ExecStartPre=/usr/bin/systemctl stop ac50.service' \
    --property="ExecStopPost=/bin/sh $RAM/session.sh --restore-akai" \
    --property="StandardOutput=append:$RAM/session.log" \
    --property="StandardError=append:$RAM/session.log" \
    /bin/sh "$RAM/session.sh" "$RAM" "$SD_ARG" "$mount_id" "$@"
systemctl is-active mpc-select.service
