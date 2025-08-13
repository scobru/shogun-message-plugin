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
    options: TokenRoomManagerOptions = {}
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

      // No need to load rooms from user profile - UI handles persistence
      console.log(
        "🔍 TokenRoomManager initialized - UI handles room persistence"
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
    token: string
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    // Ensure initialization
    await this.initialize();

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per unirti a una stanza token.",
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

      // **STEP 2.1: Validate room exists**
      const roomData = await this.getTokenRoomData(roomId);
      if (!roomData) {
        return {
          success: false,
          error: "Stanza non trovata o token non valido.",
        };
      }

      // **STEP 2.2: Add to active rooms**
      this.activeTokenRooms.set(roomId, token);
      this.roomStates.set(roomId, {
        isJoined: true,
        messageCount: 0,
        lastSync: Date.now(),
      });

      // **STEP 2.3: Start listening if manager is active**
      if (this._isListeningTokenRooms) {
        await this._startListeningToRoom(roomId, token);
      }

      this.emitStatus({ type: "room:join:success", roomId });
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
    token: string
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
        token
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
        messagesPath
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
        Array.from(this.activeTokenRooms.keys())
      );
      console.log(
        "🔍 sendTokenRoomMessage: Is listening:",
        this._isListeningTokenRooms
      );

      await this._sendToGunDB(messagesPath, messageId, messageData, "token");
      console.log("🔍 sendTokenRoomMessage: Successfully sent to GunDB");

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
    } = {}
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
        options
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
    token: string
  ): Promise<void> {
    console.log("🔍 _startListeningToRoom: Starting for room", roomId);

    if (this.roomMessageHandlers.has(roomId)) {
      console.log(
        "🔍 _startListeningToRoom: Already listening to room",
        roomId
      );
      return; // Already listening
    }

    const messagesPath = `tokenRoom_${roomId}_messages`;
    console.log("🔍 _startListeningToRoom: Using path", messagesPath);

    const roomMessagesNode = this.core.db.gun.get(messagesPath).map();

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
        });
        await this._processIncomingMessage(
          messageData,
          messageId,
          token,
          roomId
        );
      }
    );

    this.roomMessageHandlers.set(roomId, handler);
    console.log(
      "🔍 _startListeningToRoom: Successfully set up listener for room",
      roomId
    );
    this.emitStatus({ type: "listeners:room:started", roomId });
  }

  private async _processIncomingMessage(
    messageData: any,
    messageId: string,
    token: string,
    roomId: string
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
      });
      return;
    }

    // **DUPLICATE DETECTION**
    const messageKey = `${roomId}:${messageId}`;
    if (this.processedMessageKeys.has(messageKey)) {
      console.log(
        "🔍 _processIncomingMessage: Duplicate message detected",
        messageKey
      );
      return;
    }

    // **SELF-SENT DETECTION**
    if (this.sentMessageIds.has(messageId)) {
      console.log(
        "🔍 _processIncomingMessage: Self-sent message detected",
        messageId
      );
      return;
    }

    // **MARK AS PROCESSED**
    this.processedMessageKeys.add(messageKey);
    this.processedMessageIds.set(messageId, Date.now());

    try {
      console.log("🔍 _processIncomingMessage: Attempting to decrypt message");
      // **DECRYPT MESSAGE**
      const decryptedContent = await this.core.db.sea.decrypt(
        messageData.content,
        token
      );

      if (!decryptedContent) {
        console.log("🔍 _processIncomingMessage: Decryption failed");
        return;
      }

      console.log("🔍 _processIncomingMessage: Message decrypted successfully");

      // **CREATE MESSAGE OBJECT**
      const decryptedMessage: TokenRoomMessage = {
        ...messageData,
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
      });

      // **NOTIFY LISTENERS**
      console.log("🔍 _processIncomingMessage: Notifying listeners", {
        listenerCount: this.tokenRoomListeners.length,
      });
      this.tokenRoomListeners.forEach((callback) => {
        try {
          callback(decryptedMessage);
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
        "🔍 _processIncomingMessage: Processing completed successfully"
      );
    } catch (error) {
      console.error("🔍 _processIncomingMessage: Processing error", error);
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
    options: { before?: string; after?: string }
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
    token: string
  ): Promise<TokenRoomMessage[]> {
    const decryptedMessages: TokenRoomMessage[] = [];

    for (const message of messages) {
      try {
        const decryptedContent = await this.core.db.sea.decrypt(
          message.content,
          token
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
    if (data === null || data === undefined) {
      return null;
    }

    if (typeof data === "object" && !Array.isArray(data)) {
      const cleaned: any = {};
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined) {
          cleaned[key] = this._cleanDataForGunDB(value);
        }
      }
      return cleaned;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this._cleanDataForGunDB(item));
    }

    return data;
  }

  private async _sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group" | "token"
  ): Promise<void> {
    const messageNode = this.core.db.gun.get(path);

    // Clean the data to remove undefined values
    const cleanedData = this._cleanDataForGunDB(messageData);

    return new Promise<void>((resolve, reject) => {
      try {
        messageNode.get(messageId).put(cleanedData, (ack: any) => {
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  // **PUBLIC API METHODS**

  public async createTokenRoom(
    roomName: string,
    description?: string,
    maxParticipants?: number
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

      console.log("🔍 createTokenRoom: Room data created:", roomData);

      // Store room data
      const roomPath = `tokenRoom_${roomId}`;
      console.log("🔍 createTokenRoom: Storing room data to path:", roomPath);
      await this._sendToGunDB(roomPath, "data", roomData, "token");

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
        Array.from(this.activeTokenRooms.keys())
      );

      this.emitStatus({ type: "room:create:success", roomId });
      return { success: true, roomData };
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
    if (typeof callback !== "function") {
      return;
    }
    this.tokenRoomListeners.push(callback);
  }

  public removeTokenRoomMessageListener(
    callback: TokenRoomMessageListener
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
    roomId: string
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
      this.activeTokenRooms.size
    );
    return activeRooms;
  }

  public getRoomState(roomId: string) {
    return this.roomStates.get(roomId);
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
