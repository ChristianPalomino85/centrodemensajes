/**
 * AI/RAG Service Types
 * Unified types for multi-provider AI integration
 */

export type AIProvider = 'openai' | 'anthropic' | 'ollama' | 'gemini';

export type OpenAIModel =
  // GPT-5 family (August 2025+)
  | 'gpt-5'
  | 'gpt-5-mini'
  | 'gpt-5-nano'
  | 'gpt-5.1'
  | 'gpt-5.1-mini'
  | 'gpt-5.1-nano'
  // GPT-4 family
  | 'gpt-4-turbo'
  | 'gpt-4'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-3.5-turbo';

export type AnthropicModel =
  | 'claude-3-5-sonnet-20241022'
  | 'claude-3-5-haiku-20241022'
  | 'claude-3-opus-20240229'
  | 'claude-3-sonnet-20240229'
  | 'claude-3-haiku-20240307';

export type GeminiModel =
  | 'gemini-2.0-flash-exp'
  | 'gemini-1.5-pro'
  | 'gemini-1.5-flash';

export type OllamaModel = string; // Ollama supports custom models

export type AIModel = OpenAIModel | AnthropicModel | GeminiModel | OllamaModel;

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIRequestConfig {
  provider: AIProvider;
  model: AIModel;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface AIResponse {
  content: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface AIClientConfig {
  openai?: {
    apiKey: string;
    baseURL?: string;
  };
  anthropic?: {
    apiKey: string;
    baseURL?: string;
  };
  gemini?: {
    apiKey: string;
    baseURL?: string;
  };
  ollama?: {
    baseURL: string;
  };
}

export interface RAGContext {
  knowledgeBase?: string;
  contextDocuments?: string[];
  metadata?: Record<string, any>;
}

export interface RAGRequest extends AIRequestConfig {
  ragContext?: RAGContext;
}

export interface AIClient {
  complete(request: AIRequestConfig): Promise<AIResponse>;
}
