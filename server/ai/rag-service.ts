/**
 * AI RAG Service
 * Unified service for AI completion with multi-provider support
 */

import type {
  AIProvider,
  AIClientConfig,
  AIResponse,
  RAGRequest,
} from './types';
import { OpenAIClient } from './clients/openai';
import { AnthropicClient } from './clients/anthropic';
import { GeminiClient } from './clients/gemini';
import { OllamaClient } from './clients/ollama';

export class RAGService {
  private config: AIClientConfig;
  private clients: Map<AIProvider, any>;

  constructor(config: AIClientConfig) {
    this.config = config;
    this.clients = new Map();
    this.initializeClients();
  }

  private initializeClients(): void {
    if (this.config.openai?.apiKey) {
      this.clients.set(
        'openai',
        new OpenAIClient(this.config.openai.apiKey, this.config.openai.baseURL)
      );
    }

    if (this.config.anthropic?.apiKey) {
      this.clients.set(
        'anthropic',
        new AnthropicClient(this.config.anthropic.apiKey, this.config.anthropic.baseURL)
      );
    }

    if (this.config.gemini?.apiKey) {
      this.clients.set(
        'gemini',
        new GeminiClient(this.config.gemini.apiKey, this.config.gemini.baseURL)
      );
    }

    if (this.config.ollama?.baseURL) {
      this.clients.set(
        'ollama',
        new OllamaClient(this.config.ollama.baseURL)
      );
    }
  }

  async complete(request: RAGRequest): Promise<AIResponse> {
    const client = this.clients.get(request.provider);

    if (!client) {
      throw new Error(
        `Provider '${request.provider}' is not configured. Available providers: ${Array.from(this.clients.keys()).join(', ')}`
      );
    }

    // If RAG context is provided, inject it into the messages
    if (request.ragContext?.contextDocuments && request.ragContext.contextDocuments.length > 0) {
      const contextMessage = this.buildContextMessage(request.ragContext.contextDocuments);
      request.messages = [
        contextMessage,
        ...request.messages,
      ];
    }

    try {
      const response = await client.complete(request);
      return response;
    } catch (error) {
      console.error(`[AI RAG] Error with provider ${request.provider}:`, error);
      throw error;
    }
  }

  private buildContextMessage(documents: string[]): any {
    const contextText = documents.join('\n\n---\n\n');
    return {
      role: 'system' as const,
      content: `Context from knowledge base:\n\n${contextText}\n\nUse this context to answer the user's question. If the answer is not in the context, say so.`,
    };
  }

  isProviderAvailable(provider: AIProvider): boolean {
    return this.clients.has(provider);
  }

  getAvailableProviders(): AIProvider[] {
    return Array.from(this.clients.keys());
  }

  getClient(provider: AIProvider): any {
    const client = this.clients.get(provider);
    if (!client) {
      throw new Error(
        `Provider '${provider}' is not configured. Available providers: ${Array.from(this.clients.keys()).join(', ')}`
      );
    }
    return client;
  }
}

// Singleton instance
let ragServiceInstance: RAGService | null = null;

async function loadAIConfig(): Promise<AIClientConfig> {
  try {
    // Try to load from JSON file (user config from UI)
    const { readAIConfig } = await import('../routes/ai-config');
    const fileConfig = await readAIConfig();

    if (fileConfig) {
      const config: AIClientConfig = {};

      if (fileConfig.openai?.apiKey) {
        config.openai = {
          apiKey: fileConfig.openai.apiKey,
          baseURL: fileConfig.openai.baseUrl,
        };
      }

      if (fileConfig.anthropic?.apiKey) {
        config.anthropic = {
          apiKey: fileConfig.anthropic.apiKey,
          baseURL: fileConfig.anthropic.baseUrl,
        };
      }

      if (fileConfig.gemini?.apiKey) {
        config.gemini = {
          apiKey: fileConfig.gemini.apiKey,
          baseURL: fileConfig.gemini.baseUrl,
        };
      }

      if (fileConfig.ollama?.baseUrl) {
        config.ollama = {
          baseURL: fileConfig.ollama.baseUrl,
        };
      }

      // If we have at least one provider configured, return it
      if (Object.keys(config).length > 0) {
        return config;
      }
    }
  } catch (error) {
    console.log('[AI RAG] No config file found, falling back to .env');
  }

  // Fallback to environment variables
  const config: AIClientConfig = {
    openai: process.env.OPENAI_API_KEY
      ? {
          apiKey: process.env.OPENAI_API_KEY,
          baseURL: process.env.OPENAI_BASE_URL,
        }
      : undefined,
    anthropic: process.env.ANTHROPIC_API_KEY
      ? {
          apiKey: process.env.ANTHROPIC_API_KEY,
          baseURL: process.env.ANTHROPIC_BASE_URL,
        }
      : undefined,
    gemini: process.env.GEMINI_API_KEY
      ? {
          apiKey: process.env.GEMINI_API_KEY,
          baseURL: process.env.GEMINI_BASE_URL,
        }
      : undefined,
    ollama: process.env.OLLAMA_BASE_URL
      ? {
          baseURL: process.env.OLLAMA_BASE_URL,
        }
      : { baseURL: 'http://localhost:11434' }, // Default Ollama URL
  };

  return config;
}

export async function getRagService(): Promise<RAGService> {
  if (!ragServiceInstance) {
    const config = await loadAIConfig();
    ragServiceInstance = new RAGService(config);
  }

  return ragServiceInstance;
}

export function resetRagService(): void {
  ragServiceInstance = null;
}
