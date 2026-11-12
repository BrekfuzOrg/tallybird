import { Client } from '@upstash/qstash';

/** The address QStash calls back: APP_URL in production, this server while developing. */
export const appUrl = () => (process.env.APP_URL || `http://localhost:${process.env.PORT ?? 3000}`).replace(/\/+$/, '');

let client = null;
const qstash = () => (process.env.QSTASH_TOKEN ? (client ??= new Client({ token: process.env.QSTASH_TOKEN })) : null);

/**
 * Queues a job for one of the routes under /api/queue. With QSTASH_TOKEN set, Upstash QStash delivers it, signed, and retries
 * it until the route answers 2xx. Without QStash (local development) the job is posted straight to its route.
 */
export async function enqueue(path, body) {
  const url = `${appUrl()}${path}`;
  const q = qstash();
  if (q) return (await q.publishJSON({ url, body, retries: 3 })).messageId;
  fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    .catch((e) => console.error('queue', path, e.message));
  return null;
}
