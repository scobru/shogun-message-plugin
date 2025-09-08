// Legacy messaging functionality for backward compatibility
import { ShogunCore } from "shogun-core";
import { MessagingSchema } from "./schema";
import { EncryptionManager } from "./encryption";

/**
 * Legacy messaging functionality for backward compatibility
 * Handles direct messaging using legacy paths and formats
 */
export class LegacyMessaging {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  
  // Legacy listening control to prevent duplicate listeners and enable cleanup
  private _legacyListening: boolean = false;
  private _legacyDateListeners: Map<string, { off: () => void } | { off: Function } > = new Map();
  private _legacyTopLevelListener: { off: () => void } | { off: Function } | null = null;
  private _legacyDebug: boolean = false; // set true only when debugging

  constructor(core: ShogunCore, encryptionManager: EncryptionManager) {
    this.core = core;
    this.encryptionManager = encryptionManager;
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
        timestamp: Date.now().toString(), // **FIX: Convert to string to prevent GunDB property creation errors**
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
        try {
        this.core.db.gun
          .get(MessagingSchema.privateMessages.recipient(recipientPub))
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
        } catch (error) {
          console.error("❌ sendMessageDirect: GunDB put operation failed:", error);
          reject(new Error(`GunDB put operation failed: ${error}`));
        }
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
      const currentUserMessagesPath = MessagingSchema.privateMessages.currentUser(currentUserPub);

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
      const currentUserMessagesPath = MessagingSchema.privateMessages.currentUser(currentUserPubFromCore);

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
        if (!dateData || typeof date === "string" || date === "_") return;

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
                timestamp: parseInt((messageData.timestamp || Date.now()).toString()), // **FIX: Convert to number for MessageData interface**
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
      timestamp: parseInt((messageData.timestamp || Date.now()).toString()), // **FIX: Convert to number for MessageData interface**
      processed: true,
    };
  }

  /**
   * Enable debug logging for legacy messaging
   */
  public setDebugMode(enabled: boolean): void {
    this._legacyDebug = enabled;
  }

  /**
   * Check if legacy listening is active
   */
  public isListening(): boolean {
    return this._legacyListening;
  }

  /**
   * Get the number of active date listeners
   */
  public getActiveListenersCount(): number {
    return this._legacyDateListeners.size;
  }

  /**
   * Cleanup all legacy messaging resources
   */
  public cleanup(): void {
    this.stopListeningToLegacyPaths();
    this._legacyDateListeners.clear();
    this._legacyTopLevelListener = null;
    this._legacyListening = false;
  }
}
