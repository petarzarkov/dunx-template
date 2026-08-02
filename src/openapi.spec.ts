import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { testRoot } from '@dunx/testing';
import { appModule } from './app.module.js';
import { validateConfig } from './config/env.validation.js';
import { httpOptions } from './http.options.js';

interface OpenApiDoc {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, Record<string, unknown>>>;
  components: { schemas: Record<string, unknown> };
}

/**
 * `createTestServer` cannot be used here: it owns `HttpFactory.create` and never
 * exposes the app before `listen()`, so there is no window in which to call
 * `setGlobalPrefix`. `testRoot()` is the documented escape hatch.
 */
const source = { API_PORT: '0', SQLITE_DB_PATH: ':memory:' };
let app: HttpApp;
let doc: OpenApiDoc;

beforeAll(async () => {
  app = await HttpFactory.create(
    OpenApiModule.forRoot({
      title: 'dunx-template',
      version: '0.1.0',
      root: testRoot([appModule({ source, logLevel: 'fatal' })]),
    }),
    { ...httpOptions(validateConfig(source)), requestLogging: false },
  );
  app.setGlobalPrefix('api');
  await app.listen(0);
  doc = JSON.parse(app.get(OpenApiExplorer).json('api')) as OpenApiDoc;
});

afterAll(async () => {
  await app.shutdown();
});

describe('the generated OpenAPI document', () => {
  test('no schema degraded to a permissive one', () => {
    expect(app.get(OpenApiExplorer).warnings).toEqual([]);
  });

  test('is 3.1 and carries the app metadata', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('dunx-template');
  });

  test('every route is documented under the global prefix', () => {
    const paths = Object.keys(doc.paths).sort();
    expect(paths).toContain('/api/users');
    expect(paths).toContain('/api/users/{userId}');
    expect(paths).toContain('/api/users/{userId}/ban');
    expect(paths).toContain('/api/audit-logs');
    expect(paths).toContain('/api/service/health');
    for (const path of paths) expect(path).toStartWith('/api/');
  });

  test('named request-body schemas become components', () => {
    expect(Object.keys(doc.components.schemas).sort()).toEqual([
      'CreateUser',
      'UpdateUser',
      'ValidationError',
    ]);
  });

  /**
   * Locks in a real gap rather than pretending it is not there.
   *
   * `RouteSchemas` has `body`, `query`, `params` and `status` and no `response`,
   * and there is no `@ApiResponse` equivalent, so a success response is
   * documented as a bare description with no `content`. `SanitizedUser`,
   * `PaginatedUsers` and `AuditLogEntry` all carry `.meta({ id })` and none of
   * them reaches `components`, because nothing references them. The generated
   * document therefore cannot drive client codegen.
   */
  test('KNOWN GAP: no success response body is documented', () => {
    const ok = doc.paths['/api/users']?.['get']?.['responses'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(ok['200']).toEqual({ description: 'OK' });
    expect(ok['200']?.['content']).toBeUndefined();
    expect(Object.keys(doc.components.schemas)).not.toContain('SanitizedUser');
  });

  test('a validating route documents its 400', () => {
    const post = doc.paths['/api/users']?.['post'];
    expect(post).toBeDefined();
    const responses = post?.['responses'] as Record<string, unknown>;
    expect(responses['400']).toBeDefined();
  });

  test('@Roles becomes a security requirement, @Public clears it', () => {
    const listUsers = doc.paths['/api/users']?.['get'];
    expect(listUsers?.['security']).toEqual([{ bearer: [] }]);
    expect(listUsers?.['x-required-roles']).toEqual(['admin', 'user']);

    const health = doc.paths['/api/service/health']?.['get'];
    expect(health?.['security']).toEqual([]);
  });

  /**
   * `tags` is repeated on every method-level `@ApiDoc` on purpose. A
   * method-level `@ApiDoc` replaces the class-level object wholesale rather than
   * merging into it, so a class tag is silently dropped and the operation falls
   * back to the class-name default (`Users`, not `users`). Drop the repetition
   * and this assertion fails.
   */
  test('@ApiDoc supplies the summary and the tag', () => {
    const listUsers = doc.paths['/api/users']?.['get'];
    expect(listUsers?.['summary']).toBe('List users, keyset paginated');
    expect(listUsers?.['tags']).toEqual(['users']);
  });

  /**
   * Locks in a second gap. The top-level `tags` list is derived from the
   * controllers' class names and ignores `@ApiDoc({ tags })` completely, while
   * the operations carry the `@ApiDoc` values. The result is a document whose
   * operations reference tags it never declares, and whose declared tags nothing
   * uses, so a viewer's sidebar and its operation list disagree.
   */
  /**
   * This was a KNOWN GAP pinning a real defect: `doc.tags` was derived from
   * controller class names while operations carried their `@ApiDoc` tags, so the
   * document declared tags nothing used and used tags nothing declared. Fixed in
   * @dunx/openapi 0.2.5, which reads the tags back off the built operations. The
   * test now asserts the two agree, which is what it was always about.
   */
  test('every tag the operations use is declared, and no others', () => {
    const declared = new Set(
      (doc as unknown as { tags: { name: string }[] }).tags.map((t) => t.name),
    );

    const used = new Set<string>();
    for (const methods of Object.values(doc.paths)) {
      for (const op of Object.values(methods)) {
        for (const tag of (op['tags'] as string[] | undefined) ?? []) {
          used.add(tag);
        }
      }
    }

    expect([...used].sort()).toEqual([...declared].sort());
    expect(used.size).toBeGreaterThan(0);
  });

  test('query parameters are expanded one per property', () => {
    const params = doc.paths['/api/users']?.['get']?.['parameters'] as {
      name: string;
      in: string;
    }[];
    const names = params.map((p) => p.name);
    expect(names).toContain('take');
    expect(names).toContain('cursor');
    expect(names).toContain('search');
    expect(params.every((p) => p.in === 'query')).toBe(true);
  });

  test('the explorer renders a self-contained page', () => {
    const page = app.get(OpenApiExplorer).page('api');
    expect(page).toStartWith('<!doctype html>');
    // No external host: a strict CSP or an offline machine must still work.
    expect(page).not.toContain('https://cdn.');
  });
});
