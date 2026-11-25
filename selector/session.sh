#!/bin/sh
# The launcher also queries this before it starts the session that stops Akai.
card_mount_id() {
    MPC_CARD_PATH=$1 awk '
        BEGIN {
            # mountinfo escapes these four characters in paths.
            escape["\\"] = "\\134"
            escape[" "] = "\\040"
            escape["\t"] = "\\011"
            escape["\n"] = "\\012"
            path = ENVIRON["MPC_CARD_PATH"]
            for (i = 1; i <= length(path); i++) {
                ch = substr(path, i, 1)
                mount_path = mount_path ((ch in escape) ? escape[ch] : ch)
            }
        }
        $5 == mount_path { id = $1 }
        END { if (id == "") exit 1; print id }
    ' /proc/self/mountinfo
}

if [ "$#" = 2 ] && [ "$1" = --card-mount-id ]; then
    card_mount_id "$2"
    exit $?
fi
if [ "$#" = 1 ] && [ "$1" = --restore-akai ]; then
    [ "$(systemctl is-system-running 2>/dev/null)" != stopping ] || exit 0
    # Keep a shutdown queued after the state check from being superseded.
    exec systemctl --job-mode=fail start ac50.service
fi

# ExecStopPost restores Akai on normal exit or failure.
case "$#:${4-}" in
    3:|4:--developer-mode) ;;
    *) exit 1 ;;
esac
[ -n "$3" ] || exit 1
RAM=$1
SD=$2
MOUNT_ID=$3
BOOT_MODE=${4-}
FW=$SD/firmware
STAGE=$RAM/fw
LAST=$FW/.last
FAVORITES_OUT=$RAM/favorites.next
VIEW_STATE=$RAM/view
message=

finish() {
    rm -rf "$STAGE"
    rm -f "$FAVORITES_OUT" "$VIEW_STATE"
    exit 0
}

mount_matches() {
    [ "$(card_mount_id "$SD")" = "$MOUNT_ID" ]
}

save_favorites() (
    # Hold the original directory so relative writes stay on its mount.
    cd "$FW" && mount_matches && [ ! -d .favorites ] || exit 1
    if [ -f .favorites ]; then
        cmp -s "$FAVORITES_OUT" .favorites && exit 0
    elif [ ! -s "$FAVORITES_OUT" ]; then
        exit 0
    fi
    temp=$(mktemp .favorites.tmp.XXXXXX) || exit 1
    trap 'rm -f "$temp"' 0
    trap 'exit 1' HUP INT TERM
    cat "$FAVORITES_OUT" > "$temp" && mount_matches && mv -f "$temp" .favorites && sync
)

stage_verified() {
    manifest=$STAGE/SHA256SUMS
    case "$choice" in
        sampqol) required='name run.sh sampler.sh mpcqol.so qol-snap.sh' ;;
        gridzilla) required='name run.sh sampler.sh' ;;
        melodee) required='name run.sh sample-base restore-selector.sh stems.sha256 caption' ;;
        mpc-simple) required='name run.sh app.sh mpcsimple caption' ;;
        *) required= ;;
    esac
    if [ -n "$required" ]; then
        [ ! -f "$STAGE/sampler-return.so" ] || required="$required sampler-return.so"
        [ -s "$manifest" ] || return 1
        for file in $required; do
            awk -v file="$file" 'substr($0, 67) == file { found = 1 } END { exit !found }' "$manifest" || return 1
        done
    fi
    [ ! -f "$manifest" ] || (cd "$STAGE" && sha256sum -c SHA256SUMS >/dev/null)
}

rm -f "$VIEW_STATE" && mount_matches || finish
last=$(cat "$LAST" 2>/dev/null)
while mount_matches; do
    set --
    for dir in "$FW"/*/; do
        id=$(basename "$dir")
        [ "$id" != akai ] && [ -f "$dir/run.sh" ] && [ -f "$dir/name" ] || continue
        IFS= read -r name < "$dir/name" || [ -n "$name" ] || continue
        set -- "$@" "$id" "$name"
    done

    rm -f "$FAVORITES_OUT" || finish
    choice=$(MPC_SELECT_CARD="$SD" MPC_SELECT_FAVORITES_OUT="$FAVORITES_OUT" MPC_SELECT_VIEW_STATE="$VIEW_STATE" \
        "$RAM/mpc-select" "$last" "$message" "$@") || finish
    mount_matches || finish
    message=
    if [ -f "$FAVORITES_OUT" ]; then
        save_favorites 2>/dev/null || message="Favorites could not be saved"
        rm -f "$FAVORITES_OUT"
        mount_matches || finish
    fi
    if [ "$choice" = /shutdown ]; then
        systemctl poweroff && finish
        message="Could not shut down"
        continue
    fi
    if [ "$choice" != akai ] && [ -f "$FW/$choice/unavailable" ]; then
        IFS= read -r message < "$FW/$choice/unavailable" || :
        [ -n "$message" ] || message="Preview only"
        last=$choice
        continue
    fi
    if [ "$BOOT_MODE" = --developer-mode ]; then
        case "$choice" in
            akai|mp-doom|pad-lights|melodee|mpc-simple) ;;
            sampqol|gridzilla) message="Requires Akai firmware 1.3.0.12"; last=$choice; continue ;;
            *) message="Not verified on Akai firmware 1.4"; last=$choice; continue ;;
        esac
    fi
    if [ "$choice" != "$last" ]; then
        { printf '%s\n' "$choice" > "$LAST" && sync; } 2>/dev/null
    fi
    last=$choice
    [ "$choice" = akai ] && finish

    # The SD card is noexec, and a firmware must not depend on the card staying put.
    IFS= read -r label < "$FW/$choice/name" || label=$choice
    rm -rf "$STAGE"
    if ! { mkdir -p "$STAGE" && cp -R "$FW/$choice"/* "$STAGE"/ && chmod -R 700 "$STAGE" && stage_verified; }; then
        message="$label is damaged on the card"
        continue
    fi
    log=$RAM/$choice.log
    (cd "$STAGE" && sh ./run.sh "$SD" "$log") >> "$log" 2>&1 || message="$label stopped with an error"
done
finish
