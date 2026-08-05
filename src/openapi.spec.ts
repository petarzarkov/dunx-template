import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { HttpFactory, type HttpApp } from '@dunx/http';
import { OpenApiExplorer, OpenApiModule } from '@dunx/openapi';
import { testRoot } from '@dunx/testing';
import { AppModule } from './app.module.js';
import { authDocument } from './auth/auth.document.js';
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
const source = {
  API_PORT: '0',
  SQLITE_DB_PATH: ':memory:',
  THROTTLE_PREFIX: `test-${crypto.randomUUID()}`,
  THROTTLE_LIMIT: '10000',
};
const config = validateConfig(source);
let app: HttpApp;
let doc: OpenApiDoc;

beforeAll(async () => {
  app = await HttpFactory.create(
    OpenApiModule.forRoot({
      title: 'dunx-template',
      version: '0.1.0',
      root: testRoot([AppModule.forRoot({ source, logLevel: 'fatal' })]),
      contribute: [authDocument(config)],
    }),
    { ...httpOptions(config), requestLogging: false },
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
    // `CreateUser`, `UpdateUser` and `ValidationError` are this app's; `User`,
    // `Session`, `Account` and `Verification` came from Better Auth's own schema
    // through `contribute`, and the merge keeps both without a prefix.
    expect(Object.keys(doc.components.schemas).sort()).toEqual([
      'Account',
      'CreateUser',
      'Session',
      'UpdateUser',
      'User',
      'ValidationError',
      'Verification',
    ]);
  });

  test('the upload route documents a multipart body', () => {
    const post = doc.paths['/api/files']?.['post'];
    expect(post).toBeDefined();
    const body = post?.['requestBody'] as {
      content: Record<string, unknown>;
    };
    expect(Object.keys(body.content)).toContain('application/json');
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

  /**
   * Better Auth serves `<basePath>/*` from one handler, so route discovery sees a
   * single wildcard and the document would otherwise describe an API with no
   * authentication surface at all. `contribute: [betterAuthDocument(...)]` asks the
   * library for its own schema and merges it - which is the counterpart of the
   * NestJS template's `mergeBetterAuthSchema`, except a declared route wins a
   * collision rather than being overwritten.
   */
  test('Better Auth contributes its own endpoints', () => {
    const paths = Object.keys(doc.paths);
    expect(paths).toContain('/api/auth/sign-in/email');
    expect(paths).toContain('/api/auth/sign-up/email');
    expect(paths).toContain('/api/auth/get-session');
    // The plugins are in the document too: `admin()` and `bearer()` endpoints
    // only exist because they are in `baseAuthOptions`.
    expect(
      paths.filter((p) => p.startsWith('/api/auth/')).length,
    ).toBeGreaterThan(20);
  });

  test('every contributed operation carries the auth tag', () => {
    const operations = Object.entries(doc.paths)
      .filter(([path]) => path.startsWith('/api/auth/') && !path.endsWith('/*'))
      .flatMap(([, methods]) => Object.values(methods));

    expect(operations.length).toBeGreaterThan(0);
    for (const operation of operations) {
      expect(operation['tags']).toEqual(['auth']);
    }
  });

  /**
   * This was a KNOWN GAP and is now closed, so the test is inverted rather than
   * deleted - a regression here is invisible otherwise.
   *
   * `@dunx/auth` mounts Better Auth's handler as five one-line wildcard routes, and
   * route discovery used to document them like any other: a literal path
   * `/api/auth/*` carrying five operations tagged with the internal class name
   * `MountedAuthHandler`, because the class has no `@ApiDoc`. `*` is not an OpenAPI
   * path template, the operations described nothing, and they duplicated the surface
   * `betterAuthDocument` describes properly.
   */
  test('the mounted auth handler is no longer documented as a wildcard', () => {
    expect(doc.paths['/api/auth/*']).toBeUndefined();
    expect(Object.keys(doc.paths).filter((p) => p.includes('*'))).toEqual([]);
    // And nothing is tagged with the internal class name any more.
    const tags = Object.values(doc.paths)
      .flatMap((methods) => Object.values(methods))
      .flatMap(
        (operation) => (operation['tags'] as string[] | undefined) ?? [],
      );
    expect(tags).not.toContain('MountedAuthHandler');
  });

  /**
   * `page()` is async: the 456 KB explorer bundle lives behind `@dunx/openapi/ui`
   * and is reached with `await import()`, so importing `@dunx/openapi` does not pull
   * a React app in with it. It was synchronous before that split.
   */
  test('the explorer renders a self-contained page', async () => {
    const page = await app.get(OpenApiExplorer).page('api');
    expect(page).toStartWith('<!doctype html>');
    // No external host: a strict CSP or an offline machine must still work.
    expect(page).not.toContain('https://cdn.');
  });
});
