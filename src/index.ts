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

// Export classes from specific files
export { MessagingPlugin } from "./messagingPlugin";
export { BasePlugin } from "./base";
