import { GoogleGenAI, type ContentListUnion, type GenerateContentResponse } from '@google/genai';
import { GeminiChat } from './chat.js';
import type { ChatOptions, EmbedOptions, EmbeddingResult, GeminiInteractionInput, GeminiKitOptions, GenerateJsonOptions, GenerateOptions, GenerationResult, InteractionOptions, InteractionResult, JsonGenerationResult } from './types.js';
export declare class GeminiKit {
    readonly client: GoogleGenAI;
    readonly model: string;
    readonly embeddingModel: string;
    private readonly generationConfig;
    private readonly embeddingConfig;
    private readonly retryOptions;
    constructor(options?: GeminiKitOptions);
    private generationRequest;
    generate(contents: ContentListUnion, options?: GenerateOptions): Promise<GenerationResult>;
    generateText(contents: ContentListUnion, options?: GenerateOptions): Promise<string>;
    interact(input: GeminiInteractionInput, options?: InteractionOptions): Promise<InteractionResult>;
    interactText(input: GeminiInteractionInput, options?: InteractionOptions): Promise<string>;
    generateJson<T = unknown>(contents: ContentListUnion, options?: GenerateJsonOptions<T>): Promise<JsonGenerationResult<T>>;
    stream(contents: ContentListUnion, options?: GenerateOptions): Promise<AsyncGenerator<GenerateContentResponse>>;
    streamText(contents: ContentListUnion, options?: GenerateOptions): AsyncGenerator<string>;
    embed(contents: ContentListUnion, options?: EmbedOptions): Promise<EmbeddingResult>;
    embedText(text: string, options?: EmbedOptions): Promise<number[]>;
    embedMany(texts: string[], options?: EmbedOptions): Promise<number[][]>;
    createChat(options?: ChatOptions): GeminiChat;
}
export declare function createGeminiKit(options?: GeminiKitOptions): GeminiKit;
