import { isUtf8 } from 'node:buffer';
import multer from 'multer';
import { parse } from 'csv-parse/sync';

/** An invoice takes a CSV of line items or a PDF receipt, up to 5 MB a file (README, Attachments). */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 }, defParamCharset: 'utf8' }).single('file');
/** Reads the one file of a multipart form into req.file. */
export const receiveFile = (req, res) => new Promise((ok, fail) => upload(req, res, (e) => (e ? fail(e) : ok())));

export function kindOf(file) {
  if (/\.csv$/i.test(file.originalname) || file.mimetype === 'text/csv') return 'csv';
  if (/\.pdf$/i.test(file.originalname) || file.mimetype === 'application/pdf') return 'pdf';
  return null;
}

export const looksLikePdf = (buf) => buf.subarray(0, 5).toString('latin1') === '%PDF-';

export class BadFile extends Error {}

/** A spreadsheet's CSV: a header row naming description, quantity and amount, then a line item a row. Blank rows are skipped. */
export function readLineItems(buf) {
  // Older spreadsheets save Windows-1252 rather than UTF-8.
  const text = isUtf8(buf) ? buf.toString('utf8') : buf.toString('latin1');
  let rows;
  try {
    rows = parse(text, { columns: (header) => header.map((h) => h.toLowerCase()), skip_empty_lines: true, relax_column_count: true });
  } catch (e) {
    throw new BadFile(`That CSV could not be read${e.lines ? ` (line ${e.lines})` : ''}`);
  }
  const items = [];
  for (const [n, row] of rows.entries()) {
    const description = row.description?.trim();
    if (!description) continue;
    const amount = Number(String(row.amount ?? '').replace(/[$,\s]/g, ''));
    if (!Number.isFinite(amount)) throw new BadFile(`Row ${n + 2}: the amount "${row.amount}" is not a number`);
    const quantity = Number(String(row.quantity ?? '').trim()) || 1;
    items.push({ description, quantity, amountCents: Math.round(amount * 100) });
  }
  return items;
}
