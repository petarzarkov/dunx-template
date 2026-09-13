import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Images } from '@dunx/infra/images';
import { createTestServer, type TestServer } from '@dunx/testing';
import { AppModule } from '../app.module.js';
import { validateConfig } from '../config/env.validation.js';
import { httpOptions } from '../http.options.js';
import { bearer, signIn, signUp } from '../test-support/session.js';
import type { FileMetadata } from './dto/file.dto.js';

/**
 * Uploads over the real `LocalStorage` backend, into a temp directory that is
 * removed afterwards. Nothing external is needed: `Bun.file`, `Bun.write`,
 * `Bun.Glob` and `Bun.Image` are the runtime.
 *
 * The same suite against S3 is one environment change (`STORAGE_DRIVER=s3`), which
 * is the whole point of injecting the abstract `Storage`.
 */
let server: TestServer;
let root: string;
let adminToken: string;

/** A real 4x4 PNG, so `Bun.Image` has something to decode. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

const png = (): File =>
  new File(
    [Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0))],
    'seed.png',
    {
      type: 'image/png',
    },
  );

const upload = async (file: File, token: string, context = 'uploads') => {
  const form = new FormData();
  form.set('file', file);
  form.set('context', context);
  return server.json<FileMetadata>('api/files', {
    method: 'POST',
    headers: bearer(token),
    body: form,
  });
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dunx-template-files-'));
  const source = {
    API_PORT: '0',
    SQLITE_DB_PATH: ':memory:',
    STORAGE_LOCAL_ROOT: root,
    THROTTLE_LIMIT: '10000',
    // A fresh namespace, so a rerun within the window does not inherit counters
    // from the last one - the counters are in a Redis that outlives the process.
    THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
    UPLOAD_MAX_BYTES: '4096',
    SEED_ADMIN_EMAIL: 'admin@local.dev',
    SEED_ADMIN_PASSWORD: 'admin-password',
  };

  server = await createTestServer({
    modules: [AppModule.forRoot({ source, logLevel: 'fatal' })],
    prefix: 'api',
    ...httpOptions(validateConfig(source)),
    requestLogging: false,
  });

  adminToken = await signIn(server, 'admin@local.dev', 'admin-password');
});

afterAll(async () => {
  await server.close();
  await rm(root, { recursive: true, force: true });
});

describe('multipart upload', () => {
  test('stores the bytes and measures the image', async () => {
    const { status, body } = await upload(png(), adminToken);

    expect(status).toBe(201);
    expect(body.mimeType).toBe('image/png');
    expect(body.size).toBeGreaterThan(0);
    // `Bun.Image` decoded it during the request, so the row carries dimensions.
    expect(body.width).toBe(4);
    expect(body.height).toBe(4);
    // The key is generated, never the client's filename.
    expect(body.key).not.toContain('seed.png');
    expect(body.key).toEndWith('.png');
  });

  test('a non-image is stored with no dimensions', async () => {
    const csv = new File(['a,b\n1,2\n'], 'data.csv', { type: 'text/csv' });
    const { status, body } = await upload(csv, adminToken);

    expect(status).toBe(201);
    expect(body.width).toBeNull();
    expect(body.height).toBeNull();
  });

  test('an oversized file is a 413', async () => {
    const big = new File([new Uint8Array(8192)], 'big.png', {
      type: 'image/png',
    });
    const { status } = await upload(big, adminToken);
    expect(status).toBe(413);
  });

  test('a disallowed content type is a 415', async () => {
    const exe = new File(['MZ'], 'thing.exe', {
      type: 'application/x-msdownload',
    });
    const { status } = await upload(exe, adminToken);
    expect(status).toBe(415);
  });

  test('a JSON body against a multipart route is a 400 from the schema', async () => {
    const { status } = await server.json('api/files', {
      method: 'POST',
      headers: bearer(adminToken),
      json: { file: 'not-a-file' },
    });
    expect(status).toBe(400);
  });

  test('an anonymous upload is a 401', async () => {
    const form = new FormData();
    form.set('file', png());
    const response = await server.request('api/files', {
      method: 'POST',
      body: form,
    });
    expect(response.status).toBe(401);
  });
});

describe('reading objects back', () => {
  test('download streams the exact bytes', async () => {
    const uploaded = await upload(png(), adminToken);
    const response = await server.request(
      `api/files/${uploaded.body.id}/download`,
      { headers: bearer(adminToken) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    const bytes = new Uint8Array(await response.arrayBuffer());
    expect(bytes.byteLength).toBe(uploaded.body.size);
    // The PNG signature survived the round trip through storage.
    expect([...bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  /**
   * `LocalStorage` cannot sign anything - signing is an S3 concept - and says so
   * rather than pretending. `@dunx/infra/files` raises `UnsupportedOperationError`
   * and the service maps it to 501.
   */
  test('presigning on the local backend is a 501', async () => {
    const uploaded = await upload(png(), adminToken);
    const { status } = await server.json(`api/files/${uploaded.body.id}/link`, {
      headers: bearer(adminToken),
    });
    expect(status).toBe(501);
  });

  test('a non-admin sees only its own files', async () => {
    const other = await signUp(
      server,
      'uploader@example.com',
      'a-password-123',
    );
    await upload(png(), other.token, 'private');

    const mine = await server.json<{ data: FileMetadata[] }>('api/files', {
      headers: bearer(other.token),
    });
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0]?.userId).toBe(other.userId);

    const all = await server.json<{ data: FileMetadata[] }>('api/files', {
      headers: bearer(adminToken),
    });
    expect(all.body.data.length).toBeGreaterThan(1);
  });

  test('delete removes the row and the object', async () => {
    const uploaded = await upload(png(), adminToken);

    const response = await server.request(`api/files/${uploaded.body.id}`, {
      method: 'DELETE',
      headers: bearer(adminToken),
    });
    expect(response.status).toBe(204);

    const gone = await server.json(`api/files/${uploaded.body.id}`, {
      headers: bearer(adminToken),
    });
    expect(gone.status).toBe(404);
  });
});

describe('@dunx/infra/images over Bun.Image', () => {
  test('renders a WebP thumbnail from the uploaded bytes', async () => {
    const images = server.app.get(Images);
    const bytes = new Uint8Array(await png().arrayBuffer());

    expect(images.detect(bytes)).toBe('png');

    const pipeline = await images.load(bytes);
    const encoded = await pipeline
      .resize(2, undefined, { fit: 'inside' })
      .to('webp', { quality: 70 })
      .encode();

    expect(encoded.format).toBe('webp');
    expect(encoded.mimeType).toBe('image/webp');
    expect(encoded.width).toBe(2);
    expect(encoded.bytes.byteLength).toBeGreaterThan(0);
  });

  test('arbitrary bytes are not an image and are not an exception', async () => {
    const images = server.app.get(Images);
    expect(images.supports(new TextEncoder().encode('not an image'))).toBe(
      false,
    );
  });
});
