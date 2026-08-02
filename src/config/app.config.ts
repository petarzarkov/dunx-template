/**
 * Types the config tree is built from, and nothing that restates its shape.
 *
 * `AppConfig` itself is derived from `validateConfig` in `env.validation.ts`. It
 * used to be a hand-written 110-line interface listing every field the function
 * already returns, which is two descriptions of one thing and the annotation was
 * what forced them apart.
 */
export interface OAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}
