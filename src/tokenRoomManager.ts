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
}

/**
 * Token-based encrypted room management functionality
 */
export class TokenRoomManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private tokenRoomListeners: TokenRoomMessageListener[] = [];
  private _isListeningTokenRooms = false;
  private processedTokenMessageIds = new Map<string, number>();
  private readonly MAX_PROCESSED_MESSAGES: number;
  private readonly MESSAGE_TTL: number; // default 24h
  private tokenRoomListener: any = null;
  private activeTokenRooms = new Map<string, string>(); // roomId -> token
  private options: TokenRoomManagerOptions;
  private roomMessageHandlers = new Map<string, any>(); // roomId -> gun.on chain

  constructor(
    core: ShogunCore,
    encryptionManager: EncryptionManager,
    options: TokenRoomManagerOptions = {}
  ) {
    this.core = core;
    this.encryptionManager = encryptionManager;
    this.options = options || {};
    this.MAX_PROCESSED_MESSAGES =
      typeof options.maxProcessedMessages === "number"
        ? options.maxProcessedMessages
        : 1000;
    this.MESSAGE_TTL =
      typeof options.messageTTLMs === "number"
        ? options.messageTTLMs
        : 24 * 60 * 60 * 1000;
  }

  /**
   * Emits non-intrusive status events for UI/telemetry consumers
   */
  private emitStatus(event: { type: string; [key: string]: any }): void {
    try {
      if (this.options?.onStatus) {
        this.options.onStatus(event);
      }
    } catch (_) {
      // swallow status errors to avoid impacting core flow
    }
  }

  /**
   * Creates a new token-based encrypted room
   */
  public async createTokenRoom(
    roomName: string,
    description?: string,
    maxParticipants?: number
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per creare una stanza token.",
      };
    }

    if (!roomName || typeof roomName !== "string") {
      return {
        success: false,
        error: "Nome stanza è obbligatorio.",
      };
    }

    try {
      this.emitStatus({ type: "room:create:start", roomName });
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const creatorPub = currentUserPair.pub;
      const roomId = generateTokenRoomId();
      const token = generateSecureToken();

      // Crea i dati della stanza
      const roomDataBase: TokenRoomData = {
        id: roomId,
        name: roomName,
        token,
        createdBy: creatorPub,
        createdAt: Date.now(),
      } as TokenRoomData;
      if (description !== undefined)
        (roomDataBase as any).description = description;
      if (maxParticipants !== undefined)
        (roomDataBase as any).maxParticipants = maxParticipants;
      const roomData: TokenRoomData = roomDataBase;

      // Salva la stanza nel database
      let saveAttempts = 0;
      const maxSaveAttempts = 3;

      while (saveAttempts < maxSaveAttempts) {
        try {
          this.emitStatus({
            type: "room:create:saveAttempt",
            attempt: saveAttempts + 1,
          });
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(
                new Error(
                  "Timeout saving room data (15s) - network may be slow"
                )
              );
            }, 15000);

            this.core.db.gun.get(roomId).put(roomData, (ack: any) => {
              clearTimeout(timeout);
              if (ack.err) {
                reject(new Error(`Error saving room: ${ack.err}`));
              } else {
                resolve();
              }
            });
          });

          break;
        } catch (error) {
          saveAttempts++;
          this.emitStatus({
            type: "room:create:saveRetry",
            attempt: saveAttempts,
            error: String(error),
          });
          console.warn(
            `[TokenRoomManager] ⚠️ Save attempt ${saveAttempts} failed:`,
            error
          );

          if (saveAttempts >= maxSaveAttempts) {
            throw new Error(
              `Failed to save room after ${maxSaveAttempts} attempts: ${error}`
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // Pubblica la stanza per il creatore
      const creatorNode = this.core.db.gun
        .get(`user_${creatorPub}`)
        .get("tokenRooms");
      await new Promise<void>((resolve) => {
        creatorNode.get(roomId).put(roomData, (_ack: any) => {
          resolve();
        });
      });

      this.emitStatus({ type: "room:create:success", roomId, roomName });
      console.log(
        `[TokenRoomManager] ✅ Token room created successfully: ${roomId}`
      );
      return { success: true, roomData };
    } catch (error: any) {
      this.emitStatus({
        type: "room:create:error",
        error: error?.message || String(error),
      });
      console.error(`[TokenRoomManager] ❌ Error creating token room:`, error);
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante la creazione della stanza token",
      };
    }
  }

  /**
   * Sends a message to a token-based encrypted room
   */
  public async sendTokenRoomMessage(
    roomId: string,
    messageContent: string,
    token: string
  ): Promise<MessageResponse> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio.",
      };
    }

    if (!roomId || !messageContent || !token) {
      return {
        success: false,
        error: "ID stanza, messaggio e token sono obbligatori.",
      };
    }

    try {
      this.emitStatus({ type: "message:send:start", roomId });
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const senderPub = currentUserPair.pub;
      const messageId = generateMessageId();
      const username =
        (this.core.db.user?.is?.alias as string) ||
        `User_${senderPub.slice(0, 8)}`;

      // Cifra il contenuto del messaggio con il token condiviso
      const encryptedContent = await this.core.db.sea.encrypt(
        messageContent,
        token
      );

      // Crea il messaggio della stanza token
      const tokenRoomMessage: TokenRoomMessage = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
        roomId,
        username,
        encryptedContent,
      };

      // Firma il messaggio per autenticità
      const signature = await this.core.db.sea.sign(
        messageContent,
        currentUserPair
      );
      tokenRoomMessage.signature = signature;

      // Invia il messaggio alla stanza
      await this.sendToGunDB(roomId, messageId, tokenRoomMessage, "token");

      this.emitStatus({ type: "message:send:success", roomId, messageId });
      // Assicura l'ascolto immediato della stanza in questa sessione
      try {
        this.activeTokenRooms.set(roomId, token);
        const currentUserPairRef = (this.core.db.user as any)?._?.sea;
        const currentUserPubRef = currentUserPairRef?.pub;
        if (currentUserPairRef && currentUserPubRef) {
          await this.startListeningToTokenRoom(
            roomId,
            token,
            currentUserPairRef,
            currentUserPubRef
          );
        }
      } catch (listenError) {
        console.warn(
          `[TokenRoomManager] ⚠️ Could not attach listener after send:`,
          listenError
        );
      }

      console.log(`[TokenRoomManager] ✅ Token room message sent successfully`);
      return { success: true, messageId };
    } catch (error: any) {
      this.emitStatus({
        type: "message:send:error",
        roomId,
        error: error?.message || String(error),
      });
      console.error(
        `[TokenRoomManager] ❌ Error sending token room message:`,
        error
      );
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante l'invio del messaggio",
      };
    }
  }

  /**
   * Retrieves token room data from GunDB
   */
  public async getTokenRoomData(roomId: string): Promise<TokenRoomData | null> {
    try {
      const roomData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting room data (15s)"));
        }, 15000);

        this.core.db.gun.get(roomId).once((data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      if (!roomData) {
        return null;
      }

      return {
        id: roomData.id || roomId,
        name: roomData.name,
        token: roomData.token,
        createdBy: roomData.createdBy,
        createdAt: roomData.createdAt,
        description: roomData.description,
        maxParticipants: roomData.maxParticipants,
      };
    } catch (error: any) {
      console.error(
        `[TokenRoomManager] ❌ Error getting token room data:`,
        error
      );
      return null;
    }
  }

  /**
   * Joins a token-based encrypted room
   */
  public async joinTokenRoom(
    roomId: string,
    token: string
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    const currentUser = this.core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    this.emitStatus({ type: "room:join:start", roomId });
    console.log(
      `[TokenRoomManager] 🔍 joinTokenRoom called for user ${currentUserPub.slice(0, 20)}... to room ${roomId}`
    );

    try {
      // Get room data
      const roomData = await this.getTokenRoomData(roomId);
      if (!roomData) {
        console.log(`[TokenRoomManager] ❌ Room not found: ${roomId}`);
        this.emitStatus({
          type: "room:join:error",
          roomId,
          error: "Room not found or invitation invalid",
        });
        return {
          success: false,
          error: "Room not found or invitation invalid",
        };
      }

      // Verify token
      if (roomData.token !== token) {
        console.log(`[TokenRoomManager] ❌ Invalid token for room: ${roomId}`);
        this.emitStatus({
          type: "room:join:error",
          roomId,
          error: "Invalid token for this room",
        });
        return {
          success: false,
          error: "Invalid token for this room",
        };
      }

      this.emitStatus({ type: "room:join:verified", roomId });
      console.log(`[TokenRoomManager] ✅ Token verified for room: ${roomId}`);

      // Publish the room under the user's public graph for listeners
      try {
        await new Promise<void>((resolve) => {
          this.core.db.gun
            .get(`user_${currentUserPub}`)
            .get("tokenRooms")
            .get(roomId)
            .put(roomData, (_ack: any) => resolve());
        });
      } catch (e) {
        console.warn(
          `[TokenRoomManager] ⚠️ Could not publish joined room to user graph:`,
          e
        );
      }

      // Store room reference in user profile
      console.log(
        `[TokenRoomManager] 💾 Storing room reference in user profile`
      );
      await this.storeRoomReferenceInUserProfile(
        currentUserPub,
        roomId,
        roomData.name
      );

      // Add a small delay to ensure GunDB sync
      console.log(`[TokenRoomManager] ⏳ Waiting for GunDB sync...`);
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Add to active rooms for this session
      this.activeTokenRooms.set(roomId, token);

      // Start listening to this room immediately for this session
      try {
        const currentUserPair = (this.core.db.user as any)._?.sea;
        if (currentUserPair) {
          await this.startListeningToTokenRoom(
            roomId,
            token,
            currentUserPair,
            currentUserPub
          );
        }
      } catch (e) {
        console.warn(
          `[TokenRoomManager] ⚠️ Could not start listening to joined room immediately:`,
          e
        );
      }

      this.emitStatus({ type: "room:join:success", roomId });
      console.log(
        `[TokenRoomManager] ✅ Successfully joined token room ${roomId}`
      );
      return { success: true, roomData };
    } catch (error) {
      this.emitStatus({
        type: "room:join:error",
        roomId,
        error: String(error),
      });
      console.error(`[TokenRoomManager] ❌ Error joining token room:`, error);
      return { success: false, error: `Failed to join token room: ${error}` };
    }
  }

  /**
   * Starts listening to token room messages
   */
  public startListeningTokenRooms(): void {
    if (
      !this.core.isLoggedIn() ||
      this._isListeningTokenRooms ||
      !this.core.db.user
    ) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(
        `[TokenRoomManager] Coppia di chiavi utente non disponibile`
      );
      return;
    }

    this._isListeningTokenRooms = true;
    const currentUserPub = currentUserPair.pub;

    this.emitStatus({ type: "room:listeners:start" });
    console.log(`[TokenRoomManager] 🔊 Starting token room listener`);

    // Listener per stanze token dell'utente
    const userTokenRoomsNode = this.core.db.gun
      .get(`user_${currentUserPub}`)
      .get("tokenRooms")
      .map();

    this.tokenRoomListener = userTokenRoomsNode.on(
      async (roomData: any, roomId: string) => {
        if (roomData && roomData.id && roomData.token) {
          await this.startListeningToTokenRoom(
            roomId,
            roomData.token,
            currentUserPair,
            currentUserPub
          );
        }
      }
    );

    // Also attach listeners to any rooms already active in this session
    if (this.activeTokenRooms.size > 0) {
      this.activeTokenRooms.forEach(async (tok, rid) => {
        try {
          await this.startListeningToTokenRoom(
            rid,
            tok,
            currentUserPair,
            currentUserPub
          );
        } catch (e) {
          console.warn(
            `[TokenRoomManager] ⚠️ Failed to attach listener to active room ${rid}:`,
            e
          );
        }
      });
    }

    this.emitStatus({
      type: "room:listeners:ready",
      activeRooms: this.activeTokenRooms.size,
    });
  }

  /**
   * Stops listening to token room messages
   */
  public stopListeningTokenRooms(): void {
    if (!this._isListeningTokenRooms) return;

    if (this.tokenRoomListener) {
      this.tokenRoomListener.off();
      this.tokenRoomListener = null;
    }

    this._isListeningTokenRooms = false;
    this.processedTokenMessageIds.clear();
    this.emitStatus({ type: "room:listeners:stopped" });
    console.log(`[TokenRoomManager] 🔇 Stopped token room listener`);
  }

  /**
   * Starts listening to a specific token room
   */
  private async startListeningToTokenRoom(
    roomId: string,
    token: string,
    currentUserPair: any,
    currentUserPub: string
  ): Promise<void> {
    console.log(`[TokenRoomManager] 🔊 Listening to token room: ${roomId}`);

    const roomMessagesNode = this.core.db.gun.get(roomId).map();

    const handler = roomMessagesNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingTokenMessage(
          messageData,
          messageId,
          token,
          currentUserPair,
          currentUserPub,
          roomId
        );
      }
    );
    this.roomMessageHandlers.set(roomId, handler);
  }

  /**
   * Processes incoming token room messages
   */
  private async processIncomingTokenMessage(
    messageData: any,
    messageId: string,
    token: string,
    currentUserPair: any,
    currentUserPub: string,
    roomId: string
  ): Promise<void> {
    // Validazione base
    if (
      !messageData?.encryptedContent ||
      !messageData?.from ||
      !messageData?.roomId ||
      messageData.roomId !== roomId
    ) {
      return;
    }

    // Controllo duplicati per ID
    if (this.processedTokenMessageIds.has(messageId)) {
      this.emitStatus({ type: "message:receive:duplicate", roomId, messageId });
      console.log(
        `[TokenRoomManager] 🔄 Duplicate token message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedTokenMessageIds.set(messageId, Date.now());

    try {
      // Decifra il contenuto del messaggio usando il token condiviso
      const decryptedContent = await this.core.db.sea.decrypt(
        messageData.encryptedContent,
        token
      );

      if (!decryptedContent) {
        this.emitStatus({
          type: "message:receive:decryptFailed",
          roomId,
          messageId,
        });
        console.error(
          `[TokenRoomManager] ❌ Could not decrypt message content`
        );
        return;
      }

      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.encryptionManager.verifyMessageSignature(
          decryptedContent,
          messageData.signature,
          messageData.from
        );
        if (!isValid) {
          console.warn(
            `[TokenRoomManager] ⚠️ Invalid signature for token message from: ${messageData.from.slice(0, 8)}...`
          );
        }
      }

      // Crea il messaggio decifrato
      const decryptedTokenMessage: TokenRoomMessage = {
        ...messageData,
        content: decryptedContent,
      };

      // Notifica i listener
      if (this.tokenRoomListeners.length > 0) {
        this.tokenRoomListeners.forEach((callback) => {
          try {
            callback(decryptedTokenMessage);
          } catch (error) {
            console.error(
              `[TokenRoomManager] ❌ Errore listener token room:`,
              error
            );
          }
        });
      } else {
        console.warn(
          `[TokenRoomManager] ⚠️ Nessun listener token room registrato per il messaggio`
        );
      }
      this.emitStatus({ type: "message:receive:success", roomId, messageId });
    } catch (error) {
      this.processedTokenMessageIds.delete(messageId);
      this.emitStatus({
        type: "message:receive:error",
        roomId,
        messageId,
        error: String(error),
      });
      console.error(
        `[TokenRoomManager] ❌ Errore processamento messaggio token room:`,
        error
      );
    }
  }

  /**
   * Enhanced cleanup for token messages
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    // Clean up token message IDs
    for (const [
      messageId,
      timestamp,
    ] of this.processedTokenMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedTokenMessageIds.delete(id));

    // Limit size of map
    if (this.processedTokenMessageIds.size > this.MAX_PROCESSED_MESSAGES) {
      const sortedEntries = Array.from(
        this.processedTokenMessageIds.entries()
      ).sort(([, a], [, b]) => a - b);

      const toRemove = sortedEntries.slice(
        0,
        this.processedTokenMessageIds.size - this.MAX_PROCESSED_MESSAGES
      );
      toRemove.forEach(([id]) => this.processedTokenMessageIds.delete(id));
    }
  }

  /**
   * Shared method to send messages to GunDB
   */
  private async sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group" | "token"
  ): Promise<void> {
    let safePath: string;

    if (type === "public") {
      safePath = `room_${path}`;
    } else if (type === "group") {
      safePath = path;
    } else if (type === "token") {
      safePath = path;
    } else {
      safePath = createSafePath(path);
    }

    const messageNode = this.core.db.gun.get(safePath);

    console.log(
      `[TokenRoomManager] 📡 Sending ${type} message to GunDB path: ${safePath}`
    );

    return new Promise<void>((resolve, reject) => {
      try {
        messageNode.get(messageId).put(messageData, (ack: any) => {
          if (ack.err) {
            console.error(
              `[TokenRoomManager] ❌ Errore invio messaggio ${type}:`,
              ack.err
            );
            reject(new Error(ack.err));
          } else {
            console.log(
              `[TokenRoomManager] ✅ ${type} message sent successfully to GunDB`
            );
            resolve();
          }
        });
      } catch (error) {
        console.error(
          `[TokenRoomManager] ❌ Errore durante put operation ${type}:`,
          error
        );
        reject(error);
      }
    });
  }

  /**
   * Stores a room reference in the user's profile for persistence
   */
  private async storeRoomReferenceInUserProfile(
    userPub: string,
    roomId: string,
    roomName?: string
  ): Promise<void> {
    try {
      console.log(`[TokenRoomManager] 💾 Storing room reference:`, {
        userPub: userPub.slice(0, 20) + "...",
        roomId,
        roomName,
        path: `chats/token/${roomId}`,
      });

      // Store room reference in user's profile
      const roomReference = {
        type: "token",
        id: roomId,
        name: roomName || `Token Room ${roomId.slice(0, 8)}...`,
        joinedAt: Date.now(),
      };

      console.log(
        `[TokenRoomManager] 💾 Room reference object:`,
        roomReference
      );

      await this.core.db.putUserData(`chats/token/${roomId}`, roomReference);

      console.log(
        `[TokenRoomManager] ✅ Stored token room reference for user ${userPub.slice(0, 20)}...`
      );

      // Verify the data was stored by reading it back
      try {
        const storedData = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Timeout verifying stored room reference (5s)`));
          }, 5000);

          this.core.db.gun
            .user()
            .get("chats")
            .get("token")
            .get(roomId)
            .once((data: any) => {
              clearTimeout(timeout);
              resolve(data);
            });
        });

        console.log(
          `[TokenRoomManager] 🔍 Verification - stored data:`,
          storedData
        );

        if (storedData && storedData.id === roomId) {
          console.log(
            `[TokenRoomManager] ✅ Room reference verified successfully`
          );
        } else {
          console.warn(
            `[TokenRoomManager] ⚠️ Room reference verification failed - data mismatch`
          );
        }
      } catch (verifyError) {
        console.warn(
          `[TokenRoomManager] ⚠️ Could not verify stored room reference:`,
          verifyError
        );
      }
    } catch (error) {
      console.warn(
        `[TokenRoomManager] ⚠️ Could not store room reference:`,
        error
      );
    }
  }

  /**
   * Registers a callback for token room messages
   */
  public onTokenRoomMessage(callback: TokenRoomMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.tokenRoomListeners.push(callback);
  }

  /**
   * Removes a specific token room message listener
   */
  public removeTokenRoomMessageListener(
    callback: TokenRoomMessageListener
  ): void {
    const index = this.tokenRoomListeners.indexOf(callback);
    if (index > -1) {
      this.tokenRoomListeners.splice(index, 1);
      console.log(`[TokenRoomManager] 🗑️ Removed token room message listener`);
    }
  }

  /**
   * Subscribe to token room messages and get an unsubscribe function
   */
  public subscribeTokenRoomMessages(
    callback: TokenRoomMessageListener
  ): () => void {
    this.onTokenRoomMessage(callback);
    return () => this.removeTokenRoomMessageListener(callback);
  }

  /**
   * Gets the current listening status
   */
  public isListeningTokenRooms(): boolean {
    return this._isListeningTokenRooms;
  }

  /**
   * Gets the number of token room message listeners
   */
  public getTokenRoomMessageListenersCount(): number {
    return this.tokenRoomListeners.length;
  }

  /**
   * Gets the number of processed token messages
   */
  public getProcessedTokenMessagesCount(): number {
    return this.processedTokenMessageIds.size;
  }

  /**
   * Gets the number of active token rooms
   */
  public getActiveTokenRoomsCount(): number {
    return this.activeTokenRooms.size;
  }

  /** Returns ids of active token rooms */
  public getActiveRooms(): string[] {
    return Array.from(this.activeTokenRooms.keys());
  }

  /** Update token for a specific room (e.g., rotation) */
  public updateTokenForRoom(roomId: string, token: string): void {
    if (!roomId || !token) return;
    this.activeTokenRooms.set(roomId, token);
    this.emitStatus({ type: "room:token:update", roomId });
  }

  /** Leave a token room: stop per-room listener and forget token */
  public leaveTokenRoom(roomId: string): void {
    try {
      const handler = this.roomMessageHandlers.get(roomId);
      if (handler && typeof handler.off === "function") {
        handler.off();
      }
    } catch {}
    this.roomMessageHandlers.delete(roomId);
    this.activeTokenRooms.delete(roomId);
    this.emitStatus({ type: "room:leave:success", roomId });
  }

  /**
   * Snapshot for UI/telemetry panels
   */
  public getUxSnapshot(): {
    isListening: boolean;
    activeRooms: number;
    listeners: number;
    processedMessages: number;
  } {
    return {
      isListening: this._isListeningTokenRooms,
      activeRooms: this.activeTokenRooms.size,
      listeners: this.tokenRoomListeners.length,
      processedMessages: this.processedTokenMessageIds.size,
    };
  }
}
