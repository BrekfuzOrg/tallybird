/**
 * One-line AI summaries (OpenAI), shown at the top of a document and above the Documents list.
 * Off unless OPENAI_API_KEY is set. A summary is kept until the document changes.
 */
const MODEL = 'gpt-4o-mini';
const OPENAI = 'https://api.openai.com/v1/chat/completions';

/** Summary calls start 160 ms apart (about 375 a minute): well inside our OpenAI tier's 500 requests a minute. */
const GAP_MS = 160;
/** A summary call has 5 s, counted from when it was asked for. */
const CALL_MS = 5_000;
/** A reader waits at most this long for a summary; after that the document shows without one. */
const READER_MS = 10_000;
/** How many calls a summary gets (SUMMARY_RETRY_LIMIT; unset: as many as it takes), and the wait before the next one. */
const retryLimit = () => Number(process.env.SUMMARY_RETRY_LIMIT) || Infinity;
const retryDelayMs = (tries) => (Number.isFinite(retryLimit()) ? Math.min(8_000, 500 * 2 ** (tries - 1)) + Math.random() * 250 : 0);

const cache = new Map(); // `${id}@${updatedAt}` -> summary
const CACHE_MAX = 10_000;
const pending = new Map(); // same key -> { key, doc, askedAt, tries, waiters }
const queue = [];
let timer = null;
let lastCall = 0;

const keyOf = (doc) => `${doc.id}@${new Date(doc.updated_at).getTime()}`;
const on = () => Boolean(process.env.OPENAI_API_KEY);

function within(promise, ms) {
  if (ms <= 0) {
    promise.catch(() => {}); // no time left: whatever it answers is not waited for
    return Promise.reject(new Error('summary timed out'));
  }
  let t;
  return Promise.race([promise, new Promise((_, reject) => { t = setTimeout(() => reject(new Error('summary timed out')), ms); })])
    .finally(() => clearTimeout(t));
}

async function askOpenAI(system, text) {
  const res = await fetch(OPENAI, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 40, messages: [{ role: 'system', content: system }, { role: 'user', content: text }] }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`OpenAI answered ${res.status}`);
  const body = await res.json();
  return String(body?.choices?.[0]?.message?.content ?? '').trim() || null;
}

const summarize = (doc) => askOpenAI('Summarize this document in one short sentence for a teammate skimming it.', `${doc.title}\n\n${String(doc.body ?? '').slice(0, 4000)}`);

function enqueue(job) {
  queue.push(job);
  pump();
}

function pump() {
  if (timer || !queue.length) return;
  timer = setTimeout(() => {
    timer = null;
    lastCall = Date.now();
    attempt(queue.shift());
    pump();
  }, Math.max(0, lastCall + GAP_MS - Date.now()));
}

async function attempt(job) {
  job.tries += 1;
  try {
    const text = await within(summarize(job.doc), job.askedAt + CALL_MS - Date.now());
    cache.set(job.key, text);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
    pending.delete(job.key);
    for (const w of job.waiters.splice(0)) w(text);
  } catch {
    if (job.tries >= retryLimit()) {
      pending.delete(job.key);
      for (const w of job.waiters.splice(0)) w(null);
      return;
    }
    // Ask again, so the summary is there for the next reader.
    const again = () => { job.askedAt = Date.now(); enqueue(job); };
    const delay = retryDelayMs(job.tries);
    if (delay) setTimeout(again, delay);
    else again();
  }
}

/** The document's summary, or null when there is none yet (no key, or OpenAI did not answer in time). */
export async function documentSummary(doc) {
  if (!on()) return null;
  const key = keyOf(doc);
  if (cache.has(key)) return cache.get(key);
  let job = pending.get(key);
  if (!job) {
    job = { key, doc, askedAt: Date.now(), tries: 0, waiters: [] };
    pending.set(key, job);
    enqueue(job);
  }
  return new Promise((resolve) => {
    const t = setTimeout(() => { job.waiters = job.waiters.filter((w) => w !== done); resolve(null); }, READER_MS);
    const done = (text) => { clearTimeout(t); resolve(text); };
    job.waiters.push(done);
  });
}

/* ------------------------------------------------------------------- the Documents list's "what's new" line */

const NEWS_MS = 30_000;
const news = new Map(); // user id -> { at, text }

/** One line on what changed lately in this person's documents, refreshed at most every 30 s; null when OpenAI does not answer within 2 s. */
export async function whatsNew(userId, docs) {
  if (!on() || !docs.length) return null;
  const kept = news.get(userId);
  if (kept && Date.now() - kept.at < NEWS_MS) return kept.text;
  try {
    const titles = docs.slice(0, 5).map((d) => `- ${d.title}`).join('\n');
    const text = await within(askOpenAI('In one short sentence, say what is new in these recently changed documents.', titles), 2_000);
    news.set(userId, { at: Date.now(), text });
    if (news.size > CACHE_MAX) news.delete(news.keys().next().value);
    return text;
  } catch {
    return null;
  }
}
