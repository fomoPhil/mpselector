#!/usr/bin/env node
// Command-line form of Add Firmware.html: node importer/cli.mjs <release.zip> [card folder]
// Without a card folder it only checks the ZIP.
import { openAsBlob } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Zip, sha256Blob } from './engine.mjs';
import { apply, plan } from './recipes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function loadAssets(folder = join(HERE, 'adapters')) {
  const assets = {};
  for (const id of await readdir(folder)) {
    for (const name of await readdir(join(folder, id))) {
      assets[`${id}/${name}`] = new Uint8Array(await readFile(join(folder, id, name)));
    }
  }
  return assets;
}

export function folderSink(card) {
  return {
    has: (path) => stat(join(card, path)).then(() => true, () => false),
    remove: (path) => rm(join(card, path), { recursive: true, force: true }),
    async write(path, bytes) {
      await mkdir(dirname(join(card, path)), { recursive: true });
      await writeFile(join(card, path), bytes);
    },
  };
}

export async function importZip(archive, card) {
  const blob = await openAsBlob(archive);
  const result = await plan(await Zip.open(blob), await sha256Blob(blob), await loadAssets());
  if (result.status === 'ready' && card) await apply(result, folderSink(card));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [archive, card] = process.argv.slice(2);
  if (!archive) {
    console.error('Usage: node importer/cli.mjs <release.zip> [card folder]');
    process.exit(2);
  }
  try {
    const result = await importZip(archive, card);
    if (result.status !== 'ready') {
      console.error([result.name, result.reason].filter(Boolean).join(': '));
      for (const problem of result.problems || []) console.error('- ' + problem);
      process.exit(1);
    }
    console.log(`${card ? 'Added' : 'Ready:'} ${result.name} ${result.version}`.trim());
    if (result.warn) console.log(result.warn);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
