import {
  GoogleGenAI,
  type ContentListUnion,
  type GenerateContentResponse,
} from '@google/genai';
import { GeminiChat } from './chat.js';
import {
  GeminiConfigurationError,
  GeminiResponseError,
} from './errors.js';
import { normalizeRetryOptions, withRetry } from './retry.js';
import type {
  ChatOptions,
  EmbedOptions,
  EmbeddingResult,
  GeminiInteractionCreateParameters,
  GeminiInteractionInput,
  GeminiKitOptions,
  GenerateJsonOptions,
  GenerateOptions,
  GenerationResult,
  InteractionOptions,
  InteractionResult,
  JsonGenerationResult,
} from './types.js';
import {
  assertContents,
  extractText,
  mergeConfig,
  normalizeEmbeddingResponse,
  normalizeGenerationResponse,
  normalizeInteractionResponse,
  parseJsonResponse,
  resolveApiKey,
  resolveEmbeddingModel,
  resolveModel,
} from './utils.js';

type GenerateContentParameters = Parameters<
  GoogleGenAI['models']['generateContent']
>[0];
type EmbedContentParameters = Parameters<
  GoogleGenAI['models']['embedContent']
>[0];
type CreateChatParameters = Parameters<GoogleGenAI['chats']['create']>[0];

function resolveRequestModel(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : fallback;
}

export class GeminiKit {
  readonly client: GoogleGenAI;
  readonly model: string;
  readonly embeddingModel: string;
  private readonly generationConfig: NonNullable<
    GeminiKitOptions['generationConfig']
  >;
  private readonly embeddingConfig: NonNullable<
    GeminiKitOptions['embeddingConfig']
  >;
  private readonly retryOptions: ReturnType<typeof normalizeRetryOptions>;

  constructor(options: GeminiKitOptions = {}) {
    const clientOptions = { ...(options.clientOptions ?? {}) };
    const extendedClientOptions = clientOptions as typeof clientOptions & {
      enterprise?: boolean;
    };
    const apiKey = resolveApiKey(options.apiKey ?? clientOptions.apiKey);
    const usesEnterprise =
      extendedClientOptions.enterprise === true ||
      clientOptions.vertexai === true;

    if (!options.client && !apiKey && !usesEnterprise) {
      throw new GeminiConfigurationError(
        'A Gemini API key is required. Pass apiKey or set GEMINI_API_KEY (or GOOGLE_API_KEY).',
        { code: 'MISSING_API_KEY' },
      );
    }

    if (apiKey && !usesEnterprise) {
      clientOptions.apiKey = apiKey;
    }
    if (options.apiVersion) {
      clientOptions.apiVersion = options.apiVersion;
    }

    this.client = options.client ?? new GoogleGenAI(clientOptions);
    this.model = resolveModel(options.model);
    this.embeddingModel = resolveEmbeddingModel(options.embeddingModel);
    this.generationConfig = { ...(options.generationConfig ?? {}) };
    this.embeddingConfig = { ...(options.embeddingConfig ?? {}) };
    this.retryOptions = normalizeRetryOptions(options.retry);
  }

  private generationRequest(
    contents: ContentListUnion,
    options: GenerateOptions = {},
  ): { model: string; request: GenerateContentParameters } {
    assertContents(contents);

    const model = resolveRequestModel(options.model, this.model);
    const config = mergeConfig(
      this.generationConfig,
      options.config,
      options.systemInstruction,
    );

    return {
      model,
      request: {
        ...(options.request ?? {}),
        model,
        contents,
        ...(config ? { config } : {}),
      } as GenerateContentParameters,
    };
  }

  async generate(
    contents: ContentListUnion,
    options: GenerateOptions = {},
  ): Promise<GenerationResult> {
    const { model, request } = this.generationRequest(contents, options);

    const response = await withRetry(
      () => this.client.models.generateContent(request),
      normalizeRetryOptions(this.retryOptions, options.retry),
    );

    return normalizeGenerationResponse(response, model);
  }

  async generateText(
    contents: ContentListUnion,
    options: GenerateOptions = {},
  ): Promise<string> {
    return (await this.generate(contents, options)).text;
  }

  async interact(
    input: GeminiInteractionInput,
    options: InteractionOptions = {},
  ): Promise<InteractionResult> {
    assertContents(input, 'input');

    const model = resolveRequestModel(options.model, this.model);
    const request = {
      ...(options.request ?? {}),
      model,
      input,
      stream: false,
      ...(options.systemInstruction === undefined
        ? {}
        : { system_instruction: options.systemInstruction }),
    } as GeminiInteractionCreateParameters;

    const response = await withRetry(
      () => this.client.interactions.create(request),
      normalizeRetryOptions(this.retryOptions, options.retry),
    );

    return normalizeInteractionResponse(response, model);
  }

  async interactText(
    input: GeminiInteractionInput,
    options: InteractionOptions = {},
  ): Promise<string> {
    return (await this.interact(input, options)).text;
  }

  async generateJson<T = unknown>(
    contents: ContentListUnion,
    options: GenerateJsonOptions<T> = {},
  ): Promise<JsonGenerationResult<T>> {
    const { schema, validate, ...generationOptions } = options;
    const config = {
      ...(generationOptions.config ?? {}),
      responseMimeType: 'application/json',
      ...(schema ? { responseJsonSchema: schema } : {}),
    };

    const result = await this.generate(contents, {
      ...generationOptions,
      config,
    });

    const data = parseJsonResponse(result.text);

    if (validate) {
      try {
        const validated = await validate(data);
        return {
          ...result,
          data: (validated === undefined ? data : validated) as T,
        };
      } catch (cause) {
        throw new GeminiResponseError(
          'Gemini JSON response failed validation.',
          {
            cause,
            code: 'JSON_VALIDATION_FAILED',
            responseText: result.text,
          },
        );
      }
    }

    return {
      ...result,
      data: data as T,
    };
  }

  async stream(
    contents: ContentListUnion,
    options: GenerateOptions = {},
  ): Promise<AsyncGenerator<GenerateContentResponse>> {
    const { request } = this.generationRequest(contents, options);

    return withRetry(
      () => this.client.models.generateContentStream(request),
      normalizeRetryOptions(this.retryOptions, options.retry),
    );
  }

  async *streamText(
    contents: ContentListUnion,
    options: GenerateOptions = {},
  ): AsyncGenerator<string> {
    const stream = await this.stream(contents, options);
    for await (const chunk of stream) {
      const text = extractText(chunk);
      if (text) {
        yield text;
      }
    }
  }

  async embed(
    contents: ContentListUnion,
    options: EmbedOptions = {},
  ): Promise<EmbeddingResult> {
    assertContents(contents);

    const model = resolveRequestModel(options.model, this.embeddingModel);
    const config = {
      ...this.embeddingConfig,
      ...(options.config ?? {}),
    };
    const request = {
      ...(options.request ?? {}),
      model,
      contents,
      ...(Object.keys(config).length ? { config } : {}),
    } as EmbedContentParameters;

    const response = await withRetry(
      () => this.client.models.embedContent(request),
      normalizeRetryOptions(this.retryOptions, options.retry),
    );

    return normalizeEmbeddingResponse(response, model);
  }

  async embedText(
    text: string,
    options: EmbedOptions = {},
  ): Promise<number[]> {
    const result = await this.embed(text, options);
    if (!result.embeddings[0]) {
      throw new GeminiResponseError('Gemini returned no embedding.', {
        code: 'EMPTY_EMBEDDING_RESPONSE',
      });
    }
    return result.embeddings[0];
  }

  async embedMany(
    texts: string[],
    options: EmbedOptions = {},
  ): Promise<number[][]> {
    if (
      !Array.isArray(texts) ||
      texts.length === 0 ||
      texts.some(
        (text) => typeof text !== 'string' || !text.trim(),
      )
    ) {
      throw new GeminiConfigurationError(
        'embedMany requires a non-empty array of non-empty strings.',
      );
    }

    const contents = texts.map((text) => ({
      parts: [{ text }],
    }));
    return (await this.embed(contents, options)).embeddings;
  }

  createChat(options: ChatOptions = {}): GeminiChat {
    const model = resolveRequestModel(options.model, this.model);
    const config = mergeConfig(
      this.generationConfig,
      options.config,
      options.systemInstruction,
    );
    const request = {
      model,
      ...(options.history ? { history: options.history } : {}),
      ...(config ? { config } : {}),
    } as CreateChatParameters;
    const retry = normalizeRetryOptions(
      this.retryOptions,
      options.retry,
    );

    return new GeminiChat({
      chat: this.client.chats.create(request),
      model,
      retry: {
        ...retry,
        onRetry: retry.onRetry ?? undefined,
      },
    });
  }
}

export function createGeminiKit(options: GeminiKitOptions = {}): GeminiKit {
  return new GeminiKit(options);
}
