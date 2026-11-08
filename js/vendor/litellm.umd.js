/*! litellm-js v0.2.0 | MIT | https://github.com/lloydzhou/litellmjs */
(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports, require('cross-fetch')) :
  typeof define === 'function' && define.amd ? define(['exports', 'cross-fetch'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.litellm = {}, global.fetch));
})(this, (function (exports, fetch$1) { 'use strict';

  /**
   * @typedef {Object} LLMMessage
   * @property {string} role - The role of the message sender (system, user, assistant)
   * @property {string} content - The content of the message
   */

  /**
   * @typedef {Object} CompletionOptions
   * @property {string} model - The name of the model to use
   * @property {Array<LLMMessage>} messages - Array of messages to generate completions for
   * @property {number} [temperature=0.7] - Sampling temperature
   * @property {number} [max_tokens] - Maximum number of tokens to generate
   * @property {boolean} [stream=false] - Whether to stream the response
   * @property {Object} [additional_params] - Any additional provider-specific parameters
   */

  /**
   * @typedef {Object} LLMProvider
   * @property {string} name - Provider name
   * @property {string} baseUrl - Base URL for the provider's API
   * @property {Array<string>} models - List of supported models
   */

  /**
   * @typedef {Object} ProxyConfig
   * @property {string} name - The name of the proxy configuration
   * @property {Array<string>} models - List of models to route through this proxy
   * @property {string} url - The proxy URL
   * @property {Object} headers - Headers to include with requests to this proxy
   */

  const PROVIDER_TYPES = {
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    AZURE: 'azure',
    GOOGLE: 'google',
    COHERE: 'cohere',
    HUGGINGFACE: 'huggingface'
  };

  const MODEL_PREFIXES = {
    'gpt': PROVIDER_TYPES.OPENAI,
    'claude': PROVIDER_TYPES.ANTHROPIC,
    'azure': PROVIDER_TYPES.AZURE,
    'gemini': PROVIDER_TYPES.GOOGLE,
    'palm': PROVIDER_TYPES.GOOGLE,
    'command': PROVIDER_TYPES.COHERE
  };

  /**
   * Universal HTTP client for making requests to LLM APIs
   */
  class LiteLLMClient {
    /**
     * Make a request to an LLM API
     * 
     * @param {string} url - The API endpoint
     * @param {Object} options - Request options
     * @param {Object} options.headers - HTTP headers
     * @param {string} options.method - HTTP method (GET, POST, etc.)
     * @param {Object|null} options.body - Request body (for POST, PUT, etc.)
     * @param {AbortSignal|null} options.signal - AbortController signal
     * @returns {Promise<Object>} - The API response
     */
    async request(url, options = {}) {
      const { headers = {}, method = 'GET', body = null, signal = null, stream = false } = options;
      
      const requestOptions = {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers
        },
        signal
      };

      if (body) {
        requestOptions.body = JSON.stringify(body);
      }

      try {
        const response = await fetch$1(url, requestOptions);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new LiteLLMError(
            `API request failed with status ${response.status}`,
            response.status,
            errorData
          );
        }

        // If streaming is requested, return the raw response
        if (stream) {
          return response;
        }

        return await response.json();
      } catch (error) {
        if (error instanceof LiteLLMError) {
          throw error;
        }
        
        throw new LiteLLMError(
          `Request failed: ${error.message}`,
          500,
          { originalError: error }
        );
      }
    }
  }

  /**
   * Custom error class for LiteLLM errors
   */
  class LiteLLMError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'LiteLLMError';
      this.status = status;
      this.data = data;
    }
  }

  var client = new LiteLLMClient();

  /**
   * Base provider class for all LLM providers
   */
  class Provider {
    /**
     * Initialize a new provider
     * 
     * @param {Object} options - Provider options
     * @param {string} options.apiKey - API key for the provider
     * @param {string} [options.baseUrl] - Base URL for the provider's API
     * @param {Object} [options.defaultParams={}] - Default parameters for all requests
     */
    constructor(options = {}) {
      this.apiKey = options.apiKey;
      this.baseUrl = options.baseUrl || this.constructor.defaultBaseUrl;
      this.defaultParams = options.defaultParams || {};
    }

    /**
     * Generate a completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {Promise<Object>} - The completion response
     */
    async completion(options) {
      throw new Error('Not implemented');
    }

    /**
     * Generate a streaming completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {AsyncGenerator} - An async generator that yields completion chunks
     */
    async *streamCompletion(options) {
      throw new Error('Not implemented');
    }

    /**
     * Make a request to the provider's API
     * 
     * @param {string} path - API path
     * @param {Object} options - Request options
     * @returns {Promise<Object>} - The API response
     */
    async makeRequest(path, options = {}) {
      const url = `${this.baseUrl}${path}`;
      const headers = {
        ...this._getAuthHeaders(),
        ...options.headers
      };

      return await client.request(url, {
        ...options,
        headers
      });
    }

    /**
     * Get authentication headers for the provider
     * 
     * @returns {Object} - Authentication headers
     */
    _getAuthHeaders() {
      throw new Error('Not implemented');
    }

    /**
     * Transform messages to provider-specific format
     * 
     * @param {Array<LLMMessage>} messages - Messages to transform
     * @returns {Array<Object>} - Transformed messages
     */
    _transformMessages(messages) {
      return messages;
    }

    /**
     * Transform options to provider-specific format
     * 
     * @param {CompletionOptions} options - Options to transform
     * @returns {Object} - Transformed options
     */
    _transformOptions(options) {
      return {
        ...this.defaultParams,
        ...options,
        messages: this._transformMessages(options.messages)
      };
    }

    /**
     * Check if the provider supports the given model
     * 
     * @param {string} model - Model name to check
     * @returns {boolean} - True if the provider supports the model
     */
    supportsModel(model) {
      return false;
    }
  }

  class OpenAIProvider extends Provider {
    static defaultBaseUrl = 'https://api.openai.com/v1';
    static providerType = PROVIDER_TYPES.OPENAI;
    
    /**
     * Initialize a new OpenAI provider
     * 
     * @param {Object} options - Provider options
     * @param {string} options.apiKey - OpenAI API key
     * @param {string} [options.baseUrl] - Base URL for the OpenAI API
     * @param {Object} [options.defaultParams={}] - Default parameters for all requests
     */
    constructor(options = {}) {
      super(options);
    }

    /**
     * Generate a completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {Promise<Object>} - The completion response
     */
    async completion(options) {
      const transformedOptions = this._transformOptions(options);
      
      return await this.makeRequest('/chat/completions', {
        method: 'POST',
        body: transformedOptions
      });
    }

    /**
     * Generate a streaming completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {AsyncGenerator} - An async generator that yields completion chunks
     */
    async *streamCompletion(options) {
      const transformedOptions = this._transformOptions({
        ...options,
        stream: true
      });
      
      const response = await this.makeRequest('/chat/completions', {
        method: 'POST',
        body: transformedOptions,
        stream: true
      });

      // Handle streaming in a way that works in both Node.js and browser environments
      if (typeof response.body === 'object' && response.body !== null) {
        // Browser environment or Node.js with fetch that supports ReadableStream
        if (typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) {
                break;
              }
              
              const chunk = decoder.decode(value);
              yield* this._processChunk(chunk);
            }
          } finally {
            reader.releaseLock();
          }
        } 
        // Node.js environment with response.body as a Node.js Readable stream
        else if (typeof response.body.on === 'function') {
          for await (const chunk of response.body) {
            const strChunk = new TextDecoder('utf-8').decode(chunk);
            yield* this._processChunk(strChunk);
          }
        }
      } else if (typeof response.text === 'function') {
        // Fallback for environments where we can't directly access the stream
        const text = await response.text();
        yield* this._processChunk(text);
      }
    }

    /**
     * Process a text chunk from a stream
     * 
     * @private
     * @param {string} chunk - The text chunk to process
     * @returns {Array} - Array of parsed JSON objects from the chunk
     */
    *_processChunk(chunk) {
      const lines = chunk
        .split('\n')
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data: /, '').trim());
      
      for (const line of lines) {
        if (line === '[DONE]') {
          return;
        }
        
        try {
          if (line) {
            const parsed = JSON.parse(line);
            yield parsed;
          }
        } catch (e) {
          console.error('Error parsing SSE line:', line, e);
        }
      }
    }

    /**
     * Get authentication headers for OpenAI
     * 
     * @returns {Object} - OpenAI authentication headers
     */
    _getAuthHeaders() {
      return {
        'Authorization': `Bearer ${this.apiKey}`
      };
    }

    /**
     * Check if OpenAI supports the given model
     * 
     * @param {string} model - Model name to check
     * @returns {boolean} - True if OpenAI supports the model
     */
    supportsModel(model) {
      return model.startsWith('gpt-') || 
             model.startsWith('text-') ||
             model === 'dall-e-3';
    }
  }

  class AnthropicProvider extends Provider {
    static defaultBaseUrl = 'https://api.anthropic.com/v1';
    static providerType = PROVIDER_TYPES.ANTHROPIC;
    
    /**
     * Initialize a new Anthropic provider
     * 
     * @param {Object} options - Provider options
     * @param {string} options.apiKey - Anthropic API key
     * @param {string} [options.baseUrl] - Base URL for the Anthropic API
     * @param {Object} [options.defaultParams={}] - Default parameters for all requests
     */
    constructor(options = {}) {
      super(options);
      this.defaultVersion = options.version || '2023-06-01';
    }

    /**
     * Generate a completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {Promise<Object>} - The completion response
     */
    async completion(options) {
      const transformedOptions = this._transformOptions(options);
      
      const response = await this.makeRequest('/messages', {
        method: 'POST',
        body: transformedOptions
      });
      
      // Convert Anthropic response format to OpenAI format
      return this._convertResponseToOpenAIFormat(response, options);
    }

    /**
     * Generate a streaming completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {AsyncGenerator} - An async generator that yields completion chunks
     */
    async *streamCompletion(options) {
      const transformedOptions = this._transformOptions({
        ...options,
        stream: true
      });
      
      const response = await this.makeRequest('/messages', {
        method: 'POST',
        body: transformedOptions,
        stream: true
      });

      // Handle streaming in a way that works in both Node.js and browser environments
      if (typeof response.body === 'object' && response.body !== null) {
        // Browser environment or Node.js with fetch that supports ReadableStream
        if (typeof response.body.getReader === 'function') {
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          
          try {
            while (true) {
              const { done, value } = await reader.read();
              
              if (done) {
                break;
              }
              
              const chunk = decoder.decode(value);
              const processedChunks = this._processChunk(chunk);
              
              for (const processedChunk of processedChunks) {
                // Convert each Anthropic chunk to OpenAI format
                yield this._convertStreamChunkToOpenAIFormat(processedChunk, options);
              }
            }
          } finally {
            reader.releaseLock();
          }
        } 
        // Node.js environment with response.body as a Node.js Readable stream
        else if (typeof response.body.on === 'function') {
          for await (const chunk of response.body) {
            const strChunk = new TextDecoder('utf-8').decode(chunk);
            const processedChunks = this._processChunk(strChunk);
            
            for (const processedChunk of processedChunks) {
              // Convert each Anthropic chunk to OpenAI format
              yield this._convertStreamChunkToOpenAIFormat(processedChunk, options);
            }
          }
        }
      } else if (typeof response.text === 'function') {
        // Fallback for environments where we can't directly access the stream
        const text = await response.text();
        const processedChunks = this._processChunk(text);
        
        for (const processedChunk of processedChunks) {
          // Convert each Anthropic chunk to OpenAI format
          yield this._convertStreamChunkToOpenAIFormat(processedChunk, options);
        }
      }
    }

    /**
     * Process a text chunk from a stream
     * 
     * @private
     * @param {string} chunk - The text chunk to process
     * @returns {Array} - Array of parsed JSON objects from the chunk
     */
    _processChunk(chunk) {
      const result = [];
      const lines = chunk
        .split('\n')
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data: /, '').trim());
      
      for (const line of lines) {
        if (line === '[DONE]') {
          continue;
        }
        
        try {
          if (line) {
            const parsed = JSON.parse(line);
            result.push(parsed);
          }
        } catch (e) {
          console.error('Error parsing SSE line:', line, e);
        }
      }
      
      return result;
    }

    /**
     * Convert Anthropic stream chunk to OpenAI format
     * 
     * @private
     * @param {Object} chunk - Anthropic format chunk
     * @param {Object} options - Original request options
     * @returns {Object} - OpenAI format chunk
     */
    _convertStreamChunkToOpenAIFormat(chunk, options) {
      // Generate a unique ID if needed
      const id = `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
      
      // Default structure for OpenAI format
      const openAIFormat = {
        id: id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: options.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: null
          }
        ]
      };

      // Handle different Anthropic SSE event types
      if (chunk.type === 'content_block_start') {
        // Content block start doesn't contain actual content yet
        return openAIFormat;
      } 
      else if (chunk.type === 'content_block_delta') {
        if (chunk.delta.type === 'text_delta' && chunk.delta.text) {
          openAIFormat.choices[0].delta.content = chunk.delta.text;
        }
        // Handle tool calls in streaming mode
        else if (chunk.delta.type === 'tool_use') {
          // For tool_use, we need to convert to function_call format
          openAIFormat.choices[0].delta.function_call = {
            name: chunk.delta.name || '',
            arguments: chunk.delta.input ? JSON.stringify(chunk.delta.input) : ''
          };
          openAIFormat.choices[0].finish_reason = 'function_call';
        }
      } 
      else if (chunk.type === 'content_block_stop') {
        // End of a content block
        openAIFormat.choices[0].finish_reason = 'stop';
      }
      else if (chunk.type === 'message_stop') {
        // End of the entire message
        openAIFormat.choices[0].finish_reason = 'stop';
      }
      
      return openAIFormat;
    }

    /**
     * Convert complete Anthropic response to OpenAI format
     * 
     * @private
     * @param {Object} response - Anthropic format response
     * @param {Object} options - Original request options
     * @returns {Object} - OpenAI format response
     */
    _convertResponseToOpenAIFormat(response, options) {
      // Generate a unique ID if needed
      const id = `chatcmpl-${Date.now().toString(36)}${Math.random().toString(36).substr(2, 5)}`;
      
      // Extract content and handle different content types
      let content = null;
      let functionCall = null;
      
      if (response.content && Array.isArray(response.content)) {
        // Process different types of content blocks
        for (const block of response.content) {
          if (block.type === 'text') {
            content = block.text;
          } 
          else if (block.type === 'tool_use') {
            // Convert tool_use to function_call
            functionCall = {
              name: block.name,
              arguments: JSON.stringify(block.input)
            };
          }
        }
      }
      
      // Map Anthropic stop_reason to OpenAI finish_reason
      let finishReason = 'stop';
      if (response.stop_reason === 'tool_use') {
        finishReason = 'function_call';
      } else if (response.stop_reason === 'max_tokens') {
        finishReason = 'length';
      }
      
      // Build message object
      const message = {
        role: 'assistant',
        content: content
      };
      
      // Add function_call if present
      if (functionCall) {
        message.function_call = functionCall;
        message.content = null; // OpenAI sets content to null when there's a function call
      }
      
      // Create OpenAI-format response
      return {
        id: id,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: options.model,
        choices: [
          {
            index: 0,
            message: message,
            finish_reason: finishReason
          }
        ],
        usage: {
          prompt_tokens: response.usage?.input_tokens || 0,
          completion_tokens: response.usage?.output_tokens || 0,
          total_tokens: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        }
      };
    }

    /**
     * Get authentication headers for Anthropic
     * 
     * @returns {Object} - Anthropic authentication headers
     */
    _getAuthHeaders() {
      return {
        'X-API-Key': this.apiKey,
        'anthropic-version': this.defaultVersion
      };
    }

    /**
     * Transform messages to Anthropic-specific format
     * 
     * @param {Array<LLMMessage>} messages - Messages to transform
     * @returns {Array<Object>} - Transformed messages
     */
    _transformMessages(messages) {
      if (!messages || !Array.isArray(messages)) {
        return [];
      }
      const formattedMessages = [];
      
      for (const message of messages) {
        if (message.role === 'system') {
          message.content;
        } else if (message.role === 'user' || message.role === 'assistant') {
          formattedMessages.push({
            role: message.role,
            content: message.content
          });
          
          // Handle function calls from user (tool results)
          if (message.role === 'user' && message.function_call_result) {
            formattedMessages.push({
              role: 'tool',
              name: message.function_call_result.name,
              content: message.function_call_result.content
            });
          }
          
          // Handle function calls from assistant
          if (message.role === 'assistant' && message.function_call) {
            // Anthropic expects tool_use inside the content array
            formattedMessages.push({
              role: 'assistant',
              content: [{
                type: 'tool_use',
                name: message.function_call.name,
                input: JSON.parse(message.function_call.arguments)
              }]
            });
          }
        }
      }
      
      return formattedMessages;
    }

    /**
     * Transform options to Anthropic-specific format
     * 
     * @param {CompletionOptions} options - Options to transform
     * @returns {Object} - Transformed options for Anthropic
     */
    _transformOptions(options) {
      const messages = this._transformMessages(options.messages);
      
      const transformed = {
        ...this.defaultParams,
        model: options.model,
        messages: messages,
        stream: options.stream || false,
      };
      
      // Extract all system messages and combine them if there are multiple
      const systemMessages = options.messages?.filter(m => m.role === 'system') || [];
      if (systemMessages.length > 1) {
        // Multiple system messages, combine them into a single system message
        const combinedContent = systemMessages.map(m => m.content).join('\n');
        transformed.system = combinedContent;

        // Remove all system messages and add a single combined one
        options.messages = options.messages.filter(m => m.role !== 'system');
      }

      // Add completion parameters
      // max_tokens is required for Anthropic
      transformed.max_tokens = options.max_tokens || 2048;
      transformed.stop = options.stop || ['stop', 'max_tokens'];
      if (options.temperature !== undefined) {
        transformed.temperature = options.temperature;
      }

      if (options.tools || options.functions) {
        // Convert OpenAI functions/tools to Anthropic tools
        const tools = options.tools || 
          (options.functions ? [{ type: 'function', functions: options.functions }] : []);
          
        transformed.tools = tools.map(tool => {
          if (tool.type === 'function') {
            return {
              name: tool.function.name,
              description: tool.function.description,
              input_schema: tool.function.parameters
            };
          }
          return tool;
        });
      }

      if (options.additional_params) {
        Object.assign(transformed, options.additional_params);
      }

      return transformed;
    }

    /**
     * Check if Anthropic supports the given model
     * 
     * @param {string} model - Model name to check
     * @returns {boolean} - True if Anthropic supports the model
     */
    supportsModel(model) {
      return model.startsWith('claude-');
    }
  }

  /**
   * LiteLLM class for unified access to various LLM providers
   */
  class LiteLLM {
    /**
     * Initialize a new LiteLLM instance
     */
    constructor() {
      this.providers = {};
      this.proxies = [];
    }

    /**
     * Parse model string to extract provider and actual model name
     * Supports formats: "provider/model" and "model"
     * 
     * @param {string} modelString - The model string to parse
     * @returns {Object} - Object with provider and model properties
     */
    parseModelString(modelString) {
      if (!modelString || typeof modelString !== 'string') {
        return { provider: null, model: modelString };
      }

      const parts = modelString.split('/');
      if (parts.length === 2 && parts[0] && parts[1]) {
        return {
          provider: parts[0].toLowerCase(),
          model: parts[1]
        };
      }

      return {
        provider: null,
        model: modelString
      };
    }

    /**
     * Register a provider for use with LiteLLM
     * 
     * @param {string} type - Provider type (e.g., 'openai', 'anthropic')
     * @param {Object} options - Provider options
     * @returns {Provider} - The registered provider
     */
    registerProvider(type, options) {
      const providerType = type.toLowerCase();
      let provider;
      
      switch (providerType) {
        case PROVIDER_TYPES.OPENAI:
          provider = new OpenAIProvider(options);
          break;
        case PROVIDER_TYPES.ANTHROPIC:
          provider = new AnthropicProvider(options);
          break;
        // Add other providers here
        default:
          throw new LiteLLMError(`Unsupported provider type: ${type}`, 400);
      }
      
      this.providers[providerType] = provider;
      return provider;
    }

    /**
     * Register a proxy configuration
     * 
     * @param {ProxyConfig} proxyConfig - Proxy configuration
     */
    registerProxy(proxyConfig) {
      this.proxies.push(proxyConfig);
    }

    /**
     * Determine the provider type from a model name
     * 
     * @param {string} model - Model name
     * @returns {string|null} - Provider type or null if unknown
     */
    getProviderTypeForModel(model) {
      for (const [prefix, providerType] of Object.entries(MODEL_PREFIXES)) {
        if (model.startsWith(prefix)) {
          return providerType;
        }
      }
      return null;
    }

    /**
     * Get the appropriate proxy for a model
     * 
     * @param {string} modelString - Model string (can be "provider/model" or just "model")
     * @returns {Object|null} - Proxy provider and model name or null if not found
     */
    getProxyForModel(modelString) {
      const { provider, model } = this.parseModelString(modelString);
      
      // Check if any proxy handles this model
      for (const proxy of this.proxies) {
        if (proxy.models.includes(model) || 
            proxy.models.includes(modelString) || 
            proxy.models.includes('*')) {
          return { 
            provider: proxy.provider,
            actualModel: proxy.proxyModel || model
          };
        }
      }
      return null;
    }

    /**
     * Get the appropriate provider for a model
     * 
     * @param {string} modelString - Model string (can be "provider/model" or just "model")
     * @returns {Object} - Object with provider and actualModel properties
     */
    getProviderForModel(modelString) {
      const { provider: explicitProvider, model: actualModel } = this.parseModelString(modelString);
      
      // Check if there's a proxy for this model
      const proxyResult = this.getProxyForModel(modelString);
      if (proxyResult) {
        return proxyResult;
      }

      // If explicit provider is specified, try to use it
      if (explicitProvider && this.providers[explicitProvider]) {
        return { 
          provider: this.providers[explicitProvider],
          actualModel
        };
      }

      // Find provider by model prefix
      const providerType = this.getProviderTypeForModel(actualModel || modelString);
      if (providerType && this.providers[providerType]) {
        return {
          provider: this.providers[providerType],
          actualModel: actualModel || modelString
        };
      }

      // Check all providers to see if any explicitly support this model
      for (const [name, provider] of Object.entries(this.providers)) {
        if (provider.supportsModel && provider.supportsModel(actualModel || modelString)) {
          return {
            provider,
            actualModel: actualModel || modelString
          };
        }
      }

      return { provider: null, actualModel: actualModel || modelString };
    }

    /**
     * Generate a completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {Promise<Object>} - The completion response
     */
    async completion(options) {
      const { model: modelString } = options;
      const { provider, actualModel } = this.getProviderForModel(modelString);
      
      if (!provider) {
        throw new LiteLLMError(`No provider found for model: ${modelString}`, 400);
      }

      // Create a new options object with the actual model name
      const completionOptions = {
        ...options,
        model: actualModel
      };
      
      return await provider.completion(completionOptions);
    }

    /**
     * Generate a streaming completion for the given messages
     * 
     * @param {CompletionOptions} options - Completion options
     * @returns {AsyncGenerator} - An async generator that yields completion chunks
     */
    async *streamCompletion(options) {
      const { model: modelString } = options;
      const { provider, actualModel } = this.getProviderForModel(modelString);
      
      if (!provider) {
        throw new LiteLLMError(`No provider found for model: ${modelString}`, 400);
      }

      // Create a new options object with the actual model name
      const completionOptions = {
        ...options,
        model: actualModel
      };
      
      yield* provider.streamCompletion(completionOptions);
    }

    /**
     * Process a text chunk from a stream
     * 
     * @private
     * @param {string} chunk - The text chunk to process
     * @returns {Array} - Array of parsed JSON objects from the chunk
     */
    *_processChunk(chunk) {
      const lines = chunk
        .split('\n')
        .filter(line => line.trim().startsWith('data:'))
        .map(line => line.replace(/^data: /, '').trim());
      
      for (const line of lines) {
        if (line === '[DONE]') {
          return;
        }
        
        try {
          if (line) {
            const parsed = JSON.parse(line);
            yield parsed;
          }
        } catch (e) {
          console.error('Error parsing SSE line:', line, e);
        }
      }
    }

    /**
     * Create a proxy provider
     * 
     * @param {Object} options - Proxy options
     * @param {string} options.url - The proxy URL
     * @param {Object} options.headers - Headers to include with proxy requests
     * @param {Array<string>} options.models - List of models to route through this proxy
     * @param {string} options.name - The name of the proxy
     * @param {string} [options.proxyModel] - Optional model to use when making requests through the proxy
     * @returns {void}
     */
    createProxy(options) {
      const { url, headers = {}, models = ['*'], name, proxyModel = null } = options;
      const self = this;
      
      // Create a custom provider for this proxy
      const proxyProvider = {
        // Add properties to help identify this as a proxy provider
        isProxy: true, 
        proxyName: name,
        providerType: 'proxy',
        
        completion: async (completionOptions) => {
          // If proxyModel is specified, use it instead of the requested model
          const finalOptions = {
            ...completionOptions,
            model: proxyModel || completionOptions.model
          };

          const response = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            body: JSON.stringify(finalOptions)
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new LiteLLMError(
              `Proxy request failed with status ${response.status}`,
              response.status,
              errorData
            );
          }
          
          return await response.json();
        },
        
        streamCompletion: async function* (completionOptions) {
          // If proxyModel is specified, use it instead of the requested model
          const finalOptions = {
            ...completionOptions,
            model: proxyModel || completionOptions.model,
            stream: true
          };

          const response = await fetch(`${url}/chat/completions`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...headers
            },
            body: JSON.stringify(finalOptions)
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new LiteLLMError(
              `Proxy request failed with status ${response.status}`,
              response.status,
              errorData
            );
          }
          
          // Handle streaming in a way that works in both Node.js and browser environments
          if (typeof response.body === 'object' && response.body !== null) {
            // Browser environment or Node.js with fetch that supports ReadableStream
            if (typeof response.body.getReader === 'function') {
              const reader = response.body.getReader();
              const decoder = new TextDecoder('utf-8');
              
              try {
                while (true) {
                  const { done, value } = await reader.read();
                  
                  if (done) {
                    break;
                  }
                  
                  const chunk = decoder.decode(value);
                  yield* self._processChunk(chunk);
                }
              } finally {
                reader.releaseLock();
              }
            } 
            // Node.js environment with response.body as a Node.js Readable stream
            else if (typeof response.body.on === 'function') {
              for await (const chunk of response.body) {
                const strChunk = new TextDecoder('utf-8').decode(chunk);
                yield* self._processChunk(strChunk);
              }
            }
          } else if (typeof response.text === 'function') {
            // Fallback for environments where we can't directly access the stream
            const text = await response.text();
            yield* self._processChunk(text);
          }
        }
      };
      
      // Register this proxy
      this.registerProxy({
        name,
        models,
        url,
        headers,
        provider: proxyProvider,
        proxyModel // Store the proxyModel with the proxy configuration
      });

      console.log(`Proxy '${name}' registered for models: ${models.join(', ')}${proxyModel ? ` (using proxyModel: ${proxyModel})` : ''}`);
    }
  }

  // Create and export a singleton instance
  const liteLLM = new LiteLLM();

  exports.LiteLLM = LiteLLM;
  exports.default = liteLLM;

  Object.defineProperty(exports, '__esModule', { value: true });

}));
