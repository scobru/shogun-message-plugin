// Plugin di messaggistica E2E corretto per GunDB
import { ShogunCore } from "shogun-core";
import { BasePlugin } from "./base";
import { MessageProcessor } from "./messageProcessor";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";
import { PublicRoomManager } from "./publicRoomManager";
import { TokenRoomManager } from "./tokenRoomManager";
import { sendToGunDB } from "./utils";

/**
 * Messaging plugin for Shogun SDK - Protocol layer only
 * Provides end-to-end encrypted messaging capabilities
 */
export class MessagingPlugin extends BasePlugin {
  public readonly name = "messaging";
  public readonly version: string = "4.7.0";
  public readonly description =
    "End-to-end encrypted messaging plugin for Shogun SDK";
  public readonly _category = "messaging";

  protected core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private messageProcessor: MessageProcessor;
  private groupManager: GroupManager;
  private publicRoomManager: PublicRoomManager;
  private tokenRoomManager: TokenRoomManager;

  // Getter for testing purposes
  public get groupManagerForTesting(): GroupManager {
    return this.groupManager;
  }

  // Getter for testing purposes
  public get encryptionManagerForTesting(): EncryptionManager {
    return this.encryptionManager;
  }

  // Getter for testing purposes
  public get tokenRoomManagerForTesting(): TokenRoomManager {
    return this.tokenRoomManager;
  }

  constructor() {
    super();
    this.core = null as any;
    this.encryptionManager = null as any;
    this.messageProcessor = null as any;
    this.groupManager = null as any;
    this.publicRoomManager = null as any;
    this.tokenRoomManager = null as any;
  }

  /**
   * Initializes the plugin with the Shogun core
   */
  public async initialize(core: ShogunCore): Promise<void> {
    super.initialize(core);
    this.core = core;
    this.encryptionManager = new EncryptionManager(core);
    this.groupManager = new GroupManager(core, this.encryptionManager);
    this.publicRoomManager = new PublicRoomManager(
      core,
      this.encryptionManager
    );
    this.tokenRoomManager = new TokenRoomManager(core, this.encryptionManager, {
      enablePagination: true,
      pageSize: 50,
      maxProcessedMessages: 1000,
      onStatus: (event) => {
        // Log status events for debugging
        if (event.type.includes("error")) {
          console.warn("TokenRoomManager Status:", event);
        }
      },
    });
    this.messageProcessor = new MessageProcessor(
      core,
      this.encryptionManager,
      this.groupManager
    );

    // Initialize the token room manager
    await this.tokenRoomManager.initialize();
  }

  // ============================================================================
  // 🚀 CORE MESSAGING FUNCTIONS (4 essential send functions)
  // ============================================================================

  /**
   * Sends a private message to a recipient (1-to-1 encrypted)
   */
  public async sendMessage(
    recipientPub: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio.",
      };
    }

    if (!recipientPub || !messageContent) {
      return {
        success: false,
        error: "Destinatario e messaggio sono obbligatori.",
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
      const messageId = (() => {
        const bytes = new Uint8Array(8);
        (globalThis as any)?.crypto?.getRandomValues?.(bytes);
        const rand = Array.from(bytes, (b) =>
          b.toString(16).padStart(2, "0")
        ).join("");
        return `msg_${Date.now()}_${rand}`;
      })();

      // Create the complete message
      const messageData: any = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
      };

      // **FIX: Sign a canonical representation of the message data**
      const dataToSign = JSON.stringify(
        {
          content: messageData.content,
          timestamp: messageData.timestamp,
          id: messageData.id,
        },
        Object.keys({ content: "", timestamp: 0, id: "" }).sort()
      );

      messageData.signature = await this.core.db.sea.sign(
        dataToSign,
        currentUserPair
      );

      // Encrypt the entire message for the recipient
      const recipientEpub =
        await this.encryptionManager.getRecipientEpub(recipientPub);
      const sharedSecret = await this.core.db.sea.secret(
        recipientEpub,
        currentUserPair
      );
      const encryptedMessage = await this.core.db.sea.encrypt(
        messageData,
        sharedSecret || ""
      );

      // Create the wrapper for GunDB
      const encryptedMessageData = {
        data: encryptedMessage,
        from: senderPub,
        timestamp: Date.now(),
        id: messageId,
      };

      // Send to GunDB using shared helper so path matches listener expectations
      await sendToGunDB(
        this.core,
        recipientPub,
        messageId,
        encryptedMessageData,
        "private"
      );

      return { success: true, messageId };
    } catch (error: any) {
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante l'invio del messaggio",
      };
    }
  }

  /**
   * Sends a message to a group (encrypted with group key)
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.groupManager.sendGroupMessage(groupId, messageContent);
  }

  /**
   * Sends a message to a token-protected room (encrypted with shared token)
   */
  public async sendTokenRoomMessage(
    roomId: string,
    messageContent: string,
    token: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.tokenRoomManager.sendTokenRoomMessage(
      roomId,
      messageContent,
      token
    );
  }

  /**
   * Sends a public message to a room (unencrypted, signed)
   */
  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.publicRoomManager.sendPublicMessage(roomId, messageContent);
  }

  /**
   * Creates a new public room
   */
  public async createPublicRoom(
    roomName: string,
    description?: string
  ): Promise<{ success: boolean; roomData?: any; error?: string }> {
    return this.publicRoomManager.createPublicRoom(roomName, description);
  }

  /**
   * Gets all available public rooms
   */
  public async getPublicRooms(): Promise<any[]> {
    return this.publicRoomManager.getPublicRooms();
  }

  /**
   * Gets a specific public room by ID
   */
  public async getPublicRoom(roomId: string): Promise<any | null> {
    return this.publicRoomManager.getPublicRoom(roomId);
  }

  /**
   * Starts room discovery to listen for new rooms
   */
  public startRoomDiscovery(): void {
    this.publicRoomManager.startRoomDiscovery();
  }

  /**
   * Stops room discovery
   */
  public stopRoomDiscovery(): void {
    this.publicRoomManager.stopRoomDiscovery();
  }

  /**
   * Initializes default public rooms if none exist
   */
  public async initializeDefaultRooms(): Promise<void> {
    return this.publicRoomManager.initializeDefaultRooms();
  }

  // ============================================================================
  // 🔄 COMPATIBILITY SHIMS (legacy app API)
  // ============================================================================

  /**
   * Legacy alias: start listening to private messages
   */
  public startListening(): void {
    try {
      this.messageProcessor.startListening();
    } catch {}
  }

  /**
   * Legacy alias: stop listening
   */
  public stopListening(): void {
    try {
      this.messageProcessor.stopListening();
    } catch {}
  }

  /**
   * Legacy alias: subscribe to decrypted private messages
   */
  public onMessage(callback: any): void {
    try {
      this.messageProcessor.onMessage(callback);
    } catch {}
  }

  /**
   * Legacy API used by Invite flows to join chats
   */
  public async joinChat(
    chatType: "private" | "public" | "group" | "token",
    chatId: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    try {
      if (!chatType || !chatId) {
        return { success: false, error: "Invalid chat type or id" };
      }

      if (chatType === "public") {
        // Start listening to the public room and expose minimal chat data
        this.publicRoomManager.startListeningPublic(chatId);
        return {
          success: true,
          chatData: { type: "public", id: chatId, name: chatId },
        };
      }

      if (chatType === "group") {
        // Ensure a listener is attached and return current metadata
        this.messageProcessor.addGroupListener(chatId);
        const groupData = await this.groupManager.getGroupData(chatId);
        return {
          success: !!groupData,
          chatData: groupData || { type: "group", id: chatId, name: chatId },
          error: groupData ? undefined : "Group not found",
        };
      }

      if (chatType === "private") {
        // Nothing to join at protocol level; mark as available
        return { success: true, chatData: { type: "private", id: chatId } };
      }

      if (chatType === "token") {
        // Join token room and return room data
        const result = await this.tokenRoomManager.joinTokenRoom(
          chatId,
          arguments[2] || ""
        );
        return {
          success: result.success,
          chatData: result.roomData,
          error: result.error,
        };
      }

      return { success: false, error: "Unsupported chat type for joinChat" };
    } catch (error: any) {
      return { success: false, error: error?.message || String(error) };
    }
  }

  /**
   * Minimal runtime stats for panels
   */
  public getStats(): {
    isListening: boolean;
    messageListenersCount: number;
    processedMessagesCount: number;
    hasActiveListener: boolean;
  } {
    const isListening = this.messageProcessor?.isListening?.() || false;
    const messageListenersCount =
      this.messageProcessor?.getMessageListenersCount?.() || 0;
    const processedMessagesCount =
      this.messageProcessor?.getProcessedMessagesCount?.() || 0;
    const hasActiveListener =
      this.areProtocolListenersActive?.() || isListening;
    return {
      isListening,
      messageListenersCount,
      processedMessagesCount,
      hasActiveListener,
    };
  }

  // ============================================================================
  // 🔧 PROTOCOL SUPPORT FUNCTIONS (needed for the 4 send functions to work)
  // ============================================================================

  /**
   * Creates a new group chat (needed for sendGroupMessage)
   */
  public async createGroup(
    groupName: string,
    memberPubs: string[]
  ): Promise<{ success: boolean; groupData?: any; error?: string }> {
    return this.groupManager.createGroup(groupName, memberPubs);
  }

  /**
   * Creates a new token room (needed for sendTokenRoomMessage)
   */
  public async createTokenRoom(
    roomName: string,
    description?: string,
    maxParticipants?: number
  ): Promise<{ success: boolean; roomData?: any; error?: string }> {
    return this.tokenRoomManager.createTokenRoom(
      roomName,
      description,
      maxParticipants
    );
  }

  /**
   * Gets group data (needed for group operations)
   */
  public async getGroupData(groupId: string): Promise<any | null> {
    return this.groupManager.getGroupData(groupId);
  }

  /**
   * Gets token room data (needed for token room operations)
   */
  public async getTokenRoomData(roomId: string): Promise<any | null> {
    return this.tokenRoomManager.getTokenRoomData(roomId);
  }

  /**
   * Joins a token room (needed for sendTokenRoomMessage)
   */
  public async joinTokenRoom(
    roomId: string,
    token: string
  ): Promise<{ success: boolean; roomData?: any; error?: string }> {
    return this.tokenRoomManager.joinTokenRoom(roomId, token);
  }

  /**
   * Gets a recipient's epub (needed for private messaging)
   */
  public async getRecipientEpub(recipientPub: string): Promise<string> {
    return this.encryptionManager.getRecipientEpub(recipientPub);
  }

  /**
   * Publishes the user's epub (needed for others to message this user)
   */
  public async publishUserEpub(): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      await this.encryptionManager.ensureUserEpubPublished();
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to publish encryption key",
      };
    }
  }

  /**
   * Checks if a user's epub is available (needed for messaging validation)
   */
  public async checkUserEpubAvailability(userPub: string): Promise<{
    available: boolean;
    epub?: string;
    error?: string;
  }> {
    try {
      const epub = await this.encryptionManager.getRecipientEpub(userPub);
      return { available: true, epub };
    } catch (error: any) {
      return {
        available: false,
        error: error.message || "Encryption key not found",
      };
    }
  }

  /**
   * Gets the current user's epub
   */
  public getCurrentUserEpub(): string | null {
    if (!this.core || !this.core.db || !this.core.db.user) {
      return null;
    }
    const currentUserPair = (this.core.db.user as any)._?.sea;
    return currentUserPair?.epub || null;
  }

  // ============================================================================
  // 🎧 RAW PROTOCOL LISTENERS (for app to implement UI layer)
  // ============================================================================

  /**
   * Registers a callback for raw private messages (protocol level)
   */
  public onRawMessage(callback: any): void {
    this.messageProcessor.onMessage(callback);
  }

  /**
   * Registers a callback for raw public messages (protocol level)
   */
  public onRawPublicMessage(callback: any): void {
    this.publicRoomManager.onPublicMessage(callback);
  }

  /**
   * Starts listening to a specific public room
   */
  public startListeningPublic(roomId: string): void {
    this.publicRoomManager.startListeningPublic(roomId);
  }

  /**
   * Stops listening to public rooms
   */
  public stopListeningPublic(): void {
    this.publicRoomManager.stopListeningPublic();
  }

  /**
   * Removes a specific public message listener callback
   */
  public removePublicMessageListener(callback: any): void {
    this.publicRoomManager.removePublicMessageListener(callback);
  }

  /**
   * Registers a callback for raw token room messages (protocol level)
   */
  public onRawTokenRoomMessage(callback: any): void {
    this.tokenRoomManager.onTokenRoomMessage(callback);
  }

  /**
   * Starts listening to token room messages for the current user
   */
  public startListeningTokenRooms(): void {
    this.tokenRoomManager.startListeningTokenRooms();
  }

  /**
   * Stops listening to token room messages
   */
  public stopListeningTokenRooms(): void {
    this.tokenRoomManager.stopListeningTokenRooms();
  }

  /**
   * Deletes a token room completely from the database
   * Only the room creator can delete the room
   */
  public async deleteTokenRoom(
    roomId: string
  ): Promise<{ success: boolean; error?: string }> {
    // For now, just leave the room - full deletion requires additional implementation
    this.tokenRoomManager.stopListeningTokenRooms();
    return { success: true };
  }

  /**
   * Registers a callback for raw group messages (protocol level)
   */
  public onRawGroupMessage(callback: any): void {
    this.messageProcessor.onGroupMessage(callback);
  }

  /**
   * Adds a realtime listener for a specific group's messages (protocol level)
   */
  public addGroupListener(groupId: string): void {
    this.messageProcessor.addGroupListener(groupId);
  }

  /**
   * Removes the realtime listener for a specific group's messages (protocol level)
   */
  public removeGroupListener(groupId: string): void {
    this.messageProcessor.removeGroupListener(groupId);
  }

  /**
   * Starts the protocol message listeners
   */
  public startProtocolListeners(): void {
    this.messageProcessor.startListening();
  }

  /**
   * Stops the protocol message listeners
   */
  public stopProtocolListeners(): void {
    this.messageProcessor.stopListening();
  }

  /**
   * Checks if protocol listeners are active
   */
  public areProtocolListenersActive(): boolean {
    return this.messageProcessor.isListening();
  }

  /**
   * Clears all messages for a specific conversation
   */
  public async clearConversation(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string; clearedCount?: number }> {
    return this.messageProcessor.clearConversation(recipientPub);
  }

  /**
   * Debug method to check listener status
   */
  public getListenerStatus(): {
    isListening: boolean;
    messageListenersCount: number;
    processedMessagesCount: number;
    clearedConversationsCount: number;
  } {
    return {
      isListening: this.messageProcessor.isListening(),
      messageListenersCount: this.messageProcessor.getMessageListenersCount(),
      processedMessagesCount: this.messageProcessor.getProcessedMessagesCount(),
      clearedConversationsCount:
        this.messageProcessor.getClearedConversationsCount(),
    };
  }

  // ============================================================================
  // 🚀 REAL-TIME MESSAGE LISTENERS (for caching optimization)
  // ============================================================================

  /**
   * Start real-time message listener for token rooms
   */
  public async startTokenRoomMessageListener(
    roomId: string,
    callback: (message: any) => void
  ): Promise<{ success: boolean; error?: string }> {
    // Use the new unified listener system
    this.tokenRoomManager.onTokenRoomMessage(callback);
    await this.tokenRoomManager.startListeningTokenRooms();
    return { success: true };
  }

  /**
   * Stop real-time message listener for token rooms
   */
  public async stopTokenRoomMessageListener(
    roomId: string
  ): Promise<{ success: boolean; error?: string }> {
    // Stop all listeners - the new system manages them centrally
    this.tokenRoomManager.stopListeningTokenRooms();
    return { success: true };
  }

  /**
   * Get cached messages for a specific chat type
   */
  public async getTokenRoomMessages(roomId: string): Promise<any[]> {
    return this.tokenRoomManager.getTokenRoomMessages(roomId);
  }
}
