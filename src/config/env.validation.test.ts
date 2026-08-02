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
    expect(validateConfig({ ...base, APP_ENV: 'prod' }).isProd).toBe(true);
    expect(validateConfig({ ...base, APP_ENV: 'stage' }).isProd).toBe(false);
  });

  test('an unknown timezone is rejected by name', () => {
    expect(() => validateConfig({ ...base, TZ: 'Mars/Olympus' })).toThrow(
      /Invalid IANA timezone/,
    );
  });
});
