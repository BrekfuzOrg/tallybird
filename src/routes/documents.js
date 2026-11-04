import express from 'express';
import { one, q, now } from '../db.js';
import { requireTeam } from '../auth.js';

export const documentsApi = express.Router();
documentsApi.use(requireTeam);

documentsApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

const DAY_MS = 86_400_000;
/** Lists and reads stay fast by only looking at the working set. */
const workingSetSince = () => new Date(Date.now() - 30 * DAY_MS);

const publicDoc = (d, me) => ({
  id: d.id, title: d.title, body: d.body, authorId: d.author_id, mine: d.author_id === me,
  sharedWithTeam: d.shared_with_team, comments: d.comments, trashedAt: d.trashed_at, createdAt: d.created_at, updatedAt: d.updated_at,
});

async function readable(req, id) {
  const doc = await one('SELECT * FROM documents WHERE id = $1 AND team_id = $2 AND updated_at >= $3', [id, req.team.id, workingSetSince()]);
  if (!doc) return null;
  if (doc.author_id === req.user.id || doc.shared_with_team) return doc;
  return (await one('SELECT 1 FROM document_shares WHERE document_id = $1 AND user_id = $2', [id, req.user.id])) ? doc : null;
}

documentsApi.get('/', async (req, res) => {
  const docs = await q(
    `SELECT * FROM documents d WHERE d.team_id = $1 AND d.trashed_at IS NULL AND d.updated_at >= $3
       AND (d.author_id = $2 OR EXISTS (SELECT 1 FROM document_shares s WHERE s.document_id = d.id AND s.user_id = $2))
     ORDER BY d.updated_at DESC`,
    [req.team.id, req.user.id, workingSetSince()],
  );
  res.json({ documents: docs.map((d) => publicDoc(d, req.user.id)) });
});

documentsApi.post('/', async (req, res) => {
  const title = String(req.body?.title ?? '').trim();
  if (!title) return res.status(400).json({ error: 'A document needs a title' });
  const at = now();
  const doc = await one(
    'INSERT INTO documents (team_id, author_id, title, body, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$5) RETURNING *',
    [req.team.id, req.user.id, title, String(req.body?.body ?? ''), at],
  );
  res.status(201).json({ document: publicDoc(doc, req.user.id) });
});

documentsApi.get('/:id', async (req, res) => {
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  res.json({ document: publicDoc(doc, req.user.id) });
});

documentsApi.patch('/:id', async (req, res) => {
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  if (doc.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can edit this' });
  const saved = await one('UPDATE documents SET title = $2, body = $3, updated_at = $4 WHERE id = $1 RETURNING *',
    [doc.id, req.body?.title ?? doc.title, req.body?.body ?? doc.body, now()]);
  res.json({ document: publicDoc(saved, req.user.id) });
});

documentsApi.delete('/:id', async (req, res) => {
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  if (doc.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can delete this' });
  await q('UPDATE documents SET trashed_at = $2 WHERE id = $1', [doc.id, now()]);
  res.json({ ok: true });
});

documentsApi.post('/:id/share', async (req, res) => {
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  if (doc.author_id !== req.user.id) return res.status(403).json({ error: 'Only the author can share this' });
  if (req.body?.team) {
    await q('UPDATE documents SET shared_with_team = true, updated_at = $2 WHERE id = $1', [doc.id, now()]);
    return res.json({ ok: true, sharedWithTeam: true });
  }
  const person = await one(
    'SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE u.email = $1 AND m.team_id = $2',
    [String(req.body?.email ?? '').toLowerCase(), req.team.id],
  );
  if (!person) return res.status(400).json({ error: 'That person is not on your team' });
  await q('INSERT INTO document_shares (document_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [doc.id, person.id]);
  res.json({ ok: true, sharedWith: String(req.body.email).toLowerCase() });
});

documentsApi.post('/:id/comments', async (req, res) => {
  const text = String(req.body?.text ?? '').trim();
  if (!text) return res.status(400).json({ error: 'A comment needs some text' });
  const doc = await readable(req, req.params.id);
  if (!doc) return res.status(404).json({ error: 'No such document' });
  const mentioned = await q(
    `SELECT u.email FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.team_id = $1 AND position('@' || split_part(u.email, '@', 1) IN $2) > 0`,
    [req.team.id, text],
  );
  const comment = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, author: req.user.name, text, mentions: mentioned.map((m) => m.email), at: now() };
  await q('UPDATE documents SET comments = $2, updated_at = $3 WHERE id = $1', [doc.id, JSON.stringify([...doc.comments, comment]), now()]);
  res.status(201).json({ comment });
});
