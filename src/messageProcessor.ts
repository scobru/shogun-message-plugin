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
    groupManager: GroupManager,
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
          currentUserPub,
        );
      },
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
      return;
    }

    const groupMessagePath = `group-messages/${groupId}`;
    const groupNode = this.core.db.gun.get(groupMessagePath).map();
    const listener = groupNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingGroupMessage(
          messageData,
          messageId,
          currentUserPair,
        );
      },
    );

    this.groupMessageListeners.set(groupId, listener);

    // **FIX: Log when group listener is added for debugging**
    console.log("🔍 addGroupListener: Added listener for group", groupId);
    console.log(
      "🔍 addGroupListener: Total group listeners:",
      this.groupMessageListeners.size,
    );
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
   * Checks if a specific group has an active listener
   */
  public hasGroupListener(groupId: string): boolean {
    return this.groupMessageListeners.has(groupId);
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
    currentUserPair: any,
  ): Promise<void> {
    console.log(
      "🔍 processIncomingGroupMessage: Processing message",
      messageId,
    );
    try {
      const message = JSON.parse(messageData);
      const { from, content, timestamp, groupId, signature } = message;
      const currentUserPub = currentUserPair.pub;

      console.log("🔍 processIncomingGroupMessage: Message details:", {
        from,
        groupId,
        hasContent: !!content,
        hasSignature: !!signature,
      });

      // Do not ignore messages from the current user; UI needs them to replace temp messages
      if (!from || !groupId) {
        console.log(
          "🔍 processIncomingGroupMessage: Missing from or groupId, skipping",
        );
        return;
      }

      if (this.processedMessageIds.has(messageId)) {
        console.log(
          "🔍 processIncomingGroupMessage: Message already processed, skipping",
        );
        return;
      }
      this.processedMessageIds.set(messageId, Date.now());
      console.log(
        "🔍 processIncomingGroupMessage: Message marked as processed",
      );

      const groupData = await this.groupManager.getGroupData(groupId);
      if (!groupData) {
        console.log(
          "🔍 processIncomingGroupMessage: Group data not found, skipping",
        );
        this.processedMessageIds.delete(messageId);
        return;
      }

      console.log(
        "🔍 processIncomingGroupMessage: Group data found, proceeding with decryption",
      );

      // Use the improved group key retrieval method
      console.log("🔍 processIncomingGroupMessage: Getting group key for user");
      const groupKey = await this.groupManager.getGroupKeyForUser(
        groupData,
        currentUserPub,
        currentUserPair,
      );

      if (!groupKey) {
        console.log("🔍 processIncomingGroupMessage: Failed to get group key");
        this.processedMessageIds.delete(messageId);
        return;
      }

      console.log(
        "🔍 processIncomingGroupMessage: Group key obtained, decrypting content",
      );

      // Decrypt the message content using the group key
      const decryptedContent = await this.core.db.sea.decrypt(
        content,
        groupKey,
      );

      console.log(
        "🔍 processIncomingGroupMessage: Content decrypted successfully",
      );

      // Ensure decrypted content is a string
      let finalDecryptedContent: string;
      if (typeof decryptedContent === "object" && decryptedContent !== null) {
        if (typeof decryptedContent.content === "string") {
          finalDecryptedContent = decryptedContent.content;
        } else {
          finalDecryptedContent = JSON.stringify(decryptedContent);
        }
      } else {
        finalDecryptedContent = String(decryptedContent);
      }

      // **FIX: Verify signature against the DECRYPTED content**
      console.log("🔍 processIncomingGroupMessage: Verifying signature");
      const isValid = await this.encryptionManager.verifyMessageSignature(
        finalDecryptedContent,
        signature,
        from,
      );
      console.log("🔍 processIncomingGroupMessage: Signature valid:", isValid);
      if (!isValid) {
        console.log(
          "🔍 processIncomingGroupMessage: Invalid signature, skipping",
        );
        this.processedMessageIds.delete(messageId);
        return;
      }

      const decryptedMessage: MessageData = {
        id: messageId,
        from,
        content: finalDecryptedContent,
        timestamp,
        groupId,
        signature,
      };

      console.log(
        "🔍 processIncomingGroupMessage: Notifying listeners, count:",
        this.messageListeners.length +
          this.groupMessageListenersInternal.length,
      );
      this.messageListeners.forEach((callback) => callback(decryptedMessage));
      this.groupMessageListenersInternal.forEach((callback) =>
        callback(decryptedMessage as any),
      );
      console.log(
        "🔍 processIncomingGroupMessage: Message processing completed successfully",
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
    currentUserPub: string,
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
      return;
    }

    this.cleanupProcessedMessages();
    this.processedMessageIds.set(messageId, Date.now());

    try {
      // Decifra il messaggio
      const decryptedMessage = await this.encryptionManager.decryptMessage(
        messageData.data,
        currentUserPair,
        messageData.from,
      );

      // **FIX: Verify the signature on the decrypted message**
      if (decryptedMessage.signature) {
        // **FIX: Verify signature against the same canonical representation**
        const dataToVerify = JSON.stringify(
          {
            content: decryptedMessage.content,
            timestamp: decryptedMessage.timestamp,
            id: decryptedMessage.id,
          },
          Object.keys({ content: "", timestamp: 0, id: "" }).sort(),
        );

        const isValid = await this.encryptionManager.verifyMessageSignature(
          dataToVerify,
          decryptedMessage.signature,
          decryptedMessage.from,
        );

        if (!isValid) {
          this.processedMessageIds.delete(messageId);
          return;
        }
      }

      // Check if this conversation has been cleared AFTER decryption
      if (this.isConversationCleared(decryptedMessage.from, currentUserPub)) {
        this.processedMessageIds.delete(messageId);
        return;
      }

      // Notifica i listener
      if (this.messageListeners.length > 0) {
        this.messageListeners.forEach((callback, index) => {
          try {
            callback(decryptedMessage);
          } catch (error) {
            // Silent error handling
          }
        });
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
   * Clears all messages in a conversation with a specific recipient
   */
  public async clearConversation(
    recipientPub: string,
  ): Promise<{ success: boolean; error?: string; clearedCount?: number }> {
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
        recipientPub,
      );

      // Mark this conversation as cleared
      this.clearedConversations.add(conversationId);

      let totalClearedCount = 0;

      // **FIX: Clear messages from the correct paths**
      // Messages sent TO the recipient are stored under recipient's path
      const recipientSafePath = createSafePath(recipientPub);
      const recipientClearedCount = await this.clearMessagesFromPath(
        recipientSafePath,
        currentUserPub,
        recipientPub,
        "recipient",
      );
      totalClearedCount += recipientClearedCount;

      // Messages received FROM the recipient are stored under current user's path
      const currentUserSafePath = createSafePath(currentUserPub);
      const currentUserClearedCount = await this.clearMessagesFromPath(
        currentUserSafePath,
        recipientPub,
        currentUserPub,
        "sender",
      );
      totalClearedCount += currentUserClearedCount;

      // Clear processed message IDs for this conversation
      const processedCount = this.processedMessageIds.size;
      for (const [messageId] of this.processedMessageIds.entries()) {
        this.processedMessageIds.delete(messageId);
      }

      return {
        success: true,
        clearedCount: totalClearedCount,
      };
    } catch (error: any) {
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante la pulizia della conversazione",
      };
    }
  }

  /**
   * Helper method to clear messages from a specific path
   */
  private async clearMessagesFromPath(
    path: string,
    fromPub: string,
    toPub: string,
    pathType: "sender" | "recipient",
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        const node = this.core.db.gun.get(path);
        let clearedCount = 0;
        let totalMessages = 0;
        let completedOperations = 0;
        let hasError = false;
        let timeoutId: NodeJS.Timeout;

        const checkCompletion = () => {
          if (completedOperations === totalMessages && totalMessages > 0) {
            clearTimeout(timeoutId);
            if (hasError) {
              reject(
                new Error(`Errore durante la pulizia dei messaggi ${pathType}`),
              );
            } else {
              resolve(clearedCount);
            }
          }
        };

        node.map().once((messageData: any, messageId: string) => {
          totalMessages++;

          // Check if this message should be cleared based on the conversation
          // For private messages, we need to check the 'from' field at the top level
          // The 'to' field is not stored at the top level, so we determine it based on the path context
          // For recipient path: messages sent TO the recipient (from current user TO recipient)
          // For sender path: messages received FROM the sender (from sender TO current user)
          const shouldClear = messageData && messageData.from === fromPub;

          if (shouldClear) {
            node.get(messageId).put(null, (ack: any) => {
              completedOperations++;

              if (ack.err) {
                hasError = true;
              } else {
                clearedCount++;
              }

              checkCompletion();
            });
          } else {
            completedOperations++;
            checkCompletion();
          }
        });

        // Handle case where no messages are found
        timeoutId = setTimeout(() => {
          if (totalMessages === 0) {
            resolve(0);
          }
        }, 2000); // Increased timeout to 2 seconds
      } catch (error) {
        reject(error);
      }
    });
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
   * Gets the number of group message listeners
   */
  public getGroupMessageListenersCount(): number {
    return this.groupMessageListeners.size;
  }

  /**
   * Checks if group listening is active
   */
  public isListeningGroups(): boolean {
    return this.groupMessageListeners.size > 0;
  }
}
