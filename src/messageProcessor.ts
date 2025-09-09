import { GunInstance, ShogunCore } from "shogun-core";
import {
  MessageData,
  MessageListener,
  GroupMessageListener,
  UserPair,
  MessageDataRaw,
  MessageDataWithId,
  ConversationPathData,
  DebugPathItem,
  ClearMessageResult,
  VerifyConversationResult,
  DebugGunDBResult,
} from "./types";
import {
  AsyncLock,
  AtomicMessageDeduplicator,
} from "./concurrencyImprovements";
import { LRUCache, MessageObjectPool } from "./performanceOptimizations";
import { InputValidator, RateLimiter } from "./securityEnhancements";
import {
  createSafePath,
  createConversationPath,
} from "./utils";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";
import { PublicRoomManager } from "./publicRoomManager";
import { TokenRoomManager } from "./tokenRoomManager";
import { MessagingSchema } from "./schema";
import { getConfig } from "./config";

/**
 * Enhanced message processing and listener management for the messaging plugin
 * Optimized for performance and efficiency
 */
export class MessageProcessor {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private groupManager: GroupManager;
  private publicRoomManager: PublicRoomManager;
  private tokenRoomManager: TokenRoomManager;

  // Message handling
  private messageListeners: MessageListener[] = [];
  private groupMessageListenersInternal: GroupMessageListener[] = [];
  private _isListening = false;
  private processedMessageIds = new Map<string, number>();
  private retryAttempts = new Map<string, number>(); // Track retry attempts
  private lastNullMessageLog = 0; // Rate limiter for null message logs
  private lastTraditionalNullLog = 0; // Rate limiter for traditional listener null logs
  private groupSubscriptions = new Map<string, any>();
  private conversationSubscriptions = new Map<string, any>(); // For conversation listeners
  private conversationListeners: any[] = []; // Added for conversation path listening

  // **NEW: Batch notifications to reduce per-message handler cost**
  private _batchedNotifyQueue: MessageData[] = [];
  private _batchedNotifyTimer: ReturnType<typeof setTimeout> | null = null;

  // **FIXED: Replace simple cache with atomic deduplicator**
  private atomicDeduplicator: AtomicMessageDeduplicator;
  private operationLock: AsyncLock;

  // **FIXED: Memory management with LRU cache and object pooling**
  private messageObjectPool: MessageObjectPool;
  private lruCache: LRUCache<string, any>;

  // **FIXED: Security components**
  private inputValidator: InputValidator;
  private rateLimiter: RateLimiter;

  // Configuration
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL =
    getConfig().localStorageCleanupInterval || 24 * 60 * 60 * 1000;
  private readonly DECRYPTION_TIMEOUT = getConfig().encryptionTimeout || 10000;
  private readonly RETRY_ATTEMPTS = 3;
  private clearedConversations = new Set<string>();

  // Persistence for cleared conversations
  private readonly CLEARED_CONVERSATIONS_KEY = "shogun_cleared_conversations";

  constructor(
    core: ShogunCore,
    encryptionManager: EncryptionManager,
    groupManager: GroupManager,
    publicRoomManager: PublicRoomManager,
    tokenRoomManager: TokenRoomManager
  ) {
    this.core = core;
    this.encryptionManager = encryptionManager;
    this.groupManager = groupManager;
    this.publicRoomManager = publicRoomManager;
    this.tokenRoomManager = tokenRoomManager;
    this.loadClearedConversations();

    // **FIXED: Initialize atomic deduplicator and operation lock**
    this.atomicDeduplicator = new AtomicMessageDeduplicator(
      this.MAX_PROCESSED_MESSAGES,
      this.MESSAGE_TTL
    );
    this.operationLock = new AsyncLock();

    // **FIXED: Initialize memory management components**
    this.messageObjectPool = new MessageObjectPool(100);
    this.lruCache = new LRUCache<string, any>(500); // Reduced from 1000

    // **FIXED: Initialize security components**
    this.inputValidator = new InputValidator();
    this.rateLimiter = new RateLimiter();
  }

  /**
   * Start listening for messages
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
    const currentUserEpub = currentUserPair.epub;

    // Use traditional method for stability
      await this.startListeningTraditional(
        currentUserEpub,
        currentUserPair,
        currentUserPub
      );
  }


  /**
   * Traditional listening method
   */
  private async startListeningTraditional(
    currentUserEpub: string,
    currentUserPair: UserPair,
    currentUserPub: string
  ): Promise<void> {
    const recipientPath = MessagingSchema.privateMessages.currentUser(currentUserPub);
    const recipientMessageNode = this.core.db.gun.get(recipientPath).map();
    
    const optimizedHandler = this.createOptimizedMessageHandler(
      async (messageData: MessageDataRaw, messageId: string) => {
        if (!messageData || !messageId || !messageData.data || !messageData.from) {
          return;
        }

        await this.processIncomingMessage(
          messageData,
          messageId,
          currentUserPair,
          currentUserPub
        );
      }
    );

    this.conversationListeners.push(recipientMessageNode.on(optimizedHandler));
  }

  /**
   * Add a dedicated conversation listener for a specific contact
   */
  public addConversationListenerForContact(
    contactPub: string,
    callback?: (message: MessageData) => void
  ): void {
    if (!this.core.isLoggedIn() || !this.core.db.user || !contactPub || 
        this.conversationSubscriptions.has(contactPub)) {
        return;
      }

      const currentUserPair = (this.core.db.user as any)?._?.sea;
    if (!currentUserPair) return;

    const currentUserPub = currentUserPair.pub;
      const recipientPath = MessagingSchema.privateMessages.recipient(contactPub);
      const node = this.core.db.gun.get(recipientPath).map();

      const handler = node.on(
        async (messageData: MessageDataRaw, messageId: string) => {
          try {
          if (!messageData || !messageId || !messageData.from || 
              (!messageData.data && !messageData.content)) return;

            const isFromCurrentUser = messageData.from === currentUserPub;
          const isToCurrentUser = messageData.to === currentUserPub || !messageData.to;
            if (!isFromCurrentUser && !isToCurrentUser) return;

            if (this.processedMessageIds.has(messageId)) return;
            this.processedMessageIds.set(messageId, Date.now());

            let finalMessage: MessageData | null = null;

            if (isFromCurrentUser) {
              finalMessage = {
                id: messageId,
              content: (messageData.content as string) || (messageData.data as string) || "",
                from: messageData.from,
              timestamp: parseInt(((messageData.timestamp as number) || Date.now()).toString()),
                signature: messageData.signature as string | undefined,
              } as MessageData;
            } else {
              const decrypted = await this.encryptionManager.decryptMessage(
                messageData.data as string,
                currentUserPair,
                messageData.from
              );

              if (decrypted.signature) {
              const dataToVerify = JSON.stringify({
                    content: decrypted.content,
                    timestamp: decrypted.timestamp,
                    id: decrypted.id,
              }, Object.keys({ content: "", timestamp: 0, id: "" }).sort());
              
              const isValid = await this.encryptionManager.verifyMessageSignature(
                    dataToVerify,
                    decrypted.signature,
                    decrypted.from
                  );
                if (!isValid) {
                  this.processedMessageIds.delete(messageId);
                  return;
                }
              }

              if (this.isConversationCleared(decrypted.from, currentUserPub)) {
                this.processedMessageIds.delete(messageId);
                return;
              }

              finalMessage = decrypted;
            }

            if (finalMessage && callback) {
              callback(finalMessage);
            }
          } catch (e) {
            this.processedMessageIds.delete(messageId);
          }
        }
      );

      this.conversationSubscriptions.set(contactPub, {
        off: handler?.off || null,
      });
  }

  /**
   * Remove a dedicated conversation listener for a specific contact
   */
  public removeConversationListenerForContact(contactPub: string): void {
    const subscription = this.conversationSubscriptions.get(contactPub);
    if (subscription) {
      if (subscription.off && typeof subscription.off === "function") {
          subscription.off();
      }
      this.conversationSubscriptions.delete(contactPub);
    }
  }

  /**
   * Process incoming message
   */
  private async processIncomingMessage(
    messageData: MessageDataRaw,
    messageId: string,
    currentUserPair: UserPair,
    currentUserPub: string
  ): Promise<void> {
    const isDuplicate = await this.atomicDeduplicator.isDuplicate(messageId);
    if (isDuplicate) return;

    if (!messageData || !messageData.from || messageData._deleted === true) {
      await this.atomicDeduplicator.removeProcessed(messageId);
      return;
    }

    const validation = this.inputValidator.validateMessageData(messageData);
    if (!validation.isValid || !this.rateLimiter.isAllowed(messageData.from || '')) {
      await this.atomicDeduplicator.removeProcessed(messageId);
      return;
    }

    const hasContent = !!(messageData.data || messageData.content);
    if (!hasContent) {
      await this.atomicDeduplicator.removeProcessed(messageId);
      return;
    }

    const isFromCurrentUser = messageData.from === currentUserPub;
    const isToCurrentUser = messageData.to === currentUserPub || !messageData.to;

    if (!isFromCurrentUser && !isToCurrentUser) {
      await this.atomicDeduplicator.removeProcessed(messageId);
      return;
    }

    try {
      if (isFromCurrentUser) {
        const selfSentMessage: MessageData = {
          id: messageId,
          content: (messageData.content as string) || (messageData.data as string) || "",
          from: messageData.from,
          timestamp: parseInt(((messageData.timestamp as number) || Date.now()).toString()),
          signature: messageData.signature as string | undefined,
        };
        this.notifyListeners(selfSentMessage);
        return;
      }

      if (!messageData.data) {
          await this.atomicDeduplicator.removeProcessed(messageId);
          return;
        }

      const decryptedMessage = await this.encryptionManager.decryptMessage(
          messageData.data,
          currentUserPair,
          messageData.from
        );

        decryptedMessage.isEncrypted = true;

      if (decryptedMessage.signature) {
        const dataToVerify = JSON.stringify({
            content: decryptedMessage.content,
            timestamp: decryptedMessage.timestamp,
            id: decryptedMessage.id,
        }, Object.keys({ content: "", timestamp: 0, id: "" }).sort());

        const isValid = await this.encryptionManager.verifyMessageSignature(
          dataToVerify,
          decryptedMessage.signature,
          decryptedMessage.from
        );

        if (!isValid) {
          await this.atomicDeduplicator.removeProcessed(messageId);
          return;
        }
      } else {
        await this.atomicDeduplicator.removeProcessed(messageId);
        return;
      }

      if (this.isConversationCleared(decryptedMessage.from, currentUserPub)) {
        await this.atomicDeduplicator.removeProcessed(messageId);
        return;
      }

      this.notifyListeners(decryptedMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      if (errorMessage.includes("Cannot find encryption public key") ||
        errorMessage.includes("Timeout getting profile data") ||
        errorMessage.includes("Timeout getting root data") ||
          errorMessage.includes("Timeout getting user data")) {
        
        const fallbackMessage = {
          id: messageId,
          content: "[Message temporarily unavailable - retrying...]",
          from: messageData?.from || "unknown",
          timestamp: parseInt((messageData?.timestamp || Date.now()).toString()),
          isEncrypted: true,
          needsRetry: true,
        };

        this.notifyListeners(fallbackMessage);
        await this.atomicDeduplicator.removeProcessed(messageId);
        return;
      }

      await this.atomicDeduplicator.removeProcessed(messageId);
    }
  }

  /**
   * Notify listeners with batched processing
   */
  public notifyListeners(decryptedMessage: MessageData): void {
    try {
      this._batchedNotifyQueue.push(decryptedMessage);
      if (this._batchedNotifyTimer) return;

      const scheduleNotification = () => {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => this.processNotificationBatch());
        } else {
          setTimeout(() => this.processNotificationBatch(), 16);
        }
      };

      this._batchedNotifyTimer = setTimeout(scheduleNotification, 16);
    } catch (error) {
      console.error("Error in notifyListeners:", error);
    }
  }

  /**
   * Create optimized message handler
   */
  private createOptimizedMessageHandler(
    processor: (messageData: MessageDataRaw, messageId: string) => Promise<void> | void
  ) {
    let lastProcessTime = 0;
    let pendingMessages: Array<{ data: MessageDataRaw; id: string }> = [];
    let processingTimer: NodeJS.Timeout | null = null;
    const throttleDelay = 10;

    const processPending = async () => {
      if (pendingMessages.length === 0) return;

      const messagesToProcess = pendingMessages.splice(0);
      processingTimer = null;

      const chunkSize = 3;
      for (let i = 0; i < messagesToProcess.length; i += chunkSize) {
        const chunk = messagesToProcess.slice(i, i + chunkSize);
        const startTime = performance.now();

        for (const { data, id } of chunk) {
          try {
            await processor(data, id);
          } catch (error) {
            console.error("Error processing message:", error);
          }
        }

        const elapsed = performance.now() - startTime;
        if (elapsed > 16) {
          await new Promise((resolve) => {
            if (typeof requestIdleCallback !== "undefined") {
              requestIdleCallback(() => resolve(undefined));
            } else {
              setTimeout(() => resolve(undefined), 0);
            }
          });
        }
      }
    };

    return (data: MessageDataRaw, id: string) => {
      const now = Date.now();

      if (now - lastProcessTime < throttleDelay) {
        pendingMessages.push({ data, id });
        if (!processingTimer) {
          processingTimer = setTimeout(processPending, throttleDelay);
        }
        return;
      }

      lastProcessTime = now;
      pendingMessages.push({ data, id });

      if (!processingTimer) {
        processingTimer = setTimeout(processPending, 0);
      }
    };
  }

  /**
   * Process notification batch
   */
  private processNotificationBatch(): void {
    const messages = this._batchedNotifyQueue.splice(0);
    this._batchedNotifyTimer = null;
    const listenersToNotify = [...this.messageListeners];

    console.log("🔍 MessageProcessor.processNotificationBatch: Processing batch", {
      messageCount: messages.length,
      listenerCount: listenersToNotify.length,
      messages: messages.map(m => ({ id: m.id, from: m.from?.slice(0, 8) + "...", content: m.content?.substring(0, 20) + "..." }))
    });

    if (listenersToNotify.length === 0 || messages.length === 0) {
      console.warn("⚠️ MessageProcessor.processNotificationBatch: No listeners or messages", {
        listenerCount: listenersToNotify.length,
        messageCount: messages.length
      });
      return;
    }

    const processChunk = (startIndex: number) => {
      const chunkSize = 3;
      const endIndex = Math.min(startIndex + chunkSize, messages.length);

      for (let i = startIndex; i < endIndex; i++) {
        const msg = messages[i];
        listenersToNotify.forEach((listener, index) => {
          try {
            console.log(`🔍 MessageProcessor.processNotificationBatch: Calling listener ${index} with message:`, {
              id: msg.id,
              from: msg.from?.slice(0, 8) + "...",
              content: msg.content?.substring(0, 20) + "..."
            });
            listener(msg);
          } catch (error) {
            console.error("Error in listener:", error);
          }
        });
      }

      if (endIndex < messages.length) {
        if (typeof requestIdleCallback !== "undefined") {
          requestIdleCallback(() => processChunk(endIndex));
        } else {
          setTimeout(() => processChunk(endIndex), 0);
        }
      }
    };

    processChunk(0);
  }

  /**
   * Notify group listeners
   */
  private notifyGroupListeners(decryptedMessage: MessageData): void {
    if (this.groupMessageListenersInternal.length === 0) {
      return;
    }

    this.groupMessageListenersInternal.forEach((callback) => {
      try {
        callback(decryptedMessage as any);
      } catch (error) {
        console.error("Error in group message listener:", error);
      }
    });
  }

  /**
   * Cleanup processed messages
   */
  private cleanupProcessedMessages(): void {
    // Cleanup is handled by AtomicMessageDeduplicator
      // LRU cache automatically evicts least recently used items
  }

  /**
   * Register message listener
   */
  public onMessage(callback: MessageListener): void {
    if (typeof callback !== "function") {
      console.warn("⚠️ MessageProcessor.onMessage: Invalid callback provided");
      return;
    }

    this.messageListeners.push(callback);
    console.log("🔍 MessageProcessor.onMessage: Listener registered, total listeners:", this.messageListeners.length);
  }

  /**
   * Stop listening
   */
  public stopListening(): void {
    if (!this._isListening) return;


    // Unsubscribe from all group subscriptions
    this.groupSubscriptions.forEach((subscription) => {
      if (subscription && subscription.off && typeof subscription.off === "function") {
        subscription.off();
      }
    });
    this.groupSubscriptions.clear();

    // Unsubscribe from all conversation subscriptions
    this.conversationSubscriptions.forEach((subscription) => {
      if (subscription && subscription.off && typeof subscription.off === "function") {
        subscription.off();
      }
    });
    this.conversationSubscriptions.clear();

    // Stop listening to public rooms
    this.publicRoomManager.stopListeningPublic();

    // Stop listening to token rooms
    this.tokenRoomManager.stopListeningTokenRooms();

    this._isListening = false;
    this.processedMessageIds.clear();
    this.lruCache.clear();
    this.messageObjectPool = new MessageObjectPool(100);
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
    return this.groupSubscriptions.size;
  }

  /**
   * Gets the number of public room message listeners
   */
  public getPublicRoomMessageListenersCount(): number {
    return this.publicRoomManager.getPublicMessageListenersCount();
  }

  /**
   * Gets the number of token room message listeners
   */
  public getTokenRoomMessageListenersCount(): number {
    return this.tokenRoomManager.getTokenRoomMessageListenersCount();
  }

  /**
   * Checks if group listening is active
   */
  public isListeningGroups(): boolean {
    return this.groupSubscriptions.size > 0;
  }

  /**
   * Checks if a specific group has an active listener
   */
  public hasGroupListener(groupId: string): boolean {
    return this.groupSubscriptions.has(groupId);
  }

  /**
   * Checks if public room listening is active
   */
  public isListeningPublicRooms(): boolean {
    return this.publicRoomManager.isListeningPublic();
  }

  /**
   * Checks if token room listening is active
   */
  public isListeningTokenRooms(): boolean {
    return this.tokenRoomManager.isListeningTokenRooms();
  }

  /**
   * Checks if a specific public room has an active listener
   */
  public hasPublicRoomListener(roomId: string): boolean {
    return this.publicRoomManager.hasActiveRoomListener(roomId);
  }

  /**
   * Checks if a specific token room has an active listener
   */
  public hasTokenRoomListener(roomId: string): boolean {
    return this.tokenRoomManager.isListeningToRoom(roomId);
  }

  // **ADDED BACK: Group management functions**

  /**
   * Register group message listener
   */
  public onGroupMessage(callback: GroupMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.groupMessageListenersInternal.push(callback);
  }

  /**
   * Register public room message listener
   */
  public onPublicRoomMessage(callback: any): void {
    this.publicRoomManager.onPublicMessage(callback);
  }

  /**
   * Register token room message listener
   */
  public onTokenRoomMessage(callback: any): void {
    this.tokenRoomManager.onTokenRoomMessage(callback);
  }

  /**
   * Add group listener
   */
  public addGroupListener(groupId: string): void {
    if (!groupId || this.groupSubscriptions.has(groupId)) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)?._?.sea;
    if (!currentUserPair) {
      return;
    }

      this.addGroupListenerTraditional(groupId, currentUserPair);
  }

  /**
   * Add group listener using traditional GunDB approach
   */
  private addGroupListenerTraditional(
    groupId: string,
    currentUserPair: UserPair
  ): void {
    try {
      const groupMessagePath = MessagingSchema.groups.messages(groupId);
      const groupNode = this.core.db.gun.get(groupMessagePath);

      const listener = {
        groupId,
        node: groupNode,
        off: null as any,
      };

      const messageListener = groupNode
        .map()
        .on(async (messageData: any, messageId: string) => {
          if (messageData && messageId && messageId !== "_") {
            try {
              await this.processIncomingGroupMessageTraditional(
                messageData,
                messageId,
                currentUserPair,
                groupId
              );
            } catch (error) {
              console.error("Error processing group message:", error);
            }
          }
        });

      listener.off = messageListener.off;
      this.groupSubscriptions.set(groupId, listener);
    } catch (error) {
      console.error("Error adding group listener:", error);
    }
  }

  /**
   * Process incoming group message using traditional approach
   */
  private async processIncomingGroupMessageTraditional(
    messageData: any,
    messageId: string,
    currentUserPair: UserPair,
    groupId: string
  ): Promise<void> {
    try {
      let parsedData: any;
      if (typeof messageData === "string") {
        try {
          parsedData = JSON.parse(messageData);
        } catch (error) {
          return;
        }
      } else {
        parsedData = messageData;
      }

      if (this.processedMessageIds.has(messageId)) {
        return;
      }

      this.processedMessageIds.set(messageId, Date.now());

      const groupData = await this.groupManager.getGroupData(groupId);
      if (!groupData) {
        return;
      }

      const groupKey = await this.groupManager.getGroupKeyForUser(
        groupData,
        currentUserPair.pub,
        currentUserPair
      );
      if (!groupKey) {
        return;
      }

      const decryptedContent = await this.core.db.sea.decrypt(
        parsedData.content,
        groupKey
      );

      if (!decryptedContent) {
        return;
      }

      const isValidSignature = await this.encryptionManager.verifyMessageSignature(
          decryptedContent,
          parsedData.signature,
          parsedData.from
        );

      if (!isValidSignature) {
        return;
      }

      const finalMessage: MessageData = {
        id: messageId,
        from: parsedData.from,
        content: decryptedContent,
        timestamp: parseInt((parsedData.timestamp || Date.now()).toString()),
        signature: parsedData.signature,
        groupId: groupId,
      };

      this.notifyGroupListeners(finalMessage);
    } catch (error) {
      console.error("Error processing group message:", error);
    }
  }


  /**
   * Remove group listener
   */
  public removeGroupListener(groupId: string): void {
    const subscription = this.groupSubscriptions.get(groupId);
    if (subscription) {
      if (subscription.off && typeof subscription.off === "function") {
        subscription.off();
      }
      this.groupSubscriptions.delete(groupId);
    }
  }

  /**
   * Add public room listener
   */
  public addPublicRoomListener(roomId: string): void {
    this.publicRoomManager.startListeningPublic(roomId);
  }

  /**
   * Remove public room listener
   */
  public removePublicRoomListener(roomId: string): void {
    this.publicRoomManager.stopListeningToRoom(roomId);
  }

  /**
   * Add token room listener
   */
  public addTokenRoomListener(roomId: string, token: string): void {
    this.tokenRoomManager.startListeningToRoom(roomId, token);
  }

  /**
   * Remove token room listener
   */
  public removeTokenRoomListener(roomId: string): void {
    this.tokenRoomManager.leaveTokenRoom(roomId);
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
   * Load cleared conversations from localStorage
   */
  private loadClearedConversations(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = window.localStorage.getItem(this.CLEARED_CONVERSATIONS_KEY);
        if (stored) {
          const conversationIds = JSON.parse(stored);
          this.clearedConversations = new Set(conversationIds);
        }
      }
    } catch (error) {
      console.error("Error loading cleared conversations:", error);
    }
  }

  /**
   * Save cleared conversations to localStorage
   */
  private saveClearedConversations(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const conversationIds = Array.from(this.clearedConversations);
        window.localStorage.setItem(
          this.CLEARED_CONVERSATIONS_KEY,
          JSON.stringify(conversationIds)
        );
      }
    } catch (error) {
      console.error("Error saving cleared conversations:", error);
    }
  }

  /**
   * Add conversation to cleared set and persist
   */
  private addClearedConversation(from: string, to: string): void {
    const conversationId = this.createConversationId(from, to);
    this.clearedConversations.add(conversationId);
    this.saveClearedConversations();
  }

  /**
   * Public method to add conversation to cleared set (for app layer sync)
   */
  public markConversationAsCleared(from: string, to: string): void {
    this.addClearedConversation(from, to);
  }

  /**
   * Public method to check if conversation is cleared
   */
  public isConversationClearedPublic(from: string, to: string): boolean {
    return this.isConversationCleared(from, to);
  }

  /**
   * Public method to remove conversation from cleared set (for restoration)
   */
  public removeClearedConversation(from: string, to: string): void {
    const conversationId = this.createConversationId(from, to);
    this.clearedConversations.delete(conversationId);
    this.saveClearedConversations();
  }

  /**
   * Public method to reset all cleared conversations
   */
  public resetClearedConversations(): void {
    this.clearedConversations.clear();
    this.saveClearedConversations();
  }

  /**
   * Public method to reset a specific conversation from cleared state
   */
  public resetClearedConversation(contactPub: string): void {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      return;
    }

    const currentUserPub = currentUserPair.pub;
    const conversationId = this.createConversationId(currentUserPub, contactPub);

    if (this.clearedConversations.has(conversationId)) {
      this.clearedConversations.delete(conversationId);
      this.saveClearedConversations();
    }
  }

  /**
   * Public method to reload messages for a specific contact
   */
  public async reloadMessages(contactPub: string): Promise<any[]> {
    this.resetClearedConversation(contactPub);
    return await this.loadExistingMessages(contactPub);
  }

  /**
   * Load existing messages from localStorage only
   */
  public async loadExistingMessages(contactPub: string): Promise<any[]> {
    try {
      if (!this.core.isLoggedIn() || !this.core.db.user) {
        return [];
      }

      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return [];
      }

      const currentUserPub = currentUserPair.pub;
      const conversationId = this.createConversationId(currentUserPub, contactPub);
      const localStorageKey = `shogun_messages_${conversationId}`;

        if (typeof window === "undefined" || !window.localStorage) {
          return [];
        }

        const storedMessages = window.localStorage.getItem(localStorageKey);
        if (storedMessages) {
        return JSON.parse(storedMessages);
      }

      return [];
    } catch (error) {
      console.error("Error loading existing messages:", error);
      return [];
    }
  }

  /**
   * Clears all messages in a conversation with a specific recipient
   */
  public async clearConversation(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string; clearedCount?: number }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "You must be logged in to clear a conversation.",
      };
    }

    if (!recipientPub || typeof recipientPub !== "string") {
      return {
        success: false,
        error: "Recipient public key is required.",
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

      const currentUserPub = currentUserPair.pub;

      // Create a unique conversation identifier
      const conversationId = this.createConversationId(
        currentUserPub,
        recipientPub
      );

      // Mark this conversation as cleared
      this.clearedConversations.add(conversationId);
      this.saveClearedConversations(); // Persist the cleared state

      let totalClearedCount = 0;

      console.log("🗑️ Starting conversation cleanup for:", conversationId);
      console.log("🔍 Debug paths:", {
        currentUserPub,
        recipientPub,
        recipientSafePath: MessagingSchema.privateMessages.recipient(recipientPub),
        currentUserSafePath: MessagingSchema.privateMessages.currentUser(currentUserPub),
      });

      // Use a more robust clearing approach
      try {
        // Clear messages sent TO the recipient (stored under recipient's path)
        const recipientSafePath = MessagingSchema.privateMessages.recipient(recipientPub);
        const recipientClearedCount = await this.clearMessagesFromPath(
          recipientSafePath,
          currentUserPub,
          recipientPub,
          "recipient"
        );
        totalClearedCount += recipientClearedCount;
      } catch (error) {
        console.warn("⚠️ Error clearing recipient path:", error);
      }

      try {
        // Clear messages received FROM the recipient (stored under current user's path)
        const currentUserSafePath = MessagingSchema.privateMessages.currentUser(currentUserPub);
        const currentUserClearedCount = await this.clearMessagesFromPath(
          currentUserSafePath,
          recipientPub,
          currentUserPub,
          "sender"
        );
        totalClearedCount += currentUserClearedCount;
      } catch (error) {
        console.warn("⚠️ Error clearing current user path:", error);
      }

      // Clear processed message IDs for this conversation
      const conversationMessageIds = Array.from(
        this.processedMessageIds.keys()
      ).filter(
        (messageId) =>
          messageId.includes(currentUserPub) || messageId.includes(recipientPub)
      );

      conversationMessageIds.forEach((messageId) => {
        this.processedMessageIds.delete(messageId);
      });

      // Clear retry attempts for this conversation
      const conversationRetryIds = Array.from(this.retryAttempts.keys()).filter(
        (messageId) =>
          messageId.includes(currentUserPub) || messageId.includes(recipientPub)
      );

      conversationRetryIds.forEach((messageId) => {
        this.retryAttempts.delete(messageId);
      });

      console.log("🗑️ Conversation cleanup completed:", {
        conversationId,
        totalClearedCount,
        processedIdsRemoved: conversationMessageIds.length,
        retryIdsRemoved: conversationRetryIds.length,
      });

      return {
        success: true,
        clearedCount: totalClearedCount,
      };
    } catch (error: any) {
      console.error("❌ Error in clearConversation:", error);
      return {
        success: false,
        error: error.message || "Unknown error while clearing the conversation",
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
    pathType: "sender" | "recipient"
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        console.log(`🗑️ Clearing messages from ${pathType} path:`, path);

        const node = this.core.db.gun.get(path);
        let clearedCount = 0;
        let totalMessages = 0;
        let completedOperations = 0;
        let hasError = false;
        let timeoutId: ReturnType<typeof setTimeout>;
        let operationTimeoutId: ReturnType<typeof setTimeout>;
        let hasStartedProcessing = false;

        const checkCompletion = () => {
          if (hasStartedProcessing && completedOperations === totalMessages) {
            clearTimeout(timeoutId);
            clearTimeout(operationTimeoutId);
            if (hasError) {
              console.error(`❌ Error clearing messages from ${pathType} path`);
              reject(new Error(`Error while clearing ${pathType} messages`));
            } else {
              console.log(
                `✅ Cleared ${clearedCount} messages from ${pathType} path`
              );
              resolve(clearedCount);
            }
          }
        };

        // Better message filtering logic
        node.map().on((messageData: any, messageId: string) => {
          hasStartedProcessing = true;
          totalMessages++;

          // DEBUG: Log all messages to understand the structure
          console.log(`🔍 Message ${messageId} in ${pathType} path:`, {
            messageData,
            fromPub,
            toPub,
            pathType,
            hasFrom: messageData?.from,
            hasContent: messageData?.content,
            hasData: messageData?.data,
            hasTimestamp: messageData?.timestamp,
          });

          // More comprehensive message filtering
          let shouldClear = false;

          // Handle both valid messages and null messages (already deleted)
          if (messageData === null) {
            // Message was already deleted from GunDB, but still exists as a node
            shouldClear = true;
            console.log(
              `🔍 Message ${messageId} is null (already deleted), will clear node`
            );
          } else if (messageData && typeof messageData === "object") {
            // Check if this is a message in our conversation
            if (pathType === "recipient") {
              // Messages sent TO recipient: check if from current user
              shouldClear = messageData.from === fromPub;
            } else if (pathType === "sender") {
              // Messages received FROM sender: check if from the other user
              shouldClear = messageData.from === fromPub;
            }

            // More flexible message validation - accept any message with from/to fields
            shouldClear =
              shouldClear &&
              (messageData.from ||
                messageData.to ||
                messageData.content ||
                messageData.data ||
                messageData.timestamp ||
                messageData.id);
          }

          console.log(`🔍 Should clear message ${messageId}: ${shouldClear}`);

          if (shouldClear) {
            console.log(
              `🗑️ Clearing message ${messageId} from ${pathType} path`
            );

            // Add operation timeout
            const operationTimeout = setTimeout(() => {
              completedOperations++;
              hasError = true;
              console.warn(`⚠️ Timeout clearing message ${messageId}`);
              checkCompletion();
            }, 1000);

            // More robust message deletion with proper GunDB node handling
            const messageNode = node.get(messageId);

            // First, try to get the current message to verify it exists
            messageNode.on((currentMessage: any) => {
              console.log(`🔍 Current message ${messageId}:`, currentMessage);

              if (currentMessage) {
                // Use a more reliable deletion approach
                messageNode.put({}, (ack: any) => {
                  clearTimeout(operationTimeout);
                  completedOperations++;

                  if (ack.err) {
                    hasError = true;
                    console.error(
                      `❌ Error clearing message ${messageId}:`,
                      ack.err
                    );
                  } else {
                    clearedCount++;
                    console.log(`✅ Cleared message ${messageId}`);

                    // Verify deletion by checking again
                    setTimeout(() => {
                      messageNode.on((deletedMessage: any) => {
                        if (deletedMessage) {
                          console.warn(
                            `⚠️ Message ${messageId} still exists after deletion!`
                          );
                        } else {
                          console.log(
                            `✅ Message ${messageId} successfully deleted and verified`
                          );
                        }
                      });
                    }, 100);
                  }

                  checkCompletion();
                });
              } else {
                console.log(
                  `ℹ️ Message ${messageId} not found, skipping deletion`
                );
                clearTimeout(operationTimeout);
                completedOperations++;
                checkCompletion();
              }
            });
          } else {
            completedOperations++;
            checkCompletion();
          }
        });

        // Better timeout handling
        timeoutId = setTimeout(() => {
          if (!hasStartedProcessing) {
            console.log(`ℹ️ No messages found in ${pathType} path`);
            resolve(0);
          } else if (completedOperations === totalMessages) {
            console.log(`✅ All operations completed for ${pathType} path`);
            resolve(clearedCount);
          }
        }, 1000);

        // Overall operation timeout
        operationTimeoutId = setTimeout(() => {
          console.warn(`⚠️ Overall timeout for ${pathType} path clearing`);
          resolve(clearedCount); // Return what we managed to clear
        }, 3000);
      } catch (error) {
        console.error(
          `❌ Exception in clearMessagesFromPath (${pathType}):`,
          error
        );
        reject(error);
      }
    });
  }

  /**
   * Set all messages in a conversation to null without blocking future messages
   */
  public async setMessagesToNull(
    recipientPub: string
  ): Promise<{ success: boolean; error?: string; nullifiedCount?: number }> {
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

      let totalNullifiedCount = 0;

      console.log("🗑️ Starting message nullification for conversation:", {
        currentUserPub: currentUserPub.slice(0, 8) + "...",
        recipientPub: recipientPub.slice(0, 8) + "...",
      });

      // Do NOT mark conversation as cleared - this allows future messages

      // Set messages sent TO the recipient to null (stored under recipient's path)
      try {
        const recipientSafePath = MessagingSchema.privateMessages.recipient(recipientPub);
        const recipientNullifiedCount = await this.setMessagesToNullFromPath(
          recipientSafePath,
          currentUserPub,
          recipientPub,
          "recipient"
        );
        totalNullifiedCount += recipientNullifiedCount;
      } catch (error) {
        console.warn("⚠️ Error nullifying recipient path:", error);
      }

      // Set messages received FROM the recipient to null (stored under current user's path)
      try {
        const currentUserSafePath = MessagingSchema.privateMessages.currentUser(currentUserPub);
        const currentUserNullifiedCount = await this.setMessagesToNullFromPath(
          currentUserSafePath,
          recipientPub,
          currentUserPub,
          "sender"
        );
        totalNullifiedCount += currentUserNullifiedCount;
      } catch (error) {
        console.warn("⚠️ Error nullifying current user path:", error);
      }

      console.log("✅ Message nullification completed:", {
        totalNullifiedCount,
        currentUserPub: currentUserPub.slice(0, 8) + "...",
        recipientPub: recipientPub.slice(0, 8) + "...",
        note: "Conversation NOT marked as cleared - future messages will be received",
      });

      return {
        success: true,
        nullifiedCount: totalNullifiedCount,
      };
    } catch (error: any) {
      console.error("❌ Error in setMessagesToNull:", error);
      return {
        success: false,
        error: error.message || "Unknown error while nullifying messages",
      };
    }
  }

  /**
   * Helper method to set messages to null from a specific path
   */
  private async setMessagesToNullFromPath(
    path: string,
    fromPub: string,
    toPub: string,
    pathType: "sender" | "recipient"
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        console.log(`🗑️ Setting messages to null from ${pathType} path:`, path);

        const node = this.core.db.gun.get(path);
        let nullifiedCount = 0;
        let totalMessages = 0;
        let completedOperations = 0;
        let hasError = false;
        let timeoutId: ReturnType<typeof setTimeout>;
        let hasStartedProcessing = false;

        const checkCompletion = () => {
          if (hasStartedProcessing && completedOperations === totalMessages) {
            clearTimeout(timeoutId);
            if (hasError) {
              console.error(
                `❌ Error nullifying messages from ${pathType} path`
              );
              reject(new Error(`Error while nullifying ${pathType} messages`));
            } else {
              console.log(
                `✅ Set ${nullifiedCount} messages to null from ${pathType} path`
              );
              resolve(nullifiedCount);
            }
          }
        };

        // Set timeout for the entire operation
        timeoutId = setTimeout(() => {
          console.warn(`⚠️ Timeout nullifying messages from ${pathType} path`);
          checkCompletion();
        }, 10000);

        // No loading old messages - only real-time
        console.log("🚀 Signal approach: No loading old messages from GUNDB");

        // Don't process old messages - only real-time ones
        setTimeout(() => {
          console.log(
            `ℹ️ Signal approach: Skipping old messages in ${pathType} path`
          );
          resolve(0);
        }, 100);

        // Handle case where no messages are found
        if (totalMessages === 0) {
          setTimeout(() => {
            console.log(`ℹ️ No messages found in ${pathType} path`);
            resolve(0);
          }, 1000);
        }
      } catch (error) {
        console.error(
          `❌ Exception in setMessagesToNullFromPath (${pathType}):`,
          error
        );
        reject(error);
      }
    });
  }

  /**
   * Clear a single specific message by ID
   */
  public async clearSingleMessage(
    recipientPub: string,
    messageId: string
  ): Promise<{ success: boolean; error?: string; clearedCount?: number }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per cancellare un messaggio.",
      };
    }

    if (!recipientPub || typeof recipientPub !== "string") {
      return {
        success: false,
        error: "Public key del destinatario richiesta.",
      };
    }

    if (!messageId || typeof messageId !== "string") {
      return {
        success: false,
        error: "ID del messaggio richiesto.",
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

      console.log(`🗑️ Clearing single message: ${messageId}`);
      console.log(`🔍 Debug:`, { currentUserPub, recipientPub, messageId });

      // Import sendToGunDB function
      const { sendToGunDB } = await import("./utils");

      let clearedCount = 0;

      // Clear from recipient path (messages sent TO recipient)
      try {
        await sendToGunDB(this.core, recipientPub, messageId, null, "private");
        clearedCount++;
        console.log(`✅ Cleared message ${messageId} from recipient path`);
      } catch (error) {
        console.warn(
          `⚠️ Could not clear message ${messageId} from recipient path:`,
          error
        );
      }

      // Clear from current user path (messages received FROM recipient)
      try {
        await sendToGunDB(
          this.core,
          currentUserPub,
          messageId,
          null,
          "private"
        );
        clearedCount++;
        console.log(`✅ Cleared message ${messageId} from current user path`);
      } catch (error) {
        console.warn(
          `⚠️ Could not clear message ${messageId} from current user path:`,
          error
        );
      }

      // Clear from processed message IDs
      if (this.processedMessageIds.has(messageId)) {
        this.processedMessageIds.delete(messageId);
        console.log(`✅ Removed message ${messageId} from processed IDs`);
      }

      console.log(
        `✅ Single message clear completed: ${clearedCount} instances cleared`
      );

      return {
        success: true,
        clearedCount,
      };
    } catch (error: any) {
      console.error("❌ Error in single message clear:", error);
      return {
        success: false,
        error: error.message || "Errore sconosciuto",
      };
    }
  }

  /**
   * Verify that messages have been actually cleared from GunDB
   */
  public async verifyConversationCleared(
    recipientPub: string
  ): Promise<{ success: boolean; remainingMessages: number; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        remainingMessages: 0,
        error: "Devi essere loggato per verificare la pulizia.",
      };
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          remainingMessages: 0,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const currentUserPub = currentUserPair.pub;
      let totalRemainingMessages = 0;

      // Check recipient path
      const recipientSafePath = createSafePath(recipientPub);
      const recipientRemaining = await this.countMessagesInPath(
        recipientSafePath,
        currentUserPub,
        "recipient"
      );
      totalRemainingMessages += recipientRemaining;

      // Check current user path
      const currentUserSafePath = createSafePath(currentUserPub);
      const currentUserRemaining = await this.countMessagesInPath(
        currentUserSafePath,
        recipientPub,
        "sender"
      );
      totalRemainingMessages += currentUserRemaining;

      console.log("🔍 Verification completed:", {
        recipientRemaining,
        currentUserRemaining,
        totalRemainingMessages,
      });

      return {
        success: true,
        remainingMessages: totalRemainingMessages,
      };
    } catch (error: any) {
      console.error("❌ Error in verifyConversationCleared:", error);
      return {
        success: false,
        remainingMessages: 0,
        error: error.message || "Errore durante la verifica",
      };
    }
  }

  /**
   * Helper method to count messages in a path
   */
  private async countMessagesInPath(
    path: string,
    fromPub: string,
    pathType: "sender" | "recipient"
  ): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      try {
        const node = this.core.db.gun.get(path);
        let messageCount = 0;
        let totalItems = 0;
        let completedItems = 0;
        let timeoutId: NodeJS.Timeout;

        const checkCompletion = () => {
          if (completedItems === totalItems && totalItems > 0) {
            clearTimeout(timeoutId);
            resolve(messageCount);
          }
        };

        node.map().on((messageData: any, messageId: string) => {
          totalItems++;

          if (messageData && typeof messageData === "object") {
            // Check if this is a message in our conversation
            let isConversationMessage = false;

            if (pathType === "recipient") {
              isConversationMessage = messageData.from === fromPub;
            } else if (pathType === "sender") {
              isConversationMessage = messageData.from === fromPub;
            }

            // Additional check: verify it's a valid message structure
            isConversationMessage =
              isConversationMessage &&
              (messageData.content ||
                messageData.data ||
                messageData.timestamp);

            if (isConversationMessage) {
              messageCount++;
            }
          }

          completedItems++;
          checkCompletion();
        });

        // Handle case where no items are found
        timeoutId = setTimeout(() => {
          if (totalItems === 0) {
            resolve(0);
          }
        }, 3000);
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Debug function to explore GunDB structure
   */
  public async debugGunDBStructure(recipientPub: string): Promise<any> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return { error: "Not logged in" };
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return { error: "User pair not available" };
      }

      const currentUserPub = currentUserPair.pub;
      const recipientSafePath = MessagingSchema.privateMessages.recipient(recipientPub);
      const currentUserSafePath = MessagingSchema.privateMessages.currentUser(currentUserPub);

      console.log("🔍 Debugging GunDB structure for conversation:", {
        currentUserPub,
        recipientPub,
        recipientSafePath,
        currentUserSafePath,
      });

      // Explore recipient path
      const recipientData = await this.explorePath(
        recipientSafePath,
        "recipient"
      );
      const currentUserData = await this.explorePath(
        currentUserSafePath,
        "current user"
      );

      return {
        recipientPath: {
          path: recipientSafePath,
          data: recipientData,
        },
        currentUserPath: {
          path: currentUserSafePath,
          data: currentUserData,
        },
      };
    } catch (error: any) {
      console.error("❌ Error in debugGunDBStructure:", error);
      return { error: error.message };
    }
  }

  /**
   * Helper to explore a specific path
   */
  private async explorePath(path: string, pathName: string): Promise<any> {
    return new Promise((resolve) => {
      const node = this.core.db.gun.get(path);
      const items: any[] = [];
      let totalItems = 0;
      let completedItems = 0;
      let timeoutId: ReturnType<typeof setTimeout>;

      const checkCompletion = () => {
        if (completedItems === totalItems && totalItems > 0) {
          clearTimeout(timeoutId);
          console.log(
            `🔍 ${pathName} path (${path}) contains ${items.length} items:`,
            items
          );
          resolve(items);
        }
      };

      node.map().on((data: any, id: string) => {
        totalItems++;
        items.push({
          id,
          data,
          hasFrom: !!data?.from,
          hasContent: !!data?.content,
          hasData: !!data?.data,
          hasTimestamp: !!data?.timestamp,
          fromValue: data?.from,
          contentPreview:
            data?.content?.substring?.(0, 50) || data?.data?.substring?.(0, 50),
        });
        completedItems++;
        checkCompletion();
      });

      timeoutId = setTimeout(() => {
        if (totalItems === 0) {
          console.log(`🔍 ${pathName} path (${path}) is empty`);
          resolve([]);
        }
      }, 3000);
    });
  }

  /**
   * Debug method to find where messages are actually stored
   */
  public async debugMessagePaths(contactPub: string): Promise<void> {
    try {
      console.log("🔍 DEBUG: Debugging message paths for contact:", contactPub);

      const { createSafePath } = await import("./utils");

      // Get current user pair for path creation
      const currentUserPair = (this.core.db.user as any)?._?.sea;
      if (!currentUserPair) {
        console.log("🔍 DEBUG: No user pair available for path debugging");
        return;
      }

      // Try many different possible paths
      const debugPaths = [
        MessagingSchema.privateMessages.conversation(currentUserPair.pub, contactPub), // Conversation path (new) - check first
        MessagingSchema.privateMessages.recipient(contactPub),
        MessagingSchema.privateMessages.currentUser(currentUserPair.pub), // Current user's path (for sent messages)
        `msg_${contactPub}`,
        `messages_${contactPub}`,
        `chat_${contactPub}`,
        // **IMPROVED: Use schema for conversation path**
        MessagingSchema.privateMessages.conversation(
          currentUserPair.pub,
          contactPub
        ),
        `private_${contactPub}`,
        `direct_${contactPub}`,
        contactPub, // Direct pub key
        `~${contactPub}`, // With tilde
        `#${contactPub}`, // With hash
      ];

      for (const path of debugPaths) {
        try {
          console.log(`🔍 DEBUG: Checking path: ${path}`);
          const node = this.core.db.gun.get(path);

          (node as any).on((data: any) => {
            if (data) {
              console.log(`🔍 DEBUG: Found data in path ${path}:`, {
                hasData: !!data,
                keys: Object.keys(data),
                dataType: typeof data,
                sampleData: Object.keys(data)
                  .slice(0, 3)
                  .map((key) => ({ key, value: data[key] })),
              });
            } else {
              console.log(`🔍 DEBUG: No data found in path: ${path}`);
            }
          });
        } catch (error) {
          console.log(`🔍 DEBUG: Error checking path ${path}:`, error);
        }
      }
    } catch (error) {
      console.error("🔍 DEBUG: Error in debugMessagePaths:", error);
    }
  }

  /**
   * Register a conversation path listener for testing
   */
  public registerConversationPathListener(
    conversationPath: string,
    currentUserPair: UserPair,
    currentUserPub: string
  ): void {
    // **OPTIMIZED: Check if listener already exists to prevent duplicates**
    if (
      this.conversationListeners.some(
        (listener) => listener.path === conversationPath
      )
    ) {
      console.log(
        "🚀 registerConversationPathListener: Listener already exists for path:",
        conversationPath
      );
      return;
    }

    console.log(
      "🚀 registerConversationPathListener: Registering listener for path:",
      conversationPath
    );

    const conversationNode = this.core.db.gun.get(conversationPath).map();
    const listener = conversationNode.on(
      async (messageData: MessageDataRaw, messageId: string) => {
        // **OPTIMIZED: Early duplicate check to prevent processing loops**
        if (this.processedMessageIds.has(messageId)) {
          return; // Skip immediately if already processed
        }

        // **OPTIMIZED: Reduced logging to prevent console spam**
        await this.processIncomingMessage(
          messageData,
          messageId,
          currentUserPair,
          currentUserPub
        );
      }
    );

    // **FIXED: Store listener with path info for deduplication**
    (listener as any).path = conversationPath;
    this.conversationListeners.push(listener);

    console.log(
      "🚀 registerConversationPathListener: Successfully registered listener for:",
      conversationPath
    );
  }

  /**
   * Cleanup method for tests - clears all timeouts and listeners
   */
  public cleanup(): void {
    console.log(
      "🚀 MessageProcessor.cleanup() called - this will clear all listeners!"
    );
    console.log(
      "🚀 Current listeners before cleanup:",
      this.messageListeners.length
    );

    // Clear group listeners
    this.groupSubscriptions.forEach((subscription) => {
      if (subscription && subscription.off && typeof subscription.off === "function") {
        subscription.off();
      }
    });
    this.groupSubscriptions.clear();

    // Clear conversation listeners
    this.conversationSubscriptions.forEach((subscription) => {
      if (subscription && subscription.off && typeof subscription.off === "function") {
        subscription.off();
      }
    });
    this.conversationSubscriptions.clear();

    // Stop listening to public rooms
    this.publicRoomManager.stopListeningPublic();

    // Stop listening to token rooms
    this.tokenRoomManager.stopListeningTokenRooms();

    // Reset state
    this._isListening = false;

    // Don't clear message listeners during normal operation
    if (process.env.NODE_ENV === "test") {
      this.messageListeners = [];
      this.groupMessageListenersInternal = [];
    } else {
      console.log(
        "🚀 Skipping message listeners cleanup in non-test environment"
      );
    }

    this.processedMessageIds.clear();
    this.retryAttempts.clear();
  }
}
