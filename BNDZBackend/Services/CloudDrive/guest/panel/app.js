const app = document.getElementById('app');
let cwd = '';
let me = null;
let entries = [];
let selected = [];
let anchor = -1;
let clip = null;
let sortKey = 'name';
let sortDir = 1;
let notice = '';
let menuBound = false;

const folderIcon = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="#dcb67a" d="M1.5 3.5h4l1.2 1.5H14.5v8H1.5z"/><path fill="#c49a45" d="M1.5 6h13v7H1.5z"/></svg>';
const fileIcon = '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path fill="#d0d0d0" d="M4 1.5h5.2L13 5.2V14.5H4z"/><path fill="#1f1f1f" d="M9 1.8v3.4h3.3"/></svg>';

function withBase(path) {
  const prefix = String(window.BNDZ_BASE || '').replace(/\/$/, '');
  if (!prefix || !path || path.charAt(0) !== '/' || path.indexOf('/s/') === 0) return path;
  return prefix + path;
}

async function api(path, opts) {
  const res = await fetch(withBase(path), { credentials: 'same-origin', ...opts });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new Error('The panel could not finish that.');
    return res;
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'The panel could not finish that.');
  return data;
}

function post(path, body) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function uploadFile(file) {
  const start = await post('/api/upload/start', { dir: cwd, name: file.name, size: file.size });
  const piece = start.chunkSize || (90 * 1024 * 1024);
  let offset = start.offset || 0;
  while (offset < file.size) {
    const slice = file.slice(offset, Math.min(file.size, offset + piece));
    const res = await fetch(withBase('/api/upload/chunk?id=' + encodeURIComponent(start.id) + '&offset=' + offset), {
      method: 'PUT',
      credentials: 'same-origin',
      body: slice,
    });
    const data = await res.json();
    if (res.status === 409 && typeof data.offset === 'number') {
      offset = data.offset;
      continue;
    }
    if (!res.ok || data.ok === false) throw new Error(data.error || 'The panel could not finish that.');
    offset = data.offset;
  }
  await post('/api/upload/finish', { id: start.id });
}

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmt(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return (i === 0 ? String(n) : n.toFixed(n >= 10 ? 0 : 1)) + ' ' + units[i];
}

function fmtDate(sec) {
  if (!sec) return '';
  return new Date(sec * 1000).toLocaleString(undefined, {
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function itemPath(name) {
  return (cwd ? cwd + '/' : '') + name;
}

function sortedEntries() {
  const rows = entries.slice();
  rows.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1;
    let cmp = 0;
    if (sortKey === 'size') cmp = (a.size || 0) - (b.size || 0);
    else if (sortKey === 'mtime') cmp = (a.mtime || 0) - (b.mtime || 0);
    else cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return cmp * sortDir;
  });
  return rows;
}

async function boot() {
  let brand = 'BNDZ Drive';
  try {
    const health = await api('/api/health');
    brand = health.brandName || brand;
  } catch { /* login still works */ }
  try {
    me = await api('/api/me');
    paintShell('files');
  } catch {
    paintLogin(brand);
  }
}

function paintLogin(brand, error) {
  document.title = brand || 'BNDZ Drive';
  app.className = 'gate';
  app.innerHTML = `
    <div class="gate-box">
      <h1>${esc(brand || 'BNDZ Drive')}</h1>
      <p>Sign in. Your name and password are changed in Settings after that.</p>
      <form id="login">
        ${error ? `<p class="err">${esc(error)}</p>` : ''}
        <label>User <input name="user" autocomplete="username"></label>
        <label>Password <input name="password" type="password" autocomplete="current-password"></label>
        <button type="submit">Sign in</button>
      </form>
    </div>`;
  app.querySelector('#login').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: fd.get('user'), password: fd.get('password') }),
      });
      me = await api('/api/me');
      paintShell('files');
    } catch (err) {
      paintLogin(brand, err.message);
    }
  };
}

function paintShell(page) {
  const brand = me.brandName || 'BNDZ Drive';
  const who = me.displayName || me.user;
  document.title = brand;
  app.className = 'shell';
  app.innerHTML = `
    <header class="titlebar">
      <strong>${esc(brand)}</strong>
      <span class="who">${esc(who)}</span>
      <nav aria-label="Drive">
        <button type="button" id="nav-files" class="${page === 'files' ? 'on' : ''}">Files</button>
        <button type="button" id="nav-admin" class="${page === 'admin' ? 'on' : ''}">Settings</button>
        <button type="button" id="out">Sign out</button>
      </nav>
    </header>
    <div id="page"></div>`;
  document.getElementById('nav-files').onclick = () => paintShell('files');
  document.getElementById('nav-admin').onclick = () => paintShell('admin');
  document.getElementById('out').onclick = async () => {
    await api('/api/logout', { method: 'POST' });
    paintLogin(brand);
  };
  if (page === 'admin') paintAdmin();
  else paintFiles();
}

function paintFiles() {
  const page = document.getElementById('page');
  page.innerHTML = `
    <div class="explorer" id="explorer" tabindex="0">
      <div class="cmdbar">
        <button type="button" id="mkdir">New folder</button>
        <label class="cmd">Upload <input id="file" type="file"></label>
        <span class="sep"></span>
        <button type="button" id="cut" disabled>Cut</button>
        <button type="button" id="copy" disabled>Copy</button>
        <button type="button" id="paste" disabled>Paste</button>
        <span class="sep"></span>
        <button type="button" id="rename" disabled>Rename</button>
        <button type="button" id="share" disabled>Share</button>
        <button type="button" id="del" disabled>Delete</button>
        <button type="button" id="download" disabled>Download</button>
        <span class="sep"></span>
        <button type="button" id="props" disabled>Properties</button>
        <button type="button" id="archive">Archive</button>
      </div>
      <div class="crumbs" id="crumbs"></div>
      <p class="notice" id="notice"></p>
      <div class="grid-wrap">
        <table class="grid">
          <thead>
            <tr>
              <th data-sort="name">Name</th>
              <th class="size" data-sort="size">Size</th>
              <th class="mod" data-sort="mtime">Date modified</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <div class="status" id="status"></div>
    </div>`;
  const explorer = document.getElementById('explorer');
  explorer.addEventListener('keydown', onKey);
  explorer.addEventListener('contextmenu', onBackgroundMenu);
  document.getElementById('mkdir').onclick = () => askName('New folder', 'Folder name', '', async (name) => {
    await post('/api/mkdir', { path: cwd, name });
    await load();
  });
  document.getElementById('file').onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      await uploadFile(file);
      notice = '';
      await load();
    } catch (err) { fail(err); }
  };
  document.getElementById('cut').onclick = () => setClip('cut');
  document.getElementById('copy').onclick = () => setClip('copy');
  document.getElementById('paste').onclick = () => doPaste();
  document.getElementById('rename').onclick = () => doRename();
  document.getElementById('share').onclick = () => doShare();
  document.getElementById('del').onclick = () => doDelete();
  document.getElementById('download').onclick = () => doDownload();
  document.getElementById('props').onclick = () => doProps(selected.length === 1 ? selected[0] : cwd);
  document.getElementById('archive').onclick = () => { window.location.href = withBase('/api/archive'); };
  page.querySelectorAll('th[data-sort]').forEach(th => {
    th.onclick = () => {
      const key = th.getAttribute('data-sort');
      sortDir = sortKey === key ? -sortDir : 1;
      sortKey = key;
      renderRows();
    };
  });
  if (!menuBound) {
    document.addEventListener('mousedown', closeMenu);
    menuBound = true;
  }
  load();
  explorer.focus();
}

function fail(err) {
  notice = err && err.message ? err.message : 'That did not finish.';
  const node = document.getElementById('notice');
  if (node) node.textContent = notice;
}

function onKey(ev) {
  if (ev.target.closest('input, textarea')) return;
  const key = ev.key.toLowerCase();
  if (ev.key === 'Delete') { ev.preventDefault(); doDelete(); }
  else if (ev.key === 'F2') { ev.preventDefault(); doRename(); }
  else if (ev.ctrlKey && key === 'c') { ev.preventDefault(); setClip('copy'); }
  else if (ev.ctrlKey && key === 'x') { ev.preventDefault(); setClip('cut'); }
  else if (ev.ctrlKey && key === 'v') { ev.preventDefault(); doPaste(); }
  else if (ev.ctrlKey && key === 'a') { ev.preventDefault(); selected = sortedEntries().map(item => itemPath(item.name)); anchor = selected.length - 1; renderRows(); }
  else if (ev.key === 'Backspace') { ev.preventDefault(); goUp(); }
  else if (ev.key === 'Escape') closeMenu();
}

function goUp() {
  if (!cwd) return;
  cwd = cwd.split('/').slice(0, -1).join('/');
  selected = [];
  load();
}

function setClip(mode) {
  if (!selected.length) return;
  clip = { mode, paths: selected.slice() };
  notice = '';
  renderRows();
}

async function doPaste() {
  if (!clip || !clip.paths.length) return;
  try {
    await post(clip.mode === 'cut' ? '/api/move' : '/api/copy', { paths: clip.paths, dest: cwd });
    if (clip.mode === 'cut') clip = null;
    notice = '';
    await load();
  } catch (err) { fail(err); }
}

function doRename() {
  if (selected.length !== 1) return;
  const path = selected[0];
  const current = path.split('/').pop();
  askName('Rename', 'New name', current, async (name) => {
    await post('/api/rename', { from: path, name });
    selected = [];
    await load();
  });
}

function doDelete() {
  if (!selected.length) return;
  const label = selected.length === 1 ? selected[0].split('/').pop() : selected.length + ' items';
  askConfirm('Delete', 'Delete ' + label + '?', async () => {
    await post('/api/delete', { paths: selected });
    selected = [];
    await load();
  });
}

function doDownload() {
  const files = selected.filter(path => {
    const name = path.split('/').pop();
    const item = entries.find(row => row.name === name);
    return item && !item.dir;
  });
  if (files.length !== 1) {
    fail(new Error(files.length ? 'Download one file at a time.' : 'Download is for a file. Folders stay on the disk.'));
    return;
  }
  window.location.href = withBase('/api/download?path=' + encodeURIComponent(files[0]));
}

async function doShare() {
  if (selected.length !== 1) {
    fail(new Error('Share one file or folder.'));
    return;
  }
  const path = selected[0];
  const hours = Number(me.shareHours) || 24;
  dialog('Share', `
    <p class="meta">${esc(path)}</p>
    <label>Hours <input name="hours" type="number" min="1" max="720" value="${hours}"></label>
    <label>Password, optional <input name="password" type="password" autocomplete="off"></label>
    <label class="check"><input name="write" type="checkbox" ${me.shareWrite ? 'checked' : ''}> Allow upload</label>
    <div class="dialog-actions"><button type="button" id="cancel">Cancel</button><button type="button" id="ok">Create link</button></div>
    <div class="share-hit" id="made"></div>
  `, (root) => {
    root.querySelector('#cancel').onclick = closeDialog;
    root.querySelector('#ok').onclick = async () => {
      try {
        const created = await post('/api/shares', {
          path,
          hours: Number(root.querySelector('[name="hours"]').value || hours),
          password: root.querySelector('[name="password"]').value || '',
          write: root.querySelector('[name="write"]').checked,
        });
        const abs = new URL(created.share.url, window.location.origin).href;
        root.querySelector('#made').innerHTML = `<p class="url">${esc(abs)}</p><button type="button" id="copy-link">Copy link</button>`;
        root.querySelector('#copy-link').onclick = () => navigator.clipboard.writeText(abs);
      } catch (err) { fail(err); }
    };
  });
}

async function doProps(path) {
  try {
    const info = await api('/api/props?path=' + encodeURIComponent(path || ''));
    const type = info.dir ? 'File folder' : (info.name.includes('.') ? info.name.split('.').pop().toUpperCase() + ' file' : 'File');
    const size = info.dir ? info.children + ' items' : fmt(info.size);
    dialog('Properties', `
      <dl class="props">
        <dt>Name</dt><dd>${esc(info.name || 'Drive')}</dd>
        <dt>Type</dt><dd>${esc(type)}</dd>
        <dt>Path</dt><dd>/${esc(info.path || '')}</dd>
        <dt>Size</dt><dd>${esc(size)}</dd>
        <dt>Modified</dt><dd>${esc(fmtDate(info.mtime))}</dd>
        <dt>Permissions</dt><dd>${esc(info.mode || '')}</dd>
      </dl>
      <div class="dialog-actions"><button type="button" id="ok">Close</button></div>
    `, (root) => { root.querySelector('#ok').onclick = closeDialog; });
  } catch (err) { fail(err); }
}

function askName(title, label, value, run) {
  dialog(title, `
    <label>${esc(label)} <input name="name" value="${esc(value)}"></label>
    <div class="dialog-actions"><button type="button" id="cancel">Cancel</button><button type="button" id="ok">OK</button></div>
  `, (root) => {
    const input = root.querySelector('[name="name"]');
    input.focus();
    input.select();
    root.querySelector('#cancel').onclick = closeDialog;
    const go = async () => {
      const name = input.value.trim();
      if (!name) return;
      try {
        await run(name);
        closeDialog();
        notice = '';
      } catch (err) { fail(err); }
    };
    root.querySelector('#ok').onclick = go;
    input.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); go(); } };
  });
}

function askConfirm(title, text, run) {
  dialog(title, `
    <p>${esc(text)}</p>
    <div class="dialog-actions"><button type="button" id="cancel">Cancel</button><button type="button" id="ok">Delete</button></div>
  `, (root) => {
    root.querySelector('#cancel').onclick = closeDialog;
    root.querySelector('#ok').onclick = async () => {
      try { await run(); closeDialog(); } catch (err) { fail(err); }
    };
  });
}

function dialog(title, body, ready) {
  closeDialog();
  closeMenu();
  const root = document.createElement('div');
  root.className = 'dialog-scrim';
  root.innerHTML = `<div class="dialog" role="dialog" aria-label="${esc(title)}"><div class="dialog-title">${esc(title)}</div><div class="dialog-body">${body}</div></div>`;
  root.addEventListener('mousedown', (ev) => { if (ev.target === root) closeDialog(); });
  document.body.appendChild(root);
  ready(root);
}

function closeDialog() {
  document.querySelector('.dialog-scrim')?.remove();
}

function closeMenu() {
  document.querySelector('.menu')?.remove();
}

function openMenu(x, y, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.addEventListener('mousedown', (ev) => ev.stopPropagation());
  items.forEach(item => {
    if (item.sep) {
      menu.appendChild(document.createElement('hr'));
      return;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.disabled = !!item.disabled;
    button.innerHTML = `<span>${esc(item.label)}</span><span class="key">${esc(item.key || '')}</span>`;
    button.onclick = () => { closeMenu(); item.run(); };
    menu.appendChild(button);
  });
  document.body.appendChild(menu);
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(x, window.innerWidth - box.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(y, window.innerHeight - box.height - 4)) + 'px';
}

function menuItems(forSelection) {
  const one = selected.length === 1;
  const any = selected.length > 0;
  if (!forSelection) {
    return [
      { label: 'New folder', run: () => document.getElementById('mkdir').click() },
      { label: 'Paste', key: 'Ctrl+V', disabled: !clip, run: () => doPaste() },
      { sep: true },
      { label: 'Properties', run: () => doProps(cwd) },
    ];
  }
  return [
    { label: 'Open', disabled: !one, run: () => openItem(selected[0]) },
    { label: 'Download', disabled: !one, run: () => doDownload() },
    { sep: true },
    { label: 'Cut', key: 'Ctrl+X', disabled: !any, run: () => setClip('cut') },
    { label: 'Copy', key: 'Ctrl+C', disabled: !any, run: () => setClip('copy') },
    { label: 'Paste', key: 'Ctrl+V', disabled: !clip, run: () => doPaste() },
    { sep: true },
    { label: 'Rename', key: 'F2', disabled: !one, run: () => doRename() },
    { label: 'Delete', key: 'Del', disabled: !any, run: () => doDelete() },
    { label: 'Share', disabled: !one, run: () => doShare() },
    { sep: true },
    { label: 'New folder', run: () => document.getElementById('mkdir').click() },
    { label: 'Properties', run: () => doProps(one ? selected[0] : cwd) },
  ];
}

function onBackgroundMenu(ev) {
  if (ev.target.closest('tr[data-path], .menu, .dialog, .cmdbar, .crumbs')) return;
  ev.preventDefault();
  openMenu(ev.clientX, ev.clientY, menuItems(false));
}

function openItem(path) {
  const name = path.split('/').pop();
  const item = entries.find(row => row.name === name);
  if (!item) return;
  if (item.dir) {
    cwd = path;
    selected = [];
    load();
  } else {
    window.location.href = withBase('/api/download?path=' + encodeURIComponent(path));
  }
}

async function load() {
  try {
    const data = await api('/api/list?path=' + encodeURIComponent(cwd));
    cwd = data.path || '';
    entries = data.entries || [];
    selected = selected.filter(path => entries.some(item => itemPath(item.name) === path));
    renderRows();
  } catch (err) { fail(err); }
}

function renderRows() {
  const rows = document.getElementById('rows');
  const crumbs = document.getElementById('crumbs');
  const status = document.getElementById('status');
  const noticeNode = document.getElementById('notice');
  if (!rows || !crumbs) return;
  if (noticeNode) noticeNode.textContent = notice;
  const parts = cwd ? cwd.split('/') : [];
  crumbs.innerHTML = `<button type="button" data-crumb="">Drive</button>` + parts.map((part, i) => {
    const path = parts.slice(0, i + 1).join('/');
    return `<span class="sep">›</span><button type="button" data-crumb="${esc(path)}">${esc(part)}</button>`;
  }).join('');
  crumbs.querySelectorAll('[data-crumb]').forEach(button => {
    button.onclick = () => {
      cwd = button.getAttribute('data-crumb') || '';
      selected = [];
      load();
    };
  });
  const view = sortedEntries();
  rows.innerHTML = view.map(item => {
    const path = itemPath(item.name);
    const on = selected.includes(path) ? ' is-sel' : '';
    const cut = clip && clip.mode === 'cut' && clip.paths.includes(path) ? ' is-cut' : '';
    return `<tr data-path="${esc(path)}" class="${on}${cut}">
      <td><span class="name">${item.dir ? folderIcon : fileIcon}<span>${esc(item.name)}</span></span></td>
      <td class="size">${item.dir ? '' : esc(fmt(item.size))}</td>
      <td class="mod">${esc(fmtDate(item.mtime))}</td>
    </tr>`;
  }).join('') || '<tr class="empty"><td colspan="3">This folder is empty.</td></tr>';
  rows.querySelectorAll('tr[data-path]').forEach((row, index) => {
    row.onclick = (ev) => selectRow(index, ev);
    row.ondblclick = () => openItem(row.getAttribute('data-path'));
    row.oncontextmenu = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const path = row.getAttribute('data-path');
      if (!selected.includes(path)) { selected = [path]; anchor = index; renderRows(); }
      openMenu(ev.clientX, ev.clientY, menuItems(true));
    };
  });
  const one = selected.length === 1;
  const any = selected.length > 0;
  const setDisabled = (id, disabled) => {
    const node = document.getElementById(id);
    if (node) node.disabled = disabled;
  };
  setDisabled('cut', !any);
  setDisabled('copy', !any);
  setDisabled('paste', !clip);
  setDisabled('rename', !one);
  setDisabled('share', !one);
  setDisabled('del', !any);
  setDisabled('download', !one);
  setDisabled('props', false);
  if (status) {
    const clipNote = clip ? (clip.mode === 'cut' ? 'Cut ' : 'Copied ') + clip.paths.length : '';
    status.textContent = entries.length + (entries.length === 1 ? ' item' : ' items')
      + (selected.length ? '    ' + selected.length + ' selected' : '')
      + (clipNote ? '    ' + clipNote : '');
  }
}

function selectRow(index, ev) {
  const view = sortedEntries();
  const path = itemPath(view[index].name);
  if (ev.shiftKey && anchor >= 0) {
    const [a, b] = anchor < index ? [anchor, index] : [index, anchor];
    selected = view.slice(a, b + 1).map(item => itemPath(item.name));
  } else if (ev.ctrlKey || ev.metaKey) {
    selected = selected.includes(path) ? selected.filter(item => item !== path) : selected.concat(path);
    anchor = index;
  } else {
    selected = [path];
    anchor = index;
  }
  notice = '';
  renderRows();
}

async function paintAdmin() {
  const page = document.getElementById('page');
  page.innerHTML = '<div class="admin"><p class="meta">Loading settings…</p></div>';
  let cfg;
  try {
    cfg = await api('/api/admin');
  } catch (err) {
    page.innerHTML = `<div class="admin"><p class="err">${esc(err.message)}</p></div>`;
    return;
  }
  me = { ...me, ...cfg, user: cfg.username };
  const used = cfg.total ? Math.min(100, Math.round((cfg.used / cfg.total) * 100)) : 0;
  const protocols = cfg.protocols || {};
  page.innerHTML = `
    <div class="admin">
      <div class="admin-inner">
        <section>
          <h2>Disk</h2>
          <div class="meter" aria-hidden><span style="width:${used}%"></span></div>
          <p class="meta">${cfg.mounted ? fmt(cfg.used) + ' used · ' + fmt(cfg.total) + ' total' : 'The data disk is not mounted.'}</p>
          ${cfg.publicHost ? `<p class="url">People open https://${esc(cfg.publicHost)}/</p>` : '<p class="meta">No public hostname is on this guest yet. The link you send is the hostname saved in BNDZ.</p>'}
        </section>
        <form id="profile">
          <section>
            <h2>Sharing</h2>
            <label>Display name <input name="displayName" type="text" maxlength="64" value="${esc(cfg.displayName || '')}" autocomplete="nickname"></label>
            <label>Name on the drive <input name="brandName" type="text" maxlength="64" value="${esc(cfg.brandName || '')}"></label>
            <label>Session length, hours <input name="sessionHours" type="number" min="1" max="168" value="${Number(cfg.sessionHours) || 12}"></label>
            <label>Share links last, hours <input name="shareHours" type="number" min="1" max="720" value="${Number(cfg.shareHours) || 24}"></label>
            <label class="check"><input name="shareWrite" type="checkbox" ${cfg.shareWrite ? 'checked' : ''}> New share links allow upload</label>
          </section>
          <section>
            <h2>Listeners</h2>
            <label class="check"><input name="ssh" type="checkbox" ${protocols.ssh !== false ? 'checked' : ''}> SSH and SFTP</label>
            <label class="check"><input name="ftps" type="checkbox" ${protocols.ftps !== false ? 'checked' : ''}> FTPS</label>
            <label class="check"><input name="webdav" type="checkbox" ${protocols.webdav !== false ? 'checked' : ''}> WebDAV</label>
            <p class="meta">The web panel stays on. Switches are stored on this disk. They change guest listeners only when this panel runs as the drive.</p>
            <p class="err" id="profile-err" hidden></p>
            <p class="ok" id="profile-ok" hidden></p>
            <button type="submit">Save settings</button>
          </section>
        </form>
        <form id="account">
          <section>
            <h2>Sign-in</h2>
            <p class="meta">${esc(cfg.accountNote || '')}</p>
            <label>Web sign-in name <input name="username" type="text" maxlength="32" value="${esc(cfg.username || '')}" autocomplete="username"></label>
            <label>Current password <input name="currentPassword" type="password" autocomplete="current-password"></label>
            <label>New password <input name="newPassword" type="password" autocomplete="new-password"></label>
            <label>Confirm new password <input name="confirmPassword" type="password" autocomplete="new-password"></label>
            <p class="err" id="account-err" hidden></p>
            <p class="ok" id="account-ok" hidden></p>
            <button type="submit">Update sign-in</button>
          </section>
        </form>
      </div>
    </div>`;
  document.getElementById('profile').onsubmit = (ev) => saveProfile(ev);
  document.getElementById('account').onsubmit = (ev) => saveAccount(ev);
}

async function saveProfile(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const err = document.getElementById('profile-err');
  const ok = document.getElementById('profile-ok');
  err.hidden = true;
  ok.hidden = true;
  try {
    const saved = await post('/api/admin', {
      displayName: fd.get('displayName') || '',
      brandName: fd.get('brandName') || '',
      sessionHours: Number(fd.get('sessionHours') || 12),
      shareHours: Number(fd.get('shareHours') || 24),
      shareWrite: fd.get('shareWrite') === 'on',
      protocols: { ssh: fd.get('ssh') === 'on', ftps: fd.get('ftps') === 'on', webdav: fd.get('webdav') === 'on' },
    });
    me = { ...me, ...saved, user: saved.username };
    ok.textContent = saved.protocolNote || 'Settings saved on this disk.';
    ok.hidden = false;
    document.title = saved.brandName || 'BNDZ Drive';
    const title = document.querySelector('.titlebar strong');
    if (title) title.textContent = saved.brandName || 'BNDZ Drive';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
}

async function saveAccount(ev) {
  ev.preventDefault();
  const fd = new FormData(ev.target);
  const err = document.getElementById('account-err');
  const ok = document.getElementById('account-ok');
  err.hidden = true;
  ok.hidden = true;
  const body = {
    username: fd.get('username') || '',
    currentPassword: fd.get('currentPassword') || '',
    newPassword: fd.get('newPassword') || '',
    confirmPassword: fd.get('confirmPassword') || '',
  };
  if (!body.currentPassword) {
    err.textContent = 'Enter the current password to change the sign-in.';
    err.hidden = false;
    return;
  }
  try {
    const saved = await post('/api/admin', body);
    me = { ...me, ...saved, user: saved.username };
    ok.textContent = saved.passwordNote || 'Sign-in updated.';
    ok.hidden = false;
    ev.target.querySelector('[name="currentPassword"]').value = '';
    ev.target.querySelector('[name="newPassword"]').value = '';
    ev.target.querySelector('[name="confirmPassword"]').value = '';
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
}

boot();
