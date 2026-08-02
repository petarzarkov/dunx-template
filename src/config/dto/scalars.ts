import { z } from 'zod';

/**
 * A comma-separated environment variable as a string array, falling back to
 * `fallback` when the variable is absent or blank. Shared by every group, so the
 * same `A,B , C` input parses identically wherever it appears.
 */
export const csv = (fallback: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((value) =>
      value === undefined || value.trim() === ''
        ? [...fallback]
        : value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0),
    );

/**
 * An optional string where the empty string means absent. Docker `ARG` with no
 * value becomes `''` rather than an unset variable, and so does an env file line
 * with nothing after the `=`.
 */
export const blank = z
  .string()
  .optional()
  .transform((value) =>
    value === undefined || value === '' ? undefined : value,
  );
