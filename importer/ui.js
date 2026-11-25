// Page behaviour for Add Firmware.html. ASSETS is injected by build.mjs.
const $ = (id) => document.getElementById(id);
const out = $('out');
const el = (tag, text, cls) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (cls) node.className = cls;
  return node;
};
const show = (...nodes) => out.replaceChildren(...nodes);
const assets = Object.fromEntries(Object.entries(ASSETS).map(([name, b64]) =>
  [name, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))]));

$('foot').append('Works with ', ...SUPPORTED.flatMap((s, i) => {
  const link = el('a', s.name);
  link.href = s.home;
  link.target = '_blank';
  link.rel = 'noopener';
  return i ? [' and ', link] : [link];
}), '. Download the ZIP from its own page first.');

function handleSink(root) {
  const walk = async (path, create) => {
    const parts = path.split('/');
    let dir = root;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return [dir, parts.at(-1)];
  };
  return {
    async has(path) {
      try {
        const [dir, name] = await walk(path, false);
        await dir.getFileHandle(name).catch(() => dir.getDirectoryHandle(name));
        return true;
      } catch { return false; }
    },
    async remove(path) {
      try {
        const [dir, name] = await walk(path, false);
        await dir.removeEntry(name, { recursive: true });
      } catch (error) {
        if (error.name !== 'NotFoundError') throw error;
      }
    },
    async write(path, bytes) {
      const [dir, name] = await walk(path, true);
      const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await stream.write(bytes);
      await stream.close();
    },
  };
}

function ready(result) {
  const status = el('p', '');
  const add = el('button', 'Add to card', 'go');
  const zip = el('button', 'Download as ZIP');
  const row = el('div', '', 'row');
  const busy = (on) => { add.disabled = zip.disabled = on; };
  const fail = (error) => { status.className = 'bad'; status.textContent = error.message; busy(false); };
  add.onclick = async () => {
    let card;
    try { card = await showDirectoryPicker({ mode: 'readwrite' }); } catch { return; }
    busy(true);
    status.className = '';
    try {
      await apply(result, handleSink(card), (done) => { status.textContent = `Copying ${Math.round(done * 100)}%`; });
      status.textContent = `${result.name} is on your card. Eject it and put it in your MPC.`;
      busy(false);
    } catch (error) { fail(error); }
  };
  zip.onclick = () => {
    const link = el('a', '');
    link.href = URL.createObjectURL(storeZip(result.files));
    link.download = `${result.id}-for-mp-selector.zip`;
    link.click();
    status.className = '';
    status.textContent = 'Unzip it, then copy what is inside to the top of your card. Merge the firmware folder.';
  };
  if ('showDirectoryPicker' in window) row.append(add);
  else zip.className = 'go';
  row.append(zip);
  const parts = [el('h2', `${result.name} ${result.version}`.trim())];
  if (!result.tested) {
    parts.push(el('p', `Phil has not tested this version. Tested: ${result.testedVersions.join(', ')}. It should work, but if it does not, use that version.`, 'warn'));
  }
  show(...parts, row, status);
}

async function load(file) {
  show(el('p', 'Reading the ZIP'));
  try {
    const hash = await sha256Blob(file);
    const result = await plan(await Zip.open(file), hash, assets);
    if (result.status === 'ready') return ready(result);
    show(...(result.name ? [el('h2', result.name)] : []), el('p', result.reason, 'bad'));
  } catch (error) {
    show(el('p', error.message, 'bad'));
  }
}

const drop = $('drop');
$('file').onchange = (event) => event.target.files[0] && load(event.target.files[0]);
for (const type of ['dragenter', 'dragover']) {
  addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('over'); });
}
addEventListener('dragleave', () => drop.classList.remove('over'));
addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('over');
  if (event.dataTransfer.files[0]) load(event.dataTransfer.files[0]);
});
