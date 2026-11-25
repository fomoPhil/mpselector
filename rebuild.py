#!/usr/bin/env python3
"""Rebuild the public card's startup files. Run from the extracted source folder."""
import argparse
import hashlib
from pathlib import Path
import os
import shutil
import subprocess


def rebuild(source, destination, zig):
    if subprocess.check_output([str(zig), 'version'], text=True).strip() != '0.15.2':
        raise ValueError('Use Zig version 0.15.2.')
    destination.mkdir(parents=True, exist_ok=False)
    folder = destination / 'autorun'
    folder.mkdir()
    (destination / 'firmware').mkdir()
    binary = folder / 'mpc-select'
    subprocess.run([str(zig), 'cc', '-target', 'aarch64-linux-musl', '-static', '-O2', '-s',
                    '-Wall', '-Wextra', '-Werror', '-Iselector', '-Idoom',
                    'selector/mpc_select.c', 'selector/selector_draw.c',
                    'doom/mpc_display.c', 'doom/mpc_surface.c', '-lm', '-o', str(binary.resolve())],
                   cwd=source, check=True)
    launcher = (source / 'selector/autorun.sh.in').read_text()
    for token, name in [('SELECT', 'mpc-select'), ('LAUNCH', 'launch.sh'), ('SESSION', 'session.sh')]:
        if name != 'mpc-select':
            shutil.copyfile(source / 'selector' / name, folder / name)
        marker = '@' + token + '_SHA256@'
        if launcher.count(marker) != 1:
            raise ValueError('Launcher template has changed: ' + marker)
        launcher = launcher.replace(marker, hashlib.sha256((folder / name).read_bytes()).hexdigest())
    (folder / 'autorun.sh').write_bytes(launcher.encode())
    cover = source / 'selector/release/akai.rgb565'
    if cover.stat().st_size != 96 * 96 * 2:
        raise ValueError('Expected a 96 x 96 RGB565 Akai cover.')
    shutil.copyfile(cover, folder / 'akai.rgb565')
    shutil.copyfile(source / 'selector/autorun-dev.sh', destination / 'autorun.sh')
    for script in ('autorun.sh', 'autorun/autorun.sh', 'autorun/launch.sh', 'autorun/session.sh'):
        subprocess.run(['sh', '-n', str(destination / script)], check=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('output', type=Path, help='A new folder for the microSD files')
    parser.add_argument('--zig', default=os.environ.get('ZIG', 'zig'), help='Path to Zig 0.15.2')
    args = parser.parse_args()
    rebuild(Path(__file__).resolve().parent, args.output, args.zig)
