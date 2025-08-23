/**
 * Production Configuration for Shogun Message Plugin
 * This file contains all configuration constants and settings for production use
 */

export interface PluginConfig {
  // Performance settings
  maxMessageSize: number;
  maxRetryAttempts: number;
  retryBaseDelay: number;
  operationTimeout: number;
  encryptionTimeout: number;

  // Cache settings
  epubCacheTTL: number;
  maxCacheSize: number;

  // Storage settings
  maxMessagesPerConversation: number;
  localStorageCleanupInterval: number;

  // Network settings
  networkTimeout: number;
  maxConcurrentOperations: number;

  // Security settings
  enableSignatureVerification: boolean;
  enableInputValidation: boolean;

  // Monitoring settings
  enablePerformanceMonitoring: boolean;
  enableHealthChecks: boolean;
  healthCheckInterval: number;

  // Logging settings
  logLevel: "debug" | "info" | "warn" | "error";
  enableDetailedLogging: boolean;
}

/**
 * Default production configuration
 */
export const DEFAULT_CONFIG: PluginConfig = {
  // Performance settings
  maxMessageSize: 10000, // 10KB max message size
  maxRetryAttempts: 3,
  retryBaseDelay: 1000, // 1 second base delay
  operationTimeout: 10000, // 10 seconds
  encryptionTimeout: 5000, // 5 seconds

  // Cache settings
  epubCacheTTL: 300000, // 5 minutes
  maxCacheSize: 1000, // Max 1000 cached entries

  // Storage settings
  maxMessagesPerConversation: 1000, // Keep last 1000 messages
  localStorageCleanupInterval: 300000, // 5 minutes

  // Network settings
  networkTimeout: 5000, // 5 seconds
  maxConcurrentOperations: 10,

  // Security settings
  enableSignatureVerification: true,
  enableInputValidation: true,

  // Monitoring settings
  enablePerformanceMonitoring: true,
  enableHealthChecks: true,
  healthCheckInterval: 30000, // 30 seconds

  // Logging settings
  logLevel: "info",
  enableDetailedLogging: false,
};

/**
 * Development configuration (more verbose logging)
 */
export const DEV_CONFIG: PluginConfig = {
  ...DEFAULT_CONFIG,
  logLevel: "debug",
  enableDetailedLogging: true,
  maxRetryAttempts: 5,
  operationTimeout: 15000,
};

/**
 * Production configuration (optimized for performance)
 */
export const PROD_CONFIG: PluginConfig = {
  ...DEFAULT_CONFIG,
  logLevel: "warn",
  enableDetailedLogging: false,
  maxRetryAttempts: 2,
  operationTimeout: 8000,
  enablePerformanceMonitoring: true,
  enableHealthChecks: true,
};

/**
 * Test configuration (minimal timeouts for testing)
 */
export const TEST_CONFIG: PluginConfig = {
  ...DEFAULT_CONFIG,
  logLevel: "error",
  enableDetailedLogging: false,
  maxRetryAttempts: 1,
  retryBaseDelay: 100,
  operationTimeout: 1000,
  encryptionTimeout: 500,
  networkTimeout: 500,
  healthCheckInterval: 5000,
};

/**
 * Get configuration based on environment
 */
export function getConfig(): PluginConfig {
  const env = process.env.NODE_ENV || "development";

  switch (env) {
    case "production":
      return PROD_CONFIG;
    case "test":
      return TEST_CONFIG;
    case "development":
    default:
      return DEV_CONFIG;
  }
}

/**
 * Configuration validation
 */
export function validateConfig(config: PluginConfig): string[] {
  const errors: string[] = [];

  if (config.maxMessageSize <= 0) {
    errors.push("maxMessageSize must be positive");
  }

  if (config.maxRetryAttempts < 0) {
    errors.push("maxRetryAttempts must be non-negative");
  }

  if (config.retryBaseDelay <= 0) {
    errors.push("retryBaseDelay must be positive");
  }

  if (config.operationTimeout <= 0) {
    errors.push("operationTimeout must be positive");
  }

  if (config.encryptionTimeout <= 0) {
    errors.push("encryptionTimeout must be positive");
  }

  if (config.epubCacheTTL <= 0) {
    errors.push("epubCacheTTL must be positive");
  }

  if (config.maxCacheSize <= 0) {
    errors.push("maxCacheSize must be positive");
  }

  if (config.maxMessagesPerConversation <= 0) {
    errors.push("maxMessagesPerConversation must be positive");
  }

  if (config.networkTimeout <= 0) {
    errors.push("networkTimeout must be positive");
  }

  if (config.maxConcurrentOperations <= 0) {
    errors.push("maxConcurrentOperations must be positive");
  }

  if (config.healthCheckInterval <= 0) {
    errors.push("healthCheckInterval must be positive");
  }

  return errors;
}

/**
 * Error codes for production use
 */
export const ERROR_CODES = {
  NETWORK_TIMEOUT: "NETWORK_TIMEOUT",
  ENCRYPTION_FAILED: "ENCRYPTION_FAILED",
  MESSAGE_SEND_FAILED: "MESSAGE_SEND_FAILED",
  GROUP_CREATION_FAILED: "GROUP_CREATION_FAILED",
  AUTHENTICATION_FAILED: "AUTHENTICATION_FAILED",
  INPUT_VALIDATION_FAILED: "INPUT_VALIDATION_FAILED",
  OPERATION_TIMEOUT: "OPERATION_TIMEOUT",
  CACHE_FULL: "CACHE_FULL",
  STORAGE_FULL: "STORAGE_FULL",
  INVALID_PUBLIC_KEY: "INVALID_PUBLIC_KEY",
  MESSAGE_TOO_LARGE: "MESSAGE_TOO_LARGE",
  RATE_LIMIT_EXCEEDED: "RATE_LIMIT_EXCEEDED",
} as const;

/**
 * Log levels for production use
 */
export const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
} as const;

/**
 * Performance thresholds for monitoring
 */
export const PERFORMANCE_THRESHOLDS = {
  MAX_RESPONSE_TIME: 5000, // 5 seconds
  MAX_ENCRYPTION_TIME: 2000, // 2 seconds
  MAX_DECRYPTION_TIME: 2000, // 2 seconds
  MAX_MEMORY_USAGE: 50 * 1024 * 1024, // 50MB
  MAX_CACHE_SIZE: 1000,
  MAX_PROCESSED_MESSAGES: 10000,
} as const;

/**
 * Security constants
 */
export const SECURITY_CONSTANTS = {
  MIN_PUBLIC_KEY_LENGTH: 44,
  MAX_PUBLIC_KEY_LENGTH: 88,
  SIGNATURE_ALGORITHM: "SHA-256",
  ENCRYPTION_ALGORITHM: "AES-GCM",
  KEY_DERIVATION_ITERATIONS: 100000,
} as const;

/**
 * Network constants
 */
export const NETWORK_CONSTANTS = {
  MAX_RETRY_ATTEMPTS: 3,
  RETRY_BASE_DELAY: 1000,
  MAX_CONCURRENT_REQUESTS: 10,
  REQUEST_TIMEOUT: 5000,
  CONNECTION_TIMEOUT: 10000,
} as const;

/**
 * Storage constants
 */
export const STORAGE_CONSTANTS = {
  MAX_MESSAGES_PER_CONVERSATION: 1000,
  MAX_TOTAL_MESSAGES: 10000,
  CLEANUP_INTERVAL: 300000, // 5 minutes
  MESSAGE_TTL: 24 * 60 * 60 * 1000, // 24 hours
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes
} as const;

/**
 * Health check constants
 */
export const HEALTH_CHECK_CONSTANTS = {
  CHECK_INTERVAL: 30000, // 30 seconds
  TIMEOUT: 5000, // 5 seconds
  MAX_FAILURES: 3,
  RECOVERY_THRESHOLD: 2,
} as const;
