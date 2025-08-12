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
      console.log(
        `[TokenRoomManager] 🔧 Starting token room creation for: ${roomName}`
      );

      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        console.error(
          `[TokenRoomManager] ❌ No user key pair available for room creation: ${roomName}`
        );
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

      console.log(
        `[TokenRoomManager] 🔧 Starting to save room data to GunDB: ${roomId}`
      );

      while (saveAttempts < maxSaveAttempts) {
        try {
          this.emitStatus({
            type: "room:create:saveAttempt",
            attempt: saveAttempts + 1,
          });

          console.log(
            `[TokenRoomManager] 🔧 Save attempt ${saveAttempts + 1}/${maxSaveAttempts} for room: ${roomId}`
          );

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.warn(
                `[TokenRoomManager] ⚠️ Timeout on save attempt ${saveAttempts + 1} for room: ${roomId}`
              );
              reject(
                new Error(
                  "Timeout saving room data (20s) - network may be slow"
                )
              );
            }, 20000); // Aumentato da 15s a 20s

            console.log(
              `[TokenRoomManager] 🔧 Calling GunDB put for room: ${roomId}`
            );
            this.core.db.gun.get(roomId).put(roomData, (ack: any) => {
              clearTimeout(timeout);
              console.log(
                `[TokenRoomManager] 🔧 GunDB put callback received for room: ${roomId}`,
                ack
              );
              if (ack && ack.err) {
                console.error(
                  `[TokenRoomManager] ❌ GunDB put error for room: ${roomId}`,
                  ack.err
                );
                reject(new Error(`Error saving room: ${ack.err}`));
              } else {
                console.log(
                  `[TokenRoomManager] ✅ GunDB put successful for room: ${roomId}`
                );
                resolve();
              }
            });
          });

          console.log(
            `[TokenRoomManager] ✅ Room data saved successfully on attempt ${saveAttempts + 1}: ${roomId}`
          );
          break;
        } catch (error) {
          lastError = error as Error;
          saveAttempts++;
          this.emitStatus({
            type: "room:create:saveRetry",
            attempt: saveAttempts,
            error: String(error),
          });
          console.warn(
            `[TokenRoomManager] ⚠️ Save attempt ${saveAttempts} failed for room ${roomId}:`,
            error
          );

          if (saveAttempts >= maxSaveAttempts) {
            console.error(
              `[TokenRoomManager] ❌ All save attempts failed for room: ${roomId}`
            );
            throw new Error(
              `Failed to save room after ${maxSaveAttempts} attempts. Last error: ${lastError?.message}`
            );
          }

          // Backoff esponenziale per i retry
          const delay = Math.min(2000 * Math.pow(2, saveAttempts - 1), 10000);
          console.log(
            `[TokenRoomManager] 🔧 Waiting ${delay}ms before retry for room: ${roomId}`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Pubblica la stanza per il creatore con retry migliorato
      console.log(
        `[TokenRoomManager] 🔧 Saving room reference to user profile: user_${creatorPub}/tokenRooms/${roomId}`
      );

      let profileSaveAttempts = 0;
      const maxProfileSaveAttempts = 3;

      while (profileSaveAttempts < maxProfileSaveAttempts) {
        try {
          const creatorNode = this.core.db.gun
            .get(`user_${creatorPub}`)
            .get("tokenRooms");

          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.warn(
                `[TokenRoomManager] ⚠️ Timeout saving room reference to user profile for room: ${roomId}`
              );
              reject(
                new Error("Timeout saving room reference to user profile")
              );
            }, 15000); // Aumentato da 10s a 15s

            creatorNode.get(roomId).put(roomData, (ack: any) => {
              clearTimeout(timeout);
              console.log(
                `[TokenRoomManager] 🔧 User profile save callback received for room: ${roomId}`,
                ack
              );
              if (ack && ack.err) {
                console.error(
                  `[TokenRoomManager] ❌ Error saving room reference to user profile for room: ${roomId}`,
                  ack.err
                );
                reject(new Error(`Error saving room reference: ${ack.err}`));
              } else {
                console.log(
                  `[TokenRoomManager] ✅ Room reference saved to user profile for room: ${roomId}`
                );
                resolve();
              }
            });
          });

          console.log(
            `[TokenRoomManager] ✅ User profile save successful on attempt ${profileSaveAttempts + 1}: ${roomId}`
          );
          break;
        } catch (error) {
          profileSaveAttempts++;
          console.warn(
            `[TokenRoomManager] ⚠️ User profile save attempt ${profileSaveAttempts} failed for room ${roomId}:`,
            error
          );

          if (profileSaveAttempts >= maxProfileSaveAttempts) {
            console.error(
              `[TokenRoomManager] ❌ All user profile save attempts failed for room: ${roomId}`
            );
            // Non facciamo fallire la creazione della stanza se il salvataggio del profilo fallisce
            console.warn(
              `[TokenRoomManager] ⚠️ Continuing with room creation despite profile save failure`
            );
            break;
          }

          const delay = Math.min(
            1000 * Math.pow(2, profileSaveAttempts - 1),
            5000
          );
          console.log(
            `[TokenRoomManager] 🔧 Waiting ${delay}ms before profile save retry for room: ${roomId}`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Aggiungi la stanza alle stanze attive per questa sessione
      this.activeTokenRooms.set(roomId, token);

      this.emitStatus({ type: "room:create:success", roomId, roomName });
      console.log(
        `[TokenRoomManager] ✅ Token room created successfully: ${roomId} (${roomName})`
      );
      console.log(`[TokenRoomManager] 📋 Final room data:`, roomData);
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

      // **DEBUG: Verify encryption worked**
      console.log(`[TokenRoomManager] 🔐 Encryption debug:`, {
        originalLength: messageContent.length,
        encryptedLength: encryptedContent.length,
        originalPreview: messageContent.slice(0, 20) + "...",
        encryptedPreview: encryptedContent.slice(0, 20) + "...",
        tokenLength: token.length,
      });

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
      console.log(
        `[TokenRoomManager] 🔍 Getting token room data for: ${roomId}`
      );

      const roomData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          console.warn(
            `[TokenRoomManager] ⚠️ Timeout getting room data for: ${roomId}`
          );
          reject(
            new Error("Timeout getting room data (20s) - network may be slow")
          );
        }, 20000); // Aumentato da 15s a 20s

        this.core.db.gun.get(roomId).once((data: any) => {
          clearTimeout(timeout);
          console.log(
            `[TokenRoomManager] 🔍 Room data received for: ${roomId}`,
            data
          );
          resolve(data);
        });
      });

      if (!roomData || !roomData.name || !roomData.token) {
        console.log(
          `[TokenRoomManager] ❌ Invalid room data for: ${roomId}`,
          roomData
        );
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

      console.log(
        `[TokenRoomManager] ✅ Valid room data retrieved for: ${roomId}`,
        result
      );
      return result;
    } catch (error: any) {
      console.error(
        `[TokenRoomManager] ❌ Error getting token room data for ${roomId}:`,
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
      // Get room data with retry
      let roomData: TokenRoomData | null = null;
      let roomDataAttempts = 0;
      const maxRoomDataAttempts = 3;

      while (roomDataAttempts < maxRoomDataAttempts) {
        try {
          roomData = await this.getTokenRoomData(roomId);
          if (roomData) {
            console.log(
              `[TokenRoomManager] ✅ Room data retrieved on attempt ${roomDataAttempts + 1}: ${roomId}`
            );
            break;
          }
        } catch (error) {
          console.warn(
            `[TokenRoomManager] ⚠️ Room data retrieval attempt ${roomDataAttempts + 1} failed:`,
            error
          );
        }

        roomDataAttempts++;
        if (roomDataAttempts >= maxRoomDataAttempts) {
          console.log(
            `[TokenRoomManager] ❌ Room not found after ${maxRoomDataAttempts} attempts: ${roomId}`
          );
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
        console.log(
          `[TokenRoomManager] 🔧 Waiting ${delay}ms before room data retry for room: ${roomId}`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

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

      // Verify token with case-insensitive comparison
      const normalizedRoomToken = roomData.token?.trim().toLowerCase();
      const normalizedInputToken = token?.trim().toLowerCase();

      if (
        !normalizedRoomToken ||
        !normalizedInputToken ||
        normalizedRoomToken !== normalizedInputToken
      ) {
        console.log(`[TokenRoomManager] ❌ Invalid token for room: ${roomId}`);
        console.log(`[TokenRoomManager] 🔍 Token comparison:`, {
          roomToken: roomData.token,
          inputToken: token,
          normalizedRoomToken,
          normalizedInputToken,
        });
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
      console.log(`[TokenRoomManager] ✅ Token verified for room: ${roomId}`);

      // Publish the room under the user's public graph for listeners with retry
      let publishAttempts = 0;
      const maxPublishAttempts = 3;
      let publishSuccess = false;

      while (publishAttempts < maxPublishAttempts && !publishSuccess) {
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              console.warn(
                `[TokenRoomManager] ⚠️ Timeout publishing room to user graph for room: ${roomId}`
              );
              reject(new Error("Timeout publishing room to user graph"));
            }, 10000);

            this.core.db.gun
              .get(`user_${currentUserPub}`)
              .get("tokenRooms")
              .get(roomId)
              .put(roomData, (_ack: any) => {
                clearTimeout(timeout);
                console.log(
                  `[TokenRoomManager] ✅ Room published to user graph for room: ${roomId}`
                );
                resolve();
              });
          });
          publishSuccess = true;
        } catch (e) {
          publishAttempts++;
          console.warn(
            `[TokenRoomManager] ⚠️ Publish attempt ${publishAttempts} failed for room ${roomId}:`,
            e
          );

          if (publishAttempts >= maxPublishAttempts) {
            console.warn(
              `[TokenRoomManager] ⚠️ Could not publish joined room to user graph after ${maxPublishAttempts} attempts:`,
              e
            );
            // Non facciamo fallire il join se la pubblicazione fallisce
            break;
          }

          const delay = Math.min(1000 * Math.pow(2, publishAttempts - 1), 3000);
          console.log(
            `[TokenRoomManager] 🔧 Waiting ${delay}ms before publish retry for room: ${roomId}`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      // Store room reference in user profile with retry - CRITICAL FOR PERSISTENCE
      console.log(
        `[TokenRoomManager] 💾 Storing room reference in user profile for persistence`
      );
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
          console.log(
            `[TokenRoomManager] ✅ Room reference stored in user profile on attempt ${profileSaveAttempts + 1}`
          );
          profileSaveSuccess = true;
        } catch (error) {
          profileSaveAttempts++;
          console.warn(
            `[TokenRoomManager] ⚠️ Profile save attempt ${profileSaveAttempts} failed for room ${roomId}:`,
            error
          );

          if (profileSaveAttempts >= maxProfileSaveAttempts) {
            console.error(
              `[TokenRoomManager] ❌ Could not store room reference in user profile after ${maxProfileSaveAttempts} attempts:`,
              error
            );
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
          console.log(
            `[TokenRoomManager] 🔧 Waiting ${delay}ms before profile save retry for room: ${roomId}`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }

      if (!profileSaveSuccess) {
        console.error(
          `[TokenRoomManager] ❌ Profile save failed for room: ${roomId}`
        );
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
      console.log(
        `[TokenRoomManager] ⏳ Waiting for GunDB sync and persistence...`
      );
      await new Promise((resolve) => setTimeout(resolve, 2000)); // Increased to 2 seconds for better sync

      // Add to active rooms for this session
      this.activeTokenRooms.set(roomId, token);

      // Verify the room was actually saved to user profile
      console.log(
        `[TokenRoomManager] 🔍 Verifying room persistence in user profile...`
      );
      try {
        const verificationTimeout = setTimeout(() => {
          console.warn(
            `[TokenRoomManager] ⚠️ Verification timeout for room: ${roomId}`
          );
        }, 5000);

        const userProfileNode = this.core.db.gun
          .get(`user_${currentUserPub}`)
          .get("tokenRooms")
          .get(roomId);

        userProfileNode.once((savedRoomData: any) => {
          clearTimeout(verificationTimeout);
          if (savedRoomData && savedRoomData.id === roomId) {
            console.log(
              `[TokenRoomManager] ✅ Room persistence verified: ${roomId}`
            );
          } else {
            console.warn(
              `[TokenRoomManager] ⚠️ Room persistence verification failed: ${roomId}`
            );
          }
        });
      } catch (e) {
        console.warn(
          `[TokenRoomManager] ⚠️ Could not verify room persistence:`,
          e
        );
      }

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
          console.log(
            `[TokenRoomManager] ✅ Started listening to joined room: ${roomId}`
          );
        } else {
          console.warn(
            `[TokenRoomManager] ⚠️ Could not start listening: no user key pair available`
          );
        }
      } catch (e) {
        console.warn(
          `[TokenRoomManager] ⚠️ Could not start listening to joined room immediately:`,
          e
        );
        // Non facciamo fallire il join se l'ascolto fallisce
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
      console.log(`[TokenRoomManager] ⚠️ Cannot start listening:`, {
        isLoggedIn: this.core.isLoggedIn(),
        isAlreadyListening: this._isListeningTokenRooms,
        hasUser: !!this.core.db.user,
      });
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(
        `[TokenRoomManager] Coppia di chiavi utente non disponibile`
      );
      return;
    }

    // **FIX: Clear existing listeners before starting new ones**
    this.stopListeningTokenRooms();

    this._isListeningTokenRooms = true;
    const currentUserPub = currentUserPair.pub;

    this.emitStatus({ type: "room:listeners:start" });
    console.log(`[TokenRoomManager] 🔊 Starting token room listener`);

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
            console.log(
              `[TokenRoomManager] ⚠️ Already listening to room: ${roomId}`
            );
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
      console.log(
        `[TokenRoomManager] 🔍 Attaching listeners to ${this.activeTokenRooms.size} active rooms`
      );
      this.activeTokenRooms.forEach(async (tok, rid) => {
        try {
          // **FIX: Check if we're already listening to this room**
          if (this.roomMessageHandlers.has(rid)) {
            console.log(
              `[TokenRoomManager] ⚠️ Already listening to active room: ${rid}`
            );
            return;
          }

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

    console.log(`[TokenRoomManager] 🔇 Stopping token room listeners...`);

    // **FIX: Stop main token room listener**
    if (this.tokenRoomListener) {
      try {
        this.tokenRoomListener.off();
        console.log(`[TokenRoomManager] ✅ Stopped main token room listener`);
      } catch (error) {
        console.warn(`[TokenRoomManager] ⚠️ Error stopping main listener:`, error);
      }
      this.tokenRoomListener = null;
    }

    // **FIX: Stop all individual room message handlers**
    const roomIds = Array.from(this.roomMessageHandlers.keys());
    console.log(`[TokenRoomManager] 🔇 Stopping ${roomIds.length} room message handlers...`);
    
    roomIds.forEach(roomId => {
      try {
        const handler = this.roomMessageHandlers.get(roomId);
        if (handler && typeof handler.off === "function") {
          handler.off();
          console.log(`[TokenRoomManager] ✅ Stopped handler for room: ${roomId}`);
        }
      } catch (error) {
        console.warn(`[TokenRoomManager] ⚠️ Error stopping handler for room ${roomId}:`, error);
      }
    });

    // **FIX: Clear all handlers and processed messages**
    this.roomMessageHandlers.clear();
    this.processedTokenMessageIds.clear();
    
    this._isListeningTokenRooms = false;
    this.emitStatus({ type: "room:listeners:stopped" });
    console.log(`[TokenRoomManager] ✅ All token room listeners stopped and cleaned up`);
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
      !messageData?.content ||
      !messageData?.from ||
      !messageData?.roomId ||
      messageData.roomId !== roomId
    ) {
      console.log(`[TokenRoomManager] ⚠️ Invalid message data for room: ${roomId}`, {
        hasContent: !!messageData?.content,
        hasFrom: !!messageData?.from,
        hasRoomId: !!messageData?.roomId,
        roomIdMatch: messageData?.roomId === roomId
      });
      return;
    }

    // **FIX: Enhanced duplicate detection with better logging**
    if (this.processedTokenMessageIds.has(messageId)) {
      this.emitStatus({ type: "message:receive:duplicate", roomId, messageId });
      console.log(
        `[TokenRoomManager] 🔄 Duplicate token message ID detected: ${messageId.slice(0, 20)}... (processed ${this.processedTokenMessageIds.size} messages)`
      );
      return;
    }

    // **FIX: Cleanup before processing to prevent memory leaks**
    this.cleanupProcessedMessages();
    
    // **FIX: Add message to processed set with timestamp**
    this.processedTokenMessageIds.set(messageId, Date.now());
    
    console.log(`[TokenRoomManager] 📨 Processing new message: ${messageId.slice(0, 20)}... for room: ${roomId}`);

    try {
      // **FIX: Get token from active rooms if not provided**
      let actualToken = token;
      if (!actualToken || actualToken.length === 0) {
        const storedToken = this.activeTokenRooms.get(roomId);
        if (storedToken) {
          actualToken = storedToken;
          console.log(
            `[TokenRoomManager] 🔍 Using token from active rooms for room: ${roomId}`
          );
        }
      }

      // **FIX: Verify token is available before processing**
      if (!actualToken) {
        console.error(
          `[TokenRoomManager] ❌ No token available for room: ${roomId}`
        );
        console.error(
          `[TokenRoomManager] 🔍 Available rooms:`,
          Array.from(this.activeTokenRooms.keys())
        );
        // **FIX: Remove from processed set if we can't process it**
        this.processedTokenMessageIds.delete(messageId);
        return;
      }

      // **FIX: Reduced debug logging to prevent spam**
      console.log(
        `[TokenRoomManager] 🔍 Processing message for room: ${roomId} (token: ${actualToken.slice(0, 10)}...)`
      );
      console.log(
        `[TokenRoomManager] 🔍 Token length: ${actualToken?.length || 0}`
      );
      console.log(
        `[TokenRoomManager] 🔍 Message content type: ${typeof messageData.content}`
      );
      console.log(
        `[TokenRoomManager] 🔍 Message content length: ${messageData.content?.length || 0}`
      );
      console.log(
        `[TokenRoomManager] 🔍 Active rooms count: ${this.activeTokenRooms.size}`
      );
      console.log(
        `[TokenRoomManager] 🔍 Active rooms:`,
        Array.from(this.activeTokenRooms.keys())
      );

      // **DEBUG: Decryption debug**
      console.log(`[TokenRoomManager] 🔓 Decryption debug:`, {
        messageContentLength: messageData.content?.length || 0,
        messageContentType: typeof messageData.content,
        messageContentPreview: messageData.content?.slice(0, 50) + "...",
        tokenLength: actualToken?.length || 0,
        tokenPreview: actualToken?.slice(0, 20) + "...",
      });

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
        console.error(
          `[TokenRoomManager] ❌ Could not decrypt message content for room: ${roomId}`
        );
        console.error(
          `[TokenRoomManager] 🔍 Token used: ${actualToken.slice(0, 20)}...`
        );
        console.error(
          `[TokenRoomManager] 🔍 Message content: ${messageData.content?.slice(0, 50)}...`
        );
        return;
      }

      // **FIX: Ensure decryptedContent is a string**
      const decryptedContentString =
        typeof decryptedContent === "string"
          ? decryptedContent
          : JSON.stringify(decryptedContent);

      // **DEBUG: Successful decryption**
      console.log(`[TokenRoomManager] ✅ Decryption successful:`, {
        decryptedLength: decryptedContentString.length,
        decryptedType: typeof decryptedContent,
        decryptedPreview: decryptedContentString.slice(0, 50) + "...",
      });

      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.encryptionManager.verifyMessageSignature(
          decryptedContentString,
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
        content: decryptedContentString,
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
      console.log(`[TokenRoomManager] 🧹 Cleaned up ${expiredIds.length} expired message IDs`);
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
      
      console.log(`[TokenRoomManager] 🧹 Cleaned up ${toRemove.length} old message IDs (size limit: ${maxSize})`);
    }

    // **FIX: Log current state for debugging**
    if (this.processedTokenMessageIds.size > 100) {
      console.log(`[TokenRoomManager] 📊 Current processed messages: ${this.processedTokenMessageIds.size}`);
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
   * This is CRITICAL for ensuring rooms appear in the user's room list
   */
  private async storeRoomReferenceInUserProfile(
    userPub: string,
    roomId: string,
    roomName?: string
  ): Promise<void> {
    try {
      console.log(
        `[TokenRoomManager] 💾 Storing room reference for persistence:`,
        {
          userPub: userPub.slice(0, 20) + "...",
          roomId,
          roomName,
          path: `chats/token/${roomId}`,
        }
      );

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

      // Use both methods to ensure persistence
      // Method 1: Use putUserData
      await this.core.db.putUserData(`chats/token/${roomId}`, roomReference);

      // Method 2: Direct GunDB put for redundancy
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timeout storing room reference directly (10s)`));
        }, 10000);

        this.core.db.gun
          .user()
          .get("chats")
          .get("token")
          .get(roomId)
          .put(roomReference, (ack: any) => {
            clearTimeout(timeout);
            if (ack.err) {
              console.warn(
                `[TokenRoomManager] ⚠️ Direct put warning:`,
                ack.err
              );
              // Don't reject, as putUserData might have succeeded
            }
            resolve();
          });
      });

      console.log(
        `[TokenRoomManager] ✅ Stored token room reference for user ${userPub.slice(0, 20)}...`
      );

      // Verify the data was stored by reading it back
      try {
        const storedData = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Timeout verifying stored room reference (10s)`));
          }, 10000);

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
