// Transport layer. There is no auth here on purpose: the reverse proxy in front
// injects the Authorization header for requests that arrive without one, so the
// browser never holds a credential. See the README.

const API = "/index.php/apps/notes/api/v1/notes";
const WEB = "/web/v1";

// One id per tab. The server echoes it on the SSE event caused by a write, so a
// client can ignore the echo of its own change and avoid re-rendering the grid
// out from under someone who is typing.
export const CLIENT_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);

// Quillpad resolves sync conflicts purely by last-modified-wins (epoch
// *seconds*, ±1s tolerance), so every write has to carry a fresh timestamp or
// the phone silently wins every time.
export const nowSeconds = () => Math.floor(Date.now() / 1000);

async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-Client-Id": CLIENT_ID },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const listNotes = () => request("GET", API + "/");

export const createNote = (fields) =>
  request("POST", API + "/", { ...fields, modified: nowSeconds() });

// Only the changed fields are sent. The server applies a patch rather than
// replacing the row, so this cannot clobber a field somebody else just changed.
export const updateNote = (id, fields) =>
  request("PUT", `${API}/${id}`, { id, ...fields, modified: nowSeconds() });

export const deleteNote = (id) => request("DELETE", `${API}/${id}`);

export const reorderNotes = (ids) => request("PUT", `${WEB}/order`, { ids });

// Live change stream. Every write goes through the same server handlers no
// matter which client made it, so a Quillpad sync from the phone shows up here
// too — that is what makes phone-to-web propagation immediate.
export function subscribeChanges({ onChange, onStatus }) {
  let source = null;
  let retry = 1000;
  let stopped = false;

  function connect() {
    source = new EventSource(WEB + "/events");

    source.onopen = () => {
      retry = 1000;
      onStatus("live");
    };

    source.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.origin && data.origin === CLIENT_ID) return; // our own echo
      onChange(data);
    };

    source.onerror = () => {
      onStatus("stale");
      source.close();
      if (stopped) return;
      // Reconnect on our own schedule rather than EventSource's, so a server
      // restart or a laptop waking from sleep backs off instead of hammering.
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  }

  connect();
  return () => {
    stopped = true;
    if (source) source.close();
  };
}
