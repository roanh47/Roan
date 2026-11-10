/**
 * Android share-sheet intake.
 *
 * Normalises whatever `ACTION_SEND` / `ACTION_SEND_MULTIPLE` hands us into a
 * single `IntakeRecord` that the rest of the pipeline can queue, title and
 * dedupe. Pure and synchronous: no I/O, no clock reads (`now` is injected),
 * so it is safe to call from the share intent handler on either platform.
 */

import { createHash } from 'node:crypto';

export interface SharePayload {
  text?: string;
  url?: string;
  file?: { name: string; mimeType: string; size: number };
}

export interface IntakeRecord {
  kind: 'text' | 'url' | 'file';
  title: string;
  body: string;
  dedupeKey: string;
  source: 'share-sheet';
}

const TITLE_MAX = 60;
const ELLIPSIS = '\u2026';
const DEDUPE_KEY_LENGTH = 16;
const DEFAULT_MIME = 'application/octet-stream';
const DEFAULT_FILE_NAME = 'untitled';

function isBlank(value: string | undefined): boolean {
  return value === undefined || value.trim().length === 0;
}

/** First non-empty line of `body`, capped at {@link TITLE_MAX} chars. */
function titleFrom(body: string): string {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      return trimmed.length > TITLE_MAX
        ? trimmed.slice(0, TITLE_MAX) + ELLIPSIS
        : trimmed;
    }
  }
  return body.slice(0, TITLE_MAX);
}

/** Trim the text and drop trailing spaces per line so cosmetic whitespace can't defeat dedupe. */
function normaliseText(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();
}

/** Never throws on an odd mime type: blanks fall back, everything else passes through. */
function normaliseMime(mimeType: string | undefined): string {
  if (typeof mimeType !== 'string') return DEFAULT_MIME;
  const trimmed = mimeType.trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_MIME;
}

function fileBody(file: { name: string; mimeType: string; size: number }): string {
  const name = file.name.trim().length > 0 ? file.name.trim() : DEFAULT_FILE_NAME;
  const mime = normaliseMime(file.mimeType);
  const size = Number.isFinite(file.size) && file.size > 0 ? Math.floor(file.size) : 0;
  return `${name} (${mime}, ${size} bytes)`;
}

function dedupeKeyFor(kind: IntakeRecord['kind'], body: string): string {
  return createHash('sha256').update(`${kind}\n${body}`, 'utf8').digest('hex').slice(0, DEDUPE_KEY_LENGTH);
}

/**
 * Turn a share-sheet payload into an intake record.
 *
 * Precedence: `url` wins, then `text`, then `file`. Throws when the payload
 * carries nothing usable; the message names exactly which fields were empty.
 */
export function intakeFromShare(payload: SharePayload, now: number): IntakeRecord {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error(`intakeFromShare: invalid "now" timestamp: ${String(now)}`);
  }

  const text = payload.text;
  const url = payload.url;
  const file = payload.file;

  const trimmedUrl = isBlank(url) ? '' : (url ?? '').trim();
  const trimmedText = isBlank(text) ? '' : (text ?? '').trim();

  if (trimmedUrl.length === 0 && trimmedText.length === 0 && file === undefined) {
    const empty: string[] = [];
    if (text === undefined) empty.push('text (absent)');
    else if (trimmedText.length === 0) empty.push('text (blank)');
    if (url === undefined) empty.push('url (absent)');
    else if (trimmedUrl.length === 0) empty.push('url (blank)');
    empty.push('file (absent)');
    throw new Error(`intakeFromShare: share payload has no content, ${empty.join(', ')}`);
  }

  let kind: IntakeRecord['kind'];
  let body: string;

  if (trimmedUrl.length > 0) {
    kind = 'url';
    body = trimmedUrl;
  } else if (trimmedText.length > 0) {
    kind = 'text';
    body = normaliseText(trimmedText);
  } else if (file !== undefined) {
    kind = 'file';
    body = fileBody(file);
  } else {
    throw new Error(
      `intakeFromShare: share payload has no usable content, kind was undetermined for body "${trimmedText}"`,
    );
  }

  return {
    kind,
    title: titleFrom(body),
    body,
    dedupeKey: dedupeKeyFor(kind, body),
    source: 'share-sheet',
  };
}
