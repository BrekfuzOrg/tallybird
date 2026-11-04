import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.existsSync('.env') ? fs.readFileSync('.env', 'utf8').split('\n') : []) {
  const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgres://tallybird:tallybird@127.0.0.1:5432/tallybird',
  max: 20,
});

export const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
export const one = async (sql, params = []) => (await q(sql, params))[0] ?? null;

/** Everything we store carries the application's own clock, so one timezone and one source of time. */
export const now = () => new Date();
