const app = document.getElementById('app');
let cwd = '';

async function api(path, opts) {
  const res = await fetch(path, { credentials: 'same-origin', ...opts });
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    if (!res.ok) throw new Error('The panel could not finish that.');
    return res;
  }
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || 'The panel could not finish that.');
  return data;
}

function esc(text) {
  return String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function fmt(bytes) {
  if (!bytes) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i += 1; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

async function boot() {
  try {
    const me = await api('/api/me');
    paintDrive(me);
  } catch {
    paintLogin();
  }
}

function paintLogin(error) {
  app.innerHTML = `
    <p class="seal">BNDZ</p>
    <h1>Drive</h1>
    <p class="lead">Sign in as the drive user. The password is the one BNDZ keeps for this drive.</p>
    <form class="card" id="login">
      ${error ? `<p class="err">${esc(error)}</p>` : ''}
      <label>User <input name="user" value="bndz" autocomplete="username"></label>
      <label>Password <input name="password" type="password" autocomplete="current-password"></label>
      <button type="submit">Sign in</button>
    </form>`;
  app.querySelector('#login').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try {
      await api('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: fd.get('user'), password: fd.get('password') }),
      });
      const me = await api('/api/me');
      paintDrive(me);
    } catch (err) {
      paintLogin(err.message);
    }
  };
}

async function paintDrive(me) {
  const used = me.total ? Math.round((me.used / me.total) * 100) : 0;
  app.innerHTML = `
    <p class="seal">BNDZ</p>
    <h1>Drive</h1>
    <p class="lead">${esc(me.user)} · ${me.mounted ? used + '% of the disk' : 'disk not mounted'}</p>
    <div class="bar">
      <button type="button" id="up">Up</button>
      <button type="button" id="mkdir">New folder</button>
      <label class="meta">Upload <input id="file" type="file"></label>
      <button type="button" id="out">Sign out</button>
    </div>
    <p class="crumb" id="crumb"></p>
    <table><thead><tr><th>Name</th><th>Size</th><th></th></tr></thead><tbody id="rows"></tbody></table>
    <section class="shares">
      <h2>Share links</h2>
      <p class="lead">Timed links are served by this drive. Optional password. Revoke when you are done.</p>
      <form class="card" id="share">
        <label>Hours <input name="hours" type="number" min="1" max="720" value="24"></label>
        <label>Password, optional <input name="password" type="password" autocomplete="off"></label>
        <label class="meta"><input name="write" type="checkbox"> Allow upload</label>
        <button type="submit">Create link for this folder</button>
      </form>
      <div id="share-list"></div>
    </section>`;
  document.getElementById('up').onclick = () => { cwd = cwd.split('/').slice(0, -1).join('/'); load(); };
  document.getElementById('mkdir').onclick = async () => {
    const name = prompt('Folder name');
    if (!name) return;
    await api('/api/mkdir', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: cwd, name }) });
    load();
  };
  document.getElementById('file').onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const body = new FormData();
    body.append('dir', cwd);
    body.append('file', file);
    await api('/api/upload', { method: 'POST', body });
    ev.target.value = '';
    load();
  };
  document.getElementById('out').onclick = async () => { await api('/api/logout', { method: 'POST' }); paintLogin(); };
  document.getElementById('share').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    const created = await api('/api/shares', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: cwd,
        hours: Number(fd.get('hours') || 24),
        password: fd.get('password') || '',
        write: fd.get('write') === 'on',
      }),
    });
    ev.target.reset();
    await loadShares(created.share && created.share.id);
  };
  load();
  loadShares();
}

async function load() {
  const data = await api('/api/list?path=' + encodeURIComponent(cwd));
  cwd = data.path || '';
  document.getElementById('crumb').textContent = '/' + (cwd || '');
  const rows = document.getElementById('rows');
  rows.innerHTML = data.entries.map(item => {
    const path = (cwd ? cwd + '/' : '') + item.name;
    return `<tr>
      <td><a href="#" data-open="${esc(path)}" data-dir="${item.dir ? '1' : '0'}">${esc(item.name)}${item.dir ? '/' : ''}</a></td>
      <td class="meta">${item.dir ? 'Folder' : fmt(item.size)}</td>
      <td>
        <button type="button" data-ren="${esc(path)}">Rename</button>
        <button type="button" data-del="${esc(path)}">Delete</button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="meta">Empty folder.</td></tr>';
  rows.querySelectorAll('[data-open]').forEach(el => {
    el.onclick = (ev) => {
      ev.preventDefault();
      const path = el.getAttribute('data-open');
      if (el.getAttribute('data-dir') === '1') { cwd = path; load(); }
      else window.location.href = '/api/download?path=' + encodeURIComponent(path);
    };
  });
  rows.querySelectorAll('[data-ren]').forEach(el => {
    el.onclick = async () => {
      const from = el.getAttribute('data-ren');
      const name = prompt('New name', from.split('/').pop());
      if (!name) return;
      await api('/api/rename', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, name }) });
      load();
    };
  });
  rows.querySelectorAll('[data-del]').forEach(el => {
    el.onclick = async () => {
      const path = el.getAttribute('data-del');
      if (!confirm('Delete ' + path + '?')) return;
      await api('/api/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path }) });
      load();
    };
  });
}

async function loadShares(focus) {
  const data = await api('/api/shares');
  const host = document.getElementById('share-list');
  host.innerHTML = data.shares.map(share => {
    const when = new Date((share.expires || 0) * 1000).toLocaleString();
    const abs = new URL(share.url, window.location.origin).href;
    return `<article class="share-row">
      <div>
        <div>${esc(share.path || '/')} ${share.revoked ? '· revoked' : ''}</div>
        <div class="meta">${esc(abs)} · until ${esc(when)} · ${share.views} views${share.locked ? ' · password' : ''}</div>
      </div>
      <div class="bar">
        <button type="button" data-copy="${esc(abs)}">Copy</button>
        ${share.revoked ? '' : `<button type="button" data-revoke="${esc(share.id)}">Revoke</button>`}
        <img class="qr" alt="" src="/api/shares/${esc(share.id)}/qr.svg" width="72" height="72">
      </div>
    </article>`;
  }).join('') || '<p class="meta">No share links yet.</p>';
  host.querySelectorAll('[data-copy]').forEach(el => {
    el.onclick = () => navigator.clipboard.writeText(el.getAttribute('data-copy') || '');
  });
  host.querySelectorAll('[data-revoke]').forEach(el => {
    el.onclick = async () => {
      await api('/api/shares/revoke', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: el.getAttribute('data-revoke') }) });
      loadShares();
    };
  });
  if (focus) host.querySelector(`[data-revoke="${focus}"]`)?.scrollIntoView({ block: 'nearest' });
}

boot();
