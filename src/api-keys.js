import crypto from 'node:crypto';
import { one, q, now } from './db.js';

/** Every Tallybird API key starts with this, so a key pasted in the wrong place is easy to spot. */
export const KEY_PREFIX = 'tb_';
const hashKey = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

export const publicKey = (k) => ({ id: k.id, name: k.name, prefix: k.prefix, createdAt: k.created_at, lastUsedAt: k.last_used_at ?? null });

/** A new key for this person on this team. The secret is in the answer once; only its hash is kept. */
export async function createKey(user, team, name) {
  const secret = `${KEY_PREFIX}${crypto.randomBytes(20).toString('hex')}`;
  const key = await one(
    'INSERT INTO api_keys (user_id, team_id, name, prefix, key_hash, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
    [user.id, team.id, name, `${secret.slice(0, 9)}...`, hashKey(secret), now()],
  );
  return { ...publicKey(key), secret };
}

/**
 * Whom an Authorization header speaks for: { user, team, key }, or { status, error } to answer with.
 * The REST API (/api/v1) and the MCP server (/mcp) both ask this.
 */
export async function keyHolder(authorization) {
  if (!authorization) return { status: 401, error: `Missing API key: send Authorization: Bearer ${KEY_PREFIX}... with a key made on Settings, API keys` };
  const [scheme, secret] = String(authorization).trim().split(/\s+/);
  if (!/^bearer$/i.test(scheme) || !secret?.startsWith(KEY_PREFIX)) return { status: 401, error: 'Unauthorized' };
  const key = await one('SELECT * FROM api_keys WHERE key_hash = $1 AND revoked_at IS NULL', [hashKey(secret)]);
  if (!key) return { status: 401, error: 'That API key is not valid: it was revoked, or mistyped. Make a new one on Settings, API keys' };
  const user = await one('SELECT * FROM users WHERE id = $1', [key.user_id]);
  const team = await one('SELECT t.*, m.role FROM memberships m JOIN teams t ON t.id = m.team_id WHERE m.user_id = $1 AND m.team_id = $2', [key.user_id, key.team_id]);
  if (!user || !team) return { status: 401, error: 'The person who made this API key is no longer on the team. Make a new one on Settings, API keys' };
  if (team.suspended) return { status: 403, error: 'This team is suspended' };
  q('UPDATE api_keys SET last_used_at = $2 WHERE id = $1', [key.id, now()]).catch(() => {});
  return { user, team, key };
}

/** The API's own sign-in: the request's key, or its refusal. Sets req.user and req.team as a session does. */
export async function requireKey(req, res, next) {
  try {
    const who = await keyHolder(req.get('authorization'));
    if (who.error) return res.status(who.status).json({ error: who.error });
    req.user = who.user;
    req.team = who.team;
    req.apiKey = who.key;
    next();
  } catch (e) {
    next(e);
  }
}
