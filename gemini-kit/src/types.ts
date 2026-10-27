import type {
  Candidate,
  Content,
  EmbedContentConfig,
  EmbedContentResponse,
  GenerateContentConfig,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  GoogleGenAIOptions,
} from '@google/genai';

export type GeminiInteractionCreateParameters = Parameters<
  GoogleGenAI['interactions']['create']
>[0];

export type GeminiInteractionInput =
  GeminiInteractionCreateParameters extends { input: infer Input }
    ? Input
    : unknown;

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: number;
  onRetry?: (event: {
    error: unknown;
    attempt: number;
    retryNumber: number;
    delayMs: number;
  }) => void | Promise<void>;
}

export interface GeminiKitOptions {
  apiKey?: string;
  model?: string;
  embeddingModel?: string;
  apiVersion?: string;
  client?: GoogleGenAI;
  clientOptions?: GoogleGenAIOptions;
  generationConfig?: GenerateContentConfig;
  embeddingConfig?: EmbedContentConfig;
  retry?: RetryOptions;
}

export interface GenerateOptions {
  model?: string;
  systemInstruction?: GenerateContentConfig['systemInstruction'];
  config?: GenerateContentConfig;
  retry?: RetryOptions;
  request?: Record<string, unknown>;
}

export interface InteractionOptions {
  model?: string;
  systemInstruction?: string;
  retry?: RetryOptions;
  request?: Record<string, unknown>;
}

export interface GenerationResult {
  text: string;
  model: string;
  usage: GenerateContentResponseUsageMetadata | null;
  candidates: Candidate[];
  responseId: string | null;
  raw: GenerateContentResponse;
}

export interface GenerateJsonOptions<T = unknown> extends GenerateOptions {
  schema?: Record<string, unknown>;
  validate?: (data: unknown) => T | Promise<T>;
}

export interface JsonGenerationResult<T = unknown> extends GenerationResult {
  data: T;
}

export interface InteractionResult {
  text: string;
  id: string | null;
  status: string | null;
  model: string;
  usage: unknown;
  raw: unknown;
}

export interface EmbedOptions {
  model?: string;
  config?: EmbedContentConfig;
  retry?: RetryOptions;
  request?: Record<string, unknown>;
}

export interface EmbeddingResult {
  embeddings: number[][];
  model: string;
  usage: unknown;
  raw: EmbedContentResponse;
}

export interface ChatOptions {
  model?: string;
  systemInstruction?: GenerateContentConfig['systemInstruction'];
  config?: GenerateContentConfig;
  history?: Content[];
  retry?: RetryOptions;
}

export interface ChatSendOptions {
  config?: GenerateContentConfig;
  retry?: RetryOptions;
}
