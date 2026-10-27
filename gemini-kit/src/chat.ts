import type {
  Content,
  GenerateContentResponse,
  GoogleGenAI,
  PartListUnion,
} from '@google/genai';
import { GeminiConfigurationError } from './errors.js';
import { normalizeRetryOptions, withRetry } from './retry.js';
import type {
  ChatSendOptions,
  GenerationResult,
  RetryOptions,
} from './types.js';
import {
  extractText,
  normalizeGenerationResponse,
} from './utils.js';

type GeminiSdkChat = ReturnType<GoogleGenAI['chats']['create']>;

interface GeminiChatConstructorOptions {
  chat: GeminiSdkChat;
  model: string;
  retry?: RetryOptions;
}

export class GeminiChat {
  readonly raw: GeminiSdkChat;
  readonly model: string;
  private readonly retryOptions: ReturnType<typeof normalizeRetryOptions>;

  constructor(options: GeminiChatConstructorOptions) {
    if (!options?.chat) {
      throw new GeminiConfigurationError(
        'A Gemini chat instance is required.',
      );
    }

    this.raw = options.chat;
    this.model = options.model;
    this.retryOptions = normalizeRetryOptions({}, options.retry);
  }

  async send(
    message: PartListUnion,
    options: ChatSendOptions = {},
  ): Promise<GenerationResult> {
    const response = await withRetry(
      () =>
        this.raw.sendMessage({
          message,
          config: options.config,
        }),
      normalizeRetryOptions(this.retryOptions, options.retry),
    );

    return normalizeGenerationResponse(response, this.model);
  }

  async sendText(
    message: PartListUnion,
    options: ChatSendOptions = {},
  ): Promise<string> {
    return (await this.send(message, options)).text;
  }

  async stream(
    message: PartListUnion,
    options: ChatSendOptions = {},
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    return withRetry(
      () =>
        this.raw.sendMessageStream({
          message,
          config: options.config,
        }),
      normalizeRetryOptions(this.retryOptions, options.retry),
    );
  }

  async *streamText(
    message: PartListUnion,
    options: ChatSendOptions = {},
  ): AsyncGenerator<string> {
    const stream = await this.stream(message, options);
    for await (const chunk of stream) {
      const text = extractText(chunk);
      if (text) {
        yield text;
      }
    }
  }

  getHistory(curated = false): Content[] {
    return this.raw.getHistory(curated);
  }
}
