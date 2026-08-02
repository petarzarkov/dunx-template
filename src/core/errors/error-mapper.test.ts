import { describe, expect, test } from 'bun:test';
import { HttpError, ValidationError } from '@dunx/http';
import { errorMapper, toErrorBody } from './error-mapper.js';

const req = new Request('http://localhost/api/users');

describe('errorMapper', () => {
  test('an HttpError becomes { error, message, status }', async () => {
    const response = errorMapper(new HttpError(404, 'No such user'), req);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'NOT_FOUND',
      message: 'No such user',
      status: 404,
    });
  });

  test('a ValidationError carries its issues through', async () => {
    const error = new ValidationError('body', [
      { message: 'Invalid email address', path: 'email' },
      { message: 'Required' },
    ]);
    const response = errorMapper(error, req);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'BAD_REQUEST',
      message: 'Invalid body',
      status: 400,
      issues: [
        { message: 'Invalid email address', path: 'email' },
        { message: 'Required' },
      ],
    });
  });

  test('an unrecognised error falls through and leaks nothing', async () => {
    const response = errorMapper(new Error('connection string: hunter2'), req);
    expect(response.status).toBe(500);
    const body = (await response.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(body['status']).toBe(500);
  });

  test('toErrorBody returns undefined for what it does not own', () => {
    expect(toErrorBody(new Error('boom'))).toBeUndefined();
    expect(toErrorBody('a string')).toBeUndefined();
  });
});
