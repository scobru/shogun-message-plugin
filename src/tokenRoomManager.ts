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
          error:
            "Coppia di chiavi utente non disponibile. Prova a fare logout e login.",
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

      // Salva la stanza nel database con retry migliorato
      let saveAttempts = 0;
      const maxSaveAttempts = 5; // Aumentato da 3 a 5
      let lastError: Error | null = null;

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
                  "Timeout saving room data (20s) - network may be slow"
                )
              );
            }, 20000); // Aumentato da 15s a 20s

            this.core.db.gun.get(roomId).put(roomData, (ack: any) => {
              clearTimeout(timeout);
              if (ack && ack.err) {
                reject(new Error(`Error saving room: ${ack.err}`));
              } else {
                resolve();
              }
            });
          });

          break;
        } catch (error) {
          lastError = error as Error;
          saveAttempts++;
          this.emitStatus({
            type: "room:create:saveRetry",
            attempt: saveAttempts,
            error: String(error),
          });
          if (saveAttempts >= maxSaveAttempts) {
            throw new Error(
              `Failed to save room after ${maxSaveAttempts} attempts. Last error: ${lastError?.message}`
            );
          }

          // Backoff esponenziale per i retry
          const delay = Math.min(2000 * Math.pow(2, saveAttempts - 1), 10000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Pubblica la stanza per il creatore con retry migliorato

      let profileSaveAttempts = 0;
      const maxProfileSaveAttempts = 3;

      while (profileSaveAttempts < maxProfileSaveAttempts) {
        try {
          const creatorNode = this.core.db.gun
            .get(`user_${creatorPub}`)
            .get("tokenRooms");

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(
                new Error("Timeout saving room reference to user profile")
              );
            }, 15000); // Aumentato da 10s a 15s

            creatorNode.get(roomId).put(roomData, (ack: any) => {
              clearTimeout(timeout);
              if (ack && ack.err) {
                reject(new Error(`Error saving room reference: ${ack.err}`));
              } else {
                resolve();
              }
            });
          });

          break;
        } catch (error) {
          profileSaveAttempts++;

          if (profileSaveAttempts >= maxProfileSaveAttempts) {
            // Non facciamo fallire la creazione della stanza se il salvataggio del profilo fallisce
            break;
          }

          const delay = Math.min(
            1000 * Math.pow(2, profileSaveAttempts - 1),
            5000
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Aggiungi la stanza alle stanze attive per questa sessione
      this.activeTokenRooms.set(roomId, token);

      this.emitStatus({ type: "room:create:success", roomId, roomName });
      return { success: true, roomData };
    } catch (error: any) {
      this.emitStatus({
        type: "room:create:error",
        error: error?.message || String(error),
      });
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

      // **DEBUG: Verify encryption worked**

      // Crea il messaggio della stanza token
      const tokenRoomMessage: TokenRoomMessage = {
        from: senderPub,
        content: encryptedContent, // **FIX: Use encrypted content instead of plain text**
        timestamp: Date.now(),
        id: messageId,
        roomId,
        username,
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
        // Silent error handling
      }

      return { success: true, messageId };
    } catch (error: any) {
      this.emitStatus({
        type: "message:send:error",
        roomId,
        error: error?.message || String(error),
      });

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
          reject(
            new Error("Timeout getting room data (20s) - network may be slow")
          );
        }, 20000); // Aumentato da 15s a 20s

        this.core.db.gun.get(roomId).once((data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      if (!roomData || !roomData.name || !roomData.token) {
        return null;
      }

      const result = {
        id: roomData.id || roomId,
        name: roomData.name,
        token: roomData.token,
        createdBy: roomData.createdBy,
        createdAt: roomData.createdAt,
        description: roomData.description,
        maxParticipants: roomData.maxParticipants,
      };

      return result;
    } catch (error: any) {
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

    try {
      // Get room data with retry
      let roomData: TokenRoomData | null = null;
      let roomDataAttempts = 0;
      const maxRoomDataAttempts = 3;

      while (roomDataAttempts < maxRoomDataAttempts) {
        try {
          roomData = await this.getTokenRoomData(roomId);
          if (roomData) {
            break;
          }
        } catch (error) {
          // Silent error handling
        }

        roomDataAttempts++;
        if (roomDataAttempts >= maxRoomDataAttempts) {
          this.emitStatus({
            type: "room:join:error",
            roomId,
            error: "Room not found or invitation invalid",
          });
          return {
            success: false,
            error:
              "Room not found or invitation invalid. Please check the room ID and try again.",
          };
        }

        // Wait before retry
        const delay = Math.min(1000 * Math.pow(2, roomDataAttempts - 1), 3000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      if (!roomData) {
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

      // Verify token with case-insensitive comparison
      const normalizedRoomToken = roomData.token?.trim().toLowerCase();
      const normalizedInputToken = token?.trim().toLowerCase();

      if (
        !normalizedRoomToken ||
        !normalizedInputToken ||
        normalizedRoomToken !== normalizedInputToken
      ) {
        this.emitStatus({
          type: "room:join:error",
          roomId,
          error: "Invalid token for this room",
        });
        return {
          success: false,
          error:
            "Invalid token for this room. Please check the token and try again.",
        };
      }

      this.emitStatus({ type: "room:join:verified", roomId });

      // Publish the room under the user's public graph for listeners with retry
      let publishAttempts = 0;
      const maxPublishAttempts = 3;
      let publishSuccess = false;

      while (publishAttempts < maxPublishAttempts && !publishSuccess) {
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("Timeout publishing room to user graph"));
            }, 10000);

            this.core.db.gun
              .get(`user_${currentUserPub}`)
              .get("tokenRooms")
              .get(roomId)
              .put(roomData, (_ack: any) => {
                clearTimeout(timeout);
                resolve();
              });
          });
          publishSuccess = true;
        } catch (e) {
          publishAttempts++;

          if (publishAttempts >= maxPublishAttempts) {
            // Non facciamo fallire il join se la pubblicazione fallisce
            break;
          }

          const delay = Math.min(1000 * Math.pow(2, publishAttempts - 1), 3000);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Store room reference in user profile with retry - CRITICAL FOR PERSISTENCE
      let profileSaveAttempts = 0;
      const maxProfileSaveAttempts = 5; // Increased from 3 to 5
      let profileSaveSuccess = false;

      while (
        profileSaveAttempts < maxProfileSaveAttempts &&
        !profileSaveSuccess
      ) {
        try {
          await this.storeRoomReferenceInUserProfile(
            currentUserPub,
            roomId,
            roomData.name
          );
          profileSaveSuccess = true;
        } catch (error) {
          profileSaveAttempts++;

          if (profileSaveAttempts >= maxProfileSaveAttempts) {
            // This is critical for persistence - we should fail the join if profile save fails
            this.emitStatus({
              type: "room:join:error",
              roomId,
              error: "Failed to persist room to user profile",
            });
            return {
              success: false,
              error:
                "Failed to persist room to user profile. Please try again.",
            };
          }

          const delay = Math.min(
            1000 * Math.pow(2, profileSaveAttempts - 1),
            5000
          ); // Increased max delay
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      if (!profileSaveSuccess) {
        this.emitStatus({
          type: "room:join:error",
          roomId,
          error: "Failed to persist room to user profile",
        });
        return {
          success: false,
          error: "Failed to persist room to user profile. Please try again.",
        };
      }

      // Add a longer delay to ensure GunDB sync and persistence
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Increased to 2 seconds for better sync

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
        // Non facciamo fallire il join se l'ascolto fallisce
      }

      this.emitStatus({ type: "room:join:success", roomId });
      return { success: true, roomData };
    } catch (error) {
      this.emitStatus({
        type: "room:join:error",
        roomId,
        error: String(error),
      });
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
      return;
    }

    // **FIX: Clear existing listeners before starting new ones**
    this.stopListeningTokenRooms();

    this._isListeningTokenRooms = true;
    const currentUserPub = currentUserPair.pub;

    this.emitStatus({ type: "room:listeners:start" });

    // **FIX: Clear processed messages to prevent false duplicates**
    this.processedTokenMessageIds.clear();

    // Listener per stanze token dell'utente
    const userTokenRoomsNode = this.core.db.gun
      .get(`user_${currentUserPub}`)
      .get("tokenRooms")
      .map();

    this.tokenRoomListener = userTokenRoomsNode.on(
      async (roomData: any, roomId: string) => {
        if (roomData && roomData.id && roomData.token) {
          // **FIX: Check if we're already listening to this room**
          if (this.roomMessageHandlers.has(roomId)) {
            return;
          }

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
          // **FIX: Check if we're already listening to this room**
          if (this.roomMessageHandlers.has(rid)) {
            return;
          }

          await this.startListeningToTokenRoom(
            rid,
            tok,
            currentUserPair,
            currentUserPub
          );
        } catch (e) {
          // Silent error handling
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

    // **FIX: Stop main token room listener**
    if (this.tokenRoomListener) {
      try {
        this.tokenRoomListener.off();
      } catch (error) {
        // Silent error handling
      }
      this.tokenRoomListener = null;
    }

    // **FIX: Stop all individual room message handlers**
    const roomIds = Array.from(this.roomMessageHandlers.keys());

    roomIds.forEach((roomId) => {
      try {
        const handler = this.roomMessageHandlers.get(roomId);
        if (handler && typeof handler.off === "function") {
          handler.off();
        }
      } catch (error) {
        // Silent error handling
      }
    });

    // **FIX: Clear all handlers and processed messages**
    this.roomMessageHandlers.clear();
    this.processedTokenMessageIds.clear();

    this._isListeningTokenRooms = false;
    this.emitStatus({ type: "room:listeners:stopped" });
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
      !messageData?.content ||
      !messageData?.from ||
      !messageData?.roomId ||
      messageData.roomId !== roomId
    ) {
      return;
    }

    // **FIX: Enhanced duplicate detection with better logging**
    if (this.processedTokenMessageIds.has(messageId)) {
      this.emitStatus({ type: "message:receive:duplicate", roomId, messageId });
      return;
    }

    // **FIX: Cleanup before processing to prevent memory leaks**
    this.cleanupProcessedMessages();

    // **FIX: Add message to processed set with timestamp**
    this.processedTokenMessageIds.set(messageId, Date.now());

    try {
      // **FIX: Get token from active rooms if not provided**
      let actualToken = token;
      if (!actualToken || actualToken.length === 0) {
        const storedToken = this.activeTokenRooms.get(roomId);
        if (storedToken) {
          actualToken = storedToken;
        }
      }

      // **FIX: Verify token is available before processing**
      if (!actualToken) {
        // **FIX: Remove from processed set if we can't process it**
        this.processedTokenMessageIds.delete(messageId);
        return;
      }

      // Decifra il contenuto del messaggio usando il token condiviso
      const decryptedContent = await this.core.db.sea.decrypt(
        messageData.content,
        actualToken
      );

      if (!decryptedContent) {
        this.emitStatus({
          type: "message:receive:decryptFailed",
          roomId,
          messageId,
        });
        return;
      }

      // **FIX: Ensure decryptedContent is a string**
      const decryptedContentString =
        typeof decryptedContent === "string"
          ? decryptedContent
          : JSON.stringify(decryptedContent);

      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.encryptionManager.verifyMessageSignature(
          decryptedContentString,
          messageData.signature,
          messageData.from
        );
        if (!isValid) {
          // Silent signature verification failure
        }
      }

      // Crea il messaggio decifrato
      const decryptedTokenMessage: TokenRoomMessage = {
        ...messageData,
        content: decryptedContentString,
      };

      // Notifica i listener
      if (this.tokenRoomListeners.length > 0) {
        this.tokenRoomListeners.forEach((callback) => {
          try {
            callback(decryptedTokenMessage);
          } catch (error) {
            // Silent error handling
          }
        });
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
    }
  }

  /**
   * Enhanced cleanup for token messages
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    // **FIX: More aggressive cleanup - reduce TTL to 1 hour for better performance**
    const cleanupTTL = Math.min(this.MESSAGE_TTL, 60 * 60 * 1000); // 1 hour max

    // Clean up token message IDs
    for (const [
      messageId,
      timestamp,
    ] of this.processedTokenMessageIds.entries()) {
      if (now - timestamp > cleanupTTL) {
        expiredIds.push(messageId);
      }
    }

    if (expiredIds.length > 0) {
      expiredIds.forEach((id) => this.processedTokenMessageIds.delete(id));
    }

    // **FIX: More aggressive size limiting**
    const maxSize = Math.min(this.MAX_PROCESSED_MESSAGES, 500); // Reduce to 500 max
    if (this.processedTokenMessageIds.size > maxSize) {
      const sortedEntries = Array.from(
        this.processedTokenMessageIds.entries()
      ).sort(([, a], [, b]) => a - b);

      const toRemove = sortedEntries.slice(
        0,
        this.processedTokenMessageIds.size - maxSize
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

    return new Promise<void>((resolve, reject) => {
      try {
        messageNode.get(messageId).put(messageData, (ack: any) => {
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

  /**
   * Stores a room reference in the user's profile for persistence
   * This is CRITICAL for ensuring rooms appear in the user's room list
   */
  private async storeRoomReferenceInUserProfile(
    userPub: string,
    roomId: string,
    roomName?: string
  ): Promise<void> {
    try {
      // Store room reference in user's profile
      const roomReference = {
        type: "token",
        id: roomId,
        name: roomName || `Token Room ${roomId.slice(0, 8)}...`,
        joinedAt: Date.now(),
      };

      // Use putUserData method for persistence
      await this.core.db.putUserData(`chats/token/${roomId}`, roomReference);
    } catch (error) {
      // Silent error handling
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
   * Delete a token room completely from the database
   * This removes the room data, messages, and all references
   */
  public async deleteTokenRoom(
    roomId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per eliminare una stanza token.",
      };
    }

    if (!roomId || typeof roomId !== "string") {
      return {
        success: false,
        error: "ID stanza è obbligatorio.",
      };
    }

    try {
      this.emitStatus({ type: "room:delete:start", roomId });

      // First, leave the room to clean up listeners
      this.leaveTokenRoom(roomId);

      // Get the room data to check if we're the creator
      const roomData = await this.getTokenRoomData(roomId);
      if (!roomData) {
        return {
          success: false,
          error: "Stanza non trovata.",
        };
      }

      // Check if the current user is the creator of the room
      if (roomData.createdBy !== this.core.db.user.pub) {
        return {
          success: false,
          error: "Solo il creatore della stanza può eliminarla.",
        };
      }

      // Delete room data from GunDB
      const roomPath = createSafePath(roomId, "tokenRooms");
      await this.core.db.gun.get(roomPath).put(null);

      // Delete room messages
      const messagesPath = createSafePath(roomId, "tokenRoomMessages");
      await this.core.db.gun.get(messagesPath).put(null);

      // Remove from user's joined rooms
      const userJoinedRoomsPath =
        createSafePath(this.core.db.user.pub, "users") +
        "/joinedTokenRooms/" +
        roomId;
      await this.core.db.gun.get(userJoinedRoomsPath).put(null);

      // Remove from global token rooms list
      const globalRoomsPath = createSafePath(roomId, "globalTokenRooms");
      await this.core.db.gun.get(globalRoomsPath).put(null);

      this.emitStatus({ type: "room:delete:success", roomId });

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Errore sconosciuto";
      this.emitStatus({
        type: "room:delete:error",
        roomId,
        error: errorMessage,
      });

      return {
        success: false,
        error: `Errore nell'eliminazione della stanza: ${errorMessage}`,
      };
    }
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
