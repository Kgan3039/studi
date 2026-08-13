export const INSTALLATION_STORAGE_KEY: string;
export const INSTALLATION_GENERATION_KEY: string;
export const PUSH_CLEANUP_TIMEOUT_MS: number;
export const STORAGE_PREFIX: string;

export type PushRegistrationResult =
  | { status: 'registered'; expoPushToken: string }
  | { status: 'denied' | 'signed-out' | 'skipped' | 'unsupported' | 'unavailable' | 'error'; reason?: string };

export type PushRegistrationEntry = { token: string; registrationId: string; generation: number };
export type StoredPushRegistrationState = {
  active: PushRegistrationEntry | null;
  pending: PushRegistrationEntry[];
};
type StorageAdapter = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<
  | { status: 'settled'; value: T }
  | { status: 'rejected'; error: unknown }
  | { status: 'timeout' }
>;

export function createPushRegistrationState(options?: {
  storage?: StorageAdapter;
  randomId?: () => string;
  now?: () => number;
}): {
  beginCleanup(uid: string): number;
  createRegistrationIntent(uid: string, token: string, renew?: boolean): Promise<PushRegistrationEntry>;
  getInstallationId(): Promise<string>;
  resetInstallationLookup(): void;
  getSnapshot(uid: string): Promise<StoredPushRegistrationState>;
  markRegistered(uid: string, entry: PushRegistrationEntry): Promise<StoredPushRegistrationState>;
  markUnregistered(uid: string, entry: PushRegistrationEntry): Promise<StoredPushRegistrationState>;
  resume(uid: string): boolean;
  isCleanupCurrent(uid: string, epoch: number): boolean;
  run(uid: string, task: () => Promise<PushRegistrationResult> | PushRegistrationResult): Promise<PushRegistrationResult>;
  waitForIdle(uid: string, timeoutMs: number): Promise<
    | { status: 'settled'; value?: PushRegistrationResult }
    | { status: 'rejected'; error: unknown }
    | { status: 'timeout' }
  >;
};

export function cleanupPushRegistration(options: {
  state: ReturnType<typeof createPushRegistrationState>;
  uid: string;
  installationId: string;
  unregister(entry: PushRegistrationEntry & { installationId: string }): Promise<boolean>;
  timeoutMs: number;
}): Promise<
  | { status: 'settled'; value: void }
  | { status: 'rejected'; error: unknown }
  | { status: 'timeout' }
>;

export function cleanupCurrentPushRegistration(options: {
  state: ReturnType<typeof createPushRegistrationState>;
  uid: string;
  getInstallationId(): Promise<string>;
  unregister(entry: PushRegistrationEntry & { installationId: string }): Promise<boolean>;
  timeoutMs: number;
}): Promise<
  | { status: 'settled'; value: unknown }
  | { status: 'rejected'; error: unknown }
  | { status: 'timeout' }
>;
