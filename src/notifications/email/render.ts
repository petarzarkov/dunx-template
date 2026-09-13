import { ReactEmailRenderer } from '@dunx/infra/email/react';

/**
 * The one renderer, shared by the app and the preview server.
 *
 * `bun run mail:preview` loads this module through
 * `dunx-email --renderer ./src/notifications/email/render.ts`, and
 * `NotificationsModule` hands the same instance to `EmailModule` - so what the
 * preview shows cannot drift from what arrives in an inbox. Pointing the flag at
 * a module of your own is how an app rendering MJML never installs
 * `@react-email/components`.
 */
export default new ReactEmailRenderer();
