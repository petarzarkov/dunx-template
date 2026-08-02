import { describe, expect, test } from 'bun:test';
import { getTestContext } from '../setup/context.js';

interface FileMetadata {
  id: string;
  key: string;
  size: number;
  width: number | null;
  height: number | null;
  mimeType: string;
}

/** A real 4x4 PNG, so `Bun.Image` in the server process has something to decode. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

const pngForm = (): FormData => {
  const bytes = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.set('file', new File([bytes], 'seed.png', { type: 'image/png' }));
  form.set('context', 'e2e');
  return form;
};

/**
 * Multipart against the real server, writing into the real `LocalStorage` root -
 * so this covers `Bun.write`, `Bun.file` and `Bun.Image` in the process that
 * `bun src/main.ts` started, not in the test's.
 */
describe('file upload against a live server', () => {
  test('an anonymous upload is refused', async () => {
    const { api } = getTestContext();
    const response = await api
      .as(undefined)
      .raw('files', { method: 'POST', body: pngForm() });
    expect(response.status).toBe(401);
  });

  test('upload, measure, download and delete', async () => {
    const { api, db } = getTestContext();
    const before = db.countRows('file');

    const uploaded = await api.json<FileMetadata>('files', {
      method: 'POST',
      body: pngForm(),
    });
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.width).toBe(4);
    expect(uploaded.body.height).toBe(4);
    expect(db.countRows('file')).toBe(before + 1);

    const download = await api.raw(`files/${uploaded.body.id}/download`);
    expect(download.status).toBe(200);
    const bytes = new Uint8Array(await download.arrayBuffer());
    expect(bytes.byteLength).toBe(uploaded.body.size);

    const deleted = await api.raw(`files/${uploaded.body.id}`, {
      method: 'DELETE',
    });
    expect(deleted.status).toBe(204);
    expect(db.countRows('file')).toBe(before);
  });

  test('a disallowed content type never reaches storage', async () => {
    const { api, db } = getTestContext();
    const before = db.countRows('file');

    const form = new FormData();
    form.set(
      'file',
      new File(['MZ'], 'thing.exe', { type: 'application/x-msdownload' }),
    );
    const { status } = await api.json('files', { method: 'POST', body: form });

    expect(status).toBe(415);
    expect(db.countRows('file')).toBe(before);
  });
});
