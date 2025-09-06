// Correct E2E messaging plugin for GunDB
import { ShogunCore } from "shogun-core";
import { BasePlugin } from "./base";
import { MessageProcessor } from "./messageProcessor";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";
import { PublicRoomManager } from "./publicRoomManager";
import { TokenRoomManager } from "./tokenRoomManager";
import { sendToGunDB, createSafePath, createConversationPath } from "./utils";
import { MessagingSchema } from "./schema";

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
  // Legacy listening control to prevent duplicate listeners and enable cleanup
  private _legacyListening: boolean = false;
  private _legacyDateListeners: Map<string, { off: () => void } | { off: Function } > = new Map();
  private _legacyTopLevelListener: { off: () => void } | { off: Function } | null = null;
  private _legacyDebug: boolean = false; // set true only when debugging

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
          error: "You must be logged in to send a message.",
        };
      }

      if (!recipientPub || !messageContent) {
        return {
          success: false,
          error: "Recipient and message are required.",
        };
      }

      // **PRODUCTION: Input validation**
      if (typeof messageContent !== "string") {
        return {
          success: false,
          error: "Message must be a valid string.",
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
            : "Message must be a string up to 10,000 characters.",
        };
      }

      try {
        const currentUserPair = (this.core.db.user as any)._?.sea;
        if (!currentUserPair) {
          return {
            success: false,
            error: "User key pair not available",
          };
        }

        const senderPub = currentUserPair.pub;
        // **IMPROVED: Use schema utility for message ID generation**
        const messageId = this._generateMessageId();

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

        // **FIXED: Don't send to sender's own path - this creates confusion**
        // The sender will receive the message through the listening system
        // This prevents duplicate messages and ensures proper message flow
        console.log(
          "🔍 sendMessage: Message sent to conversation path, sender will receive via listener"
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
            error.message || "Unknown error while sending message",
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
   * This method can be called without parameters to auto-publish the current user's epub,
   * or with a specific epub string to publish that value
   */
  public async publishUserEpub(epub?: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    return this.safeOperation(async () => {
      try {
        if (epub) {
          // Publish the provided epub
          const userPub = this.core.db.user?.is?.pub;
          if (!userPub) {
            return { success: false, error: "User public key not available" };
          }

          // **IMPROVED: Use schema for user epub path**
          const userEpubNode = this.core.db.gun.get(
            MessagingSchema.users.epub(userPub)
          );

          await new Promise<void>((resolve, reject) => {
            userEpubNode.put(epub, (ack: any) => {
              if (ack.err) {
                reject(new Error(ack.err));
              } else {
                resolve();
              }
            });
          });

          console.log("✅ User epub published successfully");
          return { success: true };
        } else {
          // Auto-publish using encryption manager
          await this.encryptionManager.ensureUserEpubPublished();
          return { success: true };
        }
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
            // **IMPROVED: Use schema for conversation paths**
            MessagingSchema.privateMessages.conversation(
              currentUserPub,
              messageId
            ),
            MessagingSchema.privateMessages.legacy.userMessagesByDate(
              currentUserPub,
              "messages"
            ),
            MessagingSchema.privateMessages.legacy.userMessagesByDate(
              currentUserPub,
              "chat"
            ),
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
   * **NEW: Remove a legacy-path message by date bucket**
   * Deletes from: <currentUserPub>/messages/<YYYY-MM-DD>/<messageId>
   */
  public async removeLegacyMessageByDate(
    messageId: string,
    dateBucket: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.safeOperation(async () => {
      try {
        const currentUserPub = this.core.db.user?.is?.pub;
        if (!currentUserPub) {
          return { success: false, error: "User not authenticated" };
        }

        // GunDB requires chained get() calls, not slash-delimited paths
        await new Promise<void>((resolve, reject) => {
          this.core.db.gun
            .get(currentUserPub)
            .get(MessagingSchema.collections.messages)
            .get(dateBucket)
            .get(messageId)
            .put(null, (ack: any) => {
              if (ack?.err) {
                reject(new Error(ack.err));
              } else {
                resolve();
              }
            });
        });

        return { success: true };
      } catch (error: any) {
        return {
          success: false,
          error: error?.message || "Failed to remove legacy message",
        };
      }
    }, "removeLegacyMessageByDate");
  }

  /**
   * **NEW: Remove a legacy-path message by timestamp**
   * Computes the date bucket from the provided timestamp.
   */
  public async removeLegacyMessageByTimestamp(
    messageId: string,
    timestamp: number
  ): Promise<{ success: boolean; error?: string }> {
    const dateBucket = MessagingSchema.utils.formatDate(new Date(timestamp));
    return this.removeLegacyMessageByDate(messageId, dateBucket);
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
   * Helper method to create conversation ID using schema
   */
  private createConversationId(user1Pub: string, user2Pub: string): string {
    return this._createConversationId(user1Pub, user2Pub);
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
  public async sendMessageDirect(
    recipientPub: string,
    recipientEpub: string,
    messageContent: string,
    options: {
      messageType?: "alias" | "epub" | "token";
      senderAlias?: string;
      recipientAlias?: string;
    } = {}
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    try {
      console.log(
        "🔧 sendMessageDirect: Sending to legacy path for compatibility"
      );

      // Generate message ID
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      // **FIXED: Use the provided EPUB instead of trying to retrieve it again**
      const resolvedRecipientEpub = recipientEpub;
      
      if (!resolvedRecipientEpub) {
        throw new Error("No EPUB provided for recipient");
      }
      
      console.log("🔧 sendMessageDirect: Using provided EPUB:", resolvedRecipientEpub.substring(0, 20) + "...");

      const sharedSecret = (await this.core.db.sea.secret(
        resolvedRecipientEpub,
        (this.core.db.user as any)?._?.sea  
      )) as string;

      if (!sharedSecret) {
        throw new Error("Unable to derive shared secret");
      }

      const encryptedMessage = await this.core.db.sea.encrypt(
        messageContent,
        sharedSecret
      );

      // Unified envelope (same as sendMessage): EncryptedMessage
      const encryptedMessageData = {
        data: encryptedMessage,
        from: this.core.db.user?.is?.pub || "",
        // Include sender's epub to allow recipients to decrypt without lookup
        senderEpub: (this.core.db.user as any)?._?.sea?.epub || "",
        timestamp: Date.now(),
        id: messageId,
      };

      // Legacy-compatible fields (kept for backward compatibility)
      const legacyFields = {
        sender: options.senderAlias || "Unknown",
        senderPub: encryptedMessageData.from,
        senderEpub: encryptedMessageData.senderEpub,
        recipient: options.recipientAlias || "Unknown",
        recipientPub: recipientPub,
        message: encryptedMessage, // legacy key
        type: options.messageType || "alias",
        encrypted: true,
      };

      // Final payload written to legacy path: unified + legacy fields
      const message = { ...encryptedMessageData, ...legacyFields } as const;

      // Get today's date bucket for organization (safe key)
      const today = MessagingSchema.utils.formatDate(new Date());

      console.log(
        "🔧 sendMessageDirect: Saving to legacy path (nested nodes):",
        { recipientPub, today, messageId }
      );

      await new Promise<void>((resolve, reject) => {
        this.core.db.gun
          .get(recipientPub)
          .get(MessagingSchema.collections.messages)
          .get(today)
          .get(messageId)
          .put(message, (ack: any) => {
            if (ack.err) {
              console.error(
                "❌ sendMessageDirect: Error saving to legacy path:",
                ack.err
              );
              reject(new Error(`Failed to save to legacy path: ${ack.err}`));
            } else {
              console.log(
                "✅ sendMessageDirect: Message saved to legacy path successfully"
              );
              resolve();
            }
          });
      });

      // **FIXED: Don't save to current user's path - this creates confusion**
      // The sender will receive the message through the listening system
      // This prevents duplicate messages and ensures proper message flow
      console.log(
        "🔧 sendMessageDirect: Message saved to recipient path only"
      );

      console.log(
        "✅ sendMessageDirect: Message sent to legacy paths successfully"
      );
      return { success: true, messageId };
    } catch (error: any) {
      console.error("❌ sendMessageDirect: Error:", error);
      return {
        success: false,
        error: error.message || "Unknown error sending to legacy path",
      };
    }
  }

  /**
   * **NEW: Receive messages from legacy path for compatibility with existing frontend**
   * This function reads messages from the same paths that the legacy system uses
   * without breaking existing plugin functionality
   */
  public async receiveMessageDirect(
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    try {
      console.log(
        "🔧 receiveMessageFromLegacyPath: Reading from legacy paths for compatibility"
      );

      const messages: any[] = [];
      const currentUserPub = this.core.db.user?.is?.pub;

      if (!currentUserPub) {
        return { success: false, error: "User not logged in" };
      }

      // Read from current user's messages (messages sent TO current user)
      const currentUserMessagesPath = `${currentUserPub}/${MessagingSchema.collections.messages}`;

      console.log(
        "🔧 receiveMessageFromLegacyPath: Reading from current user path:",
        currentUserMessagesPath
      );

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
            if (
              messageData &&
              typeof messageData === "object" &&
              messageId !== "_"
            ) {
              messages.push({
                ...messageData,
                date: date,
              });
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
      const limitedMessages = options.limit
        ? messages.slice(-options.limit)
        : messages;

      return {
        success: true,
        messages: limitedMessages,
      };
    } catch (error: any) {
      console.error("❌ receiveMessageFromLegacyPath: Error:", error);
      return {
        success: false,
        error: error.message || "Unknown error reading from legacy path",
      };
    }
  }

  /**
   * **NEW: Start listening to legacy paths for real-time compatibility**
   * This function sets up listeners on the legacy paths without breaking existing functionality
   * @param currentUserPub The current user's public key (for compatibility, but not used for filtering)
   * @param callback Function to call when a new message is received
   */
  public startListeningDirect(callback: (message: any) => void): void {
    try {
      if (this._legacyListening) {
        if (this._legacyDebug) {
          console.log("🔧 startListeningToLegacyPaths: already listening (idempotent)");
        }
        return;
      }

      if (this._legacyDebug) {
        console.log(
          "🔧 startListeningToLegacyPaths: Setting up legacy path listeners"
        );
      }

      const currentUserPubFromCore = this.core.db.user?.is?.pub;
      if (!currentUserPubFromCore) {
        console.warn("⚠️ startListeningToLegacyPaths: User not logged in");
        return;
      }

      // **FIXED: Listen to the current user's message paths (where they are the recipient)**
      // NOT to the sender's paths
      const currentUserMessagesPath = `${currentUserPubFromCore}/${MessagingSchema.collections.messages}`;

      if (this._legacyDebug) {
        console.log(
          "🔧 startListeningToLegacyPaths: Listening to recipient paths:",
          currentUserMessagesPath
        );
      }

      // Set up listener for new messages using direct path listening
      const messagesNode = this.core.db.gun.get(currentUserMessagesPath);

      // Listen for new dates being added (idempotent per date)
      const topMap = messagesNode.map();
      const topListener = topMap.on((dateData: any, date: string) => {
        if (!dateData || typeof date !== "string" || date === "_") return;

        if (this._legacyDateListeners.has(date)) {
          return; // already listening to this date bucket
        }

        if (this._legacyDebug) {
          console.log("🔧 startListeningToLegacyPaths: New date detected:", date);
        }

        // Listen for messages in this date
        const dateMessagesPath = `${currentUserMessagesPath}/${date}`;
        const dateMessagesNode = this.core.db.gun.get(dateMessagesPath);
        const dateMap = dateMessagesNode.map();
        const dateListener = dateMap.on(async (messageData: any, messageId: string) => {
          if (!messageData || typeof messageData !== "object" || messageId === "_") return;

          // Enhanced message filtering using schema validation
          if (this._isValidLegacyMessage(messageData, currentUserPubFromCore)) {
            try {
              const currentUserPair = (this.core.db.user as any)?._?.sea;
              if (!currentUserPair) return;

              const senderPub = messageData.from || messageData.senderPub;
              const encryptedPayload: string | undefined = messageData.data || messageData.message;
              if (!senderPub || !encryptedPayload) return;

              // Prefer senderEpub embedded in message, fall back to lookup
              const embeddedSenderEpub: string | undefined = (messageData as any).senderEpub;
              const senderEpub = embeddedSenderEpub && typeof embeddedSenderEpub === "string" && embeddedSenderEpub.length > 0
                ? embeddedSenderEpub
                : await this.encryptionManager.getRecipientEpub(senderPub);
              const sharedSecret = await this.core.db.sea.secret(senderEpub, currentUserPair);
              if (!sharedSecret) return;

              const decrypted = await this.core.db.sea.decrypt(encryptedPayload, sharedSecret);
              let content: string | null = null;
              if (typeof decrypted === "string") {
                content = decrypted;
              } else if (decrypted && typeof decrypted === "object") {
                content = typeof (decrypted as any).content === "string" ? (decrypted as any).content : JSON.stringify(decrypted);
              }
              if (!content) return;

              const processedMessage = {
                id: messageId,
                from: senderPub,
                content,
                timestamp: messageData.timestamp || Date.now(),
              };

              callback(processedMessage);
            } catch (_) {
              // silently skip non-decryptable messages
            }
          }
        });

        // Store off handler for this date
        this._legacyDateListeners.set(date, dateMap as any);
      });

      this._legacyTopLevelListener = topMap as any;
      this._legacyListening = true;

      if (this._legacyDebug) {
        console.log(
          "✅ startListeningToLegacyPaths: Legacy path listeners set up successfully"
        );
      }
    } catch (error) {
      console.error(
        "❌ startListeningToLegacyPaths: Error setting up listeners:",
        error
      );
    }
  }

  /**
   * **NEW: Stop listening to legacy paths**
   * This function cleans up legacy path listeners
   */
  public stopListeningToLegacyPaths(): void {
    try {
      if (!this._legacyListening) return;

      if (this._legacyDebug) {
        console.log(
          "🔧 stopListeningToLegacyPaths: Cleaning up legacy path listeners"
        );
      }

      // Turn off date listeners
      this._legacyDateListeners.forEach((ref) => {
        if (ref && typeof (ref as any).off === "function") {
          (ref as any).off();
        }
      });
      this._legacyDateListeners.clear();

      // Turn off top-level date map
      if (this._legacyTopLevelListener && typeof (this._legacyTopLevelListener as any).off === "function") {
        (this._legacyTopLevelListener as any).off();
      }
      this._legacyTopLevelListener = null;

      this._legacyListening = false;

      if (this._legacyDebug) {
        console.log(
          "✅ stopListeningToLegacyPaths: Legacy path listeners cleaned up"
        );
      }
    } catch (error) {
      console.error(
        "❌ stopListeningToLegacyPaths: Error cleaning up listeners:",
        error
      );
    }
  }

  // ============================================================================
  // 🔧 PRIVATE HELPER METHODS (using schema)
  // ============================================================================

  /**
   * **NEW: Validates legacy message data using schema validation**
   */
  private _isValidLegacyMessage(
    messageData: any,
    currentUserPub: string
  ): boolean {
    // Check if message has required fields
    if (!messageData || typeof messageData !== "object") {
      return false;
    }

    // **FIXED: Check if message is destined for the current user**
    // The current user should receive messages where they are the recipient
    const isToCurrentUser = messageData.recipientPub === currentUserPub;

    // Also check if it's a message from the current user (for display purposes)
    const isFromCurrentUser = messageData.senderPub === currentUserPub;

    // Message is valid if it's either:
    // 1. Destined for the current user (they are the recipient)
    // 2. Sent by the current user (for display in their message list)
    return isToCurrentUser || isFromCurrentUser;
  }

  /**
   * **NEW: Processes legacy message data using schema utilities**
   */
  private _processLegacyMessage(
    messageData: any,
    messageId: string,
    date: string
  ): any {
    // Use schema utility for date formatting if needed
    const formattedDate = MessagingSchema.utils.formatDate(new Date(date));

    // Return processed message with consistent structure
    return {
      ...messageData,
      id: messageId,
      date: formattedDate,
      timestamp: messageData.timestamp || Date.now(),
      processed: true,
    };
  }

  /**
   * **NEW: Creates conversation ID using schema utility**
   */
  private _createConversationId(user1Pub: string, user2Pub: string): string {
    return MessagingSchema.utils.createConversationId(user1Pub, user2Pub);
  }

  /**
   * **NEW: Generates message ID using schema utility**
   */
  private _generateMessageId(): string {
    return MessagingSchema.utils.generateMessageId();
  }

  /**
   * **NEW: Generates group ID using schema utility**
   */
  private _generateGroupId(): string {
    return MessagingSchema.utils.generateGroupId();
  }

  /**
   * **NEW: Generates token room ID using schema utility**
   */
  private _generateTokenRoomId(): string {
    return MessagingSchema.utils.generateTokenRoomId();
  }

  /**
   * **NEW: Generates public room ID using schema utility**
   */
  private _generatePublicRoomId(): string {
    return MessagingSchema.utils.generatePublicRoomId();
  }

  // ============================================================================
  // 🔍 USER SEARCH & MANAGEMENT FUNCTIONALITY (from hooks)
  // ============================================================================

  // **NEW: User Search Functionality from useUserSearch hook**

  /**
   * Search for user by username
   * Implements the same logic as useUserSearch hook
   */
  public async searchUser(username: string): Promise<{
    alias: string;
    epub: string;
    pub: string;
  } | null> {
    if (!username.trim()) {
      throw new Error("Please enter a username to search");
    }

    if (!this.core.isLoggedIn()) {
      throw new Error("User not logged in");
    }

    try {
      console.log(`🔍 Searching for user: "${username}"`);

      // **IMPROVED: Use schema for username mapping path**
      const usernamesNode = this.core.db.gun.get(
        MessagingSchema.users.usernames()
      );

      // Try to get user data from username mapping
      const userData = await new Promise<any>((resolve) => {
        usernamesNode.get(username).on((data: any) => {
          if (data && data.pub) {
            resolve(data);
          } else {
            resolve(null);
          }
        });
      });

      if (userData && userData.pub) {
        console.log("✅ User found via username mapping:", userData);
        return {
          alias: userData.alias || username,
          epub: userData.epub || "",
          pub: userData.pub,
        };
      }

      // Fallback: search in users collection
      console.log(
        "🔍 Username mapping not found, searching users collection..."
      );
      const usersNode = this.core.db.gun.get(MessagingSchema.collections.users);

      const foundUser = await new Promise<any>((resolve) => {
        usersNode.map().on((userData: any, userId: string) => {
          if (userData && userData.alias === username && userData.pub) {
            resolve({ ...userData, pub: userId });
          }
        });

        // Resolve after a short delay if no user found
        setTimeout(() => resolve(null), 2000);
      });

      if (foundUser) {
        console.log("✅ User found in users collection:", foundUser);
        return {
          alias: foundUser.alias,
          epub: foundUser.epub || "",
          pub: foundUser.pub,
        };
      }

      console.log("❌ User not found");
      return null;
    } catch (error) {
      console.error("❌ Error searching for user:", error);
      throw error;
    }
  }

  // **NEW: Messages Count Functionality from useMessagesCount hook**

  /**
   * Get message count for a specific user
   * Implements the same logic as useMessagesCount hook
   */
  public async getMessagesCount(contactPub: string): Promise<number> {
    if (!this.core.isLoggedIn()) {
      return 0;
    }

    try {
      // **IMPROVED: Use schema for conversation path**
      const conversationPath = MessagingSchema.privateMessages.conversation(
        this.core.db.user?.is?.pub || "",
        contactPub
      );

      const conversationNode = this.core.db.gun.get(conversationPath);

      let messageCount = 0;
      await new Promise<void>((resolve) => {
        conversationNode.map().on(() => {
          messageCount++;
        });

        // Resolve after a short delay to count messages
        setTimeout(() => resolve(), 1000);
      });

      return messageCount;
    } catch (error) {
      console.error("❌ Error getting message count:", error);
      return 0;
    }
  }

  /**
   * Check if a user is available (has epub key)
   * Implements the same logic as useMessagesCount hook
   */
  public async isUserAvailable(userPub: string): Promise<boolean> {
    if (!this.core.isLoggedIn()) {
      return false;
    }

    try {
      // **IMPROVED: Use schema for user epub path**
      const userEpubNode = this.core.db.gun.get(
        MessagingSchema.users.epub(userPub)
      );

      const hasEpub = await new Promise<boolean>((resolve) => {
        userEpubNode.on((epub: any) => {
          resolve(!!epub);
        });

        // Resolve after a short delay
        setTimeout(() => resolve(false), 2000);
      });

      return hasEpub;
    } catch (error) {
      console.error("❌ Error checking user availability:", error);
      return false;
    }
  }

  // **NEW: User Registration Functionality from useUserRegistration hook**

  /**
   * Register user data (alias, epub, pub)
   * Implements the same logic as useUserRegistration hook
   */
  public async registerUserData(
    alias: string,
    epub: string,
    pub: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.core.isLoggedIn()) {
      return { success: false, error: "User not logged in" };
    }

    if (!alias || !epub || !pub) {
      return { success: false, error: "Missing required user data" };
    }

    try {
      const userData = { alias, epub, pub };

      // Store in users collection
      // **IMPROVED: Use schema for users collection**
      const usersNode = this.core.db.gun.get(MessagingSchema.collections.users);
      await new Promise<void>((resolve, reject) => {
        usersNode.get(pub).put(userData, (ack: any) => {
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
      });

      // Store in username mapping for search
      // **IMPROVED: Use schema for username mapping**
      const usernameMappingNode = this.core.db.gun.get(
        MessagingSchema.users.usernameMapping(alias)
      );
      await new Promise<void>((resolve, reject) => {
        usernameMappingNode.put(userData, (ack: any) => {
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
      });

      console.log("✅ User data registered successfully");
      return { success: true };
    } catch (error: any) {
      console.error("❌ Error registering user data:", error);
      return { success: false, error: error.message };
    }
  }

  // **NEW: Encryption Management Functionality from useEncryption hook**

  /**
   * Get user's encryption public key (epub)
   * Implements the same logic as useEncryption hook
   */
  public async getUserEpub(userPub: string): Promise<string | null> {
    if (!this.core.isLoggedIn()) {
      return null;
    }

    try {
      // **IMPROVED: Use schema for user epub path**
      const userEpubNode = this.core.db.gun.get(
        MessagingSchema.users.epub(userPub)
      );

      const epub = await new Promise<string | null>((resolve) => {
        userEpubNode.on((epubData: any) => {
          if (epubData && typeof epubData === "string") {
            resolve(epubData);
          } else {
            resolve(null);
          }
        });

        // Resolve after a short delay
        setTimeout(() => resolve(null), 2000);
      });

      return epub;
    } catch (error) {
      console.error("❌ Error getting user epub:", error);
      return null;
    }
  }

  // ============================================================================
  // 🔐 COMPLETE USERNAME MANAGEMENT (from hooks)
  // ============================================================================

  /**
   * **NEW: Register username for current user**
   * Implements the same logic as useUserRegistration hook
   */
  public async registerUsername(
    username: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return { success: false, error: "User not logged in" };
    }

    if (!username || username.trim().length < 3) {
      return {
        success: false,
        error: "Username must be at least 3 characters",
      };
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return { success: false, error: "User pair not available" };
      }

      // Check if username is available
      const isAvailable = await this.isUsernameAvailable(username);
      if (!isAvailable) {
        return {
          success: false,
          error: `Username "${username}" is already taken`,
        };
      }

      // Save username mapping (shogun/usernames/username)
      const usernameRef = this.core.db.gun
        .get(MessagingSchema.collections.usernames)
        .get(username);

      await new Promise<void>((resolve, reject) => {
        usernameRef.put(
          {
            pub: currentUserPair.pub,
            epub: currentUserPair.epub,
            timestamp: Date.now(),
          },
          (ack: any) => {
            if (ack.err) {
              reject(new Error(`Failed to save username mapping: ${ack.err}`));
            } else {
              resolve();
            }
          }
        );
      });

      // Save protocol username (shogun/usernames/userPub)
      const protocolUsernameRef = this.core.db.gun
        .get(MessagingSchema.collections.usernames)
        .get(currentUserPair.pub);

      await new Promise<void>((resolve, reject) => {
        protocolUsernameRef.put(username, (ack: any) => {
          if (ack.err) {
            reject(new Error(`Failed to save protocol username: ${ack.err}`));
          } else {
            resolve();
          }
        });
      });

      // Ensure there are no duplicate username mappings for the same pub
      await this._purgeDuplicateUsernameMappingsForPub(currentUserPair.pub, username);

      // Update user profile with username
      const userRef = this.core.db.gun
        .get(MessagingSchema.collections.users)
        .get(currentUserPair.pub);

      await new Promise<void>((resolve, reject) => {
        userRef.put(
          {
            alias: username,
            pub: currentUserPair.pub,
            epub: currentUserPair.epub,
            updatedAt: Date.now(),
          },
          (ack: any) => {
            if (ack.err) {
              reject(new Error(`Failed to update user profile: ${ack.err}`));
            } else {
              resolve();
            }
          }
        );
      });

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to register username",
      };
    }
  }

  /**
   * **NEW: Update username for current user**
   */
  public async updateUsername(
    newUsername: string
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return { success: false, error: "User not logged in" };
    }

    if (!newUsername || newUsername.trim().length < 3) {
      return {
        success: false,
        error: "Username must be at least 3 characters",
      };
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return { success: false, error: "User pair not available" };
      }

      // Check if new username is available OR if it's already owned by current user
      const isAvailable = await this.isUsernameAvailable(newUsername);
      if (!isAvailable) {
        // Check if the username is already owned by the current user
        const currentOwner = await this.getUsername(currentUserPair.pub);
        if (currentOwner === newUsername) {
          console.log("ℹ️ Username is already owned by current user, proceeding with update");
          // Username is already owned by current user, proceed with update
        } else {
          return {
            success: false,
            error: `Username "${newUsername}" is already taken`,
          };
        }
      }

      // Get current username
      const currentUsername = await this.getUsername(currentUserPair.pub);
      
      // If the new username is the same as current, just sync profile data
      if (currentUsername === newUsername) {
        console.log("ℹ️ Username is the same, just syncing profile data");
        try {
          await this.registerUserData(newUsername, currentUserPair.epub, currentUserPair.pub);
          return { success: true };
        } catch (error: any) {
          return {
            success: false,
            error: error.message || "Failed to sync profile data"
          };
        }
      }

      if (currentUsername) {
        // Remove old username mapping
        const oldUsernameRef = this.core.db.gun
          .get(MessagingSchema.collections.usernames)
          .get(currentUsername);

        await new Promise<void>((resolve, reject) => {
          oldUsernameRef.put(null, (ack: any) => {
            if (ack.err) {
              console.warn(
                `Warning: Could not remove old username: ${ack.err}`
              );
            }
            resolve();
          });
        });
      }

      // Register new username
      const res = await this.registerUsername(newUsername);

      // Safety: purge any duplicates that might still exist for this pub
      if (res.success) {
        const currentUserPair = (this.core.db.user as any)._?.sea;
        if (currentUserPair?.pub) {
          await this._purgeDuplicateUsernameMappingsForPub(currentUserPair.pub, newUsername);
        }
      }

      return res;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to update username",
      };
    }
  }

  /**
   * Public method to enforce username consistency for a given public key.
   * Removes duplicate username mappings, keeping only the latest one.
   */
  public async enforceUsernameConsistency(pub: string): Promise<{ success: boolean; error?: string }> {
    try {
      await this._purgeDuplicateUsernameMappingsForPub(pub);
      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to enforce username consistency"
      };
    }
  }

  /**
   * Removes any username mappings that point to the provided pub,
   * keeping only the mapping for `keepUsername` if specified.
   * This guarantees there aren't two usernames for the same public key.
   */
  private async _purgeDuplicateUsernameMappingsForPub(
    pub: string,
    keepUsername?: string
  ): Promise<void> {
    if (!pub) return;
    try {
      const usernamesNode = this.core.db.gun.get(
        MessagingSchema.collections.usernames
      );

      await new Promise<void>((resolve) => {
        const toDelete: string[] = [];

        const mapRef = usernamesNode.map();
        const off = mapRef.on((data: any, key: string) => {
          if (!data || key === "_" || typeof key !== "string") return;
          try {
            if (data.pub === pub && (!keepUsername || key !== keepUsername)) {
              toDelete.push(key);
            }
          } catch (_) {}
        });

        // Give a short window to collect keys then remove
        setTimeout(() => {
          if ((off as any)?.off) {
            (off as any).off();
          }
          toDelete.forEach((usernameKey) => {
            try {
              usernamesNode.get(usernameKey).put(null);
            } catch (_) {}
          });
          resolve();
        }, 500);
      });
    } catch (error) {
      console.warn("_purgeDuplicateUsernameMappingsForPub error:", error);
    }
  }

  /**
   * **NEW: Delete username for current user**
   */
  public async deleteUsername(): Promise<{ success: boolean; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return { success: false, error: "User not logged in" };
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return { success: false, error: "User pair not available" };
      }

      // Get current username
      const currentUsername = await this.getUsername(currentUserPair.pub);
      if (!currentUsername) {
        return { success: false, error: "No username to delete" };
      }

      // Remove username mapping
      const usernameRef = this.core.db.gun
        .get(MessagingSchema.collections.usernames)
        .get(currentUsername);

      await new Promise<void>((resolve, reject) => {
        usernameRef.put(null, (ack: any) => {
          if (ack.err) {
            reject(new Error(`Failed to remove username mapping: ${ack.err}`));
          } else {
            resolve();
          }
        });
      });

      // Remove protocol username
      const protocolUsernameRef = this.core.db.gun
        .get(MessagingSchema.collections.usernames)
        .get(currentUserPair.pub);

      await new Promise<void>((resolve, reject) => {
        protocolUsernameRef.put(null, (ack: any) => {
          if (ack.err) {
            reject(new Error(`Failed to remove protocol username: ${ack.err}`));
          } else {
            resolve();
          }
        });
      });

      // Update user profile to remove username
      const userRef = this.core.db.gun
        .get(MessagingSchema.collections.users)
        .get(currentUserPair.pub);

      await new Promise<void>((resolve, reject) => {
        userRef.put(
          {
            alias: null,
            pub: currentUserPair.pub,
            epub: currentUserPair.epub,
            updatedAt: Date.now(),
          },
          (ack: any) => {
            if (ack.err) {
              reject(new Error(`Failed to update user profile: ${ack.err}`));
            } else {
              resolve();
            }
          }
        );
      });

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Failed to delete username",
      };
    }
  }

  /**
   * **NEW: Get username for a user**
   */
  public async getUsername(userPub: string): Promise<string | null> {
    if (!userPub) return null;

    try {
      return new Promise<string | null>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 5000);

        this.core.db.gun
          .get(MessagingSchema.collections.usernames)
          .get(userPub)
          .once((username: any) => {
            clearTimeout(timeout);
            if (username && typeof username === "string") {
              resolve(username);
            } else {
              resolve(null);
            }
          });
      });
    } catch (error) {
      console.error("Error getting username:", error);
      return null;
    }
  }

  /**
   * **NEW: Check if username is available**
   */
  public async isUsernameAvailable(username: string): Promise<boolean> {
    if (!username || username.trim().length < 3) return false;

    try {
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 3000);

        this.core.db.gun
          .get(MessagingSchema.collections.usernames)
          .get(username)
          .once((mapping: any) => {
            clearTimeout(timeout);
            // Username is available if no mapping exists or mapping has no pub
            const available = !mapping || !mapping.pub;
            resolve(available);
          });
      });
    } catch (error) {
      console.error("Error checking username availability:", error);
      return false;
    }
  }

  /**
   * **NEW: Validate username format**
   */
  public validateUsername(username: string): {
    isValid: boolean;
    error?: string;
  } {
    if (!username || username.trim().length < 3) {
      return {
        isValid: false,
        error: "Username must be at least 3 characters",
      };
    }

    if (username.length > 20) {
      return {
        isValid: false,
        error: "Username must be 20 characters or less",
      };
    }

    // Username should be alphanumeric and underscores only
    const usernameRegex = /^[a-zA-Z0-9_]+$/;
    if (!usernameRegex.test(username)) {
      return {
        isValid: false,
        error: "Username can only contain letters, numbers, and underscores",
      };
    }

    return { isValid: true };
  }

  /**
   * **NEW: Generate random username**
   */
  public generateRandomUsername(): string {
    const adjectives = [
      "Swift",
      "Bright",
      "Calm",
      "Wise",
      "Bold",
      "Gentle",
      "Quick",
      "Warm",
      "Cool",
      "Smart",
      "Brave",
      "Clever",
      "Fierce",
      "Kind",
      "Lucky",
      "Mighty",
      "Noble",
      "Proud",
      "Swift",
      "Wise",
    ];
    const nouns = [
      "Wolf",
      "Eagle",
      "Lion",
      "Bear",
      "Fox",
      "Hawk",
      "Tiger",
      "Dragon",
      "Phoenix",
      "Panther",
      "Falcon",
      "Jaguar",
      "Lynx",
      "Owl",
      "Puma",
      "Raven",
      "Shark",
      "Viper",
      "Wolf",
      "Zebra",
    ];

    const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 1000);

    return `${adjective}${noun}${number}`;
  }

  /**
   * **NEW: Auto-register user after login**
   */
  public async autoRegisterUser(): Promise<{
    success: boolean;
    error?: string;
  }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return { success: false, error: "User not logged in" };
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return { success: false, error: "User pair not available" };
      }

      // Check if user is already registered
      const existingUser = await this.core.db.getUserData("alias");
      if (existingUser && existingUser !== currentUserPair.pub) {
        // User already has a username, just ensure profile is up to date
        await this.registerUserData(
          existingUser,
          currentUserPair.epub,
          currentUserPair.pub
        );
        return { success: true };
      }

      // Generate a random username if none exists
      const randomUsername = this.generateRandomUsername();
      const result = await this.registerUsername(randomUsername);

      if (result.success) {
        console.log(`✅ Auto-registered user with username: ${randomUsername}`);
      }

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Auto-registration failed",
      };
    }
  }
}
