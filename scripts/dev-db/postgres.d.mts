// Tipos de postgres.mjs (usado pelo globalSetup do Vitest da API, que é TypeScript).

export declare const ROOT: string;
export declare const DATA_DIR: string;
export declare const DEFAULT_DATABASE_URL: string;

export interface DevDatabase {
  kind: 'started' | 'adopted' | 'shared' | 'external';
  owned: boolean;
  url: string;
  stop(): Promise<void>;
}

export declare function ensureEnvFile(): boolean;

export declare function readDevEnv(): Promise<{
  databaseUrl: string;
  testDatabaseUrl: string | undefined;
}>;

export declare function startDevDatabase(options: {
  databaseUrl: string;
  extraUrls?: (string | undefined)[];
  log?: (message: string) => void;
}): Promise<DevDatabase>;
