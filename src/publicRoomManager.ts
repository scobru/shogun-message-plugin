import { ShogunCore } from "shogun-core";
import { PublicMessage, MessageResponse, PublicMessageListener } from "./types";
import { generateMessageId, createSafePath } from "./utils";
import { EncryptionManager } from "./encryption";

/**
 * Public room management functionality for the messaging plugin
 */
export class PublicRoomManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private publicMessageListeners: PublicMessageListener[] = [];
  private _isListeningPublic = false;
  private processedPublicMessageIds = new Map<string, number>();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore
  private publicMessageListener: any = null;

  constructor(core: ShogunCore, encryptionManager: EncryptionManager) {
    this.core = core;
    this.encryptionManager = encryptionManager;
  }

  /**
   * Sends a message to a public room (unencrypted)
   */
  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio pubblico.",
      };
    }

    if (
      !roomId ||
      !messageContent ||
      typeof roomId !== "string" ||
      typeof messageContent !== "string"
    ) {
      return {
        success: false,
        error:
          "ID stanza e messaggio sono obbligatori e devono essere stringhe valide.",
      };
    }

    try {
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

      // Crea il messaggio pubblico
      const publicMessage: PublicMessage = {
        from: senderPub,
        content: messageContent,
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

      // Aggiungi la firma al messaggio
      const signedMessage = {
        ...publicMessage,
        signature,
      };

      // Usa il metodo condiviso per inviare a GunDB
      await this.sendToGunDB(roomId, messageId, signedMessage, "public");

      console.log(`[PublicRoomManager] ✅ Public message sent successfully`);

      return { success: true, messageId };
    } catch (error: any) {
      console.error(
        `[PublicRoomManager] ❌ Errore invio messaggio pubblico:`,
        error
      );
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante l'invio del messaggio pubblico",
      };
    }
  }

  /**
   * Starts listening to public room messages
   */
  public startListeningPublic(roomId: string): void {
    if (
      !this.core.isLoggedIn() ||
      this._isListeningPublic ||
      !this.core.db.user
    ) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(
        `[PublicRoomManager] Coppia di chiavi utente non disponibile`
      );
      return;
    }

    this._isListeningPublic = true;
    const currentUserPub = currentUserPair.pub;

    console.log(
      `[PublicRoomManager] 🔊 Starting public room listener for: ${roomId}`
    );

    // Listener per messaggi pubblici
    const roomNode = this.core.db.gun.get(`room_${roomId}`).map();

    this.publicMessageListener = roomNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingPublicMessage(
          messageData,
          messageId,
          currentUserPub,
          roomId
        );
      }
    );
  }

  /**
   * Removes a specific public message listener
   */
  public removePublicMessageListener(callback: PublicMessageListener): void {
    const index = this.publicMessageListeners.indexOf(callback);
    if (index > -1) {
      this.publicMessageListeners.splice(index, 1);
      console.log(`[PublicRoomManager] 🗑️ Removed public message listener`);
    }
  }

  /**
   * Stops listening to public room messages
   */
  public stopListeningPublic(): void {
    if (!this._isListeningPublic) return;

    if (this.publicMessageListener) {
      this.publicMessageListener.off();
      this.publicMessageListener = null;
    }

    this._isListeningPublic = false;
    this.processedPublicMessageIds.clear();
    console.log(`[PublicRoomManager] 🔇 Stopped public room listener`);
  }

  /**
   * Processes incoming public messages
   */
  private async processIncomingPublicMessage(
    messageData: any,
    messageId: string,
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

    // Controllo duplicati per ID
    if (this.processedPublicMessageIds.has(messageId)) {
      console.log(
        `[PublicRoomManager] 🔄 Duplicate public message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedPublicMessageIds.set(messageId, Date.now());

    try {
      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.encryptionManager.verifyMessageSignature(
          messageData.content,
          messageData.signature,
          messageData.from
        );
        if (!isValid) {
          console.warn(
            `[PublicRoomManager] ⚠️ Invalid signature for public message from: ${messageData.from.slice(0, 8)}...`
          );
        }
      }

      // Notifica i listener
      if (this.publicMessageListeners.length > 0) {
        this.publicMessageListeners.forEach((callback) => {
          try {
            callback(messageData as PublicMessage);
          } catch (error) {
            console.error(
              `[PublicRoomManager] ❌ Errore listener pubblico:`,
              error
            );
          }
        });
      } else {
        console.warn(
          `[PublicRoomManager] ⚠️ Nessun listener pubblico registrato per il messaggio`
        );
      }
    } catch (error) {
      this.processedPublicMessageIds.delete(messageId);
      console.error(
        `[PublicRoomManager] ❌ Errore processamento messaggio pubblico:`,
        error
      );
    }
  }

  /**
   * Enhanced cleanup for public messages
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    // Clean up public message IDs
    for (const [
      messageId,
      timestamp,
    ] of this.processedPublicMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedPublicMessageIds.delete(id));

    // Limit size of map
    if (this.processedPublicMessageIds.size > this.MAX_PROCESSED_MESSAGES) {
      const sortedEntries = Array.from(
        this.processedPublicMessageIds.entries()
      ).sort(([, a], [, b]) => a - b);

      const toRemove = sortedEntries.slice(
        0,
        this.processedPublicMessageIds.size - this.MAX_PROCESSED_MESSAGES
      );
      toRemove.forEach(([id]) => this.processedPublicMessageIds.delete(id));
    }
  }

  /**
   * Shared method to send messages to GunDB
   */
  private async sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group"
  ): Promise<void> {
    let safePath: string;

    if (type === "public") {
      safePath = `room_${path}`;
    } else if (type === "group") {
      safePath = path;
    } else {
      safePath = createSafePath(path);
    }

    const messageNode = this.core.db.gun.get(safePath);

    console.log(
      `[PublicRoomManager] 📡 Sending ${type} message to GunDB path: ${safePath}`
    );

    return new Promise<void>((resolve, reject) => {
      try {
        messageNode.get(messageId).put(messageData, (ack: any) => {
          if (ack.err) {
            console.error(
              `[PublicRoomManager] ❌ Errore invio messaggio ${type}:`,
              ack.err
            );
            reject(new Error(ack.err));
          } else {
            console.log(
              `[PublicRoomManager] ✅ ${type} message sent successfully to GunDB`
            );
            resolve();
          }
        });
      } catch (error) {
        console.error(
          `[PublicRoomManager] ❌ Errore durante put operation ${type}:`,
          error
        );
        reject(error);
      }
    });
  }

  /**
   * Registers a callback for public messages
   */
  public onPublicMessage(callback: PublicMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.publicMessageListeners.push(callback);
  }

  /**
   * Gets the current listening status
   */
  public isListeningPublic(): boolean {
    return this._isListeningPublic;
  }

  /**
   * Gets the number of public message listeners
   */
  public getPublicMessageListenersCount(): number {
    return this.publicMessageListeners.length;
  }

  /**
   * Gets the number of processed public messages
   */
  public getProcessedPublicMessagesCount(): number {
    return this.processedPublicMessageIds.size;
  }
}
