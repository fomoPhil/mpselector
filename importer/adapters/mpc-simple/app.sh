#!/bin/sh
# The selector verifies and stages the unmodified application in this directory.
set -eu
MPCS_INTERNAL=/data/UserContent
MPCS_CARD_DIR=$PWD
unset MPCS_REMOTE MPCS_REMOTE_ADDR
export MPCS_EXTERNAL MPCS_INTERNAL MPCS_CARD_DIR
export MPCS_DEVICE=1 MALLOC_ARENA_MAX=1
ulimit -S -s 1024
[ -f "$MPCS_EXTERNAL/MPC-Simple/Models/spleeter-4stems.mpcsnn" ] || {
    echo 'Missing MPC Simple stem model on the card' >&2
    exit 1
}

# The SD card is noexec. Copy CLAP code to RAM, with plugin resources on the card.
mirror_plugins() (
    mkdir -p "$2"
    for item in "$1"/*; do
        [ -e "$item" ] || continue
        dest="$2/${item##*/}"
        if [ -d "$item" ] && [ ! -L "$item" ]; then
            mirror_plugins "$item" "$dest"
        else
            case "$item" in
                *.[cC][lL][aA][pP]) cp "$item" "$dest" ;;
                *) ln -s "$item" "$dest" ;;
            esac
        fi
    done
)
if [ -d "$MPCS_EXTERNAL/MPC-Simple/Plugins" ]; then
    MPCS_PLUGINS_DIR=$PWD/.plugins
    mirror_plugins "$MPCS_EXTERNAL/MPC-Simple/Plugins" "$MPCS_PLUGINS_DIR"
    export MPCS_PLUGINS_DIR
fi
# The selector owns the display session and restores it after a normal app exit.
# MPC Simple itself presents its save-aware prompt when the user presses Power.
exec ./mpcsimple
