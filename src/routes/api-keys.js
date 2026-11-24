import express from 'express';
import { q, now } from '../db.js';
import { requireTeam } from '../auth.js';
import { createKey, publicKey } from '../api-keys.js';

/** A signed-in person's own API keys (Settings, API keys). Each key acts as its maker, on their team, with their role. */
export const apiKeysApi = express.Router();
apiKeysApi.use(requireTeam);

apiKeysApi.param('id', (_req, res, next, id) => (/^\d{1,9}$/.test(id) ? next() : res.status(404).json({ error: 'Not found' })));

apiKeysApi.get('/', async (req, res) => {
  const keys = await q('SELECT * FROM api_keys WHERE user_id = $1 AND team_id = $2 AND revoked_at IS NULL ORDER BY id', [req.user.id, req.team.id]);
  res.json({ keys: keys.map(publicKey) });
});

apiKeysApi.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 80) || 'API key';
  const key = await createKey(req.user, req.team, name);
  res.status(201).json({ ok: true, message: 'Copy your key now: it is shown only once', key });
});

apiKeysApi.delete('/:id', async (req, res) => {
  const gone = await q('UPDATE api_keys SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id', [req.params.id, req.user.id, now()]);
  if (!gone.length) return res.status(404).json({ error: 'No such key' });
  res.json({ ok: true });
});
