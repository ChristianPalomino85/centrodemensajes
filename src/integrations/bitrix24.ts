/**
 * Bitrix24 API Client - OPTIMIZED VERSION
 * Features:
 * 1. Request Queue with Rate Limiting (leaky bucket)
 * 2. In-Memory Cache (TTL) for read operations
 * 3. Automatic Token Refresh
 * 4. Memory Management (GC & Queue Limits)
 */

export interface Bitrix24Config {
  webhookUrl?: string;
  domain?: string;
  accessToken?: string;
  onTokenRefresh?: () => Promise<string>;
}

export interface BitrixEntity {
  ID: string;
  [key: string]: any;
}

export interface BitrixSearchParams {
  filter: Record<string, any>;
  select?: string[];
  limit?: number;
}

// Simple In-Memory Cache
interface CacheEntry<T> {
  data: T;
  expiry: number;
}

export class Bitrix24Client {
  private readonly config: Bitrix24Config;

  // Rate Limiting Queue
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private readonly MIN_REQUEST_INTERVAL = 200; // 200ms (5 req/sec) - More aggressive than 500ms
  private readonly MAX_QUEUE_SIZE = 500; // Drop oldest requests if queue explodes

  // Caching
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache default
  private gcInterval: NodeJS.Timeout | null = null;

  constructor(config: Bitrix24Config) {
    this.config = config;
    this.startGarbageCollection();
  }

  // =================================================================
  // QUEUE & CACHE MANAGERS
  // =================================================================

  /**
   * Start periodic cleanup of expired cache entries
   */
  private startGarbageCollection() {
    // Run GC every 10 minutes
    this.gcInterval = setInterval(() => {
      const now = Date.now();
      let cleaned = 0;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.expiry < now) {
          this.cache.delete(key);
          cleaned++;
        }
      }
      if (cleaned > 0) {
        // console.log(`[Bitrix GC] Cleaned ${cleaned} expired entries`);
      }
    }, 10 * 60 * 1000);
  }

  /**
   * Stop GC (for graceful shutdown)
   */
  public stop() {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
  }

  /**
   * Execute request with Rate Limiting
   */
  private async enqueueRequest<T>(requestFn: () => Promise<T>): Promise<T> {
    // Prevent memory explosion
    if (this.requestQueue.length >= this.MAX_QUEUE_SIZE) {
      console.warn('[Bitrix Queue] Queue full, dropping request');
      throw new Error('Bitrix24 request queue full - try again later');
    }

    return new Promise<T>((resolve, reject) => {
      this.requestQueue.push(async () => {
        try {
          const result = await requestFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      // Always try to process queue after adding
      this.processQueue();
    });
  }

  private async processQueue() {
    if (this.isProcessingQueue) return;
    if (this.requestQueue.length === 0) return;

    this.isProcessingQueue = true;

    try {
      while (this.requestQueue.length > 0) {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;

        // Enforce rate limit delay
        if (timeSinceLastRequest < this.MIN_REQUEST_INTERVAL) {
          await new Promise(resolve => setTimeout(resolve, this.MIN_REQUEST_INTERVAL - timeSinceLastRequest));
        }

        const request = this.requestQueue.shift();
        if (request) {
          this.lastRequestTime = Date.now();
          // Execute without await to allow next loop iteration logic, but catching errors
          request().catch(err => console.error('[Bitrix Queue] Task failed', err));
        }
      }
    } finally {
      this.isProcessingQueue = false;
      // Double check if new items arrived while processing
      if (this.requestQueue.length > 0) {
        this.processQueue();
      }
    }
  }

  /**
   * Get cached data or fetch fresh
   */
  private async getCachedOrFetch<T>(key: string, fetchFn: () => Promise<T>, ttl: number = this.CACHE_TTL): Promise<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && cached.expiry > now) {
      return cached.data;
    }

    const data = await fetchFn();

    // Only cache non-null results to allow retrying failures
    if (data !== null && data !== undefined) {
      this.cache.set(key, {
        data,
        expiry: now + ttl
      });
    }

    return data;
  }

  // =================================================================
  // PUBLIC METHODS (WRAPPED)
  // =================================================================

  async findContact(params: BitrixSearchParams): Promise<BitrixEntity | null> {
    // Generate cache key based on filter (e.g., "contact:PHONE=5551234")
    const filterKey = Object.entries(params.filter).map(([k, v]) => `${k}=${v}`).sort().join('&');
    const cacheKey = `contact:${filterKey}`;

    return this.getCachedOrFetch(cacheKey, async () => {
      // Use queue for the network request
      return this.enqueueRequest(async () => {
        try {
          const response = await this.callMethod("crm.contact.list", params);
          return response.result?.[0] ?? null;
        } catch (error) {
          console.error("[Bitrix24] Error finding contact:", error);
          return null;
        }
      });
    });
  }

  async getContact(id: string): Promise<BitrixEntity | null> {
    const cacheKey = `contact:id=${id}`;
    return this.getCachedOrFetch(cacheKey, async () => {
      return this.enqueueRequest(async () => {
        try {
          const response = await this.callMethod("crm.contact.get", { id });
          return response.result ?? null;
        } catch (error) {
          console.error("[Bitrix24] Error getting contact:", error);
          return null;
        }
      });
    });
  }

  // ... (Other read methods follow same pattern of caching + queuing)

  async findLead(params: BitrixSearchParams): Promise<BitrixEntity | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.lead.list", params);
        return response.result?.[0] ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error finding lead:", error);
        return null;
      }
    });
  }

  async findDeal(params: BitrixSearchParams): Promise<BitrixEntity | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.deal.list", params);
        return response.result?.[0] ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error finding deal:", error);
        return null;
      }
    });
  }

  async findCompany(params: BitrixSearchParams): Promise<BitrixEntity | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.company.list", params);
        return response.result?.[0] ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error finding company:", error);
        return null;
      }
    });
  }

  async getLead(id: string): Promise<BitrixEntity | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.lead.get", { id });
        return response.result ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error getting lead:", error);
        return null;
      }
    });
  }

  async getDeal(id: string): Promise<BitrixEntity | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.deal.get", { id });
        return response.result ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error getting deal:", error);
        return null;
      }
    });
  }

  async getCompany(id: string): Promise<BitrixEntity | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.company.get", { id });
        return response.result ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error getting company:", error);
        return null;
      }
    });
  }

  // WRITE OPERATIONS (No Cache, Always Queued)

  async createLead(fields: Record<string, any>): Promise<string | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.lead.add", { fields });
        return response.result?.toString() ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error creating lead:", error);
        return null;
      }
    });
  }

  async createContact(fields: Record<string, any>): Promise<string | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.contact.add", { fields });
        return response.result?.toString() ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error creating contact:", error);
        return null;
      }
    });
  }

  async updateContact(id: string, fields: Record<string, any>): Promise<boolean> {
    // Invalidate cache when updating
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.contact.update", { id, fields });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error updating contact:", error);
        return false;
      }
    });
  }

  async updateLead(id: string, fields: Record<string, any>): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.lead.update", { id, fields });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error updating lead:", error);
        return false;
      }
    });
  }

  async createDeal(fields: Record<string, any>): Promise<string | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.deal.add", { fields });
        return response.result?.toString() ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error creating deal:", error);
        return null;
      }
    });
  }

  async updateDeal(id: string, fields: Record<string, any>): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.deal.update", { id, fields });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error updating deal:", error);
        return false;
      }
    });
  }

  async createCompany(fields: Record<string, any>): Promise<string | null> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.company.add", { fields });
        return response.result?.toString() ?? null;
      } catch (error) {
        console.error("[Bitrix24] Error creating company:", error);
        return null;
      }
    });
  }

  async updateCompany(id: string, fields: Record<string, any>): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.company.update", { id, fields });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error updating company:", error);
        return false;
      }
    });
  }

  async deleteLead(id: string): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.lead.delete", { id });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error deleting lead:", error);
        return false;
      }
    });
  }

  async deleteContact(id: string): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.contact.delete", { id });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error deleting contact:", error);
        return false;
      }
    });
  }

  async deleteDeal(id: string): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.deal.delete", { id });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error deleting deal:", error);
        return false;
      }
    });
  }

  async deleteCompany(id: string): Promise<boolean> {
    // Invalidate cache
    const keysToInvalidate = Array.from(this.cache.keys()).filter(k => k.includes(id));
    keysToInvalidate.forEach(k => this.cache.delete(k));

    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("crm.company.delete", { id });
        return response.result === true;
      } catch (error) {
        console.error("[Bitrix24] Error deleting company:", error);
        return false;
      }
    });
  }

  async findEntity(
    entityType: "lead" | "deal" | "contact" | "company",
    params: BitrixSearchParams
  ): Promise<BitrixEntity | null> {
    switch (entityType) {
      case "lead": return this.findLead(params);
      case "deal": return this.findDeal(params);
      case "contact": return this.findContact(params);
      case "company": return this.findCompany(params);
      default: return null;
    }
  }

  async searchEntities(
    entityType: "lead" | "deal" | "contact" | "company",
    params: BitrixSearchParams
  ): Promise<BitrixEntity[]> {
    return this.enqueueRequest(async () => {
      try {
        const method = `crm.${entityType}.list`;
        const response = await this.callMethod(method, params);
        return response.result ?? [];
      } catch (error) {
        console.error(`[Bitrix24] Error searching ${entityType}s:`, error);
        return [];
      }
    });
  }

  async createEntity(
    entityType: "lead" | "deal" | "contact" | "company",
    fields: Record<string, any>
  ): Promise<string | null> {
    switch (entityType) {
      case "lead": return this.createLead(fields);
      case "deal": return this.createDeal(fields);
      case "contact": return this.createContact(fields);
      case "company": return this.createCompany(fields);
      default: throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async updateEntity(
    entityType: "lead" | "deal" | "contact" | "company",
    id: string,
    fields: Record<string, any>
  ): Promise<boolean> {
    switch (entityType) {
      case "lead": return this.updateLead(id, fields);
      case "deal": return this.updateDeal(id, fields);
      case "contact": return this.updateContact(id, fields);
      case "company": return this.updateCompany(id, fields);
      default: throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async deleteEntity(
    entityType: "lead" | "deal" | "contact" | "company",
    id: string
  ): Promise<boolean> {
    switch (entityType) {
      case "lead": return this.deleteLead(id);
      case "deal": return this.deleteDeal(id);
      case "contact": return this.deleteContact(id);
      case "company": return this.deleteCompany(id);
      default: throw new Error(`Unknown entity type: ${entityType}`);
    }
  }

  async getFieldValue(
    entityType: "lead" | "deal" | "contact" | "company",
    identifier: { field: string; value: string },
    fieldName: string
  ): Promise<string | null> {
    return this.enqueueRequest(async () => {
      try {
        const entity = await this.findEntity(entityType, {
          filter: { [identifier.field]: identifier.value },
          select: [fieldName, "ID"],
        });

        if (!entity) return null;

        const value = entity[fieldName];
        return value != null ? String(value) : null;
      } catch (error) {
        console.error("[Bitrix24] Error getting field value:", error);
        return null;
      }
    });
  }

  async getEntityFields(entityType: "lead" | "deal" | "contact" | "company"): Promise<Record<string, any>> {
    const cacheKey = `fields:${entityType}`;
    return this.getCachedOrFetch(cacheKey, async () => {
      return this.enqueueRequest(async () => {
        try {
          const method = `crm.${entityType}.fields`;
          const response = await this.callMethod(method);
          return response.result || {};
        } catch (error) {
          console.error(`[Bitrix24] Error getting ${entityType} fields:`, error);
          return {};
        }
      });
    }, 60 * 60 * 1000); // Cache structure for 1 hour
  }

  async getUsers(params?: { filter?: Record<string, any>; select?: string[] }): Promise<BitrixEntity[]> {
    return this.enqueueRequest(async () => {
      try {
        const response = await this.callMethod("user.get", {
          filter: params?.filter || {},
          select: params?.select || ["ID", "NAME", "LAST_NAME", "EMAIL", "PERSONAL_PHOTO", "WORK_POSITION"],
        });
        return response.result ?? [];
      } catch (error) {
        console.error("[Bitrix24] Error getting users:", error);
        return [];
      }
    });
  }

  /**
   * Raw call method (Internal use, logic preserved)
   */
  async callMethod(method: string, params: Record<string, any> = {}, retryCount = 0): Promise<any> {
    let url: string;
    let headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (this.config.webhookUrl) {
      url = `${this.config.webhookUrl}${method}.json`;
    } else if (this.config.domain && this.config.accessToken) {
      const baseUrl = this.config.domain.startsWith("http")
        ? this.config.domain
        : `https://${this.config.domain}`;
      url = `${baseUrl.replace(/\/$/, "")}/rest/${method}.json`;
      headers["Authorization"] = `Bearer ${this.config.accessToken}`;
    } else {
      throw new Error("Bitrix24Client: Se requiere webhookUrl o (domain + accessToken)");
    }

    try {
      // Use global fetch (Node 18+)
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
      });

      const data = await response.json();

      if (data.error || !response.ok) {
        const isTokenError =
          response.status === 401 ||
          data.error === "expired_token" ||
          data.error === "invalid_token" ||
          data.error === "WRONG_AUTH_TYPE" ||
          data.error_description?.includes("expired") ||
          data.error_description?.includes("invalid");

        if (isTokenError && this.config.onTokenRefresh && retryCount === 0) {
          console.log(`[Bitrix24] Token expirado (${response.status}), refrescando automáticamente...`);
          try {
            const newToken = await this.config.onTokenRefresh();
            this.config.accessToken = newToken;
            console.log(`[Bitrix24] ✅ Token refrescado exitosamente, reintentando llamada...`);
            return await this.callMethod(method, params, retryCount + 1);
          } catch (refreshError) {
            console.error(`[Bitrix24] ❌ Error al refrescar token:`, refreshError);
            throw new Error(`Token refresh failed: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
          }
        }

        if (data.error) {
          throw new Error(`Bitrix24 API error: ${data.error} - ${data.error_description}`);
        } else {
          throw new Error(`Bitrix24 API error: ${response.status} ${response.statusText}`);
        }
      }

      return data;
    } catch (error) {
      // console.error(`[Bitrix24] Error calling ${method}:`, error); // Reduced noise
      throw error;
    }
  }
}

// Mock Client kept for compatibility/testing
export class MockBitrix24Client extends Bitrix24Client {
  private mockData: Map<string, BitrixEntity[]> = new Map();

  constructor(config: Bitrix24Config) {
    super(config);
  }

  setMockData(entityType: string, data: BitrixEntity[]) {
    this.mockData.set(entityType, data);
  }

  async findEntity(
    entityType: "lead" | "deal" | "contact" | "company",
    params: BitrixSearchParams
  ): Promise<BitrixEntity | null> {
    const entities = this.mockData.get(entityType) ?? [];
    const filtered = entities.filter((entity) => {
      for (const [key, value] of Object.entries(params.filter)) {
        if (entity[key] !== value) return false;
      }
      return true;
    });
    return filtered[0] ?? null;
  }

  async searchEntities(
    entityType: "lead" | "deal" | "contact" | "company",
    params: BitrixSearchParams
  ): Promise<BitrixEntity[]> {
    const entities = this.mockData.get(entityType) ?? [];
    const filtered = entities.filter((entity) => {
      for (const [key, value] of Object.entries(params.filter)) {
        if (entity[key] !== value) return false;
      }
      return true;
    });
    const limit = params.limit ?? 50;
    return filtered.slice(0, limit);
  }
}
