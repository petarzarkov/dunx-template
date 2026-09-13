import { describe, expect, test } from 'bun:test';
import { AppEnv } from '../../config/dto/service-vars.dto.js';
import { windowFor } from './throttle.decorator.js';

/**
 * The resolution rule alone, with no server. It is three branches and every one
 * of them changes whether a caller is refused, which is more than enough reason
 * to pin them.
 */
describe('windowFor', () => {
  test('a plain number applies in every environment', () => {
    expect(windowFor(30, AppEnv.PROD, 60)).toBe(30);
    expect(windowFor(30, AppEnv.LOCAL, 60)).toBe(30);
  });

  test('a map picks the current environment', () => {
    const window = { local: 5, dev: 60, prod: 3600 };
    expect(windowFor(window, AppEnv.LOCAL, 999)).toBe(5);
    expect(windowFor(window, AppEnv.PROD, 999)).toBe(3600);
  });

  test('an environment the map omits falls back to the app-wide default', () => {
    expect(windowFor({ prod: 3600 }, AppEnv.STAGE, 60)).toBe(60);
  });

  /** `0` is the opt-out, and it has to beat the fallback rather than be replaced by it. */
  test('zero disables the limit for that environment only', () => {
    const window = { local: 0, prod: 3600 };
    expect(windowFor(window, AppEnv.LOCAL, 60)).toBeUndefined();
    expect(windowFor(window, AppEnv.PROD, 60)).toBe(3600);
  });
});
