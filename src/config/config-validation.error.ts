import { AppError } from '@dunx/core';

/**
 * Boot fails with whatever `validate` throws, so this is the whole "config is
 * wrong" story. NestJS needed a custom exception plus a ConfigModule hook; here
 * the thrown value is the failure.
 */
export class ConfigValidationError extends AppError {
  override name = 'ConfigValidationError';
}
