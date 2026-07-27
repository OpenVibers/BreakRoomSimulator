// Auth (REST) + realtime websocket connection.
export const net = {
  ws: null,
  handlers: {},
  connected: false,
  on(type, fn) { (net.handlers[type] ||= []).push(fn); },
  send(msg) { if (net.connected) net.ws.send(JSON.stringify(msg)); },
};

export async function api(path, body) {
  const r = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return r.json();
}

export function connect(token, { onOpen, onClose }) {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws?token=${token}`);
  net.ws = ws;
  ws.onopen = () => { net.connected = true; onOpen?.(); };
  ws.onclose = (e) => { net.connected = false; onClose?.(e); };
  ws.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    for (const fn of net.handlers[m.t] || []) fn(m);
  };
}
