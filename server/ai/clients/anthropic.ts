/**
 * Anthropic (Claude) Client
 * Handles API requests to Anthropic's messages API
 */

import type { AIClient, AIRequestConfig, AIResponse } from '../types';

export class AnthropicClient implements AIClient {
  private apiKey: string;
  private baseURL: string;

  constructor(apiKey: string, baseURL = 'https://api.anthropic.com/v1') {
    this.apiKey = apiKey;
    this.baseURL = baseURL;
  }

  async complete(request: AIRequestConfig): Promise<AIResponse> {
    // Anthropic requires system messages to be separate
    const systemMessages = request.messages.filter(m => m.role === 'system');
    const conversationMessages = request.messages.filter(m => m.role !== 'system');

    const systemPrompt = systemMessages.map(m => m.content).join('\n\n') ||
                        request.systemPrompt ||
                        undefined;

    const response = await fetch(`${this.baseURL}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: request.model,
        messages: conversationMessages.map(m => ({
          role: m.role,
          content: m.content,
        })),
        system: systemPrompt,
        temperature: request.temperature ?? 0.7,
        max_tokens: request.maxTokens ?? 1024,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Anthropic API error (${response.status}): ${error}`);
    }

    const data = await response.json();

    return {
      content: data.content[0]?.text ?? '',
      finishReason: data.stop_reason,
      usage: {
        promptTokens: data.usage?.input_tokens ?? 0,
        completionTokens: data.usage?.output_tokens ?? 0,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
    };
  }
}
