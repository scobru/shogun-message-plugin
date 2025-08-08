import { ShogunCore } from "shogun-core";
import { MessageData, MessageListener } from "./types";
import { createSafePath, cleanupExpiredEntries, limitMapSize } from "./utils";
import { EncryptionManager } from "./encryption";

/**
 * Message processing and listener management for the messaging plugin
 */
export class MessageProcessor {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;

  // Private message handling
  private messageListeners: MessageListener[] = [];
  private _isListening = false;
  private processedMessageIds = new Map<string, number>();
  private messageListener: any = null;

  // Configuration
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore
  private clearedConversations = new Set<string>();

  constructor(core: ShogunCore, encryptionManager: EncryptionManager) {
    this.core = core;
    this.encryptionManager = encryptionManager;
  }

  /**
   * Starts listening to private messages
   */
  public startListening(): void {
    if (!this.core.isLoggedIn() || this._isListening || !this.core.db.user) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(
        `[MessageProcessor] Coppia di chiavi utente non disponibile`
      );
      return;
    }

    this._isListening = true;
    const currentUserPub = currentUserPair.pub;

    // Un solo listener sul canale dedicato
    const currentUserSafePath = createSafePath(currentUserPub);
    const messageNode = this.core.db.gun.get(currentUserSafePath).map();

    this.messageListener = messageNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingMessage(
          messageData,
          messageId,
          currentUserPair,
          currentUserPub
        );
      }
    );
  }

  /**
   * Stops listening to private messages
   */
  public stopListening(): void {
    if (!this._isListening) return;

    if (this.messageListener) {
      this.messageListener.off();
      this.messageListener = null;
    }

    this._isListening = false;
    this.processedMessageIds.clear();
  }

  /**
   * Processes incoming private messages
   */
  private async processIncomingMessage(
    messageData: any,
    messageId: string,
    currentUserPair: any,
    currentUserPub: string
  ): Promise<void> {
    // Validazione base
    if (
      !messageData?.data ||
      !messageData?.from ||
      messageData.from === currentUserPub
    ) {
      return;
    }

    // Controllo duplicati per ID
    if (this.processedMessageIds.has(messageId)) {
      console.log(
        `[MessageProcessor] 🔄 Duplicate message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedMessageIds.set(messageId, Date.now());

    try {
      // Decifra il messaggio
      const decryptedMessage = await this.encryptionManager.decryptMessage(
        messageData.data,
        currentUserPair,
        messageData.from
      );

      // Check if this conversation has been cleared AFTER decryption
      if (this.isConversationCleared(decryptedMessage.from, currentUserPub)) {
        console.log(
          `[MessageProcessor] ⏭️ Ignoring message from cleared conversation: ${decryptedMessage.from.slice(0, 8)}...`
        );
        this.processedMessageIds.delete(messageId);
        return;
      }

      // Notifica i listener
      if (this.messageListeners.length > 0) {
        this.messageListeners.forEach((callback) => {
          try {
            callback(decryptedMessage);
          } catch (error) {
            console.error(`[MessageProcessor] ❌ Errore listener:`, error);
          }
        });
      } else {
        console.warn(
          `[MessageProcessor] ⚠️ Nessun listener registrato per il messaggio`
        );
      }
    } catch (error) {
      this.processedMessageIds.delete(messageId);
    }
  }

  /**
   * Enhanced cleanup for all message types
   */
  private cleanupProcessedMessages(): void {
    // Clean up private message IDs
    cleanupExpiredEntries(this.processedMessageIds, this.MESSAGE_TTL);
    limitMapSize(this.processedMessageIds, this.MAX_PROCESSED_MESSAGES);
  }

  /**
   * Registers a callback for private messages
   */
  public onMessage(callback: MessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.messageListeners.push(callback);
  }

  /**
   * Clears all messages for a specific conversation
   */
  public async clearConversation(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per pulire una conversazione.",
      };
    }

    if (!recipientPub || typeof recipientPub !== "string") {
      return {
        success: false,
        error: "Public key del destinatario richiesta.",
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

      const currentUserPub = currentUserPair.pub;

      // Create a unique conversation identifier
      const conversationId = this.createConversationId(
        currentUserPub,
        recipientPub
      );

      // Mark this conversation as cleared
      this.clearedConversations.add(conversationId);

      // Clear messages from both sender and recipient paths
      const senderSafePath = createSafePath(currentUserPub);
      const recipientSafePath = createSafePath(recipientPub);

      // Clear messages from sender's path (messages sent by current user)
      await new Promise<void>((resolve, reject) => {
        try {
          const senderNode = this.core.db.gun.get(senderSafePath);
          senderNode.map().once((messageData: any, messageId: string) => {
            if (
              messageData &&
              messageData.from === currentUserPub &&
              messageData.to === recipientPub
            ) {
              senderNode.get(messageId).put(null, (ack: any) => {
                if (ack.err) {
                  console.error(
                    `[MessageProcessor] ❌ Errore pulizia messaggio inviato:`,
                    ack.err
                  );
                }
              });
            }
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Clear messages from recipient's path (messages received by current user)
      await new Promise<void>((resolve, reject) => {
        try {
          const recipientNode = this.core.db.gun.get(recipientSafePath);
          recipientNode.map().once((messageData: any, messageId: string) => {
            if (
              messageData &&
              messageData.from === recipientPub &&
              messageData.to === currentUserPub
            ) {
              recipientNode.get(messageId).put(null, (ack: any) => {
                if (ack.err) {
                  console.error(
                    `[MessageProcessor] ❌ Errore pulizia messaggio ricevuto:`,
                    ack.err
                  );
                }
              });
            }
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Clear processed message IDs for this conversation
      for (const [messageId] of this.processedMessageIds.entries()) {
        this.processedMessageIds.delete(messageId);
      }

      console.log(
        `[MessageProcessor] ✅ Conversazione pulita per: ${recipientPub.slice(0, 8)}...`
      );

      return { success: true };
    } catch (error: any) {
      console.error(
        `[MessageProcessor] ❌ Errore pulizia conversazione:`,
        error
      );
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante la pulizia della conversazione",
      };
    }
  }

  /**
   * Creates a unique conversation identifier
   */
  private createConversationId(user1: string, user2: string): string {
    const sorted = [user1, user2].sort();
    return `${sorted[0]}_${sorted[1]}`;
  }

  /**
   * Checks if a conversation has been cleared
   */
  private isConversationCleared(from: string, to: string): boolean {
    const conversationId = this.createConversationId(from, to);
    return this.clearedConversations.has(conversationId);
  }

  /**
   * Resets the cleared conversations tracking
   */
  public resetClearedConversations(): void {
    this.clearedConversations.clear();
    console.log(`[MessageProcessor] 🔄 Reset cleared conversations tracking`);
  }

  /**
   * Gets the current listening status
   */
  public isListening(): boolean {
    return this._isListening;
  }

  /**
   * Gets the number of message listeners
   */
  public getMessageListenersCount(): number {
    return this.messageListeners.length;
  }

  /**
   * Gets the number of processed messages
   */
  public getProcessedMessagesCount(): number {
    return this.processedMessageIds.size;
  }

  /**
   * Gets the number of cleared conversations
   */
  public getClearedConversationsCount(): number {
    return this.clearedConversations.size;
  }

  /**
   * Clears processed message IDs for a specific group (useful when rejoining)
   */
  public clearProcessedGroupMessageIds(groupId?: string): void {
    // This functionality is no longer needed as GroupManager is removed.
    // Keeping the method signature for now, but it will do nothing.
    console.warn(
      `[MessageProcessor] clearProcessedGroupMessageIds is deprecated as GroupManager is removed.`
    );
  }
}
