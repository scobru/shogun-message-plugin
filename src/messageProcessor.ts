import { ShogunCore } from "shogun-core";
import {
  MessageData,
  GroupMessage,
  MessageListener,
  GroupMessageListener,
} from "./types";
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

  // Private message handling
  private messageListeners: MessageListener[] = [];
  private _isListening = false;
  private processedMessageIds = new Map<string, number>();
  private messageListener: any = null;

  // Group message handling
  private groupMessageListeners: GroupMessageListener[] = [];
  private _isListeningGroups = false;
  private processedGroupMessageIds = new Map<string, number>();
  private groupMessageListener: any = null;

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
   * Starts listening to group messages
   */
  public startListeningGroups(): void {
    if (
      !this.core.isLoggedIn() ||
      this._isListeningGroups ||
      !this.core.db.user
    ) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(
        `[MessageProcessor] Coppia di chiavi utente non disponibile`
      );
      return;
    }

    this._isListeningGroups = true;
    const currentUserPub = currentUserPair.pub;

    console.log(`[MessageProcessor] 🔊 Starting group message listener`);

    // Listener per messaggi di gruppo
    const userGroupsNode = this.core.db.gun
      .get(`user_${currentUserPub}`)
      .get("groups")
      .map();

    this.groupMessageListener = userGroupsNode.on(
      async (groupData: any, groupId: string) => {
        if (groupData && groupData.id) {
          await this.startListeningToGroup(
            groupId,
            currentUserPair,
            currentUserPub
          );
        }
      }
    );
  }

  /**
   * Stops listening to group messages
   */
  public stopListeningGroups(): void {
    if (!this._isListeningGroups) return;

    if (this.groupMessageListener) {
      this.groupMessageListener.off();
      this.groupMessageListener = null;
    }

    this._isListeningGroups = false;
    this.processedGroupMessageIds.clear();
    console.log(`[MessageProcessor] 🔇 Stopped group message listener`);
  }

  /**
   * Restarts listening to group messages (useful after leaving/rejoining groups)
   */
  public restartListeningGroups(): void {
    console.log(`[MessageProcessor] 🔄 Restarting group message listener`);
    this.stopListeningGroups();
    // Clear processed group message IDs to allow reprocessing when rejoining groups
    this.processedGroupMessageIds.clear();
    console.log(`[MessageProcessor] 🧹 Cleared processed group message IDs`);
    this.startListeningGroups();
  }

  /**
   * Starts listening to a specific group
   */
  private async startListeningToGroup(
    groupId: string,
    currentUserPair: any,
    currentUserPub: string
  ): Promise<void> {
    console.log(`[MessageProcessor] 🔊 Listening to group: ${groupId}`);

    const groupMessagesNode = this.core.db.gun.get(`group_${groupId}`).map();

    groupMessagesNode.on(async (messageData: any, messageId: string) => {
      await this.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair,
        currentUserPub,
        groupId
      );
    });
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
   * Processes incoming group messages using Multiple People Encryption
   */
  private async processIncomingGroupMessage(
    messageData: any,
    messageId: string,
    currentUserPair: any,
    currentUserPub: string,
    groupId: string
  ): Promise<void> {
    // Validazione base
    if (
      !messageData?.encryptedContent ||
      !messageData?.from ||
      !messageData?.groupId ||
      messageData.groupId !== groupId
    ) {
      return;
    }

    // Controllo duplicati per ID
    if (this.processedGroupMessageIds.has(messageId)) {
      console.log(
        `[MessageProcessor] 🔄 Duplicate group message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedGroupMessageIds.set(messageId, Date.now());

    try {
      let decryptedGroupKey: string | null = null;

      // Check if the current user is the sender
      if (messageData.from === currentUserPub) {
        // Current user is the sender, get the group's encryption key directly
        console.log(
          `[MessageProcessor] 🔐 Current user is sender, getting group encryption key directly`
        );

        const groupData = await this.groupManager.getGroupData(groupId);
        if (groupData?.encryptionKey) {
          decryptedGroupKey = groupData.encryptionKey;
          console.log(
            `[MessageProcessor] ✅ Retrieved group encryption key for sender`
          );
        } else {
          console.error(
            `[MessageProcessor] ❌ Could not retrieve group encryption key for sender`
          );
          return;
        }
      } else {
        // Current user is not the sender, decrypt the group key using their encrypted key
        console.log(
          `[MessageProcessor] 🔐 Current user is recipient, decrypting group key`
        );

        // STEP 1: Get the group data to find the creator and encrypted keys
        const groupData = await this.groupManager.getGroupData(groupId);
        if (!groupData) {
          console.error(`[MessageProcessor] ❌ Could not retrieve group data`);
          return;
        }

        // STEP 2: Get the encrypted key for this user
        console.log(
          `[MessageProcessor] 🔍 Looking for encrypted key for user: ${currentUserPub}`
        );
        console.log(
          `[MessageProcessor] 🔍 Available encrypted keys:`,
          messageData.encryptedKeys
        );

        // Handle GunDB reference in encryptedKeys
        let resolvedEncryptedKeys = messageData.encryptedKeys;
        if (
          messageData.encryptedKeys &&
          typeof messageData.encryptedKeys === "object" &&
          messageData.encryptedKeys["#"]
        ) {
          console.log(
            `[MessageProcessor] 🔍 Resolving encryptedKeys reference: ${messageData.encryptedKeys["#"]}`
          );
          try {
            const resolvedKeys = await new Promise<any>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(
                  new Error("Timeout resolving encryptedKeys reference (5s)")
                );
              }, 5000);

              this.core.db.gun
                .get(messageData.encryptedKeys["#"])
                .once((data: any) => {
                  clearTimeout(timeout);
                  resolve(data);
                });
            });
            console.log(
              `[MessageProcessor] 🔍 Resolved encryptedKeys:`,
              resolvedKeys
            );
            resolvedEncryptedKeys = resolvedKeys;
          } catch (resolveError) {
            console.warn(
              `[MessageProcessor] ⚠️ Could not resolve encryptedKeys reference:`,
              resolveError
            );
            return;
          }
        }

        const encryptedKey = resolvedEncryptedKeys?.[currentUserPub];
        if (!encryptedKey) {
          console.warn(
            `[MessageProcessor] ⚠️ No encrypted key found for user in group message`
          );
          console.warn(
            `[MessageProcessor] ⚠️ Current user pub: ${currentUserPub}`
          );
          console.warn(
            `[MessageProcessor] ⚠️ Available keys:`,
            Object.keys(resolvedEncryptedKeys || {})
          );
          console.warn(`[MessageProcessor] ⚠️ Full message data:`, messageData);
          return;
        }

        // STEP 3: Decrypt the group key using the group creator's shared secret
        // The group key was encrypted by the creator, so we need the creator's epub
        console.log(
          `[MessageProcessor] 🔐 Getting creator epub for: ${groupData.createdBy.slice(0, 8)}...`
        );

        let creatorEpub: string;
        try {
          creatorEpub = await this.encryptionManager.getRecipientEpub(
            groupData.createdBy
          );
          console.log(
            `[MessageProcessor] 🔐 Creator epub retrieved: ${creatorEpub.slice(0, 8)}...`
          );
        } catch (epubError) {
          console.error(
            `[MessageProcessor] ❌ Could not get creator epub:`,
            epubError
          );
          console.error(
            `[MessageProcessor] ❌ Creator pub: ${groupData.createdBy}`
          );
          console.error(
            `[MessageProcessor] ❌ This may indicate the creator's epub is not published or accessible`
          );
          return;
        }

        console.log(
          `[MessageProcessor] 🔐 Generating shared secret with creator...`
        );
        const sharedSecret = await this.core.db.sea.secret(
          creatorEpub,
          currentUserPair
        );
        console.log(
          `[MessageProcessor] 🔐 Shared secret generated: ${sharedSecret ? "success" : "failed"}`
        );

        if (!sharedSecret) {
          console.error(
            `[MessageProcessor] ❌ Could not generate shared secret with creator`
          );
          console.error(
            `[MessageProcessor] ❌ Creator pub: ${groupData.createdBy}`
          );
          console.error(`[MessageProcessor] ❌ Creator epub: ${creatorEpub}`);
          console.error(
            `[MessageProcessor] ❌ Current user pair available: ${!!currentUserPair}`
          );
          return;
        }

        console.log(`[MessageProcessor] 🔐 Decrypting group key...`);
        decryptedGroupKey = await this.core.db.sea.decrypt(
          encryptedKey,
          sharedSecret
        );

        if (!decryptedGroupKey) {
          console.error(`[MessageProcessor] ❌ Could not decrypt group key`);
          console.error(
            `[MessageProcessor] ❌ Creator pub: ${groupData.createdBy}`
          );
          console.error(`[MessageProcessor] ❌ Creator epub: ${creatorEpub}`);
          console.error(
            `[MessageProcessor] ❌ Shared secret available: ${!!sharedSecret}`
          );
          console.error(
            `[MessageProcessor] ❌ Encrypted key length: ${encryptedKey?.length || 0}`
          );
          return;
        }

        console.log(`[MessageProcessor] ✅ Group key decrypted successfully`);
      }

      // STEP 3: Decifra il contenuto del messaggio usando la chiave del gruppo
      const decryptedContent = await this.core.db.sea.decrypt(
        messageData.encryptedContent,
        decryptedGroupKey
      );

      if (!decryptedContent) {
        console.error(
          `[MessageProcessor] ❌ Could not decrypt message content`
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
            `[MessageProcessor] ⚠️ Invalid signature for group message from: ${messageData.from.slice(0, 8)}...`
          );
        }
      }

      // Crea il messaggio decifrato
      const decryptedGroupMessage: GroupMessage = {
        ...messageData,
        content: decryptedContent,
      };

      // Notifica i listener
      if (this.groupMessageListeners.length > 0) {
        this.groupMessageListeners.forEach((callback) => {
          try {
            callback(decryptedGroupMessage);
          } catch (error) {
            console.error(
              `[MessageProcessor] ❌ Errore listener gruppo:`,
              error
            );
          }
        });
      } else {
        console.warn(
          `[MessageProcessor] ⚠️ Nessun listener gruppo registrato per il messaggio`
        );
      }
    } catch (error) {
      this.processedGroupMessageIds.delete(messageId);
      console.error(
        `[MessageProcessor] ❌ Errore processamento messaggio gruppo:`,
        error
      );
    }
  }

  /**
   * Enhanced cleanup for all message types
   */
  private cleanupProcessedMessages(): void {
    // Clean up private message IDs
    cleanupExpiredEntries(this.processedMessageIds, this.MESSAGE_TTL);
    limitMapSize(this.processedMessageIds, this.MAX_PROCESSED_MESSAGES);

    // Clean up group message IDs
    cleanupExpiredEntries(this.processedGroupMessageIds, this.MESSAGE_TTL);
    limitMapSize(this.processedGroupMessageIds, this.MAX_PROCESSED_MESSAGES);
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
   * Registers a callback for group messages
   */
  public onGroupMessage(callback: GroupMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.groupMessageListeners.push(callback);
  }

  /**
   * Removes a specific group message listener
   */
  public removeGroupMessageListener(callback: GroupMessageListener): void {
    const index = this.groupMessageListeners.indexOf(callback);
    if (index > -1) {
      this.groupMessageListeners.splice(index, 1);
      console.log(`[MessageProcessor] 🗑️ Removed group message listener`);
    }
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
   * Gets the current group listening status
   */
  public isListeningGroups(): boolean {
    return this._isListeningGroups;
  }

  /**
   * Gets the number of message listeners
   */
  public getMessageListenersCount(): number {
    return this.messageListeners.length;
  }

  /**
   * Gets the number of group message listeners
   */
  public getGroupMessageListenersCount(): number {
    return this.groupMessageListeners.length;
  }

  /**
   * Gets the number of processed messages
   */
  public getProcessedMessagesCount(): number {
    return this.processedMessageIds.size;
  }

  /**
   * Gets the number of processed group messages
   */
  public getProcessedGroupMessagesCount(): number {
    return this.processedGroupMessageIds.size;
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
    if (groupId) {
      // Clear only messages for this specific group
      const keysToDelete: string[] = [];
      this.processedGroupMessageIds.forEach((timestamp, messageId) => {
        if (messageId.includes(groupId)) {
          keysToDelete.push(messageId);
        }
      });
      keysToDelete.forEach((key) => this.processedGroupMessageIds.delete(key));
      console.log(
        `[MessageProcessor] 🧹 Cleared ${keysToDelete.length} processed message IDs for group: ${groupId}`
      );
    } else {
      // Clear all processed group message IDs
      this.processedGroupMessageIds.clear();
      console.log(
        `[MessageProcessor] 🧹 Cleared all processed group message IDs`
      );
    }
  }
}
