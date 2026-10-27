export interface GeminiKitErrorOptions {
    cause?: unknown;
    code?: string;
    status?: number | null;
    retryable?: boolean;
    attempts?: number;
}
export declare class GeminiKitError extends Error {
    code: string;
    status: number | null;
    retryable: boolean;
    attempts: number;
    constructor(message: string, options?: GeminiKitErrorOptions);
}
export declare class GeminiConfigurationError extends GeminiKitError {
    constructor(message: string, options?: GeminiKitErrorOptions);
}
export interface GeminiResponseErrorOptions extends GeminiKitErrorOptions {
    responseText?: string | null;
}
export declare class GeminiResponseError extends GeminiKitError {
    responseText: string | null;
    constructor(message: string, options?: GeminiResponseErrorOptions);
}
