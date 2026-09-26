const $ = (id) => document.getElementById(id);
const api = (p) => `/api${p}`;
let socket = null;

const line = (html, cls = '') => {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  el.innerHTML = html;
  $('log').append(el);
  $('log').scrollTop = $('log').scrollHeight;
};

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c],
  );

const now = () => new Date().toLocaleTimeString();

const setState = (on, label) => {
  $('dot').classList.toggle('on', on);
  $('state').textContent = label;
};

/**
 * The envelope is `{"event":..,"data":..}`, which is the whole wire
 * protocol. `@OnMessage('chatMessage')` on the gateway receives `data`
 * decoded, and replies under the same event name.
 */
const connect = () => {
  const url = new URL('/ws', location.href);
  url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  socket = new WebSocket(url);

  socket.onopen = () => setState(true, 'connected');
  socket.onclose = (e) => {
    setState(false, `closed (${e.code})`);
    socket = null;
  };
  // An upgrade refused by `@OnUpgrade` never becomes a socket, so an
  // unauthenticated attempt arrives here rather than as a 401 body.
  socket.onerror = () => setState(false, 'refused');

  socket.onmessage = (ev) => {
    let frame;
    try {
      frame = JSON.parse(ev.data);
    } catch {
      return;
    }
    const { event, data } = frame;
    if (event === 'connected') {
      line(`connected as <span class="who">${esc(data.email)}</span>`, 'sys');
      $('rooms').innerHTML = data.rooms
        .map((r) => `<span class="tag">${esc(r)}</span>`)
        .join('');
      return;
    }
    if (event === 'message') {
      line(
        `<span class="who">${esc(data.from)}</span>: ${esc(data.text)}<span class="at">${now()}</span>`,
      );
      return;
    }
    if (event === 'notification') {
      line(`${esc(data.event)} ${esc(JSON.stringify(data.payload))}`, 'note');
      return;
    }
    if (event === 'chatMessage' && data && data.error) {
      line(esc(data.error), 'sys');
      return;
    }
    line(`${esc(event)} ${esc(JSON.stringify(data))}`, 'sys');
  };
};

const enter = () => {
  $('auth').hidden = true;
  $('chat').hidden = false;
  $('text').focus();
  connect();
};

const auth = async (path) => {
  $('authErr').textContent = '';
  const body = {
    email: $('email').value,
    password: $('password').value,
  };
  if (path.includes('sign-up')) body.name = body.email.split('@')[0];

  const res = await fetch(api(`/auth${path}`), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    $('authErr').textContent = detail.message ?? `failed (${res.status})`;
    return;
  }
  enter();
};

$('signin').onclick = () => auth('/sign-in/email');
$('signup').onclick = () => auth('/sign-up/email');

$('send').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (text === '' || socket === null) return;
  socket.send(JSON.stringify({ event: 'chatMessage', data: text }));
  $('text').value = '';
};

$('out').onclick = async () => {
  socket?.close();
  await fetch(api('/auth/sign-out'), { method: 'POST' });
  $('chat').hidden = true;
  $('auth').hidden = false;
  $('log').innerHTML = '';
  $('rooms').innerHTML = '';
  setState(false, 'offline');
};

// A live session means the upgrade will be accepted, so skip the form.
const me = await fetch(api('/profile'), {
  headers: { accept: 'application/json' },
});
if (me.ok) enter();
