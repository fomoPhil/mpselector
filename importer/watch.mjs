#!/usr/bin/env node
// Checks each firmware's latest release against the importer: node importer/watch.mjs
// It downloads the newest ZIP to a temporary folder, reads it, and deletes it.
// Nothing from a ZIP is run. Exit code 1 means something needs a look.
import { openAsBlob } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAssets } from './cli.mjs';
import { Zip, sha256Blob } from './engine.mjs';
import { plan } from './recipes.mjs';

// expect: 'ready' for firmware the page adds today, 'blocked' for firmware it only names.
const SOURCES = [
  { name: 'Melodee', github: 'keremimo/melodee-sample', expect: 'ready' },
  { name: 'MPC Simple', sourceforge: 'mpcsimple', expect: 'ready' },
  { name: 'SampQOL OS', github: 'snarebes/SampQOL-OS', expect: 'blocked' },
  { name: 'GRIDZILLA', github: 'ZootedandRebooted/GRIDZILLA', expect: 'blocked' },
];
const HEADERS = { 'User-Agent': 'mp-selector-release-watcher' };

async function latest(source) {
  if (source.github) {
    const reply = await fetch(`https://api.github.com/repos/${source.github}/releases?per_page=5`, { headers: HEADERS });
    if (!reply.ok) throw new Error(`GitHub answered ${reply.status}`);
    for (const release of await reply.json()) {
      const asset = release.assets.find((a) => a.name.toLowerCase().endsWith('.zip'));
      if (asset) return { version: release.tag_name, url: asset.browser_download_url, notes: release.body || '' };
    }
    throw new Error('no release with a ZIP');
  }
  const reply = await fetch(`https://sourceforge.net/projects/${source.sourceforge}/rss?path=/`, { headers: HEADERS });
  if (!reply.ok) throw new Error(`SourceForge answered ${reply.status}`);
  const link = (await reply.text()).match(/<link>(https:\/\/sourceforge\.net\/projects\/[^<]+\.zip\/download)<\/link>/);
  if (!link) throw new Error('no ZIP in the feed');
  return { version: decodeURIComponent(link[1].split('/').at(-2)).replace(/\.zip$/, ''), url: link[1], notes: '' };
}

const assets = await loadAssets();
const folder = await mkdtemp(join(tmpdir(), 'mp-selector-watch-'));
let look = false;
try {
  for (const source of SOURCES) {
    try {
      const release = await latest(source);
      const reply = await fetch(release.url, { headers: HEADERS });
      if (!reply.ok) throw new Error(`download answered ${reply.status}`);
      const file = join(folder, 'release.zip');
      await writeFile(file, Buffer.from(await reply.arrayBuffer()));
      const blob = await openAsBlob(file);
      const sha = await sha256Blob(blob);
      const result = await plan(await Zip.open(blob), sha, assets);
      let line;
      if (result.status === 'ready' && result.tested) line = 'tested version, nothing to do';
      else if (result.status === 'ready') line = `NEW, imports but is not tested on an MPC. sha256 ${sha}`;
      else if (source.expect === 'ready') line = `BROKEN, the importer no longer accepts it: ${result.reason}`;
      else line = /1\.4/.test(release.notes) ? 'CHECK, release notes mention 1.4' : 'still blocked, as expected';
      look ||= /^(NEW|BROKEN|CHECK)/.test(line);
      console.log(`${source.name} ${release.version}: ${line}`);
    } catch (error) {
      look = true;
      console.log(`${source.name}: FAILED, ${error.message}`);
    }
  }
} finally {
  await rm(folder, { recursive: true, force: true });
}
process.exit(look ? 1 : 0);
