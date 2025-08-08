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

// Messaging specific types
export interface MessageData {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  signature?: string;
  roomId?: string; // For public room messages
  isPublic?: boolean; // Flag to distinguish public from private messages
  groupId?: string; // For group messages
  isGroup?: boolean; // Flag to distinguish group messages
}

export interface MessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface EncryptedMessage {
  data: string; // MessageData cifrato completo
  from: string;
  timestamp: number;
  id: string;
}

export interface PublicMessage {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  roomId: string;
  username?: string; // Optional username for display
}

// Token-based encrypted room types
export interface TokenRoomMessage {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  roomId: string;
  username?: string;
  encryptedContent: string; // Content encrypted with shared token
  signature?: string; // Digital signature for authenticity
}

export interface TokenRoomData {
  id: string;
  name: string;
  token: string; // Shared encryption token
  createdBy: string;
  createdAt: number;
  description?: string;
  maxParticipants?: number;
}

// Group types
export interface GroupMessage {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  groupId: string;
  username?: string;
  encryptedContent: string; // Contenuto cifrato con encryption key
  encryptedKeys: { [recipientPub: string]: string }; // Encryption keys cifrate per ogni membro
  signature?: string; // Firma digitale del messaggio
}

export interface GroupData {
  id: string;
  name: string;
  members: string[]; // Array di public keys
  createdBy: string;
  createdAt: number;
  encryptionKey: string; // Chiave di cifratura del gruppo
  encryptedKeys?: { [memberPub: string]: string }; // Encrypted copies of group key for each member
}

// Listener types
export interface TokenRoomMessageListener {
  (message: TokenRoomMessage): void;
}

export interface GroupMessageListener {
  (message: GroupMessage): void;
}

export interface MessageListener {
  (message: MessageData): void;
}

export interface PublicMessageListener {
  (message: PublicMessage): void;
}

/**
 * Interface for encrypted message data
 */
export interface EncryptedMessageLegacy {
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
