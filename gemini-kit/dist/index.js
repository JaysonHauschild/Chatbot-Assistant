// src/errors.ts
var GeminiKitError = class extends Error {
  code;
  status;
  retryable;
  attempts;
  constructor(message, options = {}) {
    super(message, { cause: options.cause });
    this.name = "GeminiKitError";
    this.code = options.code || "GEMINI_KIT_ERROR";
    this.status = options.status ?? null;
    this.retryable = options.retryable === true;
    this.attempts = options.attempts ?? 1;
  }
};
var GeminiConfigurationError = class extends GeminiKitError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || "INVALID_CONFIGURATION"
    });
    this.name = "GeminiConfigurationError";
  }
};
var GeminiResponseError = class extends GeminiKitError {
  responseText;
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code || "INVALID_RESPONSE"
    });
    this.name = "GeminiResponseError";
    this.responseText = options.responseText ?? null;
  }
};

// src/retry.ts
var RETRYABLE_STATUS_CODES = /* @__PURE__ */ new Set([
  408,
  409,
  425,
  429,
  500,
  502,
  503,
  504
]);
var RETRYABLE_ERROR_CODES = /* @__PURE__ */ new Set([
  "ECONNABORTED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT"
]);
var DEFAULT_RETRY_OPTIONS = Object.freeze({
  maxRetries: 2,
  baseDelayMs: 250,
  maxDelayMs: 4e3,
  jitter: 0.2
});
function normalizeRetryOptions(defaults = {}, overrides = {}) {
  const merged = {
    ...DEFAULT_RETRY_OPTIONS,
    ...defaults,
    ...overrides
  };
  const maxRetries = Number(merged.maxRetries);
  const baseDelayMs = Number(merged.baseDelayMs);
  const maxDelayMs = Number(merged.maxDelayMs);
  const jitter = Number(merged.jitter);
  return {
    maxRetries: Number.isInteger(maxRetries) && maxRetries >= 0 ? maxRetries : DEFAULT_RETRY_OPTIONS.maxRetries,
    baseDelayMs: Number.isFinite(baseDelayMs) && baseDelayMs >= 0 ? baseDelayMs : DEFAULT_RETRY_OPTIONS.baseDelayMs,
    maxDelayMs: Number.isFinite(maxDelayMs) && maxDelayMs >= 0 ? maxDelayMs : DEFAULT_RETRY_OPTIONS.maxDelayMs,
    jitter: Number.isFinite(jitter) && jitter >= 0 ? jitter : DEFAULT_RETRY_OPTIONS.jitter,
    onRetry: typeof merged.onRetry === "function" ? merged.onRetry : null
  };
}
function asRecord(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function getErrorStatus(error) {
  const record = asRecord(error);
  const response = asRecord(record?.response);
  const cause = asRecord(record?.cause);
  const rawStatus = record?.status ?? record?.statusCode ?? response?.status ?? cause?.status;
  const status = Number(rawStatus);
  return Number.isFinite(status) ? status : null;
}
function isRetryableError(error) {
  const record = asRecord(error);
  if (!record || record.name === "AbortError") {
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
  const code = String(record.code ?? cause?.code ?? "").toUpperCase();
  return RETRYABLE_ERROR_CODES.has(code);
}
function sleep(delayMs) {
  if (delayMs <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
function getDelayMs(retryNumber, options) {
  const exponentialDelay = Math.min(
    options.maxDelayMs,
    options.baseDelayMs * 2 ** Math.max(0, retryNumber - 1)
  );
  if (exponentialDelay === 0 || options.jitter === 0) {
    return exponentialDelay;
  }
  const spread = exponentialDelay * options.jitter;
  return Math.max(
    0,
    Math.round(
      exponentialDelay - spread + Math.random() * spread * 2
    )
  );
}
function errorMessage(error) {
  const record = asRecord(error);
  return typeof record?.message === "string" ? record.message : "Gemini request failed.";
}
async function withRetry(operation, options = {}) {
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
          code: "GEMINI_REQUEST_FAILED",
          status: getErrorStatus(error),
          retryable,
          attempts: attempt
        });
      }
      const retryNumber = retriesUsed + 1;
      const delayMs = getDelayMs(retryNumber, retryOptions);
      if (retryOptions.onRetry) {
        await retryOptions.onRetry({
          error,
          attempt,
          retryNumber,
          delayMs
        });
      }
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }
}

// src/utils.ts
var DEFAULT_MODEL = "gemini-2.5-flash";
var DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
function asRecord2(value) {
  return typeof value === "object" && value !== null ? value : null;
}
function getEnvironmentValue(name) {
  const runtime = globalThis;
  const value = runtime.process?.env?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function resolveApiKey(apiKey) {
  if (typeof apiKey === "string" && apiKey.trim()) {
    return apiKey.trim();
  }
  return getEnvironmentValue("GEMINI_API_KEY") ?? getEnvironmentValue("GOOGLE_API_KEY");
}
function resolveModel(model, fallback = DEFAULT_MODEL) {
  if (typeof model === "string" && model.trim()) {
    return model.trim();
  }
  return getEnvironmentValue("GEMINI_MODEL") ?? fallback;
}
function resolveEmbeddingModel(model, fallback = DEFAULT_EMBEDDING_MODEL) {
  if (typeof model === "string" && model.trim()) {
    return model.trim();
  }
  return getEnvironmentValue("GEMINI_EMBEDDING_MODEL") ?? fallback;
}
function assertContents(contents, label = "contents") {
  if (typeof contents === "string") {
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
  if (!contents || typeof contents !== "object") {
    throw new GeminiConfigurationError(
      `${label} must be a string, content object, or non-empty array.`
    );
  }
}
function mergeConfig(defaultConfig = {}, requestConfig = {}, systemInstruction) {
  const config = {
    ...defaultConfig,
    ...requestConfig
  };
  if (systemInstruction !== void 0) {
    config.systemInstruction = systemInstruction;
  }
  return Object.keys(config).length > 0 ? config : void 0;
}
function extractText(response) {
  const record = asRecord2(response);
  const directText = record?.text;
  if (typeof directText === "string") {
    return directText;
  }
  if (typeof directText === "function") {
    const value = directText.call(response);
    if (typeof value === "string") {
      return value;
    }
  }
  const candidates = Array.isArray(record?.candidates) ? record.candidates : [];
  return candidates.flatMap((candidate) => {
    const parts = asRecord2(asRecord2(candidate)?.content)?.parts;
    return Array.isArray(parts) ? parts : [];
  }).map((part) => {
    const text = asRecord2(part)?.text;
    return typeof text === "string" ? text : "";
  }).join("");
}
function normalizeGenerationResponse(response, requestedModel) {
  const record = response;
  return {
    text: extractText(response),
    model: typeof record.modelVersion === "string" && record.modelVersion ? record.modelVersion : requestedModel,
    usage: response.usageMetadata ?? null,
    candidates: response.candidates ?? [],
    responseId: typeof record.responseId === "string" && record.responseId ? record.responseId : null,
    raw: response
  };
}
function normalizeInteractionResponse(response, requestedModel) {
  const record = asRecord2(response);
  const outputText = typeof record?.output_text === "string" ? record.output_text : typeof record?.outputText === "string" ? record.outputText : "";
  return {
    text: outputText,
    id: typeof record?.id === "string" ? record.id : null,
    status: typeof record?.status === "string" ? record.status : null,
    model: typeof record?.model === "string" ? record.model : requestedModel,
    usage: record?.usage ?? null,
    raw: response
  };
}
function parseJsonResponse(text) {
  const source = typeof text === "string" ? text.trim() : "";
  if (!source) {
    throw new GeminiResponseError(
      "Gemini returned an empty structured response.",
      {
        code: "EMPTY_JSON_RESPONSE",
        responseText: source
      }
    );
  }
  const withoutFence = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(withoutFence);
  } catch (cause) {
    throw new GeminiResponseError("Gemini returned invalid JSON.", {
      cause,
      code: "INVALID_JSON_RESPONSE",
      responseText: source
    });
  }
}
function normalizeEmbeddingResponse(response, requestedModel) {
  const record = response;
  const embeddings = (response.embeddings ?? []).map(
    (embedding) => embedding.values ?? []
  );
  return {
    embeddings,
    model: requestedModel,
    usage: record.metadata ?? null,
    raw: response
  };
}
function encodeBytes(data) {
  const runtime = globalThis;
  if (runtime.Buffer) {
    return runtime.Buffer.from(data).toString("base64");
  }
  let binary = "";
  const chunkSize = 32768;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
function inlineData(data, mimeType) {
  if (typeof mimeType !== "string" || !mimeType.trim()) {
    throw new GeminiConfigurationError(
      "mimeType is required for inline data."
    );
  }
  let encoded;
  if (typeof data === "string") {
    encoded = data;
  } else if (data instanceof Uint8Array) {
    encoded = encodeBytes(data);
  } else {
    throw new GeminiConfigurationError(
      "Inline data must be a base64 string, Buffer, or Uint8Array."
    );
  }
  return {
    inlineData: {
      data: encoded,
      mimeType: mimeType.trim()
    }
  };
}
function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length === 0 || a.length !== b.length) {
    throw new GeminiConfigurationError(
      "cosineSimilarity requires two non-empty arrays of equal length."
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
        "Embedding vectors must contain only finite numbers."
      );
    }
    dot += valueA * valueB;
    normA += valueA * valueA;
    normB += valueB * valueB;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
}

// src/chat.ts
var GeminiChat = class {
  raw;
  model;
  retryOptions;
  constructor(options) {
    if (!options?.chat) {
      throw new GeminiConfigurationError(
        "A Gemini chat instance is required."
      );
    }
    this.raw = options.chat;
    this.model = options.model;
    this.retryOptions = normalizeRetryOptions({}, options.retry);
  }
  async send(message, options = {}) {
    const response = await withRetry(
      () => this.raw.sendMessage({
        message,
        config: options.config
      }),
      normalizeRetryOptions(this.retryOptions, options.retry)
    );
    return normalizeGenerationResponse(response, this.model);
  }
  async sendText(message, options = {}) {
    return (await this.send(message, options)).text;
  }
  async stream(message, options = {}) {
    return withRetry(
      () => this.raw.sendMessageStream({
        message,
        config: options.config
      }),
      normalizeRetryOptions(this.retryOptions, options.retry)
    );
  }
  async *streamText(message, options = {}) {
    const stream = await this.stream(message, options);
    for await (const chunk of stream) {
      const text = extractText(chunk);
      if (text) {
        yield text;
      }
    }
  }
  getHistory(curated = false) {
    return this.raw.getHistory(curated);
  }
};

// src/client.ts
import {
  GoogleGenAI
} from "@google/genai";
function resolveRequestModel(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
var GeminiKit = class {
  client;
  model;
  embeddingModel;
  generationConfig;
  embeddingConfig;
  retryOptions;
  constructor(options = {}) {
    const clientOptions = { ...options.clientOptions ?? {} };
    const extendedClientOptions = clientOptions;
    const apiKey = resolveApiKey(options.apiKey ?? clientOptions.apiKey);
    const usesEnterprise = extendedClientOptions.enterprise === true || clientOptions.vertexai === true;
    if (!options.client && !apiKey && !usesEnterprise) {
      throw new GeminiConfigurationError(
        "A Gemini API key is required. Pass apiKey or set GEMINI_API_KEY (or GOOGLE_API_KEY).",
        { code: "MISSING_API_KEY" }
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
    this.generationConfig = { ...options.generationConfig ?? {} };
    this.embeddingConfig = { ...options.embeddingConfig ?? {} };
    this.retryOptions = normalizeRetryOptions(options.retry);
  }
  generationRequest(contents, options = {}) {
    assertContents(contents);
    const model = resolveRequestModel(options.model, this.model);
    const config = mergeConfig(
      this.generationConfig,
      options.config,
      options.systemInstruction
    );
    return {
      model,
      request: {
        ...options.request ?? {},
        model,
        contents,
        ...config ? { config } : {}
      }
    };
  }
  async generate(contents, options = {}) {
    const { model, request } = this.generationRequest(contents, options);
    const response = await withRetry(
      () => this.client.models.generateContent(request),
      normalizeRetryOptions(this.retryOptions, options.retry)
    );
    return normalizeGenerationResponse(response, model);
  }
  async generateText(contents, options = {}) {
    return (await this.generate(contents, options)).text;
  }
  async interact(input, options = {}) {
    assertContents(input, "input");
    const model = resolveRequestModel(options.model, this.model);
    const request = {
      ...options.request ?? {},
      model,
      input,
      stream: false,
      ...options.systemInstruction === void 0 ? {} : { system_instruction: options.systemInstruction }
    };
    const response = await withRetry(
      () => this.client.interactions.create(request),
      normalizeRetryOptions(this.retryOptions, options.retry)
    );
    return normalizeInteractionResponse(response, model);
  }
  async interactText(input, options = {}) {
    return (await this.interact(input, options)).text;
  }
  async generateJson(contents, options = {}) {
    const { schema, validate, ...generationOptions } = options;
    const config = {
      ...generationOptions.config ?? {},
      responseMimeType: "application/json",
      ...schema ? { responseJsonSchema: schema } : {}
    };
    const result = await this.generate(contents, {
      ...generationOptions,
      config
    });
    const data = parseJsonResponse(result.text);
    if (validate) {
      try {
        const validated = await validate(data);
        return {
          ...result,
          data: validated === void 0 ? data : validated
        };
      } catch (cause) {
        throw new GeminiResponseError(
          "Gemini JSON response failed validation.",
          {
            cause,
            code: "JSON_VALIDATION_FAILED",
            responseText: result.text
          }
        );
      }
    }
    return {
      ...result,
      data
    };
  }
  async stream(contents, options = {}) {
    const { request } = this.generationRequest(contents, options);
    return withRetry(
      () => this.client.models.generateContentStream(request),
      normalizeRetryOptions(this.retryOptions, options.retry)
    );
  }
  async *streamText(contents, options = {}) {
    const stream = await this.stream(contents, options);
    for await (const chunk of stream) {
      const text = extractText(chunk);
      if (text) {
        yield text;
      }
    }
  }
  async embed(contents, options = {}) {
    assertContents(contents);
    const model = resolveRequestModel(options.model, this.embeddingModel);
    const config = {
      ...this.embeddingConfig,
      ...options.config ?? {}
    };
    const request = {
      ...options.request ?? {},
      model,
      contents,
      ...Object.keys(config).length ? { config } : {}
    };
    const response = await withRetry(
      () => this.client.models.embedContent(request),
      normalizeRetryOptions(this.retryOptions, options.retry)
    );
    return normalizeEmbeddingResponse(response, model);
  }
  async embedText(text, options = {}) {
    const result = await this.embed(text, options);
    if (!result.embeddings[0]) {
      throw new GeminiResponseError("Gemini returned no embedding.", {
        code: "EMPTY_EMBEDDING_RESPONSE"
      });
    }
    return result.embeddings[0];
  }
  async embedMany(texts, options = {}) {
    if (!Array.isArray(texts) || texts.length === 0 || texts.some(
      (text) => typeof text !== "string" || !text.trim()
    )) {
      throw new GeminiConfigurationError(
        "embedMany requires a non-empty array of non-empty strings."
      );
    }
    const contents = texts.map((text) => ({
      parts: [{ text }]
    }));
    return (await this.embed(contents, options)).embeddings;
  }
  createChat(options = {}) {
    const model = resolveRequestModel(options.model, this.model);
    const config = mergeConfig(
      this.generationConfig,
      options.config,
      options.systemInstruction
    );
    const request = {
      model,
      ...options.history ? { history: options.history } : {},
      ...config ? { config } : {}
    };
    const retry = normalizeRetryOptions(
      this.retryOptions,
      options.retry
    );
    return new GeminiChat({
      chat: this.client.chats.create(request),
      model,
      retry: {
        ...retry,
        onRetry: retry.onRetry ?? void 0
      }
    });
  }
};
function createGeminiKit(options = {}) {
  return new GeminiKit(options);
}
export {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_MODEL,
  DEFAULT_RETRY_OPTIONS,
  GeminiChat,
  GeminiConfigurationError,
  GeminiKit,
  GeminiKitError,
  GeminiResponseError,
  cosineSimilarity,
  createGeminiKit,
  getErrorStatus,
  inlineData,
  isRetryableError
};
//# sourceMappingURL=index.js.map
