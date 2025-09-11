import { PluginCategory, ShogunCore } from "shogun-core";


/**
 * Base class for Shogun plugins
 */
export abstract class BasePlugin {
  protected core: ShogunCore | null = null;
  protected initialized = false;
  protected metrics = {
    startTime: Date.now(),
    operations: 0,
    errors: 0,
    lastError: null as Error | null,
  };

  abstract name: string;
  abstract version: string;
  abstract description: string;
  // Use loose typing to avoid hard dependency on specific core type exports
  abstract _category?: PluginCategory;

  /**
   * Initialize the plugin with the core instance
   */
  initialize(core: ShogunCore): void {
    this.core = core;
    this.initialized = true;
    this.metrics.startTime = Date.now();
  }

  /**
   * Destroy the plugin and clean up resources
   */
  destroy(): void {
    this.core = null;
    this.initialized = false;
  }

  /**
   * Check if the plugin is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Assert that the plugin is initialized
   */
  protected assertInitialized(): void {
    if (!this.initialized) {
      throw new Error(`Plugin ${this.name} is not initialized`);
    }
  }

  /**
   * **PRODUCTION: Health check for the plugin**
   */
  public async healthCheck(): Promise<{
    isHealthy: boolean;
    issues: string[];
    uptime: number;
    metrics: any;
  }> {
    const issues: string[] = [];
    const uptime = Date.now() - this.metrics.startTime;

    // Check initialization
    if (!this.initialized) {
      issues.push("Plugin not initialized");
    }

    // Check core availability
    if (!this.core) {
      issues.push("Core instance not available");
    }

    // Check core health if available
    if (this.core) {
      try {
        if (!this.core.isLoggedIn()) {
          issues.push("User not logged in");
        }
      } catch (error) {
        issues.push(`Core health check failed: ${error}`);
      }
    }

    return {
      isHealthy: issues.length === 0,
      issues,
      uptime,
      metrics: this.metrics,
    };
  }

  /**
   * **PRODUCTION: Get plugin metrics**
   */
  public getMetrics(): any {
    return {
      ...this.metrics,
      uptime: Date.now() - this.metrics.startTime,
      errorRate: this.metrics.operations > 0 ? this.metrics.errors / this.metrics.operations : 0,
    };
  }

  /**
   * **PRODUCTION: Track operation for metrics**
   */
  protected trackOperation(): void {
    this.metrics.operations++;
  }

  /**
   * **PRODUCTION: Track error for metrics**
   */
  protected trackError(error: Error): void {
    this.metrics.errors++;
    this.metrics.lastError = error;
  }

  /**
   * **PRODUCTION: Safe operation wrapper with metrics**
   */
  protected async safeOperation<T>(
    operation: () => Promise<T>,
    operationName: string
  ): Promise<T> {
    this.trackOperation();
    
    try {
      return await operation();
    } catch (error) {
      this.trackError(error as Error);
      console.error(`[${this.name}] Error in ${operationName}:`, error);
      throw error;
    }
  }

  /**
   * **PRODUCTION: Retry operation with exponential backoff**
   */
  protected async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === maxRetries) {
          this.trackError(error as Error);
          throw error;
        }
        
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[${this.name}] Retry ${attempt + 1}/${maxRetries} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw new Error('Max retries exceeded');
  }
}


