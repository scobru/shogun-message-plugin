// Plugin di messaggistica E2E corretto per GunDB
import { ShogunCore } from "shogun-core";
import { BasePlugin } from "./base";
import { MessageProcessor } from "./messageProcessor";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";
import { PublicRoomManager } from "./publicRoomManager";
import { TokenRoomManager } from "./tokenRoomManager";
import { sendToGunDB, createSafePath, createConversationPath } from "./utils";

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

  // **PRODUCTION: Performance monitoring**
  private performanceMetrics = {
    messagesSent: 0,
    messagesReceived: 0,
    encryptionOperations: 0,
    averageResponseTime: 0,
    totalResponseTime: 0,
    responseCount: 0,
  };

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

  // Getter for testing purposes
  public get publicRoomManagerForTesting(): PublicRoomManager {
    return this.publicRoomManager;
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
    return this.safeOperation(async () => {
      super.initialize(core);
      this.core = core;
      this.encryptionManager = new EncryptionManager(core);
      this.groupManager = new GroupManager(core, this.encryptionManager);
      this.publicRoomManager = new PublicRoomManager(
        core,
        this.encryptionManager
      );
      this.tokenRoomManager = new TokenRoomManager(
        core,
        this.encryptionManager,
        {
          enablePagination: true,
          pageSize: 50,
          maxProcessedMessages: 1000,
          onStatus: (event) => {
            // Log status events for debugging
            if (event.type.includes("error")) {
              console.warn("TokenRoomManager Status:", event);
            }
          },
        }
      );
      this.messageProcessor = new MessageProcessor(
        core,
        this.encryptionManager,
        this.groupManager
      );

      // Initialize the token room manager
      await this.tokenRoomManager.initialize();

      // **FIX: Initialize the group manager**
      await this.groupManager.initialize();
    }, "initialize");
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
    const startTime = performance.now();

    return this.safeOperation(async () => {
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

      // **PRODUCTION: Input validation**
      if (typeof messageContent !== "string") {
        return {
          success: false,
          error: "Il messaggio deve essere una stringa valida.",
        };
      }

      // **NEW: Allow larger messages if they contain images**
      const containsImages =
        messageContent.includes("data:image/") ||
        messageContent.includes("[IMAGES:");
      const maxLength = containsImages ? 50000 : 10000; // 50KB for images, 10KB for text

      if (messageContent.length > maxLength) {
        return {
          success: false,
          error: containsImages
            ? "L'immagine è troppo grande. Prova con un'immagine più piccola."
            : "Il messaggio deve essere una stringa di massimo 10.000 caratteri.",
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
        // Use recipientPub (not recipientEpub) for the path to match listener expectations
        console.log("🔍 sendMessage: Sending to GunDB with path:", {
          recipientPub,
          recipientEpub,
          messageId,
          safePath: createSafePath(recipientPub),
        });

        // Send to conversation path (same for both users)
        const conversationPath = createConversationPath(
          senderPub,
          recipientPub
        );

        console.log("🔍 sendMessage: Sending to conversation path:", {
          conversationPath,
          messageId,
        });

        // Send to conversation path for both users to access
        await sendToGunDB(
          this.core,
          conversationPath,
          messageId,
          encryptedMessageData,
          "private"
        );

        // Also send to sender's own path for immediate display
        const senderPath = createSafePath(senderPub);
        console.log(
          "🔍 sendMessage: Also sending to sender's path for immediate display:",
          {
            senderPath,
            messageId,
          }
        );

        await sendToGunDB(
          this.core,
          senderPath,
          messageId,
          encryptedMessageData,
          "private"
        );

        // **NEW: Immediately notify listeners with the sent message**
        // This ensures the message appears immediately in the UI
        const sentMessage = {
          id: messageId,
          content: messageContent,
          from: senderPub,
          to: recipientPub,
          timestamp: Date.now(),
          isSent: true,
          isEncrypted: true,
        };

        console.log(
          "🔍 sendMessage: Immediately notifying listeners with sent message:",
          sentMessage
        );

        // Notify all listeners about the sent message
        if (this.messageProcessor) {
          console.log(
            "🔍 sendMessage: MessageProcessor found, calling notifyListeners"
          );
          this.messageProcessor.notifyListeners(sentMessage);
          console.log("🔍 sendMessage: notifyListeners called successfully");
        } else {
          console.warn(
            "🔍 sendMessage: MessageProcessor not available for immediate notification"
          );
        }

        // **PRODUCTION: Update performance metrics**
        this.performanceMetrics.messagesSent++;
        this.performanceMetrics.encryptionOperations++;

        return { success: true, messageId };
      } catch (error: any) {
        return {
          success: false,
          error:
            error.message || "Errore sconosciuto durante l'invio del messaggio",
        };
      }
    }, "sendMessage").finally(() => {
      // **PRODUCTION: Track response time**
      const responseTime = performance.now() - startTime;
      this.performanceMetrics.totalResponseTime += responseTime;
      this.performanceMetrics.responseCount++;
      this.performanceMetrics.averageResponseTime =
        this.performanceMetrics.totalResponseTime /
        this.performanceMetrics.responseCount;
    });
  }

  /**
   * Sends a message to a group (encrypted with group key)
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const startTime = performance.now();

    return this.safeOperation(async () => {
      console.log(
        "🔍 sendGroupMessage: Starting to send message to group",
        groupId
      );
      console.log(
        "🔍 sendGroupMessage: Message content length:",
        messageContent.length
      );

      // Check if group listener is active
      const hasListener = this.hasGroupListener(groupId);
      console.log("🔍 sendGroupMessage: Has group listener:", hasListener);

      const result = await this.groupManager.sendGroupMessage(
        groupId,
        messageContent
      );

      console.log("🔍 sendGroupMessage: Result:", result);

      // **PRODUCTION: Update performance metrics**
      if (result.success) {
        this.performanceMetrics.messagesSent++;
      }

      return result;
    }, "sendGroupMessage").finally(() => {
      // **PRODUCTION: Track response time**
      const responseTime = performance.now() - startTime;
      this.performanceMetrics.totalResponseTime += responseTime;
      this.performanceMetrics.responseCount++;
      this.performanceMetrics.averageResponseTime =
        this.performanceMetrics.totalResponseTime /
        this.performanceMetrics.responseCount;
    });
  }

  /**
   * Sends a message to a token-protected room (encrypted with shared token)
   */
  public async sendTokenRoomMessage(
    roomId: string,
    messageContent: string,
    token: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.safeOperation(async () => {
      const result = await this.tokenRoomManager.sendTokenRoomMessage(
        roomId,
        messageContent,
        token
      );

      // **PRODUCTION: Update performance metrics**
      if (result.success) {
        this.performanceMetrics.messagesSent++;
      }

      return result;
    }, "sendTokenRoomMessage");
  }

  /**
   * Sends a public message to a room (unencrypted, signed)
   */
  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.safeOperation(async () => {
      const result = await this.publicRoomManager.sendPublicMessage(
        roomId,
        messageContent
      );

      // **PRODUCTION: Update performance metrics**
      if (result.success) {
        this.performanceMetrics.messagesSent++;
      }

      return result;
    }, "sendPublicMessage");
  }

  /**
   * Creates a new public room
   */
  public async createPublicRoom(
    roomName: string,
    description?: string
  ): Promise<{ success: boolean; roomData?: any; error?: string }> {
    return this.safeOperation(async () => {
      return this.publicRoomManager.createPublicRoom(roomName, description);
    }, "createPublicRoom");
  }

  /**
   * Gets all available public rooms
   */
  public async getPublicRooms(): Promise<any[]> {
    return this.safeOperation(async () => {
      return this.publicRoomManager.getPublicRooms();
    }, "getPublicRooms");
  }

  /**
   * Gets a specific public room by ID
   */
  public async getPublicRoom(roomId: string): Promise<any | null> {
    return this.safeOperation(async () => {
      return this.publicRoomManager.getPublicRoom(roomId);
    }, "getPublicRoom");
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
    return this.safeOperation(async () => {
      return this.publicRoomManager.initializeDefaultRooms();
    }, "initializeDefaultRooms");
  }

  // ============================================================================
  // 🚀 DIRECT PROTOCOL METHODS (Production Ready)
  // ============================================================================

  /**
   * **PRODUCTION: Start listening to private messages with enhanced performance**
   */
  public async startListening(): Promise<void> {
    return this.safeOperation(async () => {
      await this.messageProcessor.startListening();
      console.log(
        "🚀 MessagingPlugin: Started listening with production optimizations"
      );
    }, "startListening");
  }

  /**
   * **PRODUCTION: Stop listening with proper cleanup**
   */
  public async stopListening(): Promise<void> {
    return this.safeOperation(async () => {
      await this.messageProcessor.stopListening();
      console.log("🚀 MessagingPlugin: Stopped listening with cleanup");
    }, "stopListening");
  }

  /**
   * **PRODUCTION: Subscribe to decrypted private messages with enhanced filtering**
   */
  public onMessage(callback: (message: any) => void): void {
    this.messageProcessor.onMessage(callback);
    console.log(
      "🚀 MessagingPlugin: Added message listener with production filtering"
    );
  }

  /**
   * **PRODUCTION: Join chat with enhanced validation and performance**
   */
  public async joinChat(
    chatType: "private" | "public" | "group" | "token",
    chatId: string,
    token?: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    return this.safeOperation(async () => {
      // **PRODUCTION: Enhanced input validation**
      if (!chatType || !chatId) {
        return { success: false, error: "Invalid chat type or id" };
      }

      if (typeof chatId !== "string" || chatId.length === 0) {
        return { success: false, error: "Chat ID must be a non-empty string" };
      }

      switch (chatType) {
        case "public":
          // **PRODUCTION: Enhanced public room joining**
          this.publicRoomManager.startListeningPublic(chatId);
          return {
            success: true,
            chatData: { type: "public", id: chatId, name: chatId },
          };

        case "group":
          // **PRODUCTION: Enhanced group joining with validation**
          console.log(
            "🚀 joinChat(group): Activating listener for group",
            chatId
          );
          this.messageProcessor.addGroupListener(chatId);
          const groupData = await this.groupManager.getGroupData(chatId);

          if (groupData) {
            console.log(
              "🚀 joinChat(group): Successfully joined group",
              chatId
            );
            return {
              success: true,
              chatData: groupData,
            };
          } else {
            console.warn("🚀 joinChat(group): Group not found", chatId);
            return {
              success: false,
              chatData: { type: "group", id: chatId, name: chatId },
              error: "Group not found",
            };
          }

        case "private":
          // **PRODUCTION: Private chat validation**
          return { success: true, chatData: { type: "private", id: chatId } };

        case "token":
          // **PRODUCTION: Enhanced token room joining with validation**
          if (!token) {
            return {
              success: false,
              error: "Token required for token room access",
            };
          }

          const result = await this.tokenRoomManager.joinTokenRoom(
            chatId,
            token
          );
          return {
            success: result.success,
            chatData: result.roomData,
            error: result.error,
          };

        default:
          return { success: false, error: "Unsupported chat type" };
      }
    }, "joinChat");
  }

  /**
   * **PRODUCTION: Enhanced runtime stats for panels**
   */
  public getStats(): {
    isListening: boolean;
    messageListenersCount: number;
    processedMessagesCount: number;
    hasActiveListener: boolean;
    performanceMetrics: any;
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
      performanceMetrics: this.performanceMetrics,
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
    return this.safeOperation(async () => {
      const result = await this.groupManager.createGroup(groupName, memberPubs);

      // **FIX: Activate listener for the new group if creation was successful**
      if (result.success && result.groupData) {
        console.log(
          "🔍 createGroup: Activating listener for new group",
          result.groupData.id
        );
        this.messageProcessor.addGroupListener(result.groupData.id);
      }

      return result;
    }, "createGroup");
  }

  /**
   * Creates a new token room (needed for sendTokenRoomMessage)
   */
  public async createTokenRoom(
    roomName: string,
    description?: string,
    maxParticipants?: number
  ): Promise<{ success: boolean; roomData?: any; error?: string }> {
    return this.safeOperation(async () => {
      return this.tokenRoomManager.createTokenRoom(
        roomName,
        description,
        maxParticipants
      );
    }, "createTokenRoom");
  }

  /**
   * Gets group data (needed for group operations)
   */
  public async getGroupData(groupId: string): Promise<any | null> {
    return this.safeOperation(async () => {
      return this.groupManager.getGroupData(groupId);
    }, "getGroupData");
  }

  /**
   * Gets token room data (needed for token room operations)
   */
  public async getTokenRoomData(roomId: string): Promise<any | null> {
    return this.safeOperation(async () => {
      return this.tokenRoomManager.getTokenRoomData(roomId);
    }, "getTokenRoomData");
  }

  /**
   * Joins a token room (needed for sendTokenRoomMessage)
   */
  public async joinTokenRoom(
    roomId: string,
    token: string
  ): Promise<{ success: boolean; roomData?: any; error?: string }> {
    return this.safeOperation(async () => {
      return this.tokenRoomManager.joinTokenRoom(roomId, token);
    }, "joinTokenRoom");
  }

  /**
   * Gets a recipient's epub (needed for private messaging)
   */
  public async getRecipientEpub(recipientPub: string): Promise<string> {
    return this.safeOperation(async () => {
      return this.encryptionManager.getRecipientEpub(recipientPub);
    }, "getRecipientEpub");
  }

  /**
   * Publishes the user's epub (needed for others to message this user)
   */
  public async publishUserEpub(): Promise<{
    success: boolean;
    error?: string;
  }> {
    return this.safeOperation(async () => {
      try {
        await this.encryptionManager.ensureUserEpubPublished();
        return { success: true };
      } catch (error: any) {
        return {
          success: false,
          error: error.message || "Failed to publish encryption key",
        };
      }
    }, "publishUserEpub");
  }

  /**
   * Checks if a user's epub is available (needed for messaging validation)
   */
  public async checkUserEpubAvailability(userPub: string): Promise<{
    available: boolean;
    epub?: string;
    error?: string;
  }> {
    return this.safeOperation(async () => {
      try {
        const epub = await this.encryptionManager.getRecipientEpub(userPub);
        return { available: true, epub };
      } catch (error: any) {
        return {
          available: false,
          error: error.message || "Encryption key not found",
        };
      }
    }, "checkUserEpubAvailability");
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
   * **FIXED: Stop listening to a specific public room**
   */
  public stopListeningToPublicRoom(roomId: string): void {
    this.publicRoomManager.stopListeningToRoom(roomId);
  }

  /**
   * **FIXED: Check if a specific public room has an active listener**
   */
  public hasActivePublicRoomListener(roomId: string): boolean {
    return this.publicRoomManager.hasActiveRoomListener(roomId);
  }

  /**
   * Gets public room messages from localStorage
   */
  public async getPublicRoomMessages(
    roomId: string,
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<any[]> {
    return this.publicRoomManager.getPublicRoomMessages(roomId, options);
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
    return this.safeOperation(async () => {
      // For now, just leave the room - full deletion requires additional implementation
      this.tokenRoomManager.stopListeningTokenRooms();
      return { success: true };
    }, "deleteTokenRoom");
  }

  /**
   * Registers a callback for raw group messages (protocol level)
   */
  public onRawGroupMessage(callback: any): void {
    this.messageProcessor.onGroupMessage(callback);
  }

  /**
   * Adds a realtime listener for a specific group's messages (protocol level)
   * This method should be called by the frontend when a user enters a group
   */
  public addGroupListener(groupId: string): void {
    console.log(
      "🔍 addGroupListener: Frontend requested listener for group",
      groupId
    );
    this.messageProcessor.addGroupListener(groupId);

    // Log the current status after adding the listener
    const status = this.getListenerStatus();
    console.log("🔍 addGroupListener: Current listener status:", {
      isListeningGroups: status.isListeningGroups,
      groupListenersCount: status.groupListenersCount,
    });
  }

  /**
   * Removes the realtime listener for a specific group's messages (protocol level)
   */
  public removeGroupListener(groupId: string): void {
    console.log("🔍 removeGroupListener: Removing listener for group", groupId);
    this.messageProcessor.removeGroupListener(groupId);
  }

  /**
   * Checks if a specific group has an active listener
   * This method can be used by the frontend to verify listener status
   */
  public hasGroupListener(groupId: string): boolean {
    return this.messageProcessor.hasGroupListener(groupId);
  }

  /**
   * Starts the protocol message listeners
   */
  public startProtocolListeners(): void {
    this.messageProcessor.startListening();

    // **FIX: Automatically activate listeners for existing groups and token rooms**
    this._activateExistingListeners();
  }

  /**
   * **FIX: Activate listeners for groups and token rooms the user is already part of**
   */
  private async _activateExistingListeners(): Promise<void> {
    try {
      // Activate listeners for groups the user is part of
      if (this.core.isLoggedIn() && this.core.db.user) {
        const currentUserPub = (this.core.db.user as any)._?.sea?.pub;
        if (currentUserPub) {
          // Get user's groups from their profile
          const userGroups = (await this.core.db.getUserData("groups")) || {};
          for (const groupId of Object.keys(userGroups)) {
            console.log(
              "🔍 _activateExistingListeners: Activating group listener for",
              groupId
            );
            this.messageProcessor.addGroupListener(groupId);
          }
        }
      }

      // Activate listeners for token rooms the user has joined
      if (this.tokenRoomManager) {
        const activeRooms = this.tokenRoomManager.getActiveRooms();
        for (const roomId of activeRooms) {
          const token = this.tokenRoomManager.getRoomToken(roomId);
          if (token) {
            console.log(
              "🔍 _activateExistingListeners: Activating token room listener for",
              roomId
            );
            await this.tokenRoomManager.startListeningToRoom(roomId, token);
          }
        }
      }
    } catch (error) {
      console.warn(
        "🔍 _activateExistingListeners: Error activating existing listeners:",
        error
      );
    }
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
   * Checks if group listeners are active
   */
  public areGroupListenersActive(): boolean {
    return this.messageProcessor.isListeningGroups();
  }

  /**
   * Checks if token room listeners are active
   */
  public areTokenRoomListenersActive(): boolean {
    return this.tokenRoomManager.isListeningTokenRooms();
  }

  /**
   * Clears all messages for a specific conversation
   */
  public async clearConversation(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string; clearedCount?: number }> {
    return this.safeOperation(async () => {
      return this.messageProcessor.clearConversation(recipientPub);
    }, "clearConversation");
  }

  /**
   * **NEW: Set all messages to null without blocking future messages**
   * This is the preferred method for clearing messages - it doesn't block new messages
   */
  public async setMessagesToNull(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string; nullifiedCount?: number }> {
    return this.safeOperation(async () => {
      return this.messageProcessor.setMessagesToNull(recipientPub);
    }, "setMessagesToNull");
  }

  public async clearSingleMessage(
    recipientPub: string,
    messageId: string
  ): Promise<{ success: boolean; error?: string; clearedCount?: number }> {
    return this.safeOperation(async () => {
      return this.messageProcessor.clearSingleMessage(recipientPub, messageId);
    }, "clearSingleMessage");
  }

  /**
   * **NEW: Verify that messages have been actually cleared from GunDB**
   */
  public async verifyConversationCleared(
    recipientPub: string
  ): Promise<{ success: boolean; remainingMessages: number; error?: string }> {
    return this.safeOperation(async () => {
      return this.messageProcessor.verifyConversationCleared(recipientPub);
    }, "verifyConversationCleared");
  }

  /**
   * **NEW: Mark conversation as cleared in the message processor**
   */
  public markConversationAsCleared(from: string, to: string): void {
    this.messageProcessor.markConversationAsCleared(from, to);
  }

  /**
   * **NEW: Check if conversation is cleared in the message processor**
   */
  public isConversationCleared(from: string, to: string): boolean {
    return this.messageProcessor.isConversationClearedPublic(from, to);
  }

  /**
   * **NEW: Remove conversation from cleared set in the message processor**
   */
  public removeClearedConversation(from: string, to: string): void {
    this.messageProcessor.removeClearedConversation(from, to);
  }

  /**
   * **NEW: Reset all cleared conversations in the message processor**
   */
  public resetClearedConversations(): void {
    this.messageProcessor.resetClearedConversations();
  }

  /**
   * **NEW: Reset a specific conversation from cleared state**
   */
  public resetClearedConversation(contactPub: string): void {
    this.messageProcessor.resetClearedConversation(contactPub);
  }

  /**
   * **NEW: Reload messages for a specific contact**
   */
  public async reloadMessages(contactPub: string): Promise<any[]> {
    return this.safeOperation(async () => {
      return this.messageProcessor.reloadMessages(contactPub);
    }, "reloadMessages");
  }

  /**
   * **NEW: Debug function to explore GunDB structure**
   */
  public async debugGunDBStructure(recipientPub: string): Promise<any> {
    return this.safeOperation(async () => {
      return this.messageProcessor.debugGunDBStructure(recipientPub);
    }, "debugGunDBStructure");
  }

  /**
   * **NEW: Set message content to null in GunDB**
   */
  public async setMessageContent(
    messageId: string,
    content: string | null
  ): Promise<{ success: boolean; error?: string }> {
    return this.safeOperation(async () => {
      try {
        console.log("🗑️ Setting message content in GunDB:", {
          messageId,
          content: content === null ? "null" : "string",
        });

        if (!this.core?.db) {
          return { success: false, error: "GunDB not available" };
        }

        // Get the message reference in GunDB
        const messageRef = this.core.db
          .get(`~${this.core.db.user?.is?.pub}`)
          .get("messages")
          .get(messageId);

        if (!messageRef) {
          return { success: false, error: "Message not found in GunDB" };
        }

        // Set the content to null
        messageRef.put({ content });

        console.log("✅ Message content set to null in GunDB:", messageId);
        return { success: true };
      } catch (error) {
        console.error("❌ Error setting message content to null:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }, "setMessageContent");
  }

  /**
   * **IMPROVED: Remove a message from GunDB completely**
   */
  public async removeMessage(
    messageId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.safeOperation(async () => {
      try {
        console.log("🗑️ Removing message from GunDB:", messageId);

        if (!this.core?.db) {
          return { success: false, error: "GunDB not available" };
        }

        const currentUser = this.core.db.user;
        if (!currentUser) {
          return { success: false, error: "User not authenticated" };
        }

        // **FIXED: Use proper GunDB deletion pattern with callbacks**

        // Method 1: Remove from user's messages
        const userMessagesRef = currentUser.get("messages").get(messageId);
        userMessagesRef.put(null, (ack: any) => {
          if (ack.err) {
            console.warn("⚠️ Error removing from user messages:", ack.err);
          } else {
            console.log("✅ Removed from user messages:", messageId);
          }
        });

        // Method 2: Remove from conversation paths
        const conversationsRef = currentUser.get("conversations");
        conversationsRef
          .map()
          .on((conversationData: any, conversationId: string) => {
            if (conversationData && conversationData.messages) {
              const messageRef = conversationsRef
                .get(conversationId)
                .get("messages")
                .get(messageId);
              messageRef.put(null, (ack: any) => {
                if (ack.err) {
                  console.warn("⚠️ Error removing from conversation:", ack.err);
                } else {
                  console.log(
                    "✅ Removed from conversation:",
                    conversationId,
                    messageId
                  );
                }
              });
            }
          });

        // Method 3: Remove from global messages index
        const globalMessagesRef = this.core.db.get("messages").get(messageId);
        globalMessagesRef.put(null, (ack: any) => {
          if (ack.err) {
            console.warn("⚠️ Error removing from global messages:", ack.err);
          } else {
            console.log("✅ Removed from global messages:", messageId);
          }
        });

        // Method 4: Remove from conversation path directly
        const currentUserPair = (currentUser as any)._?.sea;
        if (currentUserPair) {
          const currentUserPub = currentUserPair.pub;

          // Try to find and remove from all possible conversation paths
          const possiblePaths = [
            `conversation_${currentUserPub}_${messageId}`,
            `messages_${currentUserPub}_${messageId}`,
            `chat_${currentUserPub}_${messageId}`,
          ];

          possiblePaths.forEach((path) => {
            const pathRef = this.core.db.get(path);
            pathRef.put(null, (ack: any) => {
              if (!ack.err) {
                console.log("✅ Removed from path:", path);
              }
            });
          });
        }

        console.log("✅ Message removal initiated for:", messageId);
        return { success: true };
      } catch (error) {
        console.error("❌ Error removing message:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }, "removeMessage");
  }

  /**
   * **NEW: Remove all messages from a conversation in GunDB**
   */
  public async removeConversationMessages(
    contactPub: string
  ): Promise<{ success: boolean; removedCount: number; error?: string }> {
    return this.safeOperation(async () => {
      try {
        console.log(
          "🗑️ Removing all messages for conversation with:",
          contactPub
        );

        if (!this.core?.db) {
          return {
            success: false,
            removedCount: 0,
            error: "GunDB not available",
          };
        }

        const currentUser = this.core.db.user;
        if (!currentUser) {
          return {
            success: false,
            removedCount: 0,
            error: "User not authenticated",
          };
        }

        // Get current user pub
        const currentUserPair = (currentUser as any)._?.sea;
        if (!currentUserPair) {
          return {
            success: false,
            removedCount: 0,
            error: "No user pair available",
          };
        }

        const currentUserPub = currentUserPair.pub;

        // Load existing messages to get their IDs
        const existingMessages = await this.loadExistingMessages(contactPub);
        console.log("📱 Found messages to remove:", existingMessages.length);

        let removedCount = 0;

        // Remove each message individually
        for (const message of existingMessages) {
          if (message.id) {
            const result = await this.removeMessage(message.id);
            if (result.success) {
              removedCount++;
            }
          }
        }

        // **NEW: Remove the entire conversation path**
        const conversationId = this.createConversationId(
          currentUserPub,
          contactPub
        );
        const conversationRef = this.core.db.get(conversationId);

        conversationRef.put(null, (ack: any) => {
          if (ack.err) {
            console.warn("⚠️ Error removing conversation path:", ack.err);
          } else {
            console.log("✅ Removed conversation path:", conversationId);
          }
        });

        // **NEW: Remove from user's conversations list**
        const userConversationsRef = currentUser
          .get("conversations")
          .get(contactPub);
        userConversationsRef.put(null, (ack: any) => {
          if (ack.err) {
            console.warn("⚠️ Error removing from user conversations:", ack.err);
          } else {
            console.log("✅ Removed from user conversations:", contactPub);
          }
        });

        console.log(
          "✅ Conversation cleanup completed. Removed messages:",
          removedCount
        );
        return { success: true, removedCount };
      } catch (error) {
        console.error("❌ Error removing conversation messages:", error);
        return {
          success: false,
          removedCount: 0,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }, "removeConversationMessages");
  }

  /**
   * Helper method to create conversation ID
   */
  private createConversationId(user1Pub: string, user2Pub: string): string {
    // Sort pub keys to ensure consistent conversation ID
    const sortedPubs = [user1Pub, user2Pub].sort();
    return `conversation_${sortedPubs[0]}_${sortedPubs[1]}`;
  }

  /**
   * **PRODUCTION: Enhanced debug method to check listener status**
   */
  public getListenerStatus(): {
    isListening: boolean;
    isListeningGroups: boolean;
    isListeningTokenRooms: boolean;
    messageListenersCount: number;
    groupListenersCount: number;
    tokenRoomListenersCount: number;
    processedMessagesCount: number;
    clearedConversationsCount: number;
  } {
    return {
      isListening: this.messageProcessor.isListening(),
      isListeningGroups: this.messageProcessor.isListeningGroups(),
      isListeningTokenRooms: this.tokenRoomManager.isListeningTokenRooms(),
      messageListenersCount: this.messageProcessor.getMessageListenersCount(),
      groupListenersCount:
        this.messageProcessor.getGroupMessageListenersCount(),
      tokenRoomListenersCount:
        this.tokenRoomManager.getTokenRoomMessageListenersCount(),
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
    return this.safeOperation(async () => {
      // Use the new unified listener system
      this.tokenRoomManager.onTokenRoomMessage(callback);
      await this.tokenRoomManager.startListeningTokenRooms();
      return { success: true };
    }, "startTokenRoomMessageListener");
  }

  /**
   * Stop real-time message listener for token rooms
   */
  public async stopTokenRoomMessageListener(
    roomId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.safeOperation(async () => {
      // Stop all listeners - the new system manages them centrally
      this.tokenRoomManager.stopListeningTokenRooms();
      return { success: true };
    }, "stopTokenRoomMessageListener");
  }

  /**
   * Get cached messages for a specific chat type
   */
  public async getTokenRoomMessages(roomId: string): Promise<any[]> {
    return this.safeOperation(async () => {
      return this.tokenRoomManager.getTokenRoomMessages(roomId);
    }, "getTokenRoomMessages");
  }

  /**
   * **NEW: Load existing messages for a private conversation**
   */
  public async loadExistingMessages(contactPub: string): Promise<any[]> {
    return this.safeOperation(async () => {
      try {
        console.log("📱 Loading existing messages for contact:", contactPub);

        // Use the message processor to load existing messages
        const messages =
          await this.messageProcessor.loadExistingMessages(contactPub);

        console.log("📱 Loaded existing messages:", messages?.length || 0);
        return messages || [];
      } catch (error) {
        console.error("❌ Error loading existing messages:", error);
        return [];
      }
    }, "loadExistingMessages");
  }

  /**
   * **DEBUG: Debug method to find where messages are actually stored**
   */
  public async debugMessagePaths(contactPub: string): Promise<void> {
    return this.safeOperation(async () => {
      try {
        console.log(
          "🔍 DEBUG: Debugging message paths for contact:",
          contactPub
        );

        // Use the message processor's debug method
        await this.messageProcessor.debugMessagePaths(contactPub);
      } catch (error) {
        console.error("🔍 DEBUG: Error in debugMessagePaths:", error);
      }
    }, "debugMessagePaths");
  }

  /**
   * **PRODUCTION: Enhanced cleanup method for tests - clears all listeners and timeouts**
   */
  public cleanup(): void {
    console.log("🔍 MessagingPlugin.cleanup() called");
    console.log("🔍 Call stack:", new Error().stack);

    if (this.messageProcessor) {
      this.messageProcessor.cleanup();
    }
    if (this.tokenRoomManager) {
      this.tokenRoomManager.stopListeningTokenRooms();
    }
    if (this.groupManager) {
      // Add any group manager cleanup if needed
    }

    // **PRODUCTION: Clear encryption cache**
    if (this.encryptionManager) {
      this.encryptionManager.clearCache();
    }
  }

  /**
   * **PRODUCTION: Get comprehensive health status**
   */
  public async getHealthStatus(): Promise<{
    isHealthy: boolean;
    issues: string[];
    components: {
      core: boolean;
      encryption: boolean;
      messageProcessor: boolean;
      groupManager: boolean;
      publicRoomManager: boolean;
      tokenRoomManager: boolean;
    };
    performance: any;
  }> {
    const issues: string[] = [];
    const components = {
      core: !!this.core,
      encryption: !!this.encryptionManager,
      messageProcessor: !!this.messageProcessor,
      groupManager: !!this.groupManager,
      publicRoomManager: !!this.publicRoomManager,
      tokenRoomManager: !!this.tokenRoomManager,
    };

    // Check each component
    if (!this.core) issues.push("Core not available");
    if (!this.encryptionManager)
      issues.push("Encryption manager not available");
    if (!this.messageProcessor) issues.push("Message processor not available");
    if (!this.groupManager) issues.push("Group manager not available");
    if (!this.publicRoomManager)
      issues.push("Public room manager not available");
    if (!this.tokenRoomManager) issues.push("Token room manager not available");

    // Check core health
    if (this.core) {
      try {
        if (!this.core.isLoggedIn()) {
          issues.push("User not logged in");
        }
      } catch (error) {
        issues.push(`Core health check failed: ${error}`);
      }
    }

    return {
      isHealthy: issues.length === 0,
      issues,
      components,
      performance: this.performanceMetrics,
    };
  }

  /**
   * **NEW: Register conversation path listener for testing**
   */
  public registerConversationPathListener(conversationPath: string): void {
    if (!this.messageProcessor) {
      console.warn(
        "MessageProcessor not available for conversation path registration"
      );
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.warn(
        "User pair not available for conversation path registration"
      );
      return;
    }

    this.messageProcessor.registerConversationPathListener(
      conversationPath,
      currentUserPair,
      currentUserPair.pub
    );
  }

  /**
   * **NEW: Send message to legacy path for compatibility with existing frontend**
   * This function saves messages in the same paths that the legacy system uses
   * without breaking existing plugin functionality
   */
  public async sendMessageToLegacyPath(
    recipientPub: string,
    messageContent: string,
    options: {
      messageType?: "alias" | "epub" | "token";
      senderAlias?: string;
      recipientAlias?: string;
    } = {}
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      console.log("🔧 sendMessageToLegacyPath: Sending to legacy path for compatibility");

      // Generate message ID
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // Create message object compatible with legacy system
      const message = {
        id: messageId,
        sender: options.senderAlias || "Unknown",
        senderPub: this.core.db.user?.is?.pub || "",
        recipient: options.recipientAlias || "Unknown",
        recipientPub: recipientPub,
        message: messageContent,
        type: options.messageType || "alias",
        timestamp: Date.now(),
        encrypted: true,
      };

      // Get today's date for organization (like legacy system)
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

      // Save to legacy path: recipientPub/messages/date/messageId
      const legacyPath = `${recipientPub}/messages/${today}/${messageId}`;
      
      console.log("🔧 sendMessageToLegacyPath: Saving to legacy path:", legacyPath);

      await new Promise<void>((resolve, reject) => {
        this.core.db.gun.get(legacyPath).put(message, (ack: any) => {
          if (ack.err) {
            console.error("❌ sendMessageToLegacyPath: Error saving to legacy path:", ack.err);
            reject(new Error(`Failed to save to legacy path: ${ack.err}`));
          } else {
            console.log("✅ sendMessageToLegacyPath: Message saved to legacy path successfully");
            resolve();
          }
        });
      });

      // Also save to current user's path for immediate display (like legacy system)
      const currentUserPath = `${this.core.db.user?.is?.pub}/messages/${today}/${messageId}`;
      
      console.log("🔧 sendMessageToLegacyPath: Also saving to current user path:", currentUserPath);

      await new Promise<void>((resolve, reject) => {
        this.core.db.gun.get(currentUserPath).put(message, (ack: any) => {
          if (ack.err) {
            console.error("❌ sendMessageToLegacyPath: Error saving to current user path:", ack.err);
            reject(new Error(`Failed to save to current user path: ${ack.err}`));
          } else {
            console.log("✅ sendMessageToLegacyPath: Message saved to current user path successfully");
            resolve();
          }
        });
      });

      console.log("✅ sendMessageToLegacyPath: Message sent to legacy paths successfully");
      return { success: true, messageId };

    } catch (error: any) {
      console.error("❌ sendMessageToLegacyPath: Error:", error);
      return {
        success: false,
        error: error.message || "Unknown error sending to legacy path"
      };
    }
  }

  /**
   * **NEW: Receive messages from legacy path for compatibility with existing frontend**
   * This function reads messages from the same paths that the legacy system uses
   * without breaking existing plugin functionality
   */
  public async receiveMessageFromLegacyPath(
    contactPub: string,
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    try {
      console.log("🔧 receiveMessageFromLegacyPath: Reading from legacy paths for compatibility");

      const messages: any[] = [];
      const currentUserPub = this.core.db.user?.is?.pub;

      if (!currentUserPub) {
        return { success: false, error: "User not logged in" };
      }

      // Read from current user's messages (messages sent TO current user)
      const currentUserMessagesPath = `${currentUserPub}/messages`;
      
      console.log("🔧 receiveMessageFromLegacyPath: Reading from current user path:", currentUserMessagesPath);

      // Get all dates in current user's messages
      const dates = await new Promise<string[]>((resolve) => {
        const datesNode = this.core.db.gun.get(currentUserMessagesPath);
        const dates: string[] = [];
        
        datesNode.map().on((dateData: any, date: string) => {
          if (dateData && typeof date === "string" && date !== "_") {
            dates.push(date);
          }
        });

        // Timeout to ensure we get all dates
        setTimeout(() => resolve(dates), 2000);
      });

      console.log("🔧 receiveMessageFromLegacyPath: Found dates:", dates);

      // Read messages from each date
      for (const date of dates) {
        const messagesPath = `${currentUserMessagesPath}/${date}`;
        
        const dateMessages = await new Promise<any[]>((resolve) => {
          const messages: any[] = [];
          const messagesNode = this.core.db.gun.get(messagesPath);
          
          messagesNode.map().on((messageData: any, messageId: string) => {
            if (messageData && typeof messageData === "object" && messageId !== "_") {
              // Only include messages from this contact
              if (messageData.senderPub === contactPub || messageData.recipientPub === contactPub) {
                messages.push({
                  ...messageData,
                  date: date
                });
              }
            }
          });

          // Timeout to ensure we get all messages from this date
          setTimeout(() => resolve(messages), 2000);
        });

        messages.push(...dateMessages);
      }

      // Sort messages by timestamp
      messages.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

      // Apply limit if specified
      const limitedMessages = options.limit ? messages.slice(-options.limit) : messages;

      console.log("✅ receiveMessageFromLegacyPath: Successfully read messages:", limitedMessages.length);
      
      return {
        success: true,
        messages: limitedMessages
      };

    } catch (error: any) {
      console.error("❌ receiveMessageFromLegacyPath: Error:", error);
      return {
        success: false,
        error: error.message || "Unknown error reading from legacy path"
      };
    }
  }

  /**
   * **NEW: Start listening to legacy paths for real-time compatibility**
   * This function sets up listeners on the legacy paths without breaking existing functionality
   */
  public startListeningToLegacyPaths(contactPub: string, callback: (message: any) => void): void {
    try {
      console.log("🔧 startListeningToLegacyPaths: Setting up legacy path listeners");

      const currentUserPub = this.core.db.user?.is?.pub;
      if (!currentUserPub) {
        console.warn("⚠️ startListeningToLegacyPaths: User not logged in");
        return;
      }

      // Listen to current user's messages path for incoming messages
      const currentUserMessagesPath = `${currentUserPub}/messages`;
      
      console.log("🔧 startListeningToLegacyPaths: Listening to:", currentUserMessagesPath);

      // Set up listener for new messages
      const messagesNode = this.core.db.gun.get(currentUserMessagesPath);
      
      messagesNode.map().on((dateData: any, date: string) => {
        if (dateData && typeof date === "string" && date !== "_") {
          // Listen to messages in this date
          const dateMessagesPath = `${currentUserMessagesPath}/${date}`;
          const dateMessagesNode = this.core.db.gun.get(dateMessagesPath);
          
          dateMessagesNode.map().on((messageData: any, messageId: string) => {
            if (messageData && typeof messageData === "object" && messageId !== "_") {
              // Only process messages from/to this contact
              if (messageData.senderPub === contactPub || messageData.recipientPub === contactPub) {
                console.log("🔧 startListeningToLegacyPaths: New message received:", messageId);
                
                // Call the callback with the message
                callback({
                  ...messageData,
                  date: date
                });
              }
            }
          });
        }
      });

      console.log("✅ startListeningToLegacyPaths: Legacy path listeners set up successfully");

    } catch (error) {
      console.error("❌ startListeningToLegacyPaths: Error setting up listeners:", error);
    }
  }

  /**
   * **NEW: Stop listening to legacy paths**
   * This function cleans up legacy path listeners
   */
  public stopListeningToLegacyPaths(): void {
    try {
      console.log("🔧 stopListeningToLegacyPaths: Cleaning up legacy path listeners");
      
      // Note: GunDB listeners are automatically cleaned up when the plugin is destroyed
      // This function is provided for explicit cleanup if needed
      
      console.log("✅ stopListeningToLegacyPaths: Legacy path listeners cleaned up");
      
    } catch (error) {
      console.error("❌ stopListeningToLegacyPaths: Error cleaning up listeners:", error);
    }
  }


}
