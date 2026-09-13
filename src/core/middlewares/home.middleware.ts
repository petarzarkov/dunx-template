import type { BunRequest } from 'bun';
import {
  type Middleware,
  type Next,
  type RouteContext,
  StaticOptions,
  UNMATCHED,
} from '@dunx/http';

/**
 * Serves `index.html` for `/`, which `StaticFiles` deliberately does not.
 *
 * The framework refuses to guess what a directory request means: an index
 * fallback and an SPA rewrite look identical from inside the middleware, and
 * getting it wrong turns every mistyped API path into a 200 with an HTML body.
 * So the rule lives here, where the app knows it owns exactly one page.
 *
 * Narrow on purpose. Only the bare root, only `GET`, and only when the caller
 * said it wanted HTML, so `curl /` still gets the JSON 404 that tells the truth.
 *
 * `ctx.get(UNMATCHED)` rather than a returned status, because a miss is thrown
 * rather than returned - by the time a `Response` exists, this is no longer in
 * the chain.
 */
export class HomeMiddleware implements Middleware {
  constructor(private readonly options: StaticOptions) {}

  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    if (ctx.get(UNMATCHED) !== true || req.method !== 'GET') return next();

    const { pathname } = new URL(req.url);
    const wantsHtml = (req.headers.get('accept') ?? '').includes('text/html');
    if (pathname !== '/' || !wantsHtml) return next();

    const index = Bun.file(`${this.options.root}/index.html`);
    if (!(await index.exists())) return next();

    return new Response(index, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        // The page is the app's entrypoint and carries no content hash, so a
        // cached copy would outlive a deploy.
        'cache-control': 'no-cache',
      },
    });
  }
}
