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

// The MPC in the picture shows the cover of whatever was just recognised.
const mini = $('mini');
const idle = mini.src;
const screen = (id) => {
  const next = (id && mini.getAttribute('data-' + id)) || idle;
  if (mini.src === next) return;
  mini.src = next;
  mini.classList.remove('swap');
  void mini.offsetWidth;
  mini.classList.add('swap');
};

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
  if (result.warn) parts.push(el('p', result.warn, 'warn'));
  show(...parts, row, status);
}

async function load(file) {
  show(el('p', 'Reading the ZIP'));
  try {
    const hash = await sha256Blob(file);
    const zip = await Zip.open(file);
    const names = zip.names();
    const result = await plan(zip, hash, assets);
    screen(result.status === 'ready' ? result.id : '');
    if (result.status === 'ready') return ready(result);
    const parts = [...(result.name ? [el('h2', result.name)] : []), el('p', result.reason, 'bad'),
      ...(result.problems || []).map((problem) => el('p', problem))];
    if (result.request) {
      const link = 'https://github.com/fomoPhil/mpselector/issues/new?' + new URLSearchParams({
        title: `Firmware request: ${result.name || file.name}`,
        body: `File: ${file.name}\nSHA-256: ${hash}\n\nWhere I downloaded it:\n`,
      });
      const ask = el('button', 'Request this firmware', 'go');
      const row = el('div', '', 'row');
      const note = el('p', '');
      // One press tells Phil. Only the file name, its fingerprint and the names
      // of the files inside are sent, never the firmware. If the site cannot
      // take the request, a filled-in GitHub issue opens.
      ask.onclick = async () => {
        ask.disabled = true;
        try {
          if (location.protocol === 'file:') throw new Error('offline copy');
          const reply = await fetch('/api/firmware-request/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha256: hash, fileName: file.name, name: result.name, files: names.slice(0, 80) }),
          });
          if (reply.status === 429) { note.textContent = 'Lots of requests today. Please try again tomorrow.'; return; }
          if (!reply.ok) throw new Error('not sent');
          ask.textContent = 'Request sent';
          note.textContent = 'Phil has it. Check back on this page in a few days.';
        } catch {
          ask.disabled = false;
          window.open(link, '_blank', 'noopener');
          note.textContent = 'A GitHub page opened with the request filled in. Press Submit there.';
        }
      };
      row.append(ask);
      parts.push(row, note);
    }
    show(...parts);
  } catch (error) {
    show(el('p', error.message, 'bad'));
  }
}

const drop = $('drop');
$('file').onchange = (event) => event.target.files[0] && load(event.target.files[0]);
for (const type of ['dragenter', 'dragover']) {
  addEventListener(type, (event) => { event.preventDefault(); drop.classList.add('over'); document.body.classList.add('over-page'); });
}
const calm = () => { drop.classList.remove('over'); document.body.classList.remove('over-page'); };
addEventListener('dragleave', calm);
addEventListener('drop', (event) => {
  event.preventDefault();
  calm();
  if (event.dataTransfer.files[0]) load(event.dataTransfer.files[0]);
});
