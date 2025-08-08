// Plugin di messaggistica E2E corretto per GunDB
import { ShogunCore, ShogunPlugin } from "shogun-core";
import { MessageData, MessageListener } from "./types";
import { MessageProcessor } from "./messageProcessor";
import { EncryptionManager } from "./encryption";
import { ChatManager } from "./chatManager";
import { PublicRoomManager } from "./publicRoomManager";
import { TokenRoomManager } from "./tokenRoomManager";

/**
 * Messaging plugin for Shogun SDK
 * Provides end-to-end encrypted messaging capabilities
 */
export class MessagingPlugin implements ShogunPlugin {
  public readonly name = "messaging";
  public readonly version = "1.0.0";

  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private messageProcessor: MessageProcessor;
  private chatManager: ChatManager;
  private publicRoomManager: PublicRoomManager;
  private tokenRoomManager: TokenRoomManager;

  constructor() {
    this.core = null as any;
    this.encryptionManager = null as any;
    this.messageProcessor = null as any;
    this.chatManager = null as any;
    this.publicRoomManager = null as any;
    this.tokenRoomManager = null as any;
  }

  /**
   * Initializes the plugin with the Shogun core
   */
  public initialize(core: ShogunCore): void {
    this.core = core;
    this.encryptionManager = new EncryptionManager(core);
    this.publicRoomManager = new PublicRoomManager(
      core,
      this.encryptionManager
    );
    this.tokenRoomManager = new TokenRoomManager(core, this.encryptionManager);
    this.chatManager = new ChatManager(
      core,
      this.tokenRoomManager,
      this.encryptionManager
    );
    this.messageProcessor = new MessageProcessor(core, this.encryptionManager);

    console.log("[MessagingPlugin] ✅ Plugin initialized successfully");
  }

  /**
   * Sends a private message to a recipient
   */
  public async sendMessage(
    recipientPub: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.chatManager.sendMessage(recipientPub, messageContent);
  }

  /**
   * Sends a public message to a room
   */
  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    return this.publicRoomManager.sendPublicMessage(roomId, messageContent);
  }

  /**
   * Sends a message to a token-protected room
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
   * Joins a chat (private, public, or token room)
   */
  public async joinChat(
    chatType: "private" | "public" | "token",
    chatId: string,
    token?: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    return this.chatManager.joinChat(chatType, chatId, token);
  }

  /**
   * Gets the user's chats
   */
  public async getMyChats(): Promise<{
    success: boolean;
    chats?: any[];
    error?: string;
  }> {
    return this.chatManager.getMyChats();
  }

  /**
   * Generates an invite link for a chat
   */
  public generateInviteLink(
    chatType: "private" | "public" | "token",
    chatId: string,
    chatName?: string
  ): string {
    return this.chatManager.generateInviteLink(chatType, chatId, chatName);
  }

  /**
   * Registers a callback for private messages
   */
  public onMessage(callback: MessageListener): void {
    this.messageProcessor.onMessage(callback);
  }

  /**
   * Registers a callback for public messages
   */
  public onPublicMessage(callback: MessageListener): void {
    this.publicRoomManager.onPublicMessage(callback);
  }

  /**
   * Registers a callback for token room messages
   */
  public onTokenRoomMessage(callback: MessageListener): void {
    this.tokenRoomManager.onTokenRoomMessage(callback);
  }

  /**
   * Starts listening to messages
   */
  public startListening(): void {
    this.messageProcessor.startListening();
  }

  /**
   * Stops listening to messages
   */
  public stopListening(): void {
    this.messageProcessor.stopListening();
  }

  /**
   * Gets the current listening status
   */
  public isListening(): boolean {
    return this.messageProcessor.isListening();
  }

  /**
   * Clears a conversation
   */
  public async clearConversation(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.messageProcessor.clearConversation(recipientPub);
  }

  /**
   * Gets a recipient's epub
   */
  public async getRecipientEpub(recipientPub: string): Promise<string> {
    return this.encryptionManager.getRecipientEpub(recipientPub);
  }

  /**
   * Publishes the user's epub
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
   * Checks if a user's epub is available
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
}
