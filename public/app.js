const flash = (text, bad) => { const f = document.getElementById('flash'); if (!f) return; f.textContent = text; f.className = bad ? 'bad' : 'good'; };
async function call(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `That did not work (${res.status})`);
  return data;
}
const pick = (o, path) => path.split('.').reduce((a, k) => a?.[k], o);
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-api]'); if (!form) return;
  e.preventDefault();
  const [method, url] = form.dataset.api.split(' ');
  const body = Object.fromEntries(new FormData(form));
  for (const k of (form.dataset.numbers || '').split(',').filter(Boolean)) body[k] = Number(body[k]);
  for (const k of Object.keys(body)) if (body[k] === '' && k === 'invite') delete body[k];
  try {
    const data = await call(method, url, body);
    if (form.dataset.show) { flash(`${location.origin}${pick(data, form.dataset.show)}`); return; }
    flash('Saved');
    if (form.dataset.then) setTimeout(() => { location.href = form.dataset.then; }, 600);
  } catch (err) { flash(err.message, true); }
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('button[data-post]'); if (!b) return;
  try {
    await call(b.dataset.method || 'POST', b.dataset.post, b.dataset.body ? JSON.parse(b.dataset.body) : {});
    flash('Done');
    if (b.dataset.then) setTimeout(() => { location.href = b.dataset.then; }, 600);
  } catch (err) { flash(err.message, true); }
});
document.addEventListener('submit', async (e) => {
  const form = e.target.closest('form[data-upload]'); if (!form) return;
  e.preventDefault();
  try {
    const res = await fetch(form.dataset.upload, { method: 'POST', body: new FormData(form), credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `That did not work (${res.status})`);
    flash(data.message || 'Attached');
    if (form.dataset.then) setTimeout(() => { location.href = form.dataset.then; }, 600);
  } catch (err) { flash(err.message, true); }
});
const r = document.querySelector('[data-refresh]'); if (r && r.dataset.refresh) setTimeout(() => location.reload(), Number(r.dataset.refresh));
// Live lists while a page is open, every 5 seconds: the activity feed gets the newest group as it comes in; "Running now" is read again.
const entry = (text) => { const li = document.createElement('li'); li.textContent = text; return li; };
const group = (g) => { const li = document.createElement('li'); const b = document.createElement('b'); b.textContent = g.title; const ul = document.createElement('ul'); ul.append(...g.items.map(entry)); li.append(b, ul); return li; };
const every5s = (url, then) => setInterval(() => fetch(url, { credentials: 'same-origin' }).then((x) => (x.ok ? x.json() : null)).then((d) => d && then(d)).catch(() => {}), 5000);
const feed = document.querySelector('[data-feed]'); if (feed) every5s(feed.dataset.feed, (d) => { if (d.latest) feed.append(group(d.latest)); });
const running = document.querySelector('[data-running]'); if (running) every5s(running.dataset.running, (d) => running.replaceChildren(...(d.running.length ? d.running : ['Nothing is running.']).map(entry)));
// Live panels, read again every 5 seconds; a section the person opened stays open.
for (const panel of document.querySelectorAll('[data-panel]')) every5s(panel.dataset.panel, (d) => {
  const open = [...panel.querySelectorAll('details[open][id]')].map((x) => x.id);
  panel.innerHTML = d.html;
  for (const id of open) document.getElementById(id)?.setAttribute('open', '');
});
