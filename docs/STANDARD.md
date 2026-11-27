# MP Selector Standard

Version 1. For people and AI assistants who build firmware, mods or apps for the Akai MPC Sample.

Follow it and your download opens from MP Selector with no changes. A user makes a folder in `firmware` on their card and copies your download into it. It still works alone on a card, as it does today.

It is three rules and one small file. It needs MP Selector 1.3 or later.

## The file

`mpselector.txt`, in your `autorun` folder, next to your start script. Plain text, one `key: value` per line.

```
name: My Firmware
start: start.sh
akai: 1.4.0.8
```

| Line | Needed | Meaning |
| --- | --- | --- |
| `name` | Yes | The title in Cover Flow. Plain ASCII. |
| `start` | Yes | The script that starts your firmware. It sits in the same folder as this file. |
| `akai` | Yes | Every Akai firmware version you have run it on, with spaces between them. For example `1.3.0.12 1.4.0.8`. |
| `version` | No | Your own version, such as `2.1`. |
| `quit` | No | How to get out, shown under the title. Plain ASCII, 37 characters at most. For example `Hold SHIFT + STOP`. |
| `standard` | No | The version of this standard. `1` if left out. |

For cover art, put a square `cover.png` or `cover.jpg` next to the file.

## The three rules

### 1. Run from your own folder

- Ship everything in your `autorun` folder, or in folders beside it.
- Find your folder from your own script. Do not assume it is `<card>/autorun`, and do not read the mount table to find the card:

  ```sh
  here=$(cd "$(dirname "$0")" && pwd)
  ```

- Under MP Selector the top of the card is in `$MPSELECTOR_CARD`.
- Write only inside your own folder, or in one folder named after your project at the top of the card.
- The card cannot run programs. Copy what you execute to `/run` first, as you do today.

### 2. Say which Akai firmware you tested

- List the versions in `akai`. List only what you ran.
- MP Selector reads that line before it starts you. On another Akai firmware your cover shows "Requires Akai firmware" with your first version, and nothing runs.
- When `$MPSELECTOR` is set, do not test the Akai app's size or checksum yourself. A user on a version you did not list never reaches your script.
- A mod that loads into the Akai app depends on one exact Akai firmware. That is fine. Its `akai` line says so.

### 3. Quit back to Cover Flow

MP Selector runs your start script with `MPSELECTOR=1`. When it is set:

- Start every time you are asked. Skip any once-per-boot guard.
- Stop the Akai app as you do today (`systemctl stop ac50.service`).
- Keep your start script running until the user quits. Then end it with `exit 0`. Cover Flow comes back.
- Do not start the Akai app and do not reboot.
- Leave nothing behind: no running programs, no mounts, no loaded kernel modules, no changed USB setup.

Alone on a card `MPSELECTOR` is not set. Start the Akai app on the way out, as you do today.

## A start script that follows it

```sh
#!/bin/sh
here=$(cd "$(dirname "$0")" && pwd)

systemctl stop ac50.service
cp "$here/myapp" /run/myapp && chmod +x /run/myapp
/run/myapp --data "$here/data"
rm -f /run/myapp

[ -n "$MPSELECTOR" ] || systemctl start ac50.service
```

A folder you can copy is in [template/standard](template/standard).

## Check it

Drop your release ZIP on the [Add Firmware page](https://philwoolley.com/mpselector/add/). It answers that the download follows the standard, or lists what to fix, rule by rule. From a terminal, in a copy of this repository:

```sh
node importer/cli.mjs your-release.zip
```

The check reads files. It does not run your script, so the last step is a run on an MPC: open it from Cover Flow, quit, and open it again.

## A prompt for your AI assistant

Paste this into Claude, ChatGPT or another coding assistant, in your project's folder:

```
Bring my Akai MPC Sample firmware up to the MP Selector Standard.
Read https://github.com/fomoPhil/mpselector/blob/main/docs/STANDARD.md and follow it exactly.

1. Read how my project starts today and explain it back to me in a few lines.
2. Add mpselector.txt to my autorun folder. Ask me for the title and for the Akai firmware
   versions I have run it on. Do not guess the versions.
3. Go through the three rules. For each one, show me every place my scripts break it and the
   change you propose. Keep my project working alone on a card.
4. Build my release ZIP and run: node importer/cli.mjs <zip> from a copy of
   https://github.com/fomoPhil/mpselector. Fix whatever it reports.
5. List what I still need to test by hand on an MPC.
```

## What MP Selector does with it

1. It lists your folder in Cover Flow with your `name`, your cover and your `quit` line.
2. When the user opens it, it checks `akai` against the Akai firmware on the MPC.
3. It runs `sh <your start script>` as root from your own folder on the card, with `MPSELECTOR=1` and `MPSELECTOR_CARD` set.
4. When your script has ended and nothing holds the screen or the pads, Cover Flow comes back. If it ended with an error, the cover says so.

Downloads without the file still open the way they did in MP Selector 1.2. The older `firmware/<id>/` folder in [DEVELOPERS.md](DEVELOPERS.md) still works too.

## Tell Phil

Open an issue at [fomoPhil/mpselector](https://github.com/fomoPhil/mpselector/issues) with a link to your release. Tested projects get listed in the README.
