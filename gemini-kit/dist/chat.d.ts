import type { Content, GenerateContentResponse, GoogleGenAI, PartListUnion } from '@google/genai';
import type { ChatSendOptions, GenerationResult, RetryOptions } from './types.js';
type GeminiSdkChat = ReturnType<GoogleGenAI['chats']['create']>;
interface GeminiChatConstructorOptions {
    chat: GeminiSdkChat;
    model: string;
    retry?: RetryOptions;
}
export declare class GeminiChat {
    readonly raw: GeminiSdkChat;
    readonly model: string;
    private readonly retryOptions;
    constructor(options: GeminiChatConstructorOptions);
    send(message: PartListUnion, options?: ChatSendOptions): Promise<GenerationResult>;
    sendText(message: PartListUnion, options?: ChatSendOptions): Promise<string>;
    stream(message: PartListUnion, options?: ChatSendOptions): Promise<AsyncGenerator<GenerateContentResponse>>;
    streamText(message: PartListUnion, options?: ChatSendOptions): AsyncGenerator<string>;
    getHistory(curated?: boolean): Content[];
}
export {};
