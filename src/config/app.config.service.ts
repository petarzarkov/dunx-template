import { ConfigService } from '@dunx/core';
import type { AppConfig } from './env.validation.js';

/**
 * The subclass exists so `inject: [AppConfigService]` keeps the type. Without
 * it, `inject: [ConfigService]` resolves to `ConfigService<Record<string,
 * unknown>>` and a factory annotating `ConfigService<AppConfig>` is rejected,
 * because parameters are contravariant and the token carries no type argument.
 */
export class AppConfigService extends ConfigService<AppConfig> {}
