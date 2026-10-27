export interface GeminiKitErrorOptions {
  cause?: unknown;
  code?: string;
  status?: number | null;
  retryable?: boolean;
  attempts?: number;
}

export class GeminiKitError extends Error {
  code: string;
  status: number | null;
  retryable: boolean;
  attempts: number;

  constructor(message: string, options: GeminiKitErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = 'GeminiKitError';
    this.code = options.code || 'GEMINI_KIT_ERROR';
    this.status = options.status ?? null;
    this.retryable = options.retryable === true;
    this.attempts = options.attempts ?? 1;
  }
}

export class GeminiConfigurationError extends GeminiKitError {
  constructor(message: string, options: GeminiKitErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code || 'INVALID_CONFIGURATION',
    });
    this.name = 'GeminiConfigurationError';
  }
}

export interface GeminiResponseErrorOptions extends GeminiKitErrorOptions {
  responseText?: string | null;
}

export class GeminiResponseError extends GeminiKitError {
  responseText: string | null;

  constructor(message: string, options: GeminiResponseErrorOptions = {}) {
    super(message, {
      ...options,
      code: options.code || 'INVALID_RESPONSE',
    });
    this.name = 'GeminiResponseError';
    this.responseText = options.responseText ?? null;
  }
}
