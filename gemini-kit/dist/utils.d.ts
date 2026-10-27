import type { ContentListUnion, EmbedContentResponse, GenerateContentConfig, GenerateContentResponse } from '@google/genai';
import type { EmbeddingResult, GenerationResult, InteractionResult } from './types.js';
export declare const DEFAULT_MODEL = "gemini-2.5-flash";
export declare const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
export declare function getEnvironmentValue(name: string): string | undefined;
export declare function resolveApiKey(apiKey?: string): string | undefined;
export declare function resolveModel(model?: string, fallback?: string): string;
export declare function resolveEmbeddingModel(model?: string, fallback?: string): string;
export declare function assertContents(contents: unknown, label?: string): asserts contents is ContentListUnion;
export declare function mergeConfig(defaultConfig?: GenerateContentConfig, requestConfig?: GenerateContentConfig, systemInstruction?: GenerateContentConfig['systemInstruction']): GenerateContentConfig | undefined;
export declare function extractText(response: unknown): string;
export declare function normalizeGenerationResponse(response: GenerateContentResponse, requestedModel: string): GenerationResult;
export declare function normalizeInteractionResponse(response: unknown, requestedModel: string): InteractionResult;
export declare function parseJsonResponse<T = unknown>(text: unknown): T;
export declare function normalizeEmbeddingResponse(response: EmbedContentResponse, requestedModel: string): EmbeddingResult;
export declare function inlineData(data: string | Uint8Array, mimeType: string): {
    inlineData: {
        data: string;
        mimeType: string;
    };
};
export declare function cosineSimilarity(a: number[], b: number[]): number;
