import type { TestServer } from '@dunx/testing';

/**
 * Sign in through better-auth's own endpoint and keep the token the `bearer()`
 * plugin hands back.
 *
 * A test client is not a browser, so there is no cookie jar. The `bearer` plugin
 * exists for exactly that: it puts the session token in a `set-auth-token`
 * response header, and `Authorization: Bearer <token>` is accepted everywhere the
 * cookie would be. The suites therefore authenticate the same way any non-browser
 * client does, rather than through a test-only door.
 */
export const signIn = async (
  server: TestServer,
  email: string,
  password: string,
): Promise<string> => {
  const response = await server.request('api/auth/sign-in/email', {
    method: 'POST',
    json: { email, password },
  });
  const token = response.headers.get('set-auth-token');
  if (token === null) {
    throw new Error(
      `sign-in failed for ${email}: ${response.status} ${await response.text()}`,
    );
  }
  return token;
};

export const bearer = (token: string): Record<string, string> => ({
  authorization: `Bearer ${token}`,
});

/** Creates a user through the public sign-up endpoint and signs it in. */
export const signUp = async (
  server: TestServer,
  email: string,
  password: string,
  name = 'Test User',
): Promise<{ token: string; userId: string }> => {
  const response = await server.request('api/auth/sign-up/email', {
    method: 'POST',
    json: { email, password, name },
  });
  if (!response.ok) {
    throw new Error(
      `sign-up failed for ${email}: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as { user: { id: string } };
  return { token: await signIn(server, email, password), userId: body.user.id };
};
