import { ShogunCore } from "shogun-core";

/**
 * Base class for Shogun plugins
 */
export abstract class BasePlugin {
  protected core: ShogunCore | null = null;
  protected initialized = false;

  abstract name: string;
  abstract version: string;
  abstract description: string;
  // Use loose typing to avoid hard dependency on specific core type exports
  abstract _category?: string;

  /**
   * Initialize the plugin with the core instance
   */
  initialize(core: ShogunCore): void {
    this.core = core;
    this.initialized = true;
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
}
