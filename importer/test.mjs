// node --test importer/test.mjs
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { build } from './build.mjs';
import { folderSink, loadAssets } from './cli.mjs';
import { Zip, sha256, storeZip, sums, utf8 } from './engine.mjs';
import { apply, handoff, plan } from './recipes.mjs';

const assets = await loadAssets();
const zipOf = (files) => Zip.open(storeZip(Object.entries(files).map(([k, v]) => [k, utf8(v)])));
const RESTORE = 'rmmod panel\nexec /bin/systemctl start ac50.service\n';
const melodee = (extra = {}) => zipOf({
  'autorun.sh': '#!/bin/sh\n',
  'autorun/melodee/app': 'melodee\n',
  'autorun/melodee/sample-base': 'ELF',
  'autorun/melodee/VERSION': 'v9.9.9 abc\n',
  'autorun/melodee/restore-stock.sh': RESTORE,
  'autorun/melodee/stems/weights.f16': 'weights',
  'autorun/melodee/licenses/A.txt': 'licence',
  'autorun/melodee/sd-worker.sh': 'not copied',
  ...extra,
});

test('sha256 matches known vectors across block boundaries', () => {
  assert.equal(sha256(utf8('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256(utf8('a'.repeat(119))), '31eba51c313a5c08226adf18d4a359cfdfd8d2e816b13f4af952f7ea6584dcfb');
});

test('Melodee becomes an entry the selector accepts', async () => {
  const result = await plan(await melodee(), 'unknown', assets);
  assert.equal(result.status, 'ready');
  assert.equal(result.version, 'v9.9.9');
  assert.equal(result.tested, false);
  const files = new Map(result.files);
  const listed = new TextDecoder().decode(files.get('firmware/melodee/SHA256SUMS'));
  for (const name of ['name', 'run.sh', 'sample-base', 'restore-selector.sh', 'stems.sha256', 'caption']) {
    assert.match(listed, new RegExp(`^[0-9a-f]{64}  ${name.replace('.', '\\.')}$`, 'm'));
  }
  const restore = new TextDecoder().decode(files.get('firmware/melodee/restore-selector.sh'));
  assert.ok(restore.startsWith('rmmod panel\n') && restore.endsWith('exit 0\n') && !restore.includes('ac50'));
  assert.equal(new TextDecoder().decode(files.get('firmware/melodee/stems.sha256')),
    `${sha256(utf8('weights'))}  stems/weights.f16\n`);
  assert.ok(files.has('firmware/melodee/.release/licenses/A.txt'));
  assert.ok(![...files.keys()].some((path) => path.includes('sd-worker')));
  assert.equal(files.get('firmware/melodee/cover.rgb565').length, 96 * 96 * 2);
});

test('a Melodee that restores stock differently is refused', async () => {
  const zip = await melodee({ 'autorun/melodee/restore-stock.sh': 'reboot\n' });
  await assert.rejects(plan(zip, 'x', assets), /shuts down/);
});

test('MPC Simple is found inside its wrapper folder and keeps an existing model', async () => {
  const zip = await zipOf({
    'MPC-Simple-1.0-Beta-99/SD Card/autorun/mpcsimple': 'ELF',
    'MPC-Simple-1.0-Beta-99/SD Card/MPC-Simple/Models/spleeter-4stems.mpcsnn': 'new model',
  });
  const result = await plan(zip, 'x', assets);
  assert.equal(result.version, '1.0 Beta 99');
  const card = await mkdtemp(join(tmpdir(), 'mp-selector-'));
  try {
    await assert.rejects(apply(result, folderSink(card)), /not an MP Selector card/);
    const sink = folderSink(card);
    await sink.write('autorun/x', utf8(''));
    await sink.write('firmware/mpc-simple/stale', utf8(''));
    await sink.write('MPC-Simple/Models/spleeter-4stems.mpcsnn', utf8('on card'));
    await apply(result, sink);
    assert.deepEqual((await readdir(join(card, 'firmware/mpc-simple'))).sort(),
      ['SHA256SUMS', 'app.sh', 'caption', 'cover.rgb565', 'mpcsimple', 'name', 'run.sh']);
    assert.equal(await readFile(join(card, 'MPC-Simple/Models/spleeter-4stems.mpcsnn'), 'utf8'), 'on card');
  } finally {
    await rm(card, { recursive: true });
  }
});

test('firmware that cannot open is named, with the reason', async () => {
  const qol = await plan(await zipOf({ 'SampQOL-OS-v0.4.2/autorun/mpcqol.so': 'x' }), 'x', assets);
  assert.deepEqual([qol.status, qol.name], ['blocked', 'SampQOL OS']);
  assert.match(qol.reason, /1\.3\.0\.12/);
  const other = await plan(await zipOf({ 'autorun/autorun.json': '{}' }), 'x', assets);
  assert.match(other.reason, /does not know this firmware/);
  assert.equal(other.request, true);
  assert.ok(!qol.request);
  const junk = await plan(await zipOf({ 'holiday.jpg': 'x' }), 'x', assets);
  assert.match(junk.reason, /does not look like/);
});

test('a release that ships its own MP Selector folder is copied as it is', async () => {
  const zip = await zipOf({
    'Thing-1.2/autorun/autorun.json': '{}',
    'Thing-1.2/firmware/thing/name': 'Thing\r\n',
    'Thing-1.2/firmware/thing/run.sh': '#!/bin/sh\nexec ./thing\n',
    'Thing-1.2/firmware/thing/akai': '1.4.0.7\n1.4.0.8\n',
    'Thing-1.2/firmware/thing/thing': 'ELF',
    'Thing-1.2/firmware/thing/.data/big.bin': 'data',
  });
  const result = await plan(zip, 'x', assets);
  assert.deepEqual([result.status, result.id, result.name], ['ready', 'thing', 'Thing']);
  assert.match(result.warn, /1\.1/);
  assert.deepEqual(result.files.map(([path]) => path).sort(), ['.data/big.bin', 'akai', 'name', 'run.sh', 'thing']
    .map((name) => 'firmware/thing/' + name));
});

test('a shipped folder for another Akai firmware is added with a warning', async () => {
  const zip = await zipOf({ 'firmware/old/name': 'Old', 'firmware/old/run.sh': 'true\n', 'firmware/old/akai': '1.3.0.12\n' });
  const result = await plan(zip, 'x', assets);
  assert.equal(result.status, 'ready');
  assert.match(result.warn, /1\.3\.0\.12/);
});

test('a shipped folder with mistakes is refused, and each mistake is named', async () => {
  const zip = await zipOf({
    'firmware/My Thing/run.sh': '#!/bin/sh\r\n',
    'firmware/My Thing/akai': 'any\n',
    'firmware/My Thing/cover.rgb565': 'short',
    'firmware/My Thing/SHA256SUMS': `${'0'.repeat(64)}  run.sh\n${'0'.repeat(64)}  gone\n`,
  });
  const result = await plan(zip, 'x', assets);
  assert.equal(result.status, 'blocked');
  for (const part of [/folder name/, /name is missing/, /akai must hold/, /Windows line endings/, /18,432/,
    /does not match run\.sh/, /lists gone/]) {
    assert.ok(result.problems.some((problem) => part.test(problem)), String(part));
  }
});

const START = '#!/bin/sh\nhere=$(cd "$(dirname "$0")" && pwd)\nsystemctl stop ac50.service\n"$here/app"\n[ -n "$MPSELECTOR" ] || systemctl start ac50.service\n';

test('a download that follows the MP Selector Standard is copied as it is', async () => {
  const zip = await zipOf({
    'My-OS-2.0/autorun.sh': 'sh "$(dirname "$0")/autorun/start.sh"\n',
    'My-OS-2.0/autorun/mpselector.txt': 'name:  My OS\r\nversion: 2.0\r\nstart: start.sh\r\nakai:  1.3.0.12 1.4.0.8\r\nquit: Hold SHIFT + STOP\r\n',
    'My-OS-2.0/autorun/start.sh': START,
    'My-OS-2.0/autorun/app': 'ELF',
    'My-OS-2.0/Samples/kick.wav': 'RIFF',
    // A recipe would match this file. The standard comes first.
    'My-OS-2.0/autorun/mpcsimple': 'ELF',
  });
  const result = await plan(zip, 'x', assets);
  assert.deepEqual([result.status, result.id, result.name, result.version], ['ready', 'My OS', 'My OS', '2.0']);
  assert.match(result.warn, /Standard/);
  assert.deepEqual(result.files.map(([path]) => path).sort(), ['Samples/kick.wav', 'autorun.sh', 'autorun/app',
    'autorun/mpcsimple', 'autorun/mpselector.txt', 'autorun/start.sh'].map((name) => 'firmware/My OS/' + name));
  const old = await plan(await zipOf({ 'mpselector.txt': 'name: Old\nstart: go.sh\nakai: 1.3.0.12\n', 'go.sh': 'true\n' }), 'x', assets);
  assert.equal(old.status, 'ready');
  assert.match(old.warn, /does not open/);
});

test('a download that misses the standard is refused, rule by rule', async () => {
  const zip = await zipOf({
    'autorun/mpselector.txt': 'standard: 2\nstart: go.sh\nakai: latest\nquit: ' + 'x'.repeat(40) + '\n',
    'autorun/go.sh': '# never reboot here\r\nCARD=/media/MPC/autorun\ngrep vfat /proc/mounts\n'
      + 'wc -c "/usr/bin/MPC Sample"\nsystemctl start ac50.service\n',
  });
  const result = await plan(zip, 'x', assets);
  assert.equal(result.status, 'blocked');
  for (const part of [/name is missing/, /standard must be 1/, /akai must hold/, /quit must be/, /Windows line endings/,
    /fixed card path/, /mount table/, /size or fingerprint/, /starts the Akai app/]) {
    assert.ok(result.problems.some((problem) => part.test(problem)), String(part));
  }
  assert.equal(result.problems.length, 9);
  const lost = await plan(await zipOf({ 'autorun/mpselector.txt': 'name: A\nstart: ../go.sh\nakai: 1.4.0.8\n' }), 'x', assets);
  assert.match(lost.problems[0], /inside the same folder/);
});

test('the ZIP for other browsers needs no merging: one folder for firmware, card data apart', async () => {
  const simple = await plan(await zipOf({
    'SD Card/autorun/mpcsimple': 'ELF',
    'SD Card/MPC-Simple/Models/spleeter-4stems.mpcsnn': 'model',
  }), 'x', assets);
  const made = handoff(simple);
  const names = made.files.map(([path]) => path);
  assert.ok(names.includes('1 - Drag into the firmware folder/mpc-simple/run.sh'));
  assert.ok(names.includes('2 - Drag to the top of the card/MPC-Simple/Models/spleeter-4stems.mpcsnn'));
  assert.ok(names.includes('READ ME.txt') && !names.some((n) => n.startsWith('firmware/')));
  assert.equal(made.steps.length, 4);
  assert.match(made.steps[2], /already has one, skip/);
  const melodeeSteps = handoff(await plan(await melodee(), 'x', assets));
  assert.equal(melodeeSteps.steps.length, 3);
  assert.ok(melodeeSteps.files.some(([path]) => path === '1 - Drag into the firmware folder/melodee/.release/stems/weights.f16'));
});

test('checksum list covers top-level files only, sorted by name', () => {
  const list = new TextDecoder().decode(sums([['firmware/a/z', utf8('1')], ['firmware/a/b', utf8('2')],
    ['firmware/a/.release/c', utf8('3')], ['firmware/other/d', utf8('4')]], 'firmware/a'));
  assert.deepEqual(list.trim().split('\n').map((row) => row.slice(66)), ['b', 'z']);
});

test('the committed page is the current build and needs nothing else', async () => {
  const page = await build();
  assert.equal(page, await readFile(new URL('../Add Firmware.html', import.meta.url), 'utf8'));
  assert.ok(!/<script[^>]+src=|<link|https?:\/\/[^"']*\.(js|css)/.test(page));
});
