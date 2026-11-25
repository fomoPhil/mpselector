#!/usr/bin/env node
// Builds the single offline page: node importer/build.mjs [output.html]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssets } from './cli.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function build() {
  const source = async (name) => (await readFile(join(HERE, name), 'utf8'))
    .replace(/^import .*\n/gm, '').replace(/^export /gm, '');
  const assets = Object.fromEntries(Object.entries(await loadAssets())
    .map(([name, bytes]) => [name, Buffer.from(bytes).toString('base64')]));
  const script = [await source('engine.mjs'), await source('recipes.mjs'),
    `const ASSETS = ${JSON.stringify(assets)};`, await source('ui.js')].join('\n');
  if (script.includes('</script')) throw new Error('Script would end the page early.');
  return (await readFile(join(HERE, 'page.html'), 'utf8')).replace('/*SCRIPT*/', () => script);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] || join(HERE, '..', 'Add Firmware.html');
  await writeFile(output, await build());
  console.log(output);
}
