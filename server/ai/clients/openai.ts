/**
 * OpenAI Client
 * Handles API requests to OpenAI's chat completion API
 */

import type { AIClient, AIRequestConfig, AIResponse } from '../types';

// Types for function calling
export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAIAgentRequest extends AIRequestConfig {
  tools?: OpenAITool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

export interface OpenAIAgentResponse extends AIResponse {
  toolCalls?: OpenAIToolCall[];
}

export class OpenAIClient implements AIClient {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL = 'https://api.openai.com/v1') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  // GPT-5 models use max_completion_tokens instead of max_tokens
  private isGPT5Model(model: string): boolean {
    return model.startsWith('gpt-5') || model.startsWith('o1') || model.startsWith('o3');
  }

  async complete(request: AIRequestConfig): Promise<AIResponse> {
    const isGPT5 = this.isGPT5Model(request.model);
    const body: any = {
      model: request.model,
      messages: request.messages,
    };

    // GPT-5 doesn't support custom temperature, only default (1)
    if (!isGPT5) {
      body.temperature = request.temperature ?? 0.7;
    }

    // GPT-5 uses max_completion_tokens, older models use max_tokens
    if (isGPT5) {
      body.max_completion_tokens = request.maxTokens ?? 1000;
    } else {
      body.max_tokens = request.maxTokens ?? 1000;
    }

    const response = await fetch(`${this.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${error}`);
    }

    const data = await response.json();

    return {
      content: data.choices[0]?.message?.content ?? '',
      finishReason: data.choices[0]?.finish_reason,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
    };
  }

  /**
   * Complete with function calling support (for agents)
   * This is a new method that doesn't affect existing functionality
   */
  async completeWithTools(request: OpenAIAgentRequest): Promise<OpenAIAgentResponse> {
    const isGPT5 = this.isGPT5Model(request.model);
    const body: any = {
      model: request.model,
      messages: request.messages,
    };

    // GPT-5 doesn't support custom temperature, only default (1)
    if (!isGPT5) {
      body.temperature = request.temperature ?? 0.7;
    }

    // GPT-5 uses max_completion_tokens, older models use max_tokens
    if (isGPT5) {
      body.max_completion_tokens = request.maxTokens ?? 1000;
    } else {
      body.max_tokens = request.maxTokens ?? 1000;
    }

    // Add tools if provided
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools;
      body.tool_choice = request.tool_choice ?? 'auto';
    }

    // Retry logic for rate limit errors (429)
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const data = await response.json();
        const message = data.choices[0]?.message;

        return {
          content: message?.content ?? '',
          finishReason: data.choices[0]?.finish_reason,
          toolCalls: message?.tool_calls,
          usage: {
            promptTokens: data.usage?.prompt_tokens ?? 0,
            completionTokens: data.usage?.completion_tokens ?? 0,
            totalTokens: data.usage?.total_tokens ?? 0,
          },
        };
      }

      // Handle rate limit (429) with retry
      if (response.status === 429 && attempt < maxRetries) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '2', 10);
        const waitTime = Math.min(retryAfter * 1000, 5000) * attempt; // Exponential backoff, max 5s per retry
        console.log(`[OpenAI] Rate limited (429), waiting ${waitTime}ms before retry ${attempt + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      const error = await response.text();
      lastError = new Error(`OpenAI API error (${response.status}): ${error}`);

      // Don't retry non-429 errors
      if (response.status !== 429) {
        throw lastError;
      }
    }

    throw lastError || new Error('OpenAI API error: Max retries exceeded');
  }
}
