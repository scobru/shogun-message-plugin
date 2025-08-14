import { ShogunCore } from "shogun-core";
import {
  TokenRoomMessage,
  TokenRoomData,
  MessageResponse,
  TokenRoomMessageListener,
} from "./types";
import {
  generateMessageId,
  generateSecureToken,
  generateTokenRoomId,
  createSafePath,
} from "./utils";
import { EncryptionManager } from "./encryption";

/**
 * Configuration options to improve developer UX/observability without changing behavior
 */
export type TokenRoomStatusEvent = { type: string; [key: string]: any };
export interface TokenRoomManagerOptions {
  onStatus?: (event: TokenRoomStatusEvent) => void;
  messageTTLMs?: number;
  maxProcessedMessages?: number;
  enablePagination?: boolean;
  pageSize?: number;
}

/**
 * Enhanced token-based encrypted room management with clear flow control
 */
export class TokenRoomManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private tokenRoomListeners: TokenRoomMessageListener[] = [];

  // **FLOW CONTROL: Clear state management**
  private _isListeningTokenRooms = false;
  private _isInitialized = false;
  private _initializationPromise: Promise<void> | null = null;

  // **MESSAGE PROCESSING: Optimized deduplication**
  private processedMessageIds = new Map<string, number>();
  private processedMessageKeys = new Set<string>(); // roomId:messageId
  private sentMessageIds = new Set<string>(); // Track messages we just sent

  // **ROOM MANAGEMENT: Centralized state**
  private activeTokenRooms = new Map<string, string>(); // roomId -> token
  private roomMessageHandlers = new Map<string, any>(); // roomId -> gun.on chain
  private roomStates = new Map<
    string,
    {
      isJoined: boolean;
      lastMessageId?: string;
      messageCount: number;
      lastSync: number;
    }
  >();

  // **PERFORMANCE: Configurable limits**
  private readonly MAX_PROCESSED_MESSAGES: number;
  private readonly MESSAGE_TTL: number;
  private readonly ENABLE_PAGINATION: boolean;
  private readonly PAGE_SIZE: number;

  private options: TokenRoomManagerOptions;

  constructor(
    core: ShogunCore,
    encryptionManager: EncryptionManager,
    options: TokenRoomManagerOptions = {},
  ) {
    this.core = core;
    this.encryptionManager = encryptionManager;
    this.options = options || {};
    this.MAX_PROCESSED_MESSAGES = options.maxProcessedMessages || 1000;
    this.MESSAGE_TTL = options.messageTTLMs || 24 * 60 * 60 * 1000;
    this.ENABLE_PAGINATION = options.enablePagination !== false;
    this.PAGE_SIZE = options.pageSize || 50;
  }

  /**
   * **FLOW STEP 1: Initialize the manager**
   * Must be called before any other operations
   */
  public async initialize(): Promise<void> {
    if (this._isInitialized) {
      return;
    }

    if (this._initializationPromise) {
      return this._initializationPromise;
    }

    this._initializationPromise = this._performInitialization();
    return this._initializationPromise;
  }

  private async _performInitialization(): Promise<void> {
    try {
      this.emitStatus({ type: "manager:init:start" });

      // Clear any existing state
      this._resetState();

      // **FIX: Load active rooms from persistence**
      await this._loadActiveRoomsFromPersistence();

      console.log(
        "🔍 TokenRoomManager initialized - Loaded active rooms from persistence",
      );

      this._isInitialized = true;
      this.emitStatus({ type: "manager:init:complete" });
    } catch (error) {
      this.emitStatus({
        type: "manager:init:error",
        error: String(error),
      });
      throw error;
    } finally {
      this._initializationPromise = null;
    }
  }

  /**
   * Load active token rooms from user profile persistence
   */
  private async _loadActiveRoomsFromPersistence(): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.log(
        "🔍 _loadActiveRoomsFromPersistence: User not logged in, skipping",
      );
      return;
    }

    try {
      console.log(
        "🔍 _loadActiveRoomsFromPersistence: Loading active rooms from persistence",
      );

      // Get all token room references from user profile
      const userData = await this.core.db.getUserData("chats/token");
      if (!userData) {
        console.log(
          "🔍 _loadActiveRoomsFromPersistence: No token room data found",
        );
        return;
      }

      console.log(
        "🔍 _loadActiveRoomsFromPersistence: Found token room data:",
        userData,
      );

      // Load each room reference
      for (const [roomId, roomReference] of Object.entries(userData)) {
        if (
          roomReference &&
          typeof roomReference === "object" &&
          "type" in roomReference
        ) {
          const ref = roomReference as any;
          if (ref.type === "token" && ref.id && ref.name) {
            console.log("🔍 _loadActiveRoomsFromPersistence: Loading room:", {
              roomId,
              roomName: ref.name,
              joinedAt: ref.joinedAt,
            });

            // Get the room data to verify it exists and get the token
            const roomData = await this.getTokenRoomData(ref.id);
            if (roomData) {
              // Add to active rooms
              this.activeTokenRooms.set(ref.id, roomData.token);
              this.roomStates.set(ref.id, {
                messageCount: 0,
                lastMessageId: undefined,
                lastSync: Date.now(),
                isJoined: true,
              });
              console.log(
                "🔍 _loadActiveRoomsFromPersistence: Successfully loaded room:",
                ref.id,
              );
            } else {
              console.warn(
                "🔍 _loadActiveRoomsFromPersistence: Room data not found for:",
                ref.id,
              );
            }
          }
        }
      }

      console.log(
        "🔍 _loadActiveRoomsFromPersistence: Loaded",
        this.activeTokenRooms.size,
        "active rooms",
      );

      // **FIX: Automatically start listening to loaded rooms**
      if (this.activeTokenRooms.size > 0) {
        console.log(
          "🔍 _loadActiveRoomsFromPersistence: Starting listeners for loaded rooms",
        );
        await this.startListeningTokenRooms();
      }
    } catch (error) {
      console.error(
        "🔍 _loadActiveRoomsFromPersistence: Error loading active rooms:",
        error,
      );
    }
  }

  private _resetState(): void {
    this.processedMessageIds.clear();
    this.processedMessageKeys.clear();
    this.sentMessageIds.clear();
    this.roomMessageHandlers.clear();
    this.roomStates.clear();
    this._isListeningTokenRooms = false;
  }

  /**
   * **FLOW STEP 2: Join a token room**
   * This is the main entry point for room operations
   */
  public async joinTokenRoom(
    roomId: string,
    token: string,
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    // Ensure initialization
    await this.initialize();

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per unirti a una stanza.",
      };
    }

    if (!roomId || !token) {
      return {
        success: false,
        error: "ID stanza e token sono obbligatori.",
      };
    }

    try {
      this.emitStatus({ type: "room:join:start", roomId });

      // **STEP 1: Get room data**
      const roomData = await this.getTokenRoomData(roomId);
      if (!roomData) {
        return {
          success: false,
          error: "Stanza non trovata.",
        };
      }

      // **STEP 2: Verify token**
      if (roomData.token !== token) {
        return {
          success: false,
          error: "Token non valido per questa stanza.",
        };
      }

      // **STEP 3: Add to active rooms**
      this.activeTokenRooms.set(roomId, token);
      this.roomStates.set(roomId, {
        messageCount: 0,
        lastMessageId: undefined,
        lastSync: Date.now(),
        isJoined: true,
      });

      // **FIX: Automatically start listening to this room**
      await this._startListeningToRoom(roomId, token);

      // **STEP 4: Store room reference in user profile**
      await this._storeRoomReference(roomId, roomData.name);

      this.emitStatus({ type: "room:join:success", roomId });
      console.log("🔍 joinTokenRoom: Successfully joined room", roomId);
      return { success: true, roomData };
    } catch (error) {
      this.emitStatus({
        type: "room:join:error",
        roomId,
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  }

  /**
   * Store a reference to a token room in user's profile
   */
  private async _storeRoomReference(
    roomId: string,
    roomName: string,
  ): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return;
    }

    try {
      // Validate input data to prevent GunDB errors
      if (!roomId || !roomName) {
        console.warn("🔍 _storeRoomReference: Invalid room data, skipping save");
        return;
      }

      const roomReference = {
        type: "token",
        id: roomId || "",
        name: roomName || "Token Room",
        joinedAt: Date.now(),
      };

      // Validate all required fields are present
      if (!roomReference.id || !roomReference.name) {
        console.warn("🔍 _storeRoomReference: Missing required fields, skipping save");
        return;
      }

      console.log("🔍 _storeRoomReference: Storing room reference:", {
        roomId,
        roomName,
      });
      console.log(
        "🔍 _storeRoomReference: Room reference data:",
        roomReference,
      );

      await this.core.db.putUserData(`chats/token/${roomId}`, roomReference);
      console.log("🔍 _storeRoomReference: Room reference stored successfully");
    } catch (error) {
      console.error(
        "🔍 _storeRoomReference: Error storing room reference:",
        error,
      );
    }
  }

  /**
   * **FLOW STEP 3: Start listening to all active rooms**
   * This should be called after joining rooms
   */
  public async startListeningTokenRooms(): Promise<void> {
    // Ensure initialization
    await this.initialize();

    if (!this.core.isLoggedIn() || this._isListeningTokenRooms) {
      return;
    }

    this.emitStatus({ type: "listeners:start" });
    this._isListeningTokenRooms = true;

    // Start listening to all active rooms
    for (const [roomId, token] of this.activeTokenRooms) {
      try {
        await this._startListeningToRoom(roomId, token);
      } catch (error) {
        this.emitStatus({
          type: "listeners:room:error",
          roomId,
          error: String(error),
        });
      }
    }

    this.emitStatus({
      type: "listeners:ready",
      activeRooms: this.activeTokenRooms.size,
    });
  }

  /**
   * **FLOW STEP 4: Send a message**
   * Clear, ordered message sending process
   */
  public async sendTokenRoomMessage(
    roomId: string,
    messageContent: string,
    token: string,
  ): Promise<MessageResponse> {
    // Ensure initialization
    await this.initialize();

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare messaggi.",
      };
    }

    if (!roomId || !messageContent || !token) {
      return {
        success: false,
        error: "ID stanza, contenuto e token sono obbligatori.",
      };
    }

    try {
      this.emitStatus({ type: "message:send:start", roomId });

      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Chiavi utente non disponibili.",
        };
      }

      // **STEP 4.1: Generate message ID and prepare data**
      const messageId = generateMessageId();
      const timestamp = Date.now();
      const currentUserPub = currentUserPair.pub;

      // **STEP 4.2: Encrypt message content**
      const encryptedContent = await this.core.db.sea.encrypt(
        messageContent,
        token,
      );

      if (!encryptedContent) {
        return {
          success: false,
          error: "Errore nella cifratura del messaggio.",
        };
      }

      // **STEP 4.3: Create message data**
      const messageData = {
        content: encryptedContent,
        from: currentUserPub,
        timestamp,
        roomId,
        id: messageId,
      };

      // **STEP 4.4: Send to GunDB**
      const messagesPath = `tokenRoom_${roomId}_messages`;
      console.log(
        "🔍 sendTokenRoomMessage: Sending to GunDB path",
        messagesPath,
      );
      console.log("🔍 sendTokenRoomMessage: Message data", {
        messageId,
        roomId,
        contentLength: messageData.content.length,
        from: messageData.from,
        timestamp: messageData.timestamp,
      });
      console.log(
        "🔍 sendTokenRoomMessage: Active rooms for listening:",
        Array.from(this.activeTokenRooms.keys()),
      );
      console.log(
        "🔍 sendTokenRoomMessage: Is listening:",
        this._isListeningTokenRooms,
      );
      console.log(
        "🔍 sendTokenRoomMessage: Room message handlers count:",
        this.roomMessageHandlers.size,
      );
      console.log(
        "🔍 sendTokenRoomMessage: Has handler for this room:",
        this.roomMessageHandlers.has(roomId),
      );
      console.log(
        "🔍 sendTokenRoomMessage: Room state:",
        this.roomStates.get(roomId),
      );

      await this._sendToGunDB(messagesPath, messageId, messageData, "token");
      console.log("🔍 sendTokenRoomMessage: Successfully sent to GunDB", {
        path: messagesPath,
        messageId,
        timestamp: new Date().toISOString(),
      });

      // **STEP 4.5: Track sent message**
      this.sentMessageIds.add(messageId);
      setTimeout(() => {
        this.sentMessageIds.delete(messageId);
      }, 5000); // Remove after 5 seconds

      // **STEP 4.6: Update room state**
      const roomState = this.roomStates.get(roomId);
      if (roomState) {
        roomState.messageCount++;
        roomState.lastMessageId = messageId;
        roomState.lastSync = timestamp;
      }

      this.emitStatus({ type: "message:send:success", roomId, messageId });
      console.log("🔍 sendTokenRoomMessage: Message sent successfully", {
        roomId,
        messageId,
      });
      return { success: true, messageId };
    } catch (error) {
      this.emitStatus({
        type: "message:send:error",
        roomId,
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  }

  /**
   * **FLOW STEP 5: Get messages with pagination**
   * Optimized message retrieval
   */
  public async getTokenRoomMessages(
    roomId: string,
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {},
  ): Promise<TokenRoomMessage[]> {
    // Ensure initialization
    await this.initialize();

    if (!roomId) {
      return [];
    }

    try {
      this.emitStatus({ type: "messages:fetch:start", roomId });

      const limit = options.limit || this.PAGE_SIZE;
      const messagesPath = `tokenRoom_${roomId}_messages`;
      const messagesNode = this.core.db.gun.get(messagesPath);

      // **STEP 5.1: Get messages from GunDB**
      const messages = await this._fetchMessagesFromGunDB(
        messagesNode,
        limit,
        options,
      );

      // **STEP 5.2: Decrypt and process messages**
      const token = this.activeTokenRooms.get(roomId);
      if (!token) {
        this.emitStatus({
          type: "messages:fetch:error",
          roomId,
          error: "Token non disponibile",
        });
        return [];
      }

      const decryptedMessages = await this._decryptMessages(messages, token);

      // **STEP 5.3: Update room state**
      const roomState = this.roomStates.get(roomId);
      if (roomState) {
        roomState.messageCount = decryptedMessages.length;
        roomState.lastSync = Date.now();
      }

      this.emitStatus({
        type: "messages:fetch:success",
        roomId,
        count: decryptedMessages.length,
      });

      return decryptedMessages;
    } catch (error) {
      this.emitStatus({
        type: "messages:fetch:error",
        roomId,
        error: String(error),
      });
      return [];
    }
  }

  // **HELPER METHODS**

  private async _startListeningToRoom(
    roomId: string,
    token: string,
  ): Promise<void> {
    console.log("🔍 _startListeningToRoom: Starting for room", roomId);

    if (this.roomMessageHandlers.has(roomId)) {
      console.log(
        "🔍 _startListeningToRoom: Already listening to room",
        roomId,
      );
      return; // Already listening
    }

    const messagesPath = `tokenRoom_${roomId}_messages`;
    console.log("🔍 _startListeningToRoom: Using path", messagesPath);

    const roomMessagesNode = this.core.db.gun.get(messagesPath).map();
    console.log(
      "🔍 _startListeningToRoom: Created GunDB node for path",
      messagesPath,
    );

    console.log("🔍 _startListeningToRoom: Setting up GunDB on listener");
    const handler = roomMessagesNode.on(
      async (messageData: any, messageId: string) => {
        console.log("🔍 _startListeningToRoom: GunDB callback triggered", {
          roomId,
          messageId,
          hasMessageData: !!messageData,
          messageDataKeys: messageData ? Object.keys(messageData) : [],
          messageDataContent: messageData?.content ? "present" : "missing",
          messageDataFrom: messageData?.from ? "present" : "missing",
          messageDataRoomId: messageData?.roomId,
          timestamp: new Date().toISOString(),
        });

        if (!messageData) {
          console.log("🔍 _startListeningToRoom: No message data, skipping");
          return;
        }

        await this._processIncomingMessage(
          messageData,
          messageId,
          token,
          roomId,
        );
      },
    );
    console.log(
      "🔍 _startListeningToRoom: GunDB listener handler created",
      handler,
    );

    this.roomMessageHandlers.set(roomId, handler);
    console.log("🔍 _startListeningToRoom: Handler stored for room", roomId);
    console.log(
      "🔍 _startListeningToRoom: Total handlers stored:",
      this.roomMessageHandlers.size,
    );

    // **FIX: Set global listening flag when any room listener is started**
    this._isListeningTokenRooms = true;

    console.log(
      "🔍 _startListeningToRoom: Successfully set up listener for room",
      roomId,
    );
    console.log(
      "🔍 _startListeningToRoom: Global listening flag set to:",
      this._isListeningTokenRooms,
    );
    this.emitStatus({ type: "listeners:room:started", roomId });
  }

  private async _processIncomingMessage(
    messageData: any,
    messageId: string,
    token: string,
    roomId: string,
  ): Promise<void> {
    console.log("🔍 _processIncomingMessage: Starting processing", {
      messageId,
      roomId,
      hasContent: !!messageData?.content,
      hasFrom: !!messageData?.from,
      messageRoomId: messageData?.roomId,
    });

    // **VALIDATION**
    if (
      !messageData?.content ||
      !messageData?.from ||
      messageData?.roomId !== roomId
    ) {
      console.log("🔍 _processIncomingMessage: Validation failed", {
        hasContent: !!messageData?.content,
        hasFrom: !!messageData?.from,
        messageRoomId: messageData?.roomId,
        expectedRoomId: roomId,
        messageData: messageData,
      });
      return;
    }

    console.log(
      "🔍 _processIncomingMessage: Validation passed, processing message",
    );

    // **DUPLICATE DETECTION**
    const messageKey = `${roomId}:${messageId}`;
    if (this.processedMessageKeys.has(messageKey)) {
      console.log(
        "🔍 _processIncomingMessage: Duplicate message detected",
        messageKey,
      );
      return;
    }

    console.log("🔍 _processIncomingMessage: Not a duplicate, continuing");

    // **SELF-SENT DETECTION**
    if (this.sentMessageIds.has(messageId)) {
      console.log(
        "🔍 _processIncomingMessage: Self-sent message detected",
        messageId,
      );
      return;
    }

    console.log("🔍 _processIncomingMessage: Not self-sent, continuing");

    // **MARK AS PROCESSED**
    this.processedMessageKeys.add(messageKey);
    this.processedMessageIds.set(messageId, Date.now());
    console.log(
      "🔍 _processIncomingMessage: Message marked as processed",
      messageKey,
    );

    try {
      console.log("🔍 _processIncomingMessage: Attempting to decrypt message");
      // **DECRYPT MESSAGE**
      const decryptedContent = await this.core.db.sea.decrypt(
        messageData.content,
        token,
      );

      if (!decryptedContent) {
        console.log("🔍 _processIncomingMessage: Decryption failed");
        return;
      }

      console.log("🔍 _processIncomingMessage: Message decrypted successfully");

      // **CREATE MESSAGE OBJECT**
      const decryptedMessage: TokenRoomMessage = {
        id: messageId,
        from: messageData.from,
        roomId,
        timestamp: messageData.timestamp || Date.now(),
        content:
          typeof decryptedContent === "string"
            ? decryptedContent
            : JSON.stringify(decryptedContent),
      };

      console.log("🔍 _processIncomingMessage: Created decrypted message", {
        id: decryptedMessage.id,
        roomId: decryptedMessage.roomId,
        content: decryptedMessage.content.substring(0, 50) + "...",
        from: decryptedMessage.from,
        timestamp: new Date().toISOString(),
      });

      // **NOTIFY LISTENERS**
      console.log("🔍 _processIncomingMessage: Notifying listeners", {
        listenerCount: this.tokenRoomListeners.length,
        messageId: decryptedMessage.id,
        roomId: decryptedMessage.roomId,
        timestamp: new Date().toISOString(),
      });

      if (this.tokenRoomListeners.length === 0) {
        console.warn("🔍 _processIncomingMessage: No listeners registered!");
      }

      this.tokenRoomListeners.forEach((callback, index) => {
        try {
          console.log(
            `🔍 _processIncomingMessage: Calling listener ${index + 1}/${this.tokenRoomListeners.length}`,
          );
          callback(decryptedMessage);
          console.log(
            `🔍 _processIncomingMessage: Listener ${index + 1} completed successfully`,
          );
        } catch (error) {
          console.error("🔍 _processIncomingMessage: Listener error", error);
        }
      });

      // **UPDATE ROOM STATE**
      const roomState = this.roomStates.get(roomId);
      if (roomState) {
        roomState.messageCount++;
        roomState.lastMessageId = messageId;
        roomState.lastSync = Date.now();
      }

      this.emitStatus({ type: "message:received", roomId, messageId });
      console.log(
        "🔍 _processIncomingMessage: Processing completed successfully",
        {
          messageId,
          roomId,
          timestamp: new Date().toISOString(),
        },
      );
    } catch (error) {
      console.error("🔍 _processIncomingMessage: Processing error", {
        error: String(error),
        messageId,
        roomId,
        timestamp: new Date().toISOString(),
      });
      // Remove from processed if decryption failed
      this.processedMessageKeys.delete(messageKey);
      this.processedMessageIds.delete(messageId);
      this.emitStatus({
        type: "message:decrypt:error",
        roomId,
        messageId,
        error: String(error),
      });
    }
  }

  private async _fetchMessagesFromGunDB(
    messagesNode: any,
    limit: number,
    options: { before?: string; after?: string },
  ): Promise<any[]> {
    console.log("🔍 _fetchMessagesFromGunDB: Starting fetch", {
      limit,
      options,
    });

    return new Promise((resolve) => {
      const messages: any[] = [];
      let count = 0;

      messagesNode.map().once((messageData: any, messageId: string) => {
        console.log("🔍 _fetchMessagesFromGunDB: Processing message", {
          messageId,
          hasData: !!messageData,
        });

        if (count >= limit) {
          console.log("🔍 _fetchMessagesFromGunDB: Limit reached, stopping");
          return;
        }

        if (messageData && messageId) {
          console.log("🔍 _fetchMessagesFromGunDB: Adding message", {
            messageId,
            contentLength: messageData.content?.length,
          });
          messages.push({ ...messageData, id: messageId });
          count++;
        } else {
          console.log("🔍 _fetchMessagesFromGunDB: Skipping invalid message", {
            messageId,
            hasData: !!messageData,
          });
        }
      });

      // Resolve after a short delay to allow GunDB to process
      setTimeout(() => {
        console.log("🔍 _fetchMessagesFromGunDB: Resolving with", {
          count: messages.length,
          messages: messages.slice(0, 3),
        });
        resolve(messages);
      }, 100);
    });
  }

  private async _decryptMessages(
    messages: any[],
    token: string,
  ): Promise<TokenRoomMessage[]> {
    const decryptedMessages: TokenRoomMessage[] = [];

    for (const message of messages) {
      try {
        const decryptedContent = await this.core.db.sea.decrypt(
          message.content,
          token,
        );

        if (decryptedContent) {
          decryptedMessages.push({
            ...message,
            content:
              typeof decryptedContent === "string"
                ? decryptedContent
                : JSON.stringify(decryptedContent),
          });
        }
      } catch (error) {
        // Skip messages that can't be decrypted
      }
    }

    return decryptedMessages;
  }

  private _cleanDataForGunDB(data: any): any {
    // Handle null and undefined
    if (data === null || data === undefined) {
      return null;
    }

    // Handle primitive types
    if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
      return data;
    }

    // Handle objects
    if (typeof data === "object" && !Array.isArray(data)) {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(data)) {
        // Skip undefined values completely
        if (value !== undefined) {
          const cleanedValue = this._cleanDataForGunDB(value);
          // Only add if the cleaned value is not null/undefined
          if (cleanedValue !== null && cleanedValue !== undefined) {
            cleaned[key] = cleanedValue;
          }
        }
      }
      return cleaned;
    }

    // Handle arrays
    if (Array.isArray(data)) {
      const cleanedArray = data.map((item) => this._cleanDataForGunDB(item));
      // Filter out null/undefined values
      return cleanedArray.filter((item) => item !== null && item !== undefined);
    }

    return data;
  }

  private async _sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group" | "token",
  ): Promise<void> {
    console.log("🔍 _sendToGunDB: Sending message", {
      path,
      messageId,
      type,
      dataKeys: Object.keys(messageData),
      timestamp: new Date().toISOString(),
    });

    const messageNode = this.core.db.gun.get(path);

    // Clean the data to remove undefined values
    const cleanedData = this._cleanDataForGunDB(messageData);
    console.log("🔍 _sendToGunDB: Cleaned data", {
      messageId,
      cleanedKeys: Object.keys(cleanedData),
    });

    return new Promise<void>((resolve, reject) => {
      try {
        console.log("🔍 _sendToGunDB: Calling GunDB put method");
        messageNode.get(messageId).put(cleanedData, (ack: any) => {
          console.log("🔍 _sendToGunDB: GunDB put callback", { ack });
          if (ack.err) {
            console.error("🔍 _sendToGunDB: GunDB put error", ack.err);
            reject(new Error(ack.err));
          } else {
            console.log("🔍 _sendToGunDB: GunDB put successful");
            resolve();
          }
        });
      } catch (error) {
        console.error("🔍 _sendToGunDB: Exception during put", error);
        reject(error);
      }
    });
  }

  // **PUBLIC API METHODS**

  public async createTokenRoom(
    roomName: string,
    description?: string,
    maxParticipants?: number,
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    // Ensure initialization
    await this.initialize();

    console.log("🔍 createTokenRoom: Starting creation for:", roomName);

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.log("🔍 createTokenRoom: User not logged in");
      return {
        success: false,
        error: "Devi essere loggato per creare una stanza token.",
      };
    }

    if (!roomName || typeof roomName !== "string") {
      console.log("🔍 createTokenRoom: Invalid room name");
      return {
        success: false,
        error: "Nome stanza è obbligatorio.",
      };
    }

    try {
      this.emitStatus({ type: "room:create:start", roomName });
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        console.log("🔍 createTokenRoom: No user pair available");
        return {
          success: false,
          error: "Chiavi utente non disponibili.",
        };
      }

      const roomId = generateTokenRoomId();
      const token = generateSecureToken();
      const currentUserPub = currentUserPair.pub;
      const timestamp = Date.now();

      console.log("🔍 createTokenRoom: Generated room data:", {
        roomId,
        token,
        currentUserPub,
      });

      // Create room data with safe defaults
      const roomData: TokenRoomData = {
        id: roomId,
        name: roomName,
        token,
        createdBy: currentUserPub,
        createdAt: timestamp,
        ...(description && { description }), // Only include if provided
        ...(maxParticipants && { maxParticipants }), // Only include if provided
      };

      // Validate room data before saving to prevent GunDB errors
      const validatedRoomData = {
        id: roomData.id || "",
        name: roomData.name || "Token Room",
        token: roomData.token || "",
        createdBy: roomData.createdBy || "",
        createdAt: roomData.createdAt || Date.now(),
        ...(roomData.description && { description: roomData.description }),
        ...(roomData.maxParticipants && { maxParticipants: roomData.maxParticipants }),
      };

      // Ensure all required fields are present
      if (!validatedRoomData.id || !validatedRoomData.token || !validatedRoomData.createdBy) {
        console.warn("🔍 createTokenRoom: Missing required room data, cannot create room");
        return {
          success: false,
          error: "Dati della stanza incompleti.",
        };
      }

      console.log("🔍 createTokenRoom: Room data created:", validatedRoomData);

      // Store room data
      const roomPath = `tokenRoom_${roomId}`;
      console.log("🔍 createTokenRoom: Storing room data to path:", roomPath);
      await this._sendToGunDB(roomPath, "data", validatedRoomData, "token");

      // Add to active rooms
      console.log("🔍 createTokenRoom: Adding to active rooms");
      this.activeTokenRooms.set(roomId, token);
      this.roomStates.set(roomId, {
        isJoined: true,
        messageCount: 0,
        lastSync: timestamp,
      });

      console.log(
        "🔍 createTokenRoom: Final active rooms:",
        Array.from(this.activeTokenRooms.keys()),
      );

      this.emitStatus({ type: "room:create:success", roomId });
      return { success: true, roomData: validatedRoomData };
    } catch (error) {
      console.error("🔍 createTokenRoom: Error creating room:", error);
      this.emitStatus({
        type: "room:create:error",
        error: String(error),
      });
      return { success: false, error: String(error) };
    }
  }

  public async getTokenRoomData(roomId: string): Promise<TokenRoomData | null> {
    // Ensure initialization
    await this.initialize();

    if (!roomId) {
      return null;
    }

    try {
      const roomPath = `tokenRoom_${roomId}`;
      const roomNode = this.core.db.gun.get(roomPath);

      return new Promise((resolve) => {
        roomNode.get("data").once((roomData: any) => {
          if (roomData && roomData.id === roomId) {
            resolve(roomData as TokenRoomData);
          } else {
            resolve(null);
          }
        });
      });
    } catch (error) {
      return null;
    }
  }

  public stopListeningTokenRooms(): void {
    if (!this._isListeningTokenRooms) return;

    // Stop all room handlers
    this.roomMessageHandlers.forEach((handler, roomId) => {
      try {
        if (handler && typeof handler.off === "function") {
          handler.off();
        }
      } catch (error) {
        // Silent error handling
      }
    });

    this.roomMessageHandlers.clear();
    this._isListeningTokenRooms = false;
    this.emitStatus({ type: "listeners:stopped" });
  }

  public onTokenRoomMessage(callback: TokenRoomMessageListener): void {
    console.log(
      "🔍 TokenRoomManager: onTokenRoomMessage called, registering listener",
    );

    if (typeof callback !== "function") {
      console.warn(
        "🔍 TokenRoomManager: Invalid callback provided to onTokenRoomMessage",
      );
      return;
    }

    this.tokenRoomListeners.push(callback);
    console.log(
      "🔍 TokenRoomManager: Listener registered, total listeners:",
      this.tokenRoomListeners.length,
    );
  }

  public removeTokenRoomMessageListener(
    callback: TokenRoomMessageListener,
  ): void {
    const index = this.tokenRoomListeners.indexOf(callback);
    if (index > -1) {
      this.tokenRoomListeners.splice(index, 1);
    }
  }

  /**
   * Leave a token room and remove it from user profile
   */
  public async leaveTokenRoom(
    roomId: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!roomId) {
      return { success: false, error: "Room ID is required" };
    }

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return { success: false, error: "User not logged in" };
    }

    try {
      console.log("🔍 leaveTokenRoom: Leaving room:", roomId);

      // Stop listening to this room
      const handler = this.roomMessageHandlers.get(roomId);
      if (handler && typeof handler.off === "function") {
        handler.off();
        this.roomMessageHandlers.delete(roomId);
      }

      // Remove from active rooms
      this.activeTokenRooms.delete(roomId);
      this.roomStates.delete(roomId);

      console.log("🔍 leaveTokenRoom: Successfully left room:", roomId);
      return { success: true };
    } catch (error) {
      console.error("🔍 leaveTokenRoom: Error leaving room:", error);
      return { success: false, error: String(error) };
    }
  }

  // **STATUS AND UTILITY METHODS**

  public isListeningTokenRooms(): boolean {
    return this._isListeningTokenRooms;
  }

  /**
   * Check if any token room listeners are active
   */
  public hasActiveTokenRoomListeners(): boolean {
    return this.roomMessageHandlers.size > 0;
  }

  public getTokenRoomMessageListenersCount(): number {
    return this.tokenRoomListeners.length;
  }

  public getActiveTokenRoomsCount(): number {
    return this.activeTokenRooms.size;
  }

  public getActiveRooms(): string[] {
    const activeRooms = Array.from(this.activeTokenRooms.keys());
    console.log("🔍 getActiveRooms: Returning active rooms:", activeRooms);
    console.log(
      "🔍 getActiveRooms: Active rooms map size:",
      this.activeTokenRooms.size,
    );
    return activeRooms;
  }

  /**
   * Get token for a specific room (public access for external listeners)
   */
  public getRoomToken(roomId: string): string | undefined {
    return this.activeTokenRooms.get(roomId);
  }

  /**
   * Start listening to a specific room (public access for external listeners)
   */
  public async startListeningToRoom(
    roomId: string,
    token: string,
  ): Promise<void> {
    return this._startListeningToRoom(roomId, token);
  }

  public getRoomState(roomId: string) {
    return this.roomStates.get(roomId);
  }

  /**
   * Check if a specific room is being listened to
   */
  public isListeningToRoom(roomId: string): boolean {
    return this.roomMessageHandlers.has(roomId);
  }

  public getUxSnapshot(): {
    isInitialized: boolean;
    isListening: boolean;
    activeRooms: number;
    listeners: number;
    processedMessages: number;
  } {
    return {
      isInitialized: this._isInitialized,
      isListening: this._isListeningTokenRooms,
      activeRooms: this.activeTokenRooms.size,
      listeners: this.tokenRoomListeners.length,
      processedMessages: this.processedMessageIds.size,
    };
  }

  private emitStatus(event: { type: string; [key: string]: any }): void {
    try {
      if (this.options?.onStatus) {
        this.options.onStatus(event);
      }
    } catch (_) {
      // swallow status errors to avoid impacting core flow
    }
  }
}
