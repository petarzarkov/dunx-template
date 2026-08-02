import { describe, expect, test } from 'bun:test';
import { HttpError } from '@dunx/http';
import { decodeCursor, encodeCursor } from './cursor.util.js';

describe('cursor', () => {
  test('round-trips', () => {
    const cursor = { s: '2026-01-01T00:00:00.000Z', i: crypto.randomUUID() };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  test('is base64url, so it survives a query string unescaped', () => {
    const encoded = encodeCursor({ s: '2026-01-01T00:00:00.000Z', i: 'a/b+c' });
    expect(encoded).not.toContain('+');
    expect(encoded).not.toContain('/');
    expect(encoded).not.toContain('=');
  });

  test('a malformed cursor is a 400, not a 500', () => {
    expect(() => decodeCursor('garbage')).toThrow(HttpError);
    try {
      decodeCursor('garbage');
    } catch (error) {
      expect((error as HttpError).status).toBe(400);
      expect((error as HttpError).message).toBe('Invalid pagination cursor');
    }
  });

  test('valid base64 that is not a cursor is also a 400', () => {
    const notACursor = Buffer.from('{"nope":1}').toString('base64url');
    expect(() => decodeCursor(notACursor)).toThrow('Invalid pagination cursor');
  });
});
