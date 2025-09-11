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
export { BasePlugin } from "./base";
export { LindaLib } from "./lib";

// **NEW: Export schema for consistent path management**
export { MessagingSchema } from "./schema";



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
  UsernameSearchResult,
  UsernameUpdateResult,
  UserDataRegistrationResult,
} from "./types";
