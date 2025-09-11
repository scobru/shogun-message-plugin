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
  isEncrypted?: boolean; // Flag to indicate if the message was encrypted
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

export interface PublicRoomData {
  id: string;
  name: string;
  description?: string;
  createdBy: string;
  createdAt: number;
  memberCount?: number;
  messageCount?: number;
  lastMessage?: string | PublicMessage;
  lastMessageTime?: number;
  isActive?: boolean;
}

// Group types
export interface GroupMessage {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  groupId: string;
  username?: string;
  signature?: string; // Digital signature of the message
}

export interface GroupData {
  id: string;
  name: string;
  members: string[]; // Array di public keys
  createdBy: string;
  createdAt: number;
  admins?: string[]; // Array of admin public keys
  lastActivity?: number; // Last activity timestamp
  encryptedKeys: { [memberPub: string]: string }; // Encrypted copies of group key for each member
  keysSignature?: string; // Signature by creator over encryptedKeys for integrity
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

  // **NEW: Username management methods**
  registerUsername(username: string): Promise<UsernameRegistrationResult>;
  registerUserData(username: string, userEpub: string, userPub: string): Promise<UserDataRegistrationResult>;
  updateUsername(newUsername: string): Promise<UsernameUpdateResult>;
  searchUser(username: string): Promise<UsernameSearchResult>;
  isUsernameAvailable(username: string, excludeUserPub?: string): Promise<boolean>;
  getUsername(userPub: string): Promise<string | null>;
  getRecipientEpub(recipientPub: string): Promise<string | null>;
}

// MessageProcessor specific types - Simplified
export interface UserPair {
  pub: string;
  epub: string;
  alias?: string;
  [key: string]: unknown;
}

// Essential types for MessageProcessor
export interface MessageDataRaw {
  from?: string;
  data?: string; // encrypted data
  content?: string;
  timestamp?: number;
  id?: string;
  _deleted?: boolean;
  [key: string]: unknown;
}

export interface MessageDataWithId {
  messageId: string;
  messageData: MessageDataRaw;
}

export interface ConversationPathData {
  [messageId: string]: MessageDataRaw | null;
}

export interface DebugPathItem {
  id: string;
  data: MessageDataRaw | null;
  hasFrom: boolean;
  hasContent: boolean;
  hasData: boolean;
  hasTimestamp: boolean;
  fromValue?: string;
  contentPreview?: string;
}

export interface ClearMessageResult {
  success: boolean;
  error?: string;
  clearedCount?: number;
}

export interface VerifyConversationResult {
  success: boolean;
  remainingMessages: number;
  error?: string;
}

export interface DebugGunDBResult {
  recipientPath?: {
    path: string;
    data: DebugPathItem[];
  };
  currentUserPath?: {
    path: string;
    data: DebugPathItem[];
  };
  error?: string;
}

// **NEW: Legacy compatibility types**
export interface LegacyMessageOptions {
  messageType?: "alias" | "epub" | "token";
  senderAlias?: string;
  recipientAlias?: string;
}

export interface LegacyMessageResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export interface LegacyMessagesResult {
  success: boolean;
  messages?: any[];
  error?: string;
}

// **NEW: Username management types**
export interface UsernameValidationResult {
  isValid: boolean;
  error?: string;
}

export interface UsernameRegistrationResult {
  success: boolean;
  error?: string;
  username?: string;
}

// **NEW: Username management method results**
export interface UsernameSearchResult {
  success: boolean;
  userPub?: string;
  error?: string;
}

export interface UsernameUpdateResult {
  success: boolean;
  error?: string;
}

export interface UserDataRegistrationResult {
  success: boolean;
  error?: string;
}