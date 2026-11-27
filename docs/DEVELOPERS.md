# The older firmware folder

**New projects: follow the [MP Selector Standard](STANDARD.md).** It is one small file in the download you already ship, and it needs MP Selector 1.3.

This page describes the older way, a `firmware/<id>/` folder added to your release. It still works, from MP Selector 1.1 on.

## The folder

Put it at the top of your card layout, next to your own `autorun` folder:

```
firmware/
  your-id/
    name
    run.sh
    akai
```

`your-id` is lowercase letters, numbers and dashes, 32 characters at most. Pick one and keep it across releases, so an update replaces the old copy.

| File | Needed | What it is |
| --- | --- | --- |
| `name` | Yes | The title shown on screen. First line only. |
| `run.sh` | Yes | Starts your firmware. Unix line endings. |
| `akai` | Yes | The Akai firmware versions you have tested on, one per line. For example `1.4.0.8`. |
| `cover.png` or `cover.jpg` | No | Cover art. A square picture. Needs MP Selector 1.2. |
| `cover.rgb565` | No | Cover art for MP Selector 1.1 too. 96 × 96 pixels, RGB565, little-endian. Exactly 18,432 bytes. It wins over a picture. |
| `caption` | No | One short line under the title. Plain ASCII. Good for "how do I get back". |
| `SHA256SUMS` | No | `sha256sum` output for the files in the folder. If it is there, every listed file is checked before `run.sh` starts. |

A folder you can copy is in [template/firmware/my-firmware](template/firmware/my-firmware).

## What happens when someone opens your cover

1. MP Selector checks that `akai` lists the Akai firmware on the MPC. If it does not, the cover shows "Requires Akai firmware" with your first version, and stays in Cover Flow.
2. It copies your folder into memory at `/run/mpc-select/fw`. The card is mounted without permission to run programs, so everything you execute has to be in this copy. Files and folders whose names start with a dot are not copied.
3. It stops the Akai app.
4. It runs `sh ./run.sh <card path> <log file>` as root, from the copy.
5. When `run.sh` ends, Cover Flow comes back. If it ends with an error, the cover shows "stopped with an error".

## Rules for run.sh

- Stay in the foreground. End when your program ends.
- Do not start the Akai app (`ac50.service`) and do not reboot. MP Selector decides what runs next.
- Give the user a way out, and say what it is in `caption`.
- Leave nothing behind: no running processes, no loaded kernel modules, no mounts.
- Write only inside your own folders on the card. Never write to `autorun`, `autorun.sh` or other people's folders in `firmware`.
- Keep the copied folder small. It lives in memory. Put large read-only files, such as models or samples, in a dot folder like `firmware/your-id/.data` and read them from the card path in `$1`.
- The card can have any name, and the name can contain spaces. Quote your paths.

## Two kinds of project

**Apps that replace the Akai app** fit this well. Melodee, MPC Simple and MP DOOM work this way.

**Mods that hook into the Akai app** load a library into Akai's own program, so they depend on one exact Akai version. List only the versions you have tested in `akai`. Your `run.sh` has to start the Akai program itself with your library, wait for it to exit, and return.

## Check your ZIP

Drop your release ZIP on the [Add Firmware page](https://philwoolley.com/mpselector/add/). If the folder is right, the page offers to add it to a card. If not, it lists each thing to fix. From a terminal:

```sh
node importer/cli.mjs your-release.zip /path/to/a/test/card
```

The check reads files. It does not run your script, so test on an MPC before you publish.

## A prompt for your AI assistant

Paste this into Claude, ChatGPT or another coding assistant, in your project's folder:

```
I want my Akai MPC Sample firmware to open from MP Selector.
Read https://github.com/fomoPhil/mpselector/blob/main/docs/DEVELOPERS.md and follow it exactly.

1. Read how my project starts today (my autorun script) and explain it back to me in a few lines.
2. Add firmware/<id>/ to my card layout with name, run.sh and akai. Ask me for the id, the title
   and which Akai firmware versions I have tested on. Do not guess the versions.
3. Write run.sh so it starts my project from the in-memory copy, stays in the foreground, and
   returns when the user exits. It must not start ac50.service, reboot, or write outside my own
   folders. Move large read-only files to a dot folder and read them from the card path in $1.
4. Tell me every place where my project assumes it owns the card or restarts the Akai app, and
   how you handled each one.
5. Build my release ZIP and run: node importer/cli.mjs <zip> <empty test folder with autorun and
   firmware folders in it>. Fix whatever it reports.
6. List what I still need to test by hand on an MPC.
```

## Tell Phil

Open an issue at [fomoPhil/mpselector](https://github.com/fomoPhil/mpselector/issues) with a link to your release. Tested projects get listed in the README.
