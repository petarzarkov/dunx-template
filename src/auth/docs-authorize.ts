import { Auth } from '@dunx/auth';
import { HttpStatusCode, type Authorize } from '@dunx/http';
import { AppEnv } from '../config/dto/service-vars.dto.js';
import { authBasePath } from './auth.options.js';

/**
 * Who may see the documentation, as one decision.
 *
 * This was `DocsSessionMiddleware`: a middleware ahead of `SessionGuard` that
 * restated `OpenApiModule`'s mount paths by hand, because the module had no way
 * to be told. dunx#140 closed in 3.8.3 and `authorize` is that way, so the path
 * list is gone and with it the thing most likely to rot - an app changing
 * `DOCS_PATH` no longer has a second place to remember.
 *
 * `Authorize` lives in `@dunx/http` rather than either consumer, so the same
 * function gates the explorer, the document, the explorer's own assets, and -
 * through `gate()` - the Scalar page this app mounts itself.
 *
 * There is no shared secret. Access is tied to real accounts, so it is revocable
 * and auditable, and any signed-in user qualifies: the document describes the
 * API, it does not administer it.
 */
export const docsAuthorize = (
  auth: Auth,
  env: AppEnv,
  prefix: string,
): Authorize | undefined => {
  // Open locally. A gate nobody can get through is the fastest way to make a
  // developer stop reading the docs.
  if (env === AppEnv.LOCAL) return undefined;

  return async (req) => {
    const session = await auth.api.getSession({ headers: req.headers });
    if (session !== null) return true;

    /**
     * A `Response` rather than `false`, which is what `AuthorizeDecision`
     * allows it to be for exactly this case: the caller is a browser with a
     * cookie and no way to send a bearer token, so the bare 404 an ops page
     * wants is a dead end here.
     */
    return loginForm(authBasePath(prefix));
  };
};

/**
 * The form signs in through better-auth's own endpoint and reloads.
 *
 * It used to POST to the docs path and have a middleware handle it, forward the
 * `Set-Cookie` and redirect. There is no middleware to handle it any more, and
 * there does not need to be: the endpoint already exists, already sets the
 * cookie, and a reload is all that is left.
 *
 * The path comes from `authBasePath` rather than being written here, and it is
 * **absolute**. A relative one resolves against `/api/docs` and posts to
 * `/api/api/auth/sign-in/email`, which fails silently in a page nothing tests
 * by hand.
 */
const loginForm = (authPath: string): Response =>
  new Response(
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
      .err { color: #ff7b72; margin: 0 0 12px; min-height: 18px; }
    </style>
  </head>
  <body>
    <form id="signin">
      <h1>These docs need a session</h1>
      <p class="err" id="error"></p>
      <input type="email" name="email" placeholder="Email" required autofocus />
      <input type="password" name="password" placeholder="Password" required />
      <button type="submit">Sign in</button>
    </form>
    <script type="module">
      document.getElementById('signin').onsubmit = async (event) => {
        event.preventDefault();
        const form = new FormData(event.target);
        const response = await fetch('${authPath}/sign-in/email', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: form.get('email'),
            password: form.get('password'),
          }),
        });
        if (response.ok) {
          location.reload();
          return;
        }
        const detail = await response.json().catch(() => ({}));
        document.getElementById('error').textContent =
          detail.message ?? 'Invalid credentials';
      };
    </script>
  </body>
</html>`,
    {
      status: HttpStatusCode.UNAUTHORIZED,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    },
  );
