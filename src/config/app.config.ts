import type { AppEnv, NodeEnv } from './dto/service-vars.dto.js';
import type { DbType } from './dto/db-vars.dto.js';
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
}
