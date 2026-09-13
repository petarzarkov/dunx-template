import { Auth } from '@dunx/auth';
import {
  HttpStatusCode,
  type Middleware,
  type Next,
  type RouteContext,
} from '@dunx/http';
import type { BunRequest } from 'bun';
import { AppConfigService } from '../../config/app.config.service.js';
import { AppEnv } from '../../config/dto/service-vars.dto.js';

/**
 * Puts the documentation pages behind a real session everywhere but local.
 *
 * This is the NestJS template's `HtmlSessionAuthMiddleware`, which gated
 * Swagger, Scalar and Bull Board. Bull Board's half is now `DashboardModule`'s
 * own `authorize`; this is the rest, and it has to be a middleware because
 * `OpenApiModule` has no equivalent hook - tracked as
 * https://github.com/petarzarkov/dunx/issues/140.
 *
 * There is no shared secret. Access is tied to real accounts, so it is
 * revocable and auditable, and any signed-in user qualifies - the document
 * describes the API, it does not administer it.
 *
 * Unauthenticated `GET` gets a self-contained login form rather than a bare
 * 401, because the caller is a browser that has no way to send a bearer token.
 * Posting it signs in through better-auth, forwards the session cookie and
 * reloads.
 */
export class DocsSessionMiddleware implements Middleware {
  readonly #guarded: readonly string[];
  readonly #open: boolean;

  constructor(
    private readonly auth: Auth,
    config: AppConfigService,
  ) {
    const { prefix, env } = config.get('app');
    const docs = config.get('docs');
    this.#open = env === AppEnv.LOCAL;
    this.#guarded = [
      `/${prefix}/${docs.path}`,
      `/${prefix}/${docs.jsonPath}`,
      `/${prefix}/${docs.scalarPath}`,
    ];
  }

  async handle(
    req: BunRequest,
    _ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    if (this.#open) return next();

    const { pathname } = new URL(req.url);
    // `startsWith` rather than equality: both explorers serve their own assets
    // from under their mount, and a page whose script is a 401 is not gated,
    // it is broken.
    const gated = this.#guarded.some(
      (path) => pathname === path || pathname.startsWith(`${path}/`),
    );
    if (!gated) return next();

    const session = await this.auth.api.getSession({ headers: req.headers });
    if (session !== null) return next();

    if (req.method === 'POST') return this.#signIn(req, pathname);
    return this.#form(HttpStatusCode.UNAUTHORIZED);
  }

  async #signIn(req: BunRequest, pathname: string): Promise<Response> {
    const form = await req.formData();
    const email = form.get('email');
    const password = form.get('password');

    if (typeof email !== 'string' || typeof password !== 'string') {
      return this.#form(
        HttpStatusCode.UNAUTHORIZED,
        'Email and password required',
      );
    }

    const signed = await this.auth.api.signInEmail({
      body: { email, password },
      headers: req.headers,
      asResponse: true,
    });
    if (!signed.ok) {
      return this.#form(HttpStatusCode.UNAUTHORIZED, 'Invalid credentials');
    }

    // Better Auth's own Set-Cookie, forwarded so the reload below is
    // authenticated. `getSetCookie` keeps them separate, which a single
    // `get('set-cookie')` would have joined into one unparseable header.
    const headers = new Headers({ location: pathname });
    for (const cookie of signed.headers.getSetCookie()) {
      headers.append('set-cookie', cookie);
    }
    return new Response(null, { status: HttpStatusCode.FOUND, headers });
  }

  #form(status: number, error?: string): Response {
    const message =
      error === undefined
        ? ''
        : `<p class="err">${error.replace(/[<>&]/g, '')}</p>`;
    return new Response(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Restricted</title>
    <style>
      body { font: 14px/1.5 system-ui, sans-serif; background: #0f1115; color: #e6e9ef;
             display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 16px; }
      form { background: #171a21; border: 1px solid #262b36; border-radius: 10px;
             padding: 24px; width: 100%; max-width: 320px; }
      h1 { font-size: 16px; margin: 0 0 16px; }
      input { width: 100%; box-sizing: border-box; padding: 9px 11px; margin-bottom: 10px;
              border: 1px solid #262b36; border-radius: 8px; background: #0e1117;
              color: inherit; font: inherit; }
      button { width: 100%; padding: 9px; border: 0; border-radius: 8px;
               background: #6ea8fe; color: #0b1020; font: inherit; font-weight: 600;
               cursor: pointer; }
      .err { color: #ff7b72; margin: 0 0 12px; }
    </style>
  </head>
  <body>
    <form method="POST">
      <h1>These docs need a session</h1>
      ${message}
      <input type="email" name="email" placeholder="Email" required autofocus />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Sign in</button>
    </form>
  </body>
</html>`,
      { status, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}
