import type { BunRequest } from 'bun';
import {
  type Middleware,
  type Next,
  type RouteContext,
  UNMATCHED,
} from '@dunx/http';
import { OpenApiExplorer } from '@dunx/openapi';
import { ScalarRenderer } from '@dunx/openapi/scalar';
import { AppConfigService } from '../../config/app.config.service.js';

/**
 * Scalar, beside Swagger.
 *
 * The NestJS template served both: `SwaggerModule.setup` at `/api/docs` and
 * `apiReference()` at `/api/public`. `OpenApiModule` takes one `renderer`, so
 * the second is a middleware over the same `OpenApiExplorer` document. A
 * renderer is just an object with `page()` and `asset()`, and nothing about it
 * needs the module.
 *
 * Both self-host. The page links one file and this serves it, so a strict CSP
 * or an offline machine still works, and the allow-list is the renderer's - a
 * path it does not recognise is a 404 rather than a read out of node_modules.
 */
export class ReferenceMiddleware implements Middleware {
  readonly #renderer = new ScalarRenderer({
    theme: 'deepSpace',
    darkMode: true,
  });
  readonly #mount: string;
  readonly #prefix: string;
  readonly #jsonHref: string;
  #page: Promise<string> | undefined;

  constructor(
    private readonly explorer: OpenApiExplorer,
    config: AppConfigService,
  ) {
    const { prefix } = config.get('app');
    const docs = config.get('docs');
    this.#prefix = `/${prefix}`;
    this.#mount = `/${prefix}/${docs.scalarPath}`;
    this.#jsonHref = `/${prefix}/${docs.jsonPath}`;
  }

  async handle(
    req: BunRequest,
    ctx: RouteContext,
    next: Next,
  ): Promise<Response> {
    if (ctx.get(UNMATCHED) !== true || req.method !== 'GET') return next();

    const { pathname } = new URL(req.url);
    if (pathname === this.#mount) {
      return new Response(await this.#html(), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (!pathname.startsWith(`${this.#mount}/`)) return next();

    return this.#renderer.asset(pathname.slice(this.#mount.length + 1));
  }

  async #html(): Promise<string> {
    const cached = this.#page;
    if (cached !== undefined) return cached;

    /**
     * The promise rather than the string, so two concurrent first requests
     * render once. Evicted on rejection, so a renderer whose peer is missing
     * does not leave the route answering the same failure for the life of the
     * process.
     */
    const rendering = this.#renderer.page(
      this.explorer.document(this.#prefix),
      {
        jsonHref: this.#jsonHref,
        warnings: this.explorer.warnings,
        mountedAt: this.#mount,
      },
    );
    this.#page = rendering;
    void rendering.catch(() => {
      if (this.#page === rendering) this.#page = undefined;
    });
    return rendering;
  }
}
