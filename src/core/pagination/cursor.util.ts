import { HttpError, HttpStatusCode } from '@dunx/http';

export interface Cursor {
  /** The sort column's value, ISO-8601 when it is a date. */
  readonly s: string;
  /** The tiebreaker id, so equal sort values still order deterministically. */
  readonly i: string;
}

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');

export const decodeCursor = (raw: string): Cursor => {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    );
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Cursor).s !== 'string' ||
      typeof (parsed as Cursor).i !== 'string'
    ) {
      throw new TypeError('malformed cursor payload');
    }
    return parsed as Cursor;
  } catch (cause) {
    throw new HttpError(
      HttpStatusCode.BAD_REQUEST,
      'Invalid pagination cursor',
      { cause },
    );
  }
};
