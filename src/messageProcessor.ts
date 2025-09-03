import { ShogunCore } from "shogun-core";
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
  createSafePath,
  createConversationPath,
  cleanupExpiredEntries,
  limitMapSize,
} from "./utils";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";
import { Observable, from, of, throwError, timer } from "rxjs";
import {
  map,
  filter,
  distinctUntilChanged,
  catchError,
  switchMap,
  timeout,
  retry,
  tap,
  debounceTime,
  mergeMap,
} from "rxjs/operators";

/**
 * Enhanced message processing and listener management for the messaging plugin
 * Now with RxJS integration for better reactive programming and performance
 */
export class MessageProcessor {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private groupManager: GroupManager;

  // Message handling with RxJS
  private messageListeners: MessageListener[] = [];
  private groupMessageListenersInternal: GroupMessageListener[] = [];
  private _isListening = false;
  private processedMessageIds = new Map<string, number>();
  private retryAttempts = new Map<string, number>(); // Track retry attempts
  private lastNullMessageLog = 0; // Rate limiter for null message logs
  private lastTraditionalNullLog = 0; // Rate limiter for traditional listener null logs
  private subscriptions: any[] = [];
  private groupSubscriptions = new Map<string, any>();
  private conversationSubscriptions = new Map<string, any>(); // For conversation listeners
  // privateMessageListener removed - using conversationListeners instead
  private conversationListeners: any[] = []; // Added for conversation path listening

  // Configuration
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 hours
  private readonly DECRYPTION_TIMEOUT = 10000; // 10 seconds
  private readonly RETRY_ATTEMPTS = 3;
  private readonly DEBOUNCE_TIME = 100; // 100ms debounce time
  private clearedConversations = new Set<string>();

  // Persistence for cleared conversations
  private readonly CLEARED_CONVERSATIONS_KEY = "shogun_cleared_conversations";

  constructor(
    core: ShogunCore,
    encryptionManager: EncryptionManager,
    groupManager: GroupManager
  ) {
    this.core = core;
    this.encryptionManager = encryptionManager;
    this.groupManager = groupManager;
    this.loadClearedConversations();
  }

  /**
   * Enhanced startListening with RxJS integration
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

    // 🔧 CROSS-PLATFORM: Gestione sia Node.js che browser
    let disableRxJS: boolean;
    
    if (typeof process !== 'undefined' && process.env) {
      // Node.js environment
      disableRxJS = process.env.DISABLE_RXJS === "true";
    } else if (typeof window !== 'undefined') {
      // Browser environment
      disableRxJS = (window as any).DISABLE_RXJS === "true" || true; // Force disable in browser
    } else {
      // Fallback
      disableRxJS = true;
    }

    console.log("🚀 startListening: Checking RxJS availability:", {
      hasDbRx: !!(this.core.db as any).rx,
      dbRxType: typeof (this.core.db as any).rx,
      coreKeys: Object.keys(this.core),
      dbKeys: Object.keys(this.core.db || {}),
      disableRxJS,
      environment: typeof process !== 'undefined' ? 'node' : 'browser',
    });

    if (
      disableRxJS ||
      !(this.core.db as any).rx ||
      typeof (this.core.db as any).rx !== "function"
    ) {
      console.log(
        "🚀 startListening: Using traditional method (RxJS disabled or unavailable)"
      );
      await this.startListeningTraditional(
        currentUserEpub,
        currentUserPair,
        currentUserPub
      );
      return;
    }

    try {
      // Use RxJS for reactive message listening
      await this.startListeningWithRx(currentUserPair, currentUserPub);
    } catch (error) {
      console.error(
        "🚀 startListening: RxJS failed, falling back to traditional method:",
        error
      );
      await this.startListeningTraditional(
        currentUserEpub,
        currentUserPair,
        currentUserPub
      );
    }
  }

  /**
   * Start listening with RxJS for reactive message handling
   */
  private async startListeningWithRx(
    currentUserPair: UserPair,
    currentUserPub: string
  ): Promise<void> {
    console.log(
      "🚀 startListeningWithRx: Using RxJS for reactive listening..."
    );

    try {
      // Get the RxJS instance from the core
      const rx = (this.core.db as any).rx;
      if (!rx) {
        throw new Error("RxJS not available in core");
      }

      // Check if rx.observe exists and is a function
      if (!rx.observe || typeof rx.observe !== "function") {
        throw new Error("rx.observe is not available or not a function");
      }

      // Listen on the current user's path for messages
      const currentUserSafePath = createSafePath(currentUserPub);
      console.log(
        "🚀 startListeningWithRx: Observing user path:",
        currentUserSafePath
      );

      const userMessageObservable = rx.observe(currentUserSafePath);
      const userSubscription = userMessageObservable.subscribe({
        next: async (data: ConversationPathData) => {
          console.log("🚀 RxJS user subscription received data:", data);
          if (data) {
            // Process all messages in the data
            for (const [messageId, messageData] of Object.entries(data)) {
              if (
                messageId &&
                messageId !== "_" &&
                typeof messageData === "object"
              ) {
                await this.processIncomingMessage(
                  messageData as any,
                  messageId,
                  currentUserPair,
                  currentUserPub
                );
              }
            }
          }
        },
        error: (error: unknown) => {
          console.error("🚀 RxJS user subscription error:", error);
        },
        complete: () => {
          console.log("🚀 RxJS user subscription completed");
        },
      });

      this.subscriptions.push(userSubscription);
      console.log(
        "🚀 startListeningWithRx: RxJS subscription created successfully"
      );
    } catch (error) {
      console.error(
        "🚀 startListeningWithRx: Error setting up RxJS listening:",
        error
      );
      throw error;
    }
  }

  /**
   * Fallback traditional listening method
   */
  private async startListeningTraditional(
    currentUserEpub: string,
    currentUserPair: UserPair,
    currentUserPub: string
  ): Promise<void> {
    console.log(
      "🚀 startListeningTraditional: Using traditional GunDB listening..."
    );

    // Listen on conversation paths for the current user
    const currentUserConversationPath = createConversationPath(
      currentUserPub,
      "placeholder"
    );
    console.log(
      "🚀 startListeningTraditional: Also listening on conversation path pattern:",
      currentUserConversationPath.replace("placeholder", "*")
    );

    // Listen on the recipient's path where messages are actually sent
    const recipientPath = createSafePath(currentUserPub);
    console.log(
      "🚀 startListeningTraditional: Listening on recipient path for incoming messages:",
      recipientPath
    );

    const recipientMessageNode = this.core.db.gun.get(recipientPath).map();
    this.conversationListeners.push(
      recipientMessageNode.on(
        async (messageData: MessageDataRaw, messageId: string) => {
          // Add comprehensive null checking before processing
          if (!messageData || !messageId) {
            // Rate limit null message logs to reduce console spam
            const now = Date.now();
            const shouldLog = now - this.lastTraditionalNullLog > 5000; // Log every 5 seconds max

            if (shouldLog) {
              console.log(
                "🚀 startListeningTraditional: Skipping null/undefined message data:",
                {
                  messageData: messageData ? "EXISTS" : "NULL",
                  messageId: messageId ? "EXISTS" : "NULL",
                  path: recipientPath,
                }
              );
              this.lastTraditionalNullLog = now;
            }
            return;
          }

          // Validate message structure before processing
          if (!messageData.data || !messageData.from) {
            // Rate limit invalid structure logs to reduce console spam
            const now = Date.now();
            const shouldLog = now - this.lastTraditionalNullLog > 5000; // Log every 5 seconds max

            if (shouldLog) {
              console.log(
                "🚀 startListeningTraditional: Skipping invalid message structure:",
                {
                  hasData: !!messageData.data,
                  hasFrom: !!messageData.from,
                  messageId,
                  path: recipientPath,
                }
              );
              this.lastTraditionalNullLog = now;
            }
            return;
          }

          console.log(
            "🚀 startListeningTraditional: Received message from recipient path (real-time):",
            {
              messageData,
              messageId,
              path: recipientPath,
            }
          );
          await this.processIncomingMessage(
            messageData,
            messageId,
            currentUserPair,
            currentUserPub
          );
        }
      )
    );

    console.log(
      "🚀 startListeningTraditional: Added recipient path and conversation path listeners"
    );
  }

  /**
   * Process incoming message using traditional method (fallback)
   */
  private async processIncomingMessage(
    messageData: MessageDataRaw,
    messageId: string,
    currentUserPair: UserPair,
    currentUserPub: string
  ): Promise<void> {
    console.log("🚀 processIncomingMessage: Processing message:", {
      messageData,
      messageId,
      currentUserPub,
    });

    // Check for duplicates - use a more robust deduplication
    if (!messageData) {
      console.log(
        "🚀 processIncomingMessage: messageData is null, skipping:",
        messageId
      );
      return;
    }

    const deduplicationKey = `${messageId}_${messageData.from}_${Date.now()}`;
    if (this.processedMessageIds.has(messageId)) {
      console.log(
        "🚀 processIncomingMessage: Duplicate message detected, skipping:",
        messageId
      );
      return;
    }

    // Check for tombstoned messages
    if (messageData?._deleted === true) {
      console.log(
        "🚀 processIncomingMessage: Tombstoned message detected, skipping:",
        messageId
      );
      return;
    }

    // Validate message structure - be more flexible for different message types
    if (!messageData?.from) {
      console.log(
        "🚀 processIncomingMessage: Message validation failed - missing from field:",
        {
          hasFrom: !!messageData?.from,
          messageDataKeys: messageData ? Object.keys(messageData) : [],
        }
      );
      return;
    }

    // Check if message has content in either data or content field
    const hasContent = !!(messageData?.data || messageData?.content);
    if (!hasContent) {
      console.log(
        "🚀 processIncomingMessage: Message validation failed - missing content:",
        {
          hasData: !!messageData?.data,
          hasContent: !!messageData?.content,
          messageDataKeys: messageData ? Object.keys(messageData) : [],
        }
      );
      return;
    }

    // Add better message filtering to prevent processing irrelevant messages
    const isFromCurrentUser = messageData.from === currentUserPub;
    const isToCurrentUser =
      messageData.to === currentUserPub || !messageData.to; // If no 'to' field, assume it's for current user

    // Skip messages that are neither from nor to the current user
    if (!isFromCurrentUser && !isToCurrentUser) {
      console.log(
        "🚀 processIncomingMessage: Message not for current user, skipping:",
        {
          messageFrom: messageData.from,
          messageTo: messageData.to,
          currentUserPub,
          isFromCurrentUser,
          isToCurrentUser,
        }
      );
      return;
    }

    // Mark as processed
    this.processedMessageIds.set(messageId, Date.now());
    this.cleanupProcessedMessages();

    let decryptedMessage: MessageData;

    try {
      // Handle self-sent messages properly
      if (isFromCurrentUser) {
        // For self-sent messages, we need to process them to ensure they appear in the UI
        console.log(
          "🚀 processIncomingMessage: Processing self-sent message for UI display"
        );

        // Create a decrypted message object for self-sent messages
        const selfSentMessage: MessageData = {
          id: messageId,
          content:
            (messageData.content as string) ||
            (messageData.data as string) ||
            "",
          from: messageData.from,
          timestamp: (messageData.timestamp as number) || Date.now(),
          signature: messageData.signature as string | undefined,
        };

        // Notify listeners with the self-sent message
        this.notifyListeners(selfSentMessage);
        return;
      } else {
        // Process messages from other users
        console.log(
          "🚀 processIncomingMessage: Processing message from other user..."
        );

        // Add null check for messageData before decryption
        if (!messageData || !messageData.data || !messageData.from) {
          console.log(
            "🚀 processIncomingMessage: Invalid messageData, skipping:",
            {
              messageId,
              hasMessageData: !!messageData,
              hasData: !!messageData?.data,
              hasFrom: !!messageData?.from,
            }
          );
          this.processedMessageIds.delete(messageId);
          return;
        }

        decryptedMessage = await this.encryptionManager.decryptMessage(
          messageData.data,
          currentUserPair,
          messageData.from
        );

        // Add isEncrypted property to decrypted message
        decryptedMessage.isEncrypted = true;

        // Cache the sender's encryption key for future messages
        try {
          const senderEpub = await this.encryptionManager.getRecipientEpub(
            messageData.from
          );
          console.log(
            `🚀 processIncomingMessage: Cached sender encryption key for: ${messageData.from.slice(0, 8)}...`
          );
        } catch (error) {
          console.warn(
            `🚀 processIncomingMessage: Failed to cache sender encryption key: ${messageData.from.slice(0, 8)}...`
          );
        }
      }

      console.log(
        "🚀 processIncomingMessage: Decryption successful:",
        decryptedMessage
      );

      // Verify signature if present
      if (decryptedMessage.signature) {
        const dataToVerify = JSON.stringify(
          {
            content: decryptedMessage.content,
            timestamp: decryptedMessage.timestamp,
            id: decryptedMessage.id,
          },
          Object.keys({ content: "", timestamp: 0, id: "" }).sort()
        );

        const isValid = await this.encryptionManager.verifyMessageSignature(
          dataToVerify,
          decryptedMessage.signature,
          decryptedMessage.from
        );

        if (!isValid) {
          console.log("🚀 processIncomingMessage: Invalid signature, skipping");
          this.processedMessageIds.delete(messageId);
          return;
        }
      }

      // Check if conversation is cleared
      if (this.isConversationCleared(decryptedMessage.from, currentUserPub)) {
        console.log(
          "🚀 processIncomingMessage: Conversation cleared, skipping"
        );
        this.processedMessageIds.delete(messageId);
        return;
      }

      // Notify listeners
      this.notifyListeners(decryptedMessage);
    } catch (error) {
      console.error(
        "🚀 processIncomingMessage: Error during processing:",
        error
      );

      // Handle encryption errors gracefully with fallback
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      if (
        errorMessage.includes("Cannot find encryption public key") ||
        errorMessage.includes("Timeout getting profile data") ||
        errorMessage.includes("Timeout getting root data") ||
        errorMessage.includes("Timeout getting user data")
      ) {
        console.warn(
          `🚀 processIncomingMessage: Encryption timeout/error - will retry later: ${messageData?.from?.slice(0, 8)}... Error: ${errorMessage}`
        );

        // Create a fallback message for display purposes
        const fallbackMessage = {
          id: messageId,
          content: "[Message temporarily unavailable - retrying...]",
          from: messageData?.from || "unknown",
          timestamp: messageData?.timestamp || Date.now(),
          isEncrypted: true,
          needsRetry: true,
        };

        // Notify listeners with the fallback message
        this.notifyListeners(fallbackMessage);

        // Remove from processed list to allow retry with better network conditions
        this.processedMessageIds.delete(messageId);
        return;
      }

      // For other errors, remove from processed list to allow retry
      this.processedMessageIds.delete(messageId);
    }
  }

  /**
   * Enhanced listener notification with error boundaries
   */
  public notifyListeners(decryptedMessage: MessageData): void {
    console.log("🚀 notifyListeners called with:", {
      messageId: decryptedMessage.id,
      content: decryptedMessage.content?.substring(0, 30) + "...",
      from: decryptedMessage.from,
      listenersCount: this.messageListeners.length,
      listenersArray: this.messageListeners.map((_, i) => `Listener ${i}`),
    });

    if (this.messageListeners.length === 0) {
      console.log("🚀 No message listeners registered");
      console.log("🚀 DEBUG: MessageProcessor state:", {
        hasMessageProcessor: !!this,
        messageListenersType: typeof this.messageListeners,
        messageListenersLength: this.messageListeners?.length,
      });

      // DEBUG: Log the call stack to see where this is being called from
      console.log("🚀 DEBUG: Call stack:", new Error().stack);
      return;
    }

    console.log(`🚀 Notifying ${this.messageListeners.length} listeners`);

    this.messageListeners.forEach((callback, index) => {
      try {
        console.log(
          `🚀 Calling listener ${index} with message:`,
          decryptedMessage.id
        );
        callback(decryptedMessage);
        console.log(`🚀 Listener ${index} called successfully`);
      } catch (error) {
        console.error(`🚀 Error in message listener ${index}:`, error);
        // Don't let one bad listener break others
      }
    });
  }

  /**
   * Enhanced group listener notification
   */
  private notifyGroupListeners(decryptedMessage: MessageData): void {
    if (this.groupMessageListenersInternal.length === 0) {
      console.log("🚀 No group message listeners registered");
      return;
    }

    console.log(
      `🚀 Notifying ${this.groupMessageListenersInternal.length} group listeners`
    );

    this.groupMessageListenersInternal.forEach((callback, index) => {
      try {
        callback(decryptedMessage as any);
      } catch (error) {
        console.error(`🚀 Error in group message listener ${index}:`, error);
      }
    });
  }

  /**
   * Enhanced cleanup for processed messages
   */
  private cleanupProcessedMessages(): void {
    cleanupExpiredEntries(this.processedMessageIds, this.MESSAGE_TTL);
    limitMapSize(this.processedMessageIds, this.MAX_PROCESSED_MESSAGES);
  }

  /**
   * Register message listener with validation
   */
  public onMessage(callback: MessageListener): void {
    if (typeof callback !== "function") {
      console.warn("🚀 Invalid message callback provided");
      return;
    }

    this.messageListeners.push(callback);
    console.log(
      `🚀 Message listener registered. Total: ${this.messageListeners.length}`
    );

    // DEBUG: Log all listeners for debugging
    console.log(
      "🚀 onMessage: All registered listeners:",
      this.messageListeners.map((_, index) => `Listener ${index}`)
    );

    // DEBUG: Log the callback function details
    console.log("🚀 onMessage: Callback details:", {
      callbackType: typeof callback,
      callbackName: callback.name || "anonymous",
      callbackLength: callback.length,
    });

    // DEBUG: Log the MessageProcessor instance
    console.log("🚀 onMessage: MessageProcessor instance:", {
      instanceId: (this.core?.db?.user?.is?.pub as string) || "unknown",
      listenersArray: this.messageListeners,
      listenersLength: this.messageListeners.length,
    });
  }

  /**
   * Enhanced stop listening with RxJS cleanup
   */
  public stopListening(): void {
    if (!this._isListening) return;

    console.log("🚀 Stopping all listeners...");

    // Unsubscribe from all private message subscriptions
    this.subscriptions.forEach((subscription, index) => {
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
        console.log(
          `🚀 Unsubscribed from private message subscription ${index}`
        );
      }
    });
    this.subscriptions = [];

    // Unsubscribe from all group subscriptions
    this.groupSubscriptions.forEach((subscription, groupId) => {
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
        console.log(`🚀 Unsubscribed from group subscription: ${groupId}`);
      } else if (
        subscription &&
        subscription.off &&
        typeof subscription.off === "function"
      ) {
        subscription.off();
        console.log(
          `🚀 Unsubscribed from traditional group listener: ${groupId}`
        );
      }
    });
    this.groupSubscriptions.clear();

    // Unsubscribe from all conversation subscriptions
    this.conversationSubscriptions.forEach((subscription, contactPub) => {
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
        console.log(
          `🚀 Unsubscribed from conversation subscription: ${contactPub}`
        );
      }
    });
    this.conversationSubscriptions.clear();

    this._isListening = false;
    this.processedMessageIds.clear();
    console.log("🚀 All listeners stopped successfully");
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

  // **ADDED BACK: Group management functions**
  
  /**
   * Register group message listener with validation
   */
  public onGroupMessage(callback: GroupMessageListener): void {
    if (typeof callback !== "function") {
      console.warn("🚀 Invalid group message callback provided");
      return;
    }

    this.groupMessageListenersInternal.push(callback);
    console.log(
      `🚀 Group message listener registered. Total: ${this.groupMessageListenersInternal.length}`
    );
  }

  /**
   * Enhanced group listener with RxJS fallback to traditional
   */
  public addGroupListener(groupId: string): void {
    if (!groupId || this.groupSubscriptions.has(groupId)) {
      console.log(
        "🚀 Group listener already exists or invalid groupId:",
        groupId
      );
      return;
    }

    const currentUserPair = (this.core.db.user as any)?._?.sea;
    if (!currentUserPair) {
      console.warn("🚀 No user pair available for group listener");
      return;
    }

    // Check if RxJS is available and not disabled
    const disableRxJS = process.env.DISABLE_RXJS === "true" || true; // Force disable RxJS since it's not available

    if (
      disableRxJS ||
      !(this.core.db as any).rx ||
      typeof (this.core.db as any).rx !== "function"
    ) {
      console.log("🚀 Adding traditional group listener for:", groupId);
      this.addGroupListenerTraditional(groupId, currentUserPair);
      return;
    }

    console.log("🚀 Adding RxJS group listener for:", groupId);

    try {
      const groupMessageObservable = this.createGroupMessageObservable(
        groupId,
        currentUserPair
      );

      const subscription = groupMessageObservable.subscribe({
        next: (message) => {
          if (message) {
            this.notifyGroupListeners(message);
          }
        },
        error: (error) => {
          console.error("🚀 Group message subscription error:", error);
          this.groupSubscriptions.delete(groupId);
        },
      });

      this.groupSubscriptions.set(groupId, subscription);
      console.log(
        "🚀 Group listener added successfully. Total:",
        this.groupSubscriptions.size
      );
    } catch (error) {
      console.error(
        "🚀 RxJS group listener failed, falling back to traditional:",
        error
      );
      this.addGroupListenerTraditional(groupId, currentUserPair);
    }
  }

  /**
   * Add group listener using traditional GunDB approach
   */
  private addGroupListenerTraditional(
    groupId: string,
    currentUserPair: UserPair
  ): void {
    try {
      const groupMessagePath = `group-messages/${groupId}`;
      console.log(
        "🚀 Setting up traditional group listener for path:",
        groupMessagePath
      );

      const groupNode = this.core.db.gun.get(groupMessagePath);

      // Store traditional listener
      const listener = {
        groupId,
        node: groupNode,
        off: null as any,
      };

      // Listen for new group messages
      const messageListener = groupNode
        .map()
        .on(async (messageData: any, messageId: string) => {
          if (messageData && messageId && messageId !== "_") {
            console.log("🚀 Traditional group message received:", {
              messageId,
              groupId,
            });

            try {
              // Process the group message using traditional approach
              await this.processIncomingGroupMessageTraditional(
                messageData,
                messageId,
                currentUserPair,
                groupId
              );
            } catch (error) {
              console.error(
                "🚀 Error processing traditional group message:",
                error
              );
            }
          }
        });

      listener.off = messageListener.off;

      // Store the listener for cleanup
      this.groupSubscriptions.set(groupId, listener);

      console.log(
        "🚀 Traditional group listener added successfully for:",
        groupId
      );
    } catch (error) {
      console.error("🚀 Error adding traditional group listener:", error);
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
      // Parse message data if it's a string
      let parsedData: any;
      if (typeof messageData === "string") {
        try {
          parsedData = JSON.parse(messageData);
        } catch (error) {
          console.error("🚀 Invalid JSON in group message:", error);
          return;
        }
      } else {
        parsedData = messageData;
      }

      // Check if we've already processed this message
      if (this.processedMessageIds.has(messageId)) {
        console.log("🚀 Skipping duplicate group message:", messageId);
        return;
      }

      // Mark as processed
      this.processedMessageIds.set(messageId, Date.now());

      // Get group data and key
      const groupData = await this.groupManager.getGroupData(groupId);
      if (!groupData) {
        console.warn("🚀 Group data not found for:", groupId);
        return;
      }

      const groupKey = await this.groupManager.getGroupKeyForUser(
        groupData,
        currentUserPair.pub,
        currentUserPair
      );
      if (!groupKey) {
        console.warn(
          "🚀 Group key not available for user:",
          currentUserPair.pub
        );
        return;
      }

      // Decrypt the message content
      const decryptedContent = await this.core.db.sea.decrypt(
        parsedData.content,
        groupKey
      );

      if (!decryptedContent) {
        console.warn("🚀 Failed to decrypt group message:", messageId);
        return;
      }

      // Verify message signature
      const isValidSignature =
        await this.encryptionManager.verifyMessageSignature(
          decryptedContent,
          parsedData.signature,
          parsedData.from
        );

      if (!isValidSignature) {
        console.warn("🚀 Invalid signature for group message:", messageId);
        return;
      }

      // Create final message data
      const finalMessage: MessageData = {
        id: messageId,
        from: parsedData.from,
        content: decryptedContent,
        timestamp: parsedData.timestamp || Date.now(),
        signature: parsedData.signature,
        groupId: groupId,
      };

      // Notify listeners
      this.notifyGroupListeners(finalMessage);
    } catch (error) {
      console.error("🚀 Error processing traditional group message:", error);
    }
  }

  /**
   * Create RxJS observable for group messages
   */
  private createGroupMessageObservable(
    groupId: string,
    currentUserPair: UserPair
  ): Observable<MessageData | null> {
    const groupMessagePath = `group-messages/${groupId}`;

    return (this.core.db as any)
      .rx()
      .observe(groupMessagePath)
      .pipe(
        filter((data: any) => data !== null && data !== undefined),
        distinctUntilChanged((prev: any, curr: any) => prev?.id === curr?.id),
        debounceTime(this.DEBOUNCE_TIME),
        mergeMap((messageData: any) =>
          this.processGroupMessageWithRxJS(messageData, currentUserPair)
        ),
        retry(this.RETRY_ATTEMPTS),
        catchError((error) => {
          console.error("🚀 Group message processing error:", error);
          return of(null);
        })
      );
  }

  /**
   * Process group message using RxJS
   */
  private processGroupMessageWithRxJS(
    messageData: MessageDataRaw,
    currentUserPair: UserPair
  ): Observable<MessageData | null> {
    const messageId =
      messageData.id || `${messageData.from}_${messageData.timestamp}`;

    if (this.processedMessageIds.has(messageId)) {
      return of(null);
    }

    this.processedMessageIds.set(messageId, Date.now());

    return from(
      this.groupManager.getGroupData(messageData.groupId as string)
    ).pipe(
      switchMap((groupData) => {
        if (!groupData) {
          this.processedMessageIds.delete(messageId);
          return of(null);
        }

        return from(
          this.groupManager.getGroupKeyForUser(
            groupData,
            currentUserPair.pub,
            currentUserPair
          )
        ).pipe(
          switchMap((groupKey) => {
            if (!groupKey) {
              this.processedMessageIds.delete(messageId);
              return of(null);
            }

            return from(
              this.core.db.sea.decrypt(messageData.content as string, groupKey)
            ).pipe(
              map((decryptedContent) => {
                const finalContent =
                  typeof decryptedContent === "object" &&
                  decryptedContent !== null &&
                  "content" in decryptedContent
                    ? (decryptedContent as any).content
                    : String(decryptedContent);

                return {
                  id: messageId,
                  from: messageData.from,
                  content: finalContent,
                  timestamp: messageData.timestamp,
                  groupId: messageData.groupId,
                  signature: messageData.signature,
                } as MessageData;
              }),
              catchError((error) => {
                console.error("🚀 Group message decryption error:", error);
                this.processedMessageIds.delete(messageId);
                return of(null);
              })
            );
          })
        );
      })
    );
  }

  /**
   * Remove group listener with proper cleanup
   */
  public removeGroupListener(groupId: string): void {
    const subscription = this.groupSubscriptions.get(groupId);
    if (subscription) {
      // Handle both RxJS subscriptions and traditional listeners
      if (typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      } else if (subscription.off && typeof subscription.off === "function") {
        subscription.off();
      }
      this.groupSubscriptions.delete(groupId);
      console.log("🚀 Group listener removed:", groupId);
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
   * Load cleared conversations from localStorage
   */
  private loadClearedConversations(): void {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const stored = window.localStorage.getItem(
          this.CLEARED_CONVERSATIONS_KEY
        );
        if (stored) {
          const conversationIds = JSON.parse(stored);
          this.clearedConversations = new Set(conversationIds);
          console.log(
            "🔍 MessageProcessor: Loaded cleared conversations from localStorage:",
            this.clearedConversations.size
          );
        }
      }
    } catch (error) {
      console.error("❌ Error loading cleared conversations:", error);
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
        console.log(
          "🔍 MessageProcessor: Saved cleared conversations to localStorage:",
          conversationIds.length
        );
      }
    } catch (error) {
      console.error("❌ Error saving cleared conversations:", error);
    }
  }

  /**
   * Add conversation to cleared set and persist
   */
  private addClearedConversation(from: string, to: string): void {
    const conversationId = this.createConversationId(from, to);
    this.clearedConversations.add(conversationId);
    this.saveClearedConversations();
    console.log(
      "🔍 MessageProcessor: Added conversation to cleared set:",
      conversationId
    );
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
    console.log(
      "🔍 MessageProcessor: Removed conversation from cleared set:",
      conversationId
    );
  }

  /**
   * Public method to reset all cleared conversations
   */
  public resetClearedConversations(): void {
    this.clearedConversations.clear();
    this.saveClearedConversations();
    console.log("🔍 MessageProcessor: Reset all cleared conversations");
  }

  /**
   * Public method to reset a specific conversation from cleared state
   */
  public resetClearedConversation(contactPub: string): void {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.warn("🔍 MessageProcessor: User not logged in for reset");
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.warn("🔍 MessageProcessor: No user pair available for reset");
      return;
    }

    const currentUserPub = currentUserPair.pub;
    const conversationId = this.createConversationId(
      currentUserPub,
      contactPub
    );

    if (this.clearedConversations.has(conversationId)) {
      this.clearedConversations.delete(conversationId);
      this.saveClearedConversations();
      console.log(
        "🔍 MessageProcessor: Reset cleared conversation for:",
        contactPub
      );
    } else {
      console.log(
        "🔍 MessageProcessor: Conversation was not cleared:",
        contactPub
      );
    }
  }

  /**
   * Public method to reload messages for a specific contact
   */
  public async reloadMessages(contactPub: string): Promise<any[]> {
    console.log(
      "🔄 MessageProcessor: Reloading messages for contact:",
      contactPub
    );

    // Reset the cleared state for this conversation
    this.resetClearedConversation(contactPub);

    // Load existing messages
    const messages = await this.loadExistingMessages(contactPub);

    console.log(
      "🔄 MessageProcessor: Reloaded messages count:",
      messages.length
    );
    return messages;
  }

  /**
   * Load existing messages from localStorage only
   * GunDB serves only as real-time bridge - no fetching old messages
   */
  public async loadExistingMessages(contactPub: string): Promise<any[]> {
    try {
      console.log(
        "📱 MessageProcessor: Loading existing messages for contact:",
        contactPub
      );

      if (!this.core.isLoggedIn() || !this.core.db.user) {
        console.warn("📱 MessageProcessor: User not logged in");
        return [];
      }

      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        console.warn("📱 MessageProcessor: No user pair available");
        return [];
      }

      const currentUserPub = currentUserPair.pub;

      // Always load from localStorage only
      console.log(
        "📱 MessageProcessor: Signal approach - loading from localStorage only"
      );

      // Load messages from localStorage for this conversation
      const conversationId = this.createConversationId(
        currentUserPub,
        contactPub
      );
      const localStorageKey = `shogun_messages_${conversationId}`;

      try {
        const storedMessages = localStorage.getItem(localStorageKey);
        if (storedMessages) {
          const messages = JSON.parse(storedMessages);
          console.log(
            "📱 MessageProcessor: Loaded messages from localStorage:",
            messages.length
          );
          return messages;
        }
      } catch (error) {
        console.warn(
          "📱 MessageProcessor: Error loading from localStorage:",
          error
        );
      }

      // Return empty array - no GunDB fetching
      console.log(
        "📱 MessageProcessor: No messages in localStorage, returning empty array"
      );
      return [];
    } catch (error) {
      console.error(
        "❌ MessageProcessor: Error loading existing messages:",
        error
      );
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
      this.saveClearedConversations(); // Persist the cleared state

      let totalClearedCount = 0;

      console.log("🗑️ Starting conversation cleanup for:", conversationId);
      console.log("🔍 Debug paths:", {
        currentUserPub,
        recipientPub,
        recipientSafePath: createSafePath(recipientPub),
        currentUserSafePath: createSafePath(currentUserPub),
      });

      // Use a more robust clearing approach
      try {
        // Clear messages sent TO the recipient (stored under recipient's path)
        const recipientSafePath = createSafePath(recipientPub);
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
        const currentUserSafePath = createSafePath(currentUserPub);
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
        let timeoutId: NodeJS.Timeout;
        let operationTimeoutId: NodeJS.Timeout;
        let hasStartedProcessing = false;

        const checkCompletion = () => {
          if (hasStartedProcessing && completedOperations === totalMessages) {
            clearTimeout(timeoutId);
            clearTimeout(operationTimeoutId);
            if (hasError) {
              console.error(`❌ Error clearing messages from ${pathType} path`);
              reject(
                new Error(`Errore durante la pulizia dei messaggi ${pathType}`)
              );
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
        const recipientSafePath = createSafePath(recipientPub);
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
        const currentUserSafePath = createSafePath(currentUserPub);
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
        error:
          error.message ||
          "Errore sconosciuto durante la nullificazione dei messaggi",
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
        let timeoutId: NodeJS.Timeout;
        let hasStartedProcessing = false;

        const checkCompletion = () => {
          if (hasStartedProcessing && completedOperations === totalMessages) {
            clearTimeout(timeoutId);
            if (hasError) {
              console.error(
                `❌ Error nullifying messages from ${pathType} path`
              );
              reject(
                new Error(
                  `Errore durante la nullificazione dei messaggi ${pathType}`
                )
              );
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
      const recipientSafePath = createSafePath(recipientPub);
      const currentUserSafePath = createSafePath(currentUserPub);

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
      let timeoutId: NodeJS.Timeout;

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
        createConversationPath(currentUserPair.pub, contactPub), // Conversation path (new) - check first
        createSafePath(contactPub),
        createSafePath(currentUserPair.pub), // Current user's path (for sent messages)
        `msg_${contactPub}`,
        `messages_${contactPub}`,
        `chat_${contactPub}`,
        `conversation_${contactPub}`,
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
    console.log(
      "🚀 registerConversationPathListener: Registering listener for path:",
      conversationPath
    );

    const conversationNode = this.core.db.gun.get(conversationPath).map();
    this.conversationListeners.push(
      conversationNode.on(
        async (messageData: MessageDataRaw, messageId: string) => {
          console.log(
            "🚀 registerConversationPathListener: Received message from conversation path (real-time):",
            {
              messageData,
              messageId,
              path: conversationPath,
            }
          );
          await this.processIncomingMessage(
            messageData,
            messageId,
            currentUserPair,
            currentUserPub
          );
        }
      )
    );

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
    this.groupSubscriptions.forEach((subscription, groupId) => {
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      }
    });
    this.groupSubscriptions.clear();

    // Clear conversation listeners
    this.conversationSubscriptions.forEach((subscription, contactPub) => {
      if (subscription && typeof subscription.unsubscribe === "function") {
        subscription.unsubscribe();
      }
    });
    this.conversationSubscriptions.clear();

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
