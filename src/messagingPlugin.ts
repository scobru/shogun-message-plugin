// Plugin di messaggistica E2E corretto per GunDB
import { ShogunCore, PluginCategory } from "shogun-core";
import { BasePlugin } from "./base";
import {
  MessageData,
  MessageResponse,
  GroupData,
  TokenRoomData,
  MessageListener,
  PublicMessageListener,
  GroupMessageListener,
  TokenRoomMessageListener,
} from "./types";
import { generateMessageId, createSafePath, sendToGunDB } from "./utils";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";
import { PublicRoomManager } from "./publicRoomManager";
import { MessageProcessor } from "./messageProcessor";
import { ChatManager } from "./chatManager";
import { TokenRoomManager } from "./tokenRoomManager";

declare var Gun: any;
declare var SEA: any;

export class MessagingPlugin extends BasePlugin {
  public readonly name = "messaging";
  public readonly version = "4.7.0";
  public readonly description =
    "Plugin di messaggistica E2E con supporto per camere pubbliche, gruppi criptati e stanze token";
  public readonly _category = PluginCategory.Utility;

  // Modular components
  private encryptionManager!: EncryptionManager;
  private groupManager!: GroupManager;
  private publicRoomManager!: PublicRoomManager;
  private messageProcessor!: MessageProcessor;
  private chatManager!: ChatManager;
  private tokenRoomManager!: TokenRoomManager;

  // State tracking
  private pluginInitialized = false;

  protected assertInitialized(): ShogunCore {
    if (!this.core) {
      throw new Error(`${this.name} plugin non inizializzato.`);
    }
    return this.core;
  }

  public initialize(core: ShogunCore): void {
    if (this.pluginInitialized) {
      return;
    }

    this.core = core;
    this.pluginInitialized = true;

    // Initialize modular components
    this.encryptionManager = new EncryptionManager(core);
    this.groupManager = new GroupManager(core, this.encryptionManager);
    this.publicRoomManager = new PublicRoomManager(
      core,
      this.encryptionManager
    );
    this.messageProcessor = new MessageProcessor(
      core,
      this.encryptionManager,
      this.groupManager
    );
    this.tokenRoomManager = new TokenRoomManager(core, this.encryptionManager);
    this.chatManager = new ChatManager(
      core,
      this.groupManager,
      this.tokenRoomManager
    );

    // Set ChatManager reference in GroupManager after both are created
    this.groupManager.setChatManager(this.chatManager);

    if (core.isLoggedIn()) {
      this.startListening();
      this.encryptionManager.ensureUserEpubPublished();
      this.messageProcessor.startListeningGroups();
      this.tokenRoomManager.startListeningTokenRooms();
    }

    core.on("auth:login", () => {
      if (!this.messageProcessor.isListening()) {
        this.startListening();
      }
      this.encryptionManager.ensureUserEpubPublished();
      this.messageProcessor.startListeningGroups();
      this.tokenRoomManager.startListeningTokenRooms();
    });

    core.on("auth:logout", () => this.stopListening());
  }

  // ===== PRIVATE MESSAGING =====

  public async sendMessage(
    recipientPub: string,
    messageContent: string
  ): Promise<MessageResponse> {
    const core = this.assertInitialized();

    if (!core.isLoggedIn() || !core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio.",
      };
    }

    if (
      !recipientPub ||
      !messageContent ||
      typeof recipientPub !== "string" ||
      typeof messageContent !== "string"
    ) {
      return {
        success: false,
        error:
          "Destinatario e messaggio sono obbligatori e devono essere stringhe valide.",
      };
    }

    try {
      const currentUserPair = (core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const senderPub = currentUserPair.pub;
      const messageId = generateMessageId();

      // Crea il messaggio completo
      const messageData: MessageData = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
      };

      // Firma il messaggio
      messageData.signature = await core.db.sea.sign(
        messageData.content,
        currentUserPair
      );

      // Cifra l'intero messaggio per il destinatario
      const encryptedMessage = await this.encryptionManager.encryptMessage(
        messageData,
        recipientPub
      );

      // Crea il wrapper per GunDB
      const encryptedMessageData = {
        data: encryptedMessage,
        from: senderPub,
        timestamp: Date.now(),
        id: messageId,
      };

      // Usa il metodo condiviso per inviare a GunDB
      await sendToGunDB(
        core,
        recipientPub,
        messageId,
        encryptedMessageData,
        "private"
      );

      return { success: true, messageId };
    } catch (error: any) {
      console.error(`[${this.name}] ❌ Errore invio messaggio:`, error);
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante l'invio del messaggio",
      };
    }
  }

  public onMessage(callback: MessageListener): void {
    this.messageProcessor.onMessage(callback);
  }

  public startListening(): void {
    this.messageProcessor.startListening();
  }

  public stopListening(): void {
    this.messageProcessor.stopListening();
  }

  // ===== PUBLIC ROOM MESSAGING =====

  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    return this.publicRoomManager.sendPublicMessage(roomId, messageContent);
  }

  public onPublicMessage(callback: PublicMessageListener): void {
    this.publicRoomManager.onPublicMessage(callback);
  }

  public startListeningPublic(roomId: string): void {
    this.publicRoomManager.startListeningPublic(roomId);
  }

  public stopListeningPublic(): void {
    this.publicRoomManager.stopListeningPublic();
  }

  public removePublicMessageListener(callback: PublicMessageListener): void {
    this.publicRoomManager.removePublicMessageListener(callback);
  }

  // ===== GROUP MESSAGING =====

  public async createGroup(
    groupName: string,
    memberPubs: string[]
  ): Promise<{ success: boolean; groupData?: GroupData; error?: string }> {
    return this.groupManager.createGroup(groupName, memberPubs);
  }

  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    return this.groupManager.sendGroupMessage(groupId, messageContent);
  }

  public onGroupMessage(callback: GroupMessageListener): void {
    this.messageProcessor.onGroupMessage(callback);
  }

  public removeGroupMessageListener(callback: GroupMessageListener): void {
    this.messageProcessor.removeGroupMessageListener(callback);
  }

  public async addMemberToGroup(
    groupId: string,
    newMemberPub: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.groupManager.addMemberToGroup(groupId, newMemberPub);
  }

  public async isGroupMember(
    groupId: string,
    userPub: string
  ): Promise<{ success: boolean; isMember: boolean; error?: string }> {
    return this.groupManager.isGroupMember(groupId, userPub);
  }

  /**
   * Removes a member from a group (only group creator can do this)
   */
  public async removeMemberFromGroup(
    groupId: string,
    memberPubToRemove: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.groupManager.removeMemberFromGroup(groupId, memberPubToRemove);
  }

  /**
   * Allows a user to leave a group
   */
  public async leaveGroup(
    groupId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.groupManager.leaveGroup(groupId);
  }

  /**
   * Deletes a group entirely (only group creator can do this)
   */
  public async deleteGroup(
    groupId: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.groupManager.deleteGroup(groupId);
  }

  // ===== TOKEN ROOM MESSAGING =====

  public async createTokenRoom(
    roomName: string,
    description?: string,
    maxParticipants?: number
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    return this.tokenRoomManager.createTokenRoom(
      roomName,
      description,
      maxParticipants
    );
  }

  public async sendTokenRoomMessage(
    roomId: string,
    messageContent: string,
    token: string
  ): Promise<MessageResponse> {
    return this.tokenRoomManager.sendTokenRoomMessage(
      roomId,
      messageContent,
      token
    );
  }

  public onTokenRoomMessage(callback: TokenRoomMessageListener): void {
    this.tokenRoomManager.onTokenRoomMessage(callback);
  }

  public removeTokenRoomMessageListener(
    callback: TokenRoomMessageListener
  ): void {
    this.tokenRoomManager.removeTokenRoomMessageListener(callback);
  }

  public async joinTokenRoom(
    roomId: string,
    token: string
  ): Promise<{ success: boolean; roomData?: TokenRoomData; error?: string }> {
    return this.tokenRoomManager.joinTokenRoom(roomId, token);
  }

  public async getTokenRoomData(roomId: string): Promise<TokenRoomData | null> {
    return this.tokenRoomManager.getTokenRoomData(roomId);
  }

  // ===== CHAT MANAGEMENT =====

  public async joinGroup(
    groupId: string
  ): Promise<{ success: boolean; groupData?: GroupData; error?: string }> {
    return this.chatManager.joinGroup(groupId);
  }

  public async joinChat(
    chatType: "private" | "public" | "group" | "token",
    chatId: string,
    token?: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    return this.chatManager.joinChat(chatType, chatId, token);
  }

  public async getMyChats(): Promise<{
    success: boolean;
    chats?: any[];
    error?: string;
  }> {
    return this.chatManager.getMyChats();
  }

  public generateInviteLink(
    chatType: "private" | "public" | "group" | "token",
    chatId: string,
    chatName?: string,
    token?: string
  ): string {
    return this.chatManager.generateInviteLink(
      chatType,
      chatId,
      chatName,
      token
    );
  }

  // ===== CONVERSATION MANAGEMENT =====

  public async clearConversation(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.messageProcessor.clearConversation(recipientPub);
  }

  public resetClearedConversations(): void {
    this.messageProcessor.resetClearedConversations();
  }

  // ===== UTILITY METHODS =====

  // ===== STATS AND INFO =====

  public getStats() {
    return {
      isListening: this.messageProcessor.isListening(),
      isListeningPublic: this.publicRoomManager.isListeningPublic(),
      isListeningGroups: this.messageProcessor.isListeningGroups(),
      isListeningTokenRooms: this.tokenRoomManager.isListeningTokenRooms(),
      messageListenersCount: this.messageProcessor.getMessageListenersCount(),
      publicMessageListenersCount:
        this.publicRoomManager.getPublicMessageListenersCount(),
      groupMessageListenersCount:
        this.messageProcessor.getGroupMessageListenersCount(),
      tokenRoomMessageListenersCount:
        this.tokenRoomManager.getTokenRoomMessageListenersCount(),
      processedMessagesCount: this.messageProcessor.getProcessedMessagesCount(),
      processedPublicMessagesCount:
        this.publicRoomManager.getProcessedPublicMessagesCount(),
      processedGroupMessagesCount:
        this.messageProcessor.getProcessedGroupMessagesCount(),
      processedTokenMessagesCount:
        this.tokenRoomManager.getProcessedTokenMessagesCount(),
      clearedConversationsCount:
        this.messageProcessor.getClearedConversationsCount(),
      activeTokenRoomsCount: this.tokenRoomManager.getActiveTokenRoomsCount(),
      version: this.version,
    };
  }

  public destroy(): void {
    this.stopListening();
    this.stopListeningPublic();
    this.messageProcessor.stopListeningGroups();
    this.tokenRoomManager.stopListeningTokenRooms();
    this.pluginInitialized = false;
    this.core = null;
  }
}
