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
