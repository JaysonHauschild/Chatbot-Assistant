import type {
  Candidate,
  ContentListUnion,
  EmbedContentResponse,
  GenerateContentConfig,
  GenerateContentResponse,
} from '@google/genai';
import {
  GeminiConfigurationError,
  GeminiResponseError,
} from './errors.js';
import type {
  EmbeddingResult,
  GenerationResult,
  InteractionResult,
} from './types.js';

export const DEFAULT_MODEL = 'gemini-2.5-flash';
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-2';

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export function getEnvironmentValue(name: string): string | undefined {
  const runtime = globalThis as typeof globalThis & {
    process?: { env?: Record<string, string | undefined> };
  };
  const value = runtime.process?.env?.[name];
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : undefined;
}

export function resolveApiKey(apiKey?: string): string | undefined {
  if (typeof apiKey === 'string' && apiKey.trim()) {
    return apiKey.trim();
  }

  return (
    getEnvironmentValue('GEMINI_API_KEY') ??
    getEnvironmentValue('GOOGLE_API_KEY')
  );
}

export function resolveModel(
  model?: string,
  fallback = DEFAULT_MODEL,
): string {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }
  return (
    getEnvironmentValue('GEMINI_MODEL') ??
    fallback
  );
}

export function resolveEmbeddingModel(
  model?: string,
  fallback = DEFAULT_EMBEDDING_MODEL,
): string {
  if (typeof model === 'string' && model.trim()) {
    return model.trim();
  }
  return (
    getEnvironmentValue('GEMINI_EMBEDDING_MODEL') ??
    fallback
  );
}

export function assertContents(
  contents: unknown,
  label = 'contents',
): asserts contents is ContentListUnion {
  if (typeof contents === 'string') {
    if (!contents.trim()) {
      throw new GeminiConfigurationError(`${label} cannot be empty.`);
    }
    return;
  }

  if (Array.isArray(contents)) {
    if (contents.length === 0) {
      throw new GeminiConfigurationError(`${label} cannot be empty.`);
    }
    return;
  }

  if (!contents || typeof contents !== 'object') {
    throw new GeminiConfigurationError(
      `${label} must be a string, content object, or non-empty array.`,
    );
  }
}

export function mergeConfig(
  defaultConfig: GenerateContentConfig = {},
  requestConfig: GenerateContentConfig = {},
  systemInstruction?: GenerateContentConfig['systemInstruction'],
): GenerateContentConfig | undefined {
  const config = {
    ...defaultConfig,
    ...requestConfig,
  };

  if (systemInstruction !== undefined) {
    config.systemInstruction = systemInstruction;
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

export function extractText(response: unknown): string {
  const record = asRecord(response);
  const directText = record?.text;

  if (typeof directText === 'string') {
    return directText;
  }

  if (typeof directText === 'function') {
    const value = directText.call(response);
    if (typeof value === 'string') {
      return value;
    }
  }

  const candidates = Array.isArray(record?.candidates)
    ? record.candidates
    : [];

  return candidates
    .flatMap((candidate) => {
      const parts = asRecord(asRecord(candidate)?.content)?.parts;
      return Array.isArray(parts) ? parts : [];
    })
    .map((part) => {
      const text = asRecord(part)?.text;
      return typeof text === 'string' ? text : '';
    })
    .join('');
}

export function normalizeGenerationResponse(
  response: GenerateContentResponse,
  requestedModel: string,
): GenerationResult {
  const record = response as unknown as Record<string, unknown>;

  return {
    text: extractText(response),
    model:
      typeof record.modelVersion === 'string' && record.modelVersion
        ? record.modelVersion
        : requestedModel,
    usage: response.usageMetadata ?? null,
    candidates: (response.candidates ?? []) as Candidate[],
    responseId:
      typeof record.responseId === 'string' && record.responseId
        ? record.responseId
        : null,
    raw: response,
  };
}

export function normalizeInteractionResponse(
  response: unknown,
  requestedModel: string,
): InteractionResult {
  const record = asRecord(response);
  const outputText =
    typeof record?.output_text === 'string'
      ? record.output_text
      : typeof record?.outputText === 'string'
        ? record.outputText
        : '';

  return {
    text: outputText,
    id: typeof record?.id === 'string' ? record.id : null,
    status:
      typeof record?.status === 'string' ? record.status : null,
    model:
      typeof record?.model === 'string' ? record.model : requestedModel,
    usage: record?.usage ?? null,
    raw: response,
  };
}

export function parseJsonResponse<T = unknown>(text: unknown): T {
  const source = typeof text === 'string' ? text.trim() : '';
  if (!source) {
    throw new GeminiResponseError(
      'Gemini returned an empty structured response.',
      {
        code: 'EMPTY_JSON_RESPONSE',
        responseText: source,
      },
    );
  }

  const withoutFence = source
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();

  try {
    return JSON.parse(withoutFence) as T;
  } catch (cause) {
    throw new GeminiResponseError('Gemini returned invalid JSON.', {
      cause,
      code: 'INVALID_JSON_RESPONSE',
      responseText: source,
    });
  }
}

export function normalizeEmbeddingResponse(
  response: EmbedContentResponse,
  requestedModel: string,
): EmbeddingResult {
  const record = response as unknown as Record<string, unknown>;
  const embeddings = (response.embeddings ?? []).map(
    (embedding) => embedding.values ?? [],
  );

  return {
    embeddings,
    model: requestedModel,
    usage: record.metadata ?? null,
    raw: response,
  };
}

function encodeBytes(data: Uint8Array): string {
  const runtime = globalThis as typeof globalThis & {
    Buffer?: {
      from(value: Uint8Array): { toString(encoding: 'base64'): string };
    };
  };

  if (runtime.Buffer) {
    return runtime.Buffer.from(data).toString('base64');
  }

  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

export function inlineData(
  data: string | Uint8Array,
  mimeType: string,
): { inlineData: { data: string; mimeType: string } } {
  if (typeof mimeType !== 'string' || !mimeType.trim()) {
    throw new GeminiConfigurationError(
      'mimeType is required for inline data.',
    );
  }

  let encoded: string;
  if (typeof data === 'string') {
    encoded = data;
  } else if (data instanceof Uint8Array) {
    encoded = encodeBytes(data);
  } else {
    throw new GeminiConfigurationError(
      'Inline data must be a base64 string, Buffer, or Uint8Array.',
    );
  }

  return {
    inlineData: {
      data: encoded,
      mimeType: mimeType.trim(),
    },
  };
}

export function cosineSimilarity(
  a: number[],
  b: number[],
): number {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b) ||
    a.length === 0 ||
    a.length !== b.length
  ) {
    throw new GeminiConfigurationError(
      'cosineSimilarity requires two non-empty arrays of equal length.',
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < a.length; index += 1) {
    const valueA = Number(a[index]);
    const valueB = Number(b[index]);
    if (!Number.isFinite(valueA) || !Number.isFinite(valueB)) {
      throw new GeminiConfigurationError(
        'Embedding vectors must contain only finite numbers.',
      );
    }
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}
