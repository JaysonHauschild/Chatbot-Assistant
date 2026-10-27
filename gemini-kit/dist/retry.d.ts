import type { RetryOptions } from './types.js';
export declare const DEFAULT_RETRY_OPTIONS: Readonly<{
    maxRetries: 2;
    baseDelayMs: 250;
    maxDelayMs: 4000;
    jitter: 0.2;
}>;
type RetryCallback = NonNullable<RetryOptions['onRetry']>;
export interface NormalizedRetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    jitter: number;
    onRetry: RetryCallback | null;
}
type RetryConfiguration = RetryOptions | NormalizedRetryOptions;
export declare function normalizeRetryOptions(defaults?: RetryConfiguration, overrides?: RetryConfiguration): NormalizedRetryOptions;
export declare function getErrorStatus(error: unknown): number | null;
export declare function isRetryableError(error: unknown): boolean;
export declare function withRetry<T>(operation: (attempt: number) => T | Promise<T>, options?: RetryConfiguration): Promise<T>;
export {};
