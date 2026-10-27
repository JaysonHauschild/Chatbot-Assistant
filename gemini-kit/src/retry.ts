import { GeminiKitError } from './errors.js';
import type { RetryOptions } from './types.js';

const RETRYABLE_STATUS_CODES = new Set([
  408,
  409,
  425,
  429,
  500,
  502,
  503,
  504,
]);
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'ETIMEDOUT',
]);

export const DEFAULT_RETRY_OPTIONS = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4_000,
  jitter: 0.2,
}) satisfies Readonly<Required<Omit<RetryOptions, 'onRetry'>>>;

type RetryCallback = NonNullable<RetryOptions['onRetry']>;

export interface NormalizedRetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: number;
  onRetry: RetryCallback | null;
}

type RetryConfiguration = RetryOptions | NormalizedRetryOptions;

export function normalizeRetryOptions(
  defaults: RetryConfiguration = {},
  overrides: RetryConfiguration = {},
): NormalizedRetryOptions {
  const merged = {
    ...DEFAULT_RETRY_OPTIONS,
    ...defaults,
    ...overrides,
  };
  const maxRetries = Number(merged.maxRetries);
  const baseDelayMs = Number(merged.baseDelayMs);
  const maxDelayMs = Number(merged.maxDelayMs);
  const jitter = Number(merged.jitter);

  return {
    maxRetries:
      Number.isInteger(maxRetries) && maxRetries >= 0
        ? maxRetries
        : DEFAULT_RETRY_OPTIONS.maxRetries,
    baseDelayMs:
      Number.isFinite(baseDelayMs) && baseDelayMs >= 0
        ? baseDelayMs
        : DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs:
      Number.isFinite(maxDelayMs) && maxDelayMs >= 0
        ? maxDelayMs
        : DEFAULT_RETRY_OPTIONS.maxDelayMs,
    jitter:
      Number.isFinite(jitter) && jitter >= 0
        ? jitter
        : DEFAULT_RETRY_OPTIONS.jitter,
    onRetry:
      typeof merged.onRetry === 'function' ? merged.onRetry : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function getErrorStatus(error: unknown): number | null {
  const record = asRecord(error);
  const response = asRecord(record?.response);
  const cause = asRecord(record?.cause);
  const rawStatus =
    record?.status ??
    record?.statusCode ??
    response?.status ??
    cause?.status;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : null;
}

export function isRetryableError(error: unknown): boolean {
  const record = asRecord(error);
  if (!record || record.name === 'AbortError') {
    return false;
  }
  if (record?.retryable === true) {
    return true;
  }

  const status = getErrorStatus(error);
  if (status !== null) {
    return RETRYABLE_STATUS_CODES.has(status);
  }

  const cause = asRecord(record.cause);
  const code = String(record.code ?? cause?.code ?? '').toUpperCase();
  return RETRYABLE_ERROR_CODES.has(code);
}

function sleep(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function getDelayMs(
  retryNumber: number,
  options: NormalizedRetryOptions,
): number {
  const exponentialDelay = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** Math.max(0, retryNumber - 1),
  );
  if (exponentialDelay === 0 || options.jitter === 0) {
    return exponentialDelay;
  }

  const spread = exponentialDelay * options.jitter;
  return Math.max(
    0,
    Math.round(
      exponentialDelay - spread + Math.random() * spread * 2,
    ),
  );
}

function errorMessage(error: unknown): string {
  const record = asRecord(error);
  return typeof record?.message === 'string'
    ? record.message
    : 'Gemini request failed.';
}

export async function withRetry<T>(
  operation: (attempt: number) => T | Promise<T>,
  options: RetryConfiguration = {},
): Promise<T> {
  const retryOptions = normalizeRetryOptions({}, options);
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await operation(attempt);
    } catch (error) {
      const retryable = isRetryableError(error);
      const retriesUsed = attempt - 1;

      if (!retryable || retriesUsed >= retryOptions.maxRetries) {
        if (error instanceof GeminiKitError) {
          error.attempts = attempt;
          throw error;
        }

        throw new GeminiKitError(errorMessage(error), {
          cause: error,
          code: 'GEMINI_REQUEST_FAILED',
          status: getErrorStatus(error),
          retryable,
          attempts: attempt,
        });
      }

      const retryNumber = retriesUsed + 1;
      const delayMs = getDelayMs(retryNumber, retryOptions);
      if (retryOptions.onRetry) {
        await retryOptions.onRetry({
          error,
          attempt,
          retryNumber,
          delayMs,
        });
      }

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }
}
