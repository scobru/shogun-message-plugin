export interface BaseEvent {
  type: string;
  data?: any;
  timestamp: number;
}

export interface BaseConfig {
  enabled?: boolean;
  maxRetries?: number;
  retryDelay?: number;
}

export interface BaseCacheEntry<T> {
  value: T;
  timestamp: number;
  ttl?: number;
}

export interface BaseBackupOptions {
  includeMetadata?: boolean;
  compress?: boolean;
}

export interface BaseImportOptions {
  validateData?: boolean;
  overwrite?: boolean;
}

/**
 * Interface for encrypted message data
 */
export interface EncryptedMessage {
  content: string;
  timestamp: number;
  id: string;
  from?: string;
  to?: string;
}

/**
 * Interface for decrypted message data
 */
export interface DecryptedMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
  id: string;
}

/**
 * Interface for message sending result
 */
export interface MessageSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Interface for conversation data
 */
export interface Conversation {
  participantPub: string;
  lastMessage?: DecryptedMessage;
  unreadCount: number;
  lastActivity: number;
}

/**
 * Message event types
 */
export enum MessageEventType {
  MESSAGE_RECEIVED = "messageReceived",
  MESSAGE_SENT = "messageSent",
  CONVERSATION_UPDATED = "conversationUpdated",
  ERROR = "error",
}

/**
 * Message event interface
 */
export interface MessageEvent extends BaseEvent {
  type: MessageEventType;
  message?: DecryptedMessage;
  conversation?: Conversation;
}

/**
 * Messaging plugin configuration
 */
export interface MessagingConfig extends BaseConfig {
  autoListen?: boolean;
  messageRetentionDays?: number;
  maxMessageLength?: number;
  enableNotifications?: boolean;
}

/**
 * Interface for the messaging plugin - ESSENTIAL ONLY
 */
export interface MessagingPluginInterface {
  /**
   * Send an encrypted message to another user
   * @param recipientPub The recipient's public key
   * @param messageContent The message content to send
   * @returns Promise with the send result
   */
  sendMessage(
    recipientPub: string,
    messageContent: string
  ): Promise<MessageSendResult>;

  /**
   * Register a callback function to be called when a new message is received
   * @param callback The function to call with the decrypted message
   */
  onMessage(callback: (message: DecryptedMessage) => void): void;

  /**
   * Start listening for new messages
   */
  startListening(): void;

  /**
   * Stop listening for new messages
   */
  stopListening(): void;

  /**
   * Check if the user is currently listening for messages
   * @returns True if listening is active
   */
  isListening(): boolean;

  /**
   * Get the current messaging configuration
   * @returns The current configuration
   */
  getConfig(): MessagingConfig;

  /**
   * Update the messaging configuration
   * @param config The new configuration
   */
  updateConfig(config: Partial<MessagingConfig>): void;

  // Optional: Basic conversation management
  getConversations(): Promise<Conversation[]>;
  getMessageHistory(
    participantPub: string,
    limit?: number
  ): Promise<DecryptedMessage[]>;

  // Certificate management
  createCertificate(recipientPub: string): Promise<any>;
  removeCertificate(recipientPub: string): void;
  getActiveCertificates(): string[];
  hasCertificate(recipientPub: string): boolean;
}
