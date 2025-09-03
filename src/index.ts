// Export types from types.ts
export type {
  BaseEvent,
  BaseConfig,
  BaseCacheEntry,
  BaseBackupOptions,
  BaseImportOptions,
  EncryptedMessage,
  DecryptedMessage,
  MessageSendResult,
  Conversation,
  MessageEventType,
  MessageEvent,
  MessagingConfig,
  MessagingPluginInterface,
} from "./types";

// Username management now integrated in shogun-core - removed local implementation

// Export classes from specific files
export { MessagingPlugin } from "./messagingPlugin";
export { BasePlugin } from "./base";

// **NEW: Export schema for consistent path management**
export { MessagingSchema } from "./schema";

// **PRODUCTION: Export configuration and constants**
export type { PluginConfig } from "./config";
export {
  DEFAULT_CONFIG,
  DEV_CONFIG,
  PROD_CONFIG,
  TEST_CONFIG,
  getConfig,
  validateConfig,
  ERROR_CODES,
  LOG_LEVELS,
  PERFORMANCE_THRESHOLDS,
  SECURITY_CONSTANTS,
  NETWORK_CONSTANTS,
  STORAGE_CONSTANTS,
  HEALTH_CHECK_CONSTANTS,
} from "./config";

// **PRODUCTION: Export production-ready utilities**
// ProtocolAdapter removed - was unused

// Export MessageData type
export type { MessageData } from "./types";

// **NEW: Export legacy compatibility functions**
export type {
  LegacyMessageOptions,
  LegacyMessageResult,
  LegacyMessagesResult
} from "./types";

// **NEW: Export complete username management types**
export type {
  UsernameValidationResult,
  UsernameRegistrationResult,
} from "./types";
