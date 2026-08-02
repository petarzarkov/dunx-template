import type { AppEnv, NodeEnv } from './dto/service-vars.dto.js';
import type { DbType } from './dto/db-vars.dto.js';
import type { AuthSessionStore } from './dto/auth-vars.dto.js';
import type { StorageDriver } from './dto/storage-vars.dto.js';
import type { LogLevel } from '@dunx/core';

export interface AppConfig {
  readonly isProd: boolean;
  readonly app: {
    readonly name: string;
    readonly version: string;
    readonly description: string;
    readonly env: AppEnv;
    readonly nodeEnv: NodeEnv;
    readonly port: number;
    readonly prefix: string;
    readonly timezone: string;
  };
  readonly log: {
    readonly level: LogLevel;
    readonly maskFields: readonly string[];
    readonly filterEvents: readonly string[];
    readonly requestBody: boolean;
    readonly responseBody: boolean;
  };
  readonly service: {
    readonly maxMemoryMb: number;
    readonly commitSha: string | undefined;
    readonly commitMessage: string | undefined;
  };
  readonly docs: {
    readonly path: string;
    readonly jsonPath: string;
  };
  readonly cors: {
    readonly origin: string;
    readonly trustProxy: boolean;
  };
  readonly db: {
    readonly type: DbType;
    readonly sqlitePath: string;
    readonly postgresUrl: string | undefined;
  };
  /**
   * `url` is `undefined` when there is no Redis, which every Redis-backed area
   * treats as "report degraded" rather than "fail". Nothing branches on it at
   * module-registration time - the connection is lazy, so the modules are always
   * imported.
   */
  readonly redis: {
    readonly url: string | undefined;
    readonly connectTimeoutMs: number;
    readonly cacheTtlSeconds: number;
  };
  readonly throttle: {
    readonly prefix: string;
    readonly limit: number;
    readonly windowSeconds: number;
  };
  readonly queue: {
    readonly prefix: string;
    readonly maxRetries: number;
    readonly retryDelayMs: number;
    readonly concurrency: number;
    readonly rateLimitMax: number;
    readonly rateLimitDurationMs: number;
    readonly jobTimeoutMs: number;
  };
  readonly ws: {
    readonly relayChannel: string;
  };
  readonly storage: {
    readonly driver: StorageDriver;
    readonly localRoot: string;
    readonly prefix: string;
    readonly bucket: string | undefined;
    readonly region: string | undefined;
    readonly endpoint: string | undefined;
    readonly accessKeyId: string | undefined;
    readonly secretAccessKey: string | undefined;
    readonly maxBytes: number;
    readonly allowedTypes: readonly string[];
  };
  readonly images: {
    readonly quality: number;
    readonly maxWidth: number;
    readonly thumbnailWidth: number;
  };
  readonly auth: {
    readonly secret: string;
    /** `true` when the published development constant is in use. */
    readonly usingDevSecret: boolean;
    readonly baseUrl: string;
    readonly sessionStore: AuthSessionStore;
    readonly trustedOrigins: readonly string[];
    readonly sessionExpiration: number;
    readonly sessionUpdateAge: number;
    readonly google: OAuthCredentials | undefined;
    readonly github: OAuthCredentials | undefined;
    readonly seedAdmin: {
      readonly email: string;
      readonly password: string;
    };
  };
}

export interface OAuthCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
}
