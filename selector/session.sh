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
# While another firmware's own start script runs, a stand-in keeps Akai's
# service "active": those scripts wait for Akai to be up, then stop it.
STAND_IN=/run/mpc-select
STAND_IN=${STAND_IN%/*}/systemd/system/ac50.service.d
real_akai() {
    [ -e "$STAND_IN/mpc-select.conf" ] || return 0
    rm -f "$STAND_IN/mpc-select.conf"
    rmdir "$STAND_IN" 2>/dev/null
    systemctl daemon-reload
    systemctl stop ac50.service
}

if [ "$#" = 1 ] && [ "$1" = --restore-akai ]; then
    [ "$(systemctl is-system-running 2>/dev/null)" != stopping ] || exit 0
    real_akai
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

# launch.sh has already checked the stock app for this exact version.
AKAI=1.4.0.8

made_for() {
    [ -f "$FW/$choice/akai" ] && tr -d '\r' < "$FW/$choice/akai" | grep -qxF "$1"
}

made_for_first() {
    [ -f "$FW/$choice/akai" ] && tr -d '\r' < "$FW/$choice/akai" | sed -n '/^[0-9][0-9.]*$/{p;q;}'
}

# The MP Selector Standard: a firmware says how to open it in one small file
# of "key: value" lines in its autorun folder.
STANDARD=mpselector.txt
standard() {
    [ -f "$1/$STANDARD" ] && tr -d '\r' < "$1/$STANDARD" |
        sed -n "s/^$2:[[:space:]]*//p" | sed -n '1s/[[:space:]]*$//p' | grep .
}

# A folder that holds another firmware's own files, unchanged, is an entry too:
# its autorun folder, or everything its download puts on a card. MP DOOM's
# download keeps what goes on the card in a folder named SD.
raw_root() {
    for root in "$1/autorun" "$1/SD/autorun" "$1"; do
        if [ -f "$root/$STANDARD" ] || [ -f "$root/autorun.sh" ] || [ -f "$root/autorun.json" ]; then
            printf '%s\n' "$root"
            return 0
        fi
    done
    return 1
}

raw_name() {
    for file in "$FW/$1/name" "$2/$STANDARD" "$2/sampleboot.txt"; do
        [ -f "$file" ] || continue
        if [ "$file" = "$2/$STANDARD" ]; then
            line=$(standard "$2" name)
        else
            IFS= read -r line < "$file" || :
            line=$(printf '%s' "$line" | tr -d '\r')
        fi
        [ -z "$line" ] || { printf '%s\n' "$line"; return; }
    done
    printf '%s\n' "$1"
}

# The start script is the first one its autorun.json names, as Akai 1.3 chose it.
raw_script() {
    if [ -f "$1/autorun.json" ]; then
        tr -d '\r' < "$1/autorun.json" | tr '{},' '\n\n\n' |
            sed -n 's/.*"path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' |
            while IFS= read -r path; do
                case "$path" in ''|/*|*..*) continue ;; esac
                [ ! -f "$1/$path" ] || { printf '%s\n' "$path"; exit 0; }
            done | grep . && return
    fi
    [ ! -f "$1/autorun.sh" ] || echo autorun.sh
}

akai_running() {
    case "$(systemctl show ac50.service -p ActiveState --value 2>/dev/null)" in
        active|activating) return 0 ;;
    esac
    return 1
}

stand_in_akai() {
    mkdir -p "$STAND_IN" &&
        printf '%s\n' '[Service]' 'ExecStart=' 'ExecStart=/bin/sleep 2147483647' 'Restart=no' > "$STAND_IN/mpc-select.conf" &&
        systemctl daemon-reload && systemctl start ac50.service
}

# Akai's splash service always holds the screen. An app is running while
# anything more than that holds the pads or the screen.
holders() {
    fuser /dev/snd/midiC0D0 /dev/dri/card0 2>/dev/null | tr -s ' \n' ' '
}

BOUND=$RAM/bound
MADE=$RAM/made

cover() {
    mount --bind "$1" "$2" 2>/dev/null && printf '%s\n' "$2" >> "$BOUND"
}

release_raw() {
    [ ! -f "$BOUND" ] || while IFS= read -r path; do umount -l "$path"; done < "$BOUND"
    [ ! -f "$MADE" ] || while IFS= read -r path; do rmdir "$path" 2>/dev/null; done < "$MADE"
    rm -f "$BOUND" "$MADE"
    real_akai
}

run_raw() {
    entry=${raw%/autorun}
    ready=
    [ ! -f "$raw/$STANDARD" ] || ready=1
    if [ -n "$ready" ]; then
        # It lists the Akai firmware it was run on, and is trusted on those.
        if [ "$(standard "$raw" standard || echo 1)" != 1 ]; then
            message="$label needs a newer MP Selector"
            return
        fi
        if [ "$BOOT_MODE" = --developer-mode ]; then
            made=$(standard "$raw" akai | tr -s ' \t,' '\n\n\n' | grep '^[0-9][0-9.]*$')
            if ! printf '%s\n' "$made" | grep -qxF "$AKAI"; then
                need=$(printf '%s\n' "$made" | sed -n 1p)
                message=${need:+Requires Akai firmware $need}
                [ -n "$message" ] || message="Not verified on Akai firmware 1.4"
                return
            fi
        fi
    # A firmware that loads itself into the Akai app fits one Akai version only.
    elif [ "$BOOT_MODE" = --developer-mode ] && grep -qs LD_PRELOAD "$raw"/*.sh; then
        message="Requires Akai firmware 1.3.0.12"
        return
    fi
    release_raw
    # A download for Akai 1.4 has its own autorun.sh next to its autorun folder.
    top=
    if [ -n "$ready" ]; then
        start=$(standard "$raw" start)
        case "$start" in ''|/*|*..*) start=missing ;; esac
        start=$raw/$start
    elif [ "$raw" != "$entry" ] && [ -f "$entry/autorun.sh" ]; then
        top=1
        start=$entry/autorun.sh
    else
        start=$raw/$(raw_script "$raw")
    fi
    if [ ! -f "$start" ]; then
        message="$label has no start script"
        return
    fi
    # Most firmware takes the folder above autorun for the card, so it runs as
    # if it were alone there. One that reads the mount table would take that
    # mount for the card, and runs from its own folder. MP DOOM reads the table
    # only to check the card, and starts from the card's autorun folder alone.
    # A firmware that follows the standard finds its own folder and stays in it.
    if [ -n "$ready" ]; then
        :
    elif [ -e "$raw/sampleboot.inplace" ] || [ -f "$raw/mpc-doom" ] || ! grep -rqs -e proc/mounts -e mountinfo "$raw"; then
        if cover "$raw" "$SD/autorun"; then
            if [ -z "$top" ]; then
                start=$SD/autorun/${start#"$raw"/}
            elif cover "$start" "$SD/autorun.sh"; then
                start=$SD/autorun.sh
            fi
        fi
    fi
    # Folders its download keeps at the top of the card show up there.
    for dir in "$entry"/*/; do
        name=$(basename "$dir")
        [ -z "$ready" ] && [ "$dir" != "$raw/" ] && [ -d "$dir" ] || continue
        mkdir "$SD/$name" 2>/dev/null
        [ -d "$SD/$name" ] && [ -z "$(ls -A "$SD/$name" 2>/dev/null)" ] || continue
        printf '%s\n' "$SD/$name" >> "$MADE"
        cover "${dir%/}" "$SD/$name"
    done
    # DFOS starts only beside the Akai app it was first tried with, by its size.
    # The program itself takes 1.3.0.12 or later, and starts on 1.4.0.8.
    if [ -f "$raw/dfos-stock-size" ]; then
        read -r size app < "$raw/dfos-stock-size"
        size=$(wc -c < "$app" 2>/dev/null | tr -d ' ')
        [ -z "$size" ] || { printf '%s %s\n' "$size" "$app" > "$RAM/stock-size" && cover "$RAM/stock-size" "$raw/dfos-stock-size"; }
    fi
    quiet=$(holders)
    stand_in_akai
    # sample-base firmware starts once per boot unless the start was asked for,
    # and DFOS stays shut after its Stock OS button until the MPC restarts.
    # Some start scripts return at once, others stay until their app closes.
    (cd "$(dirname "$start")" && MPSELECTOR=1 MPSELECTOR_CARD="$SD" SAMPLE_BASE_ASKED=1 DFOS_AGAIN=1 exec /bin/sh "$start") >> "$log" 2>&1 &
    pid=$!
    seen=
    idle=0
    waited=0
    while mount_matches; do
        if [ -e "$STAND_IN/mpc-select.conf" ]; then
            # The firmware has stopped "Akai": from here the service is the real one.
            akai_running || real_akai
        elif akai_running; then
            release_raw
            finish
        fi
        if [ -n "$ready" ]; then
            # The standard's way out: its start script ends when the user quits.
            if ! kill -0 "$pid" 2>/dev/null && [ "$(holders)" = "$quiet" ]; then
                wait "$pid" || message="$label stopped with an error"
                break
            fi
        elif [ "$(holders)" != "$quiet" ]; then
            seen=1
            idle=0
        elif [ -n "$seen" ]; then
            idle=$((idle + 1))
            [ "$idle" -lt 3 ] || break
        elif [ "$waited" -ge 60 ]; then
            message="$label did not start"
            break
        fi
        sleep 1
        waited=$((waited + 1))
    done
    release_raw
}

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
        [ "$id" != akai ] || continue
        if [ -f "$dir/run.sh" ]; then
            [ -f "$dir/name" ] || continue
            IFS= read -r name < "$dir/name" || [ -n "$name" ] || continue
        elif raw=$(raw_root "$FW/$id"); then
            name=$(raw_name "$id" "$raw")
        else
            continue
        fi
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
    # An entry opens when its akai file lists this Akai firmware, one version per line.
    raw=
    [ "$choice" = akai ] || [ -f "$FW/$choice/run.sh" ] || raw=$(raw_root "$FW/$choice")
    if [ -z "$raw" ] && [ "$BOOT_MODE" = --developer-mode ] && ! made_for "$AKAI"; then
        case "$choice" in
            akai|mp-doom|pad-lights|melodee|mpc-simple) ;;
            *)
                need=$(made_for_first)
                case "$need:$choice" in
                    :sampqol|:gridzilla) need=1.3.0.12 ;;
                esac
                if [ -n "$need" ]; then
                    message="Requires Akai firmware $need"
                else
                    message="Not verified on Akai firmware 1.4"
                fi
                last=$choice
                continue ;;
        esac
    fi
    if [ "$choice" != "$last" ]; then
        { printf '%s\n' "$choice" > "$LAST" && sync; } 2>/dev/null
    fi
    last=$choice
    [ "$choice" = akai ] && finish

    log=$RAM/$choice.log
    if [ -n "$raw" ]; then
        label=$(raw_name "$choice" "$raw")
        run_raw
        continue
    fi

    # The SD card is noexec, and a firmware must not depend on the card staying put.
    IFS= read -r label < "$FW/$choice/name" || label=$choice
    rm -rf "$STAGE"
    if ! { mkdir -p "$STAGE" && cp -R "$FW/$choice"/* "$STAGE"/ && chmod -R 700 "$STAGE" && stage_verified; }; then
        message="$label is damaged on the card"
        continue
    fi
    (cd "$STAGE" && sh ./run.sh "$SD" "$log") >> "$log" 2>&1 || message="$label stopped with an error"
done
finish
