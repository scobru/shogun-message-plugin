// Plugin di messaggistica E2E corretto per GunDB
import { ShogunCore } from "shogun-core";
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
export class MessagingPlugin {
  public readonly name = "messaging";
  public readonly version = "1.0.0";

  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private messageProcessor: MessageProcessor;
  private groupManager: GroupManager;
  private publicRoomManager: PublicRoomManager;
  private tokenRoomManager: TokenRoomManager;

  constructor() {
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
  public initialize(core: ShogunCore): void {
    this.core = core;
    this.encryptionManager = new EncryptionManager(core);
    this.groupManager = new GroupManager(core, this.encryptionManager);
    this.publicRoomManager = new PublicRoomManager(
      core,
      this.encryptionManager
    );
    this.tokenRoomManager = new TokenRoomManager(core, this.encryptionManager);
    this.messageProcessor = new MessageProcessor(
      core,
      this.encryptionManager,
      this.groupManager
    );

    console.log(
      "[MessagingPlugin] ✅ Protocol layer initialized successfully - 4 send functions ready"
    );
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
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Create the complete message
      const messageData: any = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
      };

      // **FIX: Sign a canonical representation of the message data**
      const dataToSign = JSON.stringify({
        content: messageData.content,
        timestamp: messageData.timestamp,
        id: messageData.id,
      });
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
      console.error(
        `[MessagingPlugin] ❌ Error sending private message:`,
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
      console.error(`[MessagingPlugin] ❌ Error publishing user epub:`, error);
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
}
