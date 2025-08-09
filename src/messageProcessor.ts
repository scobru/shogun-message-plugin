import { ShogunCore } from "shogun-core";
import { MessageData, MessageListener, GroupMessageListener } from "./types";
import { createSafePath, cleanupExpiredEntries, limitMapSize } from "./utils";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";

/**
 * Message processing and listener management for the messaging plugin
 */
export class MessageProcessor {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private groupManager: GroupManager;

  // Message handling
  private messageListeners: MessageListener[] = [];
  private groupMessageListenersInternal: GroupMessageListener[] = [];
  private _isListening = false;
  private processedMessageIds = new Map<string, number>();
  private privateMessageListener: any = null;
  private groupMessageListeners = new Map<string, any>();

  // Configuration
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore
  private clearedConversations = new Set<string>();

  constructor(
    core: ShogunCore,
    encryptionManager: EncryptionManager,
    groupManager: GroupManager
  ) {
    this.core = core;
    this.encryptionManager = encryptionManager;
    this.groupManager = groupManager;
  }

  /**
   * Starts listening to private messages
   */
  public async startListening(): Promise<void> {
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

    // Start listening for private messages
    const currentUserSafePath = createSafePath(currentUserPub);
    const privateMessageNode = this.core.db.gun.get(currentUserSafePath).map();
    this.privateMessageListener = privateMessageNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingMessage(
          messageData,
          messageId,
          currentUserPair,
          currentUserPub
        );
      }
    );

    // NOTE: Group message listeners are now managed at the app layer via addGroupListener
  }

  /**
   * Adds a realtime listener for a specific group's messages
   */
  public addGroupListener(groupId: string): void {
    if (!groupId || this.groupMessageListeners.has(groupId)) return;

    const currentUserPair = (this.core.db.user as any)?._?.sea;
    if (!currentUserPair) {
      console.warn(
        `[MessageProcessor] Cannot add group listener without user keypair`
      );
      return;
    }

    const groupMessagePath = `group-messages/${groupId}`;
    const groupNode = this.core.db.gun.get(groupMessagePath).map();
    const listener = groupNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingGroupMessage(
          messageData,
          messageId,
          currentUserPair
        );
      }
    );

    this.groupMessageListeners.set(groupId, listener);
  }

  /**
   * Removes the realtime listener for a specific group's messages
   */
  public removeGroupListener(groupId: string): void {
    const listener = this.groupMessageListeners.get(groupId);
    if (listener && typeof listener.off === "function") {
      try {
        listener.off();
      } catch {}
    }
    this.groupMessageListeners.delete(groupId);
  }

  /**
   * Stops listening to private and group messages
   */
  public stopListening(): void {
    if (!this._isListening) return;

    // Stop private message listener
    if (this.privateMessageListener) {
      this.privateMessageListener.off();
      this.privateMessageListener = null;
    }

    // Stop all group message listeners (if any were added elsewhere)
    for (const [groupId, listener] of this.groupMessageListeners.entries()) {
      listener.off();
    }
    this.groupMessageListeners.clear();

    this._isListening = false;
    this.processedMessageIds.clear();
  }

  public async processIncomingGroupMessage(
    messageData: any,
    messageId: string,
    currentUserPair: any
  ): Promise<void> {
    try {
      const message = JSON.parse(messageData);
      const { from, content, timestamp, groupId, signature } = message;
      const currentUserPub = currentUserPair.pub;

      // Do not ignore messages from the current user; UI needs them to replace temp messages
      if (!from || !groupId) {
        return;
      }

      if (this.processedMessageIds.has(messageId)) {
        return;
      }
      this.processedMessageIds.set(messageId, Date.now());

      const groupData = await this.groupManager.getGroupData(groupId);
      if (!groupData || !groupData.members.includes(currentUserPub)) {
        this.processedMessageIds.delete(messageId);
        return;
      }

      const encryptedGroupKey = groupData.encryptedKeys[currentUserPub];
      const creatorEpub = await this.encryptionManager.getRecipientEpub(
        groupData.createdBy
      );
      const sharedSecret = await this.core.db.sea.secret(
        creatorEpub,
        currentUserPair
      );
      if (!sharedSecret) {
        this.processedMessageIds.delete(messageId);
        return;
      }
      const groupKey = await this.core.db.sea.decrypt(
        encryptedGroupKey,
        sharedSecret
      );

      if (!groupKey) {
        this.processedMessageIds.delete(messageId);
        return;
      }

      const decryptedContent = await this.core.db.sea.decrypt(
        content,
        groupKey
      );

      // **FIX: Verify signature against the DECRYPTED content**
      const isValid = await this.encryptionManager.verifyMessageSignature(
        decryptedContent,
        signature,
        from
      );
      if (!isValid) {
        console.warn(`[MessageProcessor] ⚠️ Invalid signature for group message ${messageId}`);
        this.processedMessageIds.delete(messageId);
        return;
      }

      const decryptedMessage: MessageData = {
        id: messageId,
        from,
        content: decryptedContent,
        timestamp,
        groupId,
        signature,
      };

      this.messageListeners.forEach((callback) => callback(decryptedMessage));
      this.groupMessageListenersInternal.forEach((callback) =>
        callback(decryptedMessage as any)
      );
    } catch (error) {
      this.processedMessageIds.delete(messageId);
    }
  }

  public onGroupMessage(callback: GroupMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }
    this.groupMessageListenersInternal.push(callback);
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

      // **FIX: Verify the signature on the decrypted message**
      if (decryptedMessage.signature) {
        // **FIX: Verify signature against the same canonical representation**
        const dataToVerify = JSON.stringify({
          content: decryptedMessage.content,
          timestamp: decryptedMessage.timestamp,
          id: decryptedMessage.id,
        });
        const isValid = await this.encryptionManager.verifyMessageSignature(
          dataToVerify,
          decryptedMessage.signature,
          decryptedMessage.from
        );

        if (!isValid) {
          console.warn(
            `[MessageProcessor] ⚠️ Invalid signature for private message ${messageId}`
          );
          this.processedMessageIds.delete(messageId);
          return;
        }
      } else {
        // This case can be removed once all clients are updated
        console.warn(
          `[MessageProcessor] ⚠️ Message ${messageId} without signature, skipping verification for compatibility.`
        );
      }

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
}
