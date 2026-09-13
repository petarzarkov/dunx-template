import { describe, expect, test } from 'bun:test';
import { ConfigValidationError } from './config-validation.error.js';
import { validateConfig } from './env.validation.js';

const base = { API_PORT: '3001' };

describe('validateConfig', () => {
  test('shapes the flat environment into the nested config tree', () => {
    const config = validateConfig({ ...base, LOG_LEVEL: 'warn' });

    expect(config.app.port).toBe(3001);
    expect(config.app.prefix).toBe('api');
    expect(config.log.level).toBe('warn');
    expect(config.db.type).toBe('sqlite');
    expect(config.db.sqlitePath).toBe('./data/app.db');
    expect(config.isProd).toBe(false);
  });

  test('API_PORT has no default, so an empty environment fails', () => {
    expect(() => validateConfig({})).toThrow(ConfigValidationError);
    expect(() => validateConfig({})).toThrow(/API_PORT/);
  });

  test('the message names every offending path', () => {
    try {
      validateConfig({ API_PORT: '70000', LOG_LEVEL: 'shouty' });
      throw new Error('expected a throw');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const { message } = error as Error;
      expect(message).toStartWith('Configuration validation error:');
      expect(message).toContain(' - API_PORT: ');
      expect(message).toContain(' - LOG_LEVEL: ');
    }
  });

  test('CSV vars split, and fall back to their defaults when blank', () => {
    expect(
      validateConfig({ ...base, LOG_MASK_FIELDS: 'a, b ,c' }).log.maskFields,
    ).toEqual(['a', 'b', 'c']);
    expect(
      validateConfig({ ...base, LOG_MASK_FIELDS: '' }).log.maskFields,
    ).toContain('password');
  });

  test('the cross-field rule fires: postgres needs a URL', () => {
    expect(() => validateConfig({ ...base, DB_TYPE: 'postgres' })).toThrow(
      /POSTGRES_URL is required when DB_TYPE=postgres/,
    );
  });

  test('APP_ENV=prod is the only thing that sets isProd', () => {
    const secret = 'x'.repeat(40);
    expect(
      validateConfig({ ...base, APP_ENV: 'prod', BETTER_AUTH_SECRET: secret })
        .isProd,
    ).toBe(true);
    expect(validateConfig({ ...base, APP_ENV: 'stage' }).isProd).toBe(false);
  });

  test('production refuses the development auth secret', () => {
    expect(() => validateConfig({ ...base, APP_ENV: 'prod' })).toThrow(
      /BETTER_AUTH_SECRET is required when APP_ENV=prod/,
    );
    // Everywhere else it falls back, so a clean checkout boots with no env file.
    expect(validateConfig(base).auth.usingDevSecret).toBe(true);
  });

  test('redis-backed sessions must name a redis', () => {
    expect(() =>
      validateConfig({ ...base, AUTH_SESSION_STORE: 'redis' }),
    ).toThrow(/REDIS_URL is required when AUTH_SESSION_STORE=redis/);
  });

  test('the s3 driver must name a bucket', () => {
    expect(() => validateConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(
      /S3_BUCKET is required when STORAGE_DRIVER=s3/,
    );
  });

  test('an unknown timezone is rejected by name', () => {
    expect(() => validateConfig({ ...base, TZ: 'Mars/Olympus' })).toThrow(
      /Invalid IANA timezone/,
    );
  });
});
