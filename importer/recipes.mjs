// What the importer knows about each firmware's release ZIP.
// plan() never touches the card. It returns the files to write.
import { decode, sha256, sums, utf8 } from './engine.mjs';

const MELODEE_STOCK_START = 'exec /bin/systemctl start ac50.service\n';
const SIMPLE_MODEL = 'MPC-Simple/Models/spleeter-4stems.mpcsnn';

// Folder inside the ZIP that holds a given card file, or null.
function rootOf(zip, marker) {
  const hit = zip.names().find((n) => n === marker || n.endsWith('/' + marker));
  return hit == null ? null : hit.slice(0, hit.length - marker.length);
}

function entry(id, files, assets, names) {
  for (const name of names) files.push([`firmware/${id}/${name}`, assets[`${id}/${name}`]]);
  files.push([`firmware/${id}/SHA256SUMS`, sums(files, `firmware/${id}`)]);
  files.push([`firmware/${id}/cover.rgb565`, assets[`${id}/cover.rgb565`]]);
}

const READY = [
  {
    id: 'melodee',
    name: 'Melodee',
    home: 'https://github.com/keremimo/melodee-sample/releases',
    tested: { '3dbe3dd6b50bb8fefde92ff6ad436e78425ab690074b16ef32a47d2142b6e125': '0.8.2' },
    async match(zip) {
      const root = rootOf(zip, 'autorun/melodee/sample-base');
      if (root == null || !zip.has(root + 'autorun/melodee/app')) return null;
      return decode(await zip.read(root + 'autorun/melodee/app')).trim() === 'melodee' ? root : null;
    },
    async build(zip, root, assets) {
      const from = root + 'autorun/melodee/';
      const files = [];
      const stems = [];
      for (const member of zip.names().sort()) {
        if (!member.startsWith(from)) continue;
        const name = member.slice(from.length);
        if (name === 'sample-base') {
          files.push(['firmware/melodee/sample-base', await zip.read(member)]);
        } else if (/^(stems|licenses)\//.test(name) || name === 'README.txt' || name === 'VERSION') {
          // The selector copies visible files to memory. Model weights and
          // notices stay on the card in a hidden folder, where Melodee looks.
          const bytes = await zip.read(member);
          files.push(['firmware/melodee/.release/' + name, bytes]);
          if (/^stems\/[^/]+$/.test(name)) stems.push(`${sha256(bytes)}  ${name}\n`);
        }
      }
      if (!stems.length) throw new Error('This Melodee ZIP has no stems folder.');
      const restore = decode(await zip.read(from + 'restore-stock.sh'));
      if (!restore.endsWith(MELODEE_STOCK_START) || restore.split(MELODEE_STOCK_START).length !== 2) {
        throw new Error('This Melodee version shuts down in a way this tool does not know yet.');
      }
      // Keep Melodee's own cleanup. Only the selector restarts what comes next.
      files.push(['firmware/melodee/restore-selector.sh', utf8(
        restore.slice(0, -MELODEE_STOCK_START.length) + '# MP Selector resumes its menu after cleanup.\nexit 0\n')]);
      files.push(['firmware/melodee/stems.sha256', utf8(stems.join(''))]);
      entry('melodee', files, assets, ['run.sh', 'name', 'caption']);
      const version = zip.has(from + 'VERSION') ? decode(await zip.read(from + 'VERSION')).trim().split(' ')[0] : '';
      return { files, version };
    },
  },
  {
    id: 'mpc-simple',
    name: 'MPC Simple',
    home: 'https://sourceforge.net/projects/mpcsimple/files/',
    tested: { 'bd691e9b44e8263c55491aa1713cc4666bc102610a24fdb30be83a61bf2c09e2': '1.0 Beta 10' },
    async match(zip) {
      return rootOf(zip, 'autorun/mpcsimple');
    },
    async build(zip, root, assets) {
      const files = [['firmware/mpc-simple/mpcsimple', await zip.read(root + 'autorun/mpcsimple')]];
      entry('mpc-simple', files, assets, ['run.sh', 'app.sh', 'caption', 'name']);
      if (!zip.has(root + SIMPLE_MODEL)) throw new Error('This MPC Simple ZIP has no stem model.');
      // The stem model is card data. It lives outside the entry so it is not
      // copied to memory, next to the user's own projects and plugins.
      files.push([SIMPLE_MODEL, await zip.read(root + SIMPLE_MODEL)]);
      const version = (root.match(/MPC-Simple-([^/]+)\//) || [])[1] || '';
      return { files, version: version.replace(/-/g, ' '), keep: [SIMPLE_MODEL] };
    },
  },
];

const OLD = 'It is made for Akai firmware 1.3.0.12. MP Selector 1.0.1 runs on 1.4.0.8, so it cannot open here yet.';
const LATER = 'It has not been set up for MP Selector yet.';

// Firmware this tool can name but not add. [marker file, name, reason].
const KNOWN = [
  ['autorun/mpcqol.so', 'SampQOL OS', OLD],
  ['WaveGrid/CURRENT', 'GRIDZILLA', OLD],
  ['autorun/mod-launcher.sh', 'Am MOD', OLD],
  ['autorun/rhythmer/sample-base', 'RHYTHMER OS', OLD],
  ['autorun/app.delta.gz', 'MaiaOS', OLD],
  ['autorun/minimod.so', 'MINIMOD', OLD],
  ['autorun/kaoslayer.so', 'KAOSAMPLE', OLD],
  ['autorun/stemloop-mod.so', 'MPC Stemloop', OLD],
  ['autorun/libmpc_pcmfix.so', 'USB DeClick', OLD],
  ['autorun/sampleboot/', 'SampleBoot', 'It is a boot menu of its own. Use it or MP Selector on a card, not both.'],
  ['autorun/mpc-os', 'MPC 600 S', LATER],
  ['autorun/mpc-doom', 'MP DOOM', LATER],
  ['autorun/tracker.sh', 'MPCTRACKER', LATER],
  ['autorun/doom.sh', 'MPC DOOM', LATER],
  ['autorun/epicycle/', 'EPICYCLE', LATER],
  ['Console/install.sh', 'Console', 'It installs itself onto the MPC, so it cannot run from a menu.'],
  ['FMSTEP/bin/', 'FM-STEP', LATER],
  ['BeatTrain/', 'Beat-Train', LATER],
];

function known(zip) {
  const names = zip.names();
  for (const [marker, name, reason] of KNOWN) {
    const hit = marker.endsWith('/')
      ? names.some((n) => n.startsWith(marker) || n.includes('/' + marker))
      : rootOf(zip, marker) != null;
    if (hit) return { name, reason };
  }
  return null;
}

// Decide what to do with a release ZIP.
//   { status: 'ready', id, name, version, tested, files, keep }
//   { status: 'blocked', name, reason }
export async function plan(zip, archiveSha, assets) {
  for (const recipe of READY) {
    const root = await recipe.match(zip);
    if (root == null) continue;
    const built = await recipe.build(zip, root, assets);
    const tested = recipe.tested[archiveSha];
    return {
      status: 'ready', id: recipe.id, name: recipe.name, home: recipe.home,
      version: tested || built.version, tested: !!tested,
      testedVersions: Object.values(recipe.tested),
      files: built.files, keep: built.keep || [],
    };
  }
  const found = known(zip);
  if (found) return { status: 'blocked', name: found.name, reason: found.reason };
  const card = rootOf(zip, 'autorun/autorun.json');
  return {
    status: 'blocked', name: '',
    reason: card == null
      ? 'This ZIP does not look like MPC Sample firmware. Use the ZIP you downloaded from the firmware\'s own page.'
      : 'This firmware is not one MP Selector knows yet, so it cannot open from the menu.',
  };
}

export const SUPPORTED = READY.map((r) => ({ name: r.name, home: r.home }));

// Write a plan through a sink: { has(path), remove(path), write(path, bytes) }.
// The entry folder is replaced. Paths in plan.keep are left alone if present.
export async function apply(result, sink, progress) {
  for (const need of ['autorun', 'firmware']) {
    if (!(await sink.has(need))) {
      throw new Error('That is not an MP Selector card. Pick the card that has autorun and firmware on it.');
    }
  }
  await sink.remove(`firmware/${result.id}`);
  let done = 0;
  for (const [path, bytes] of result.files) {
    if (!(result.keep.includes(path) && await sink.has(path))) await sink.write(path, bytes);
    if (progress) progress(++done / result.files.length);
  }
}
