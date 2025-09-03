import { ShogunCore } from "shogun-core";
import {
  PublicMessage,
  MessageResponse,
  PublicMessageListener,
  PublicRoomData,
} from "./types";
import {
  generateMessageId,
  createSafePath,
  generateSecureToken,
} from "./utils";
import { EncryptionManager } from "./encryption";
import { MessagingSchema } from "./schema";

/**
 * Public room management functionality for the messaging plugin
 */
export class PublicRoomManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private publicMessageListeners: PublicMessageListener[] = [];
  private roomDiscoveryListener: any = null;
  private _isDiscoveringRooms = false;
  // **FIXED: Add map to track active listeners per room to prevent duplicates**
  // Store both handler and processedMessageIds to prevent duplicate message processing
  private activeRoomListeners: Map<
    string,
    { handler: any; processedMessageIds: Set<string> }
  > = new Map();

  constructor(core: ShogunCore, encryptionManager: EncryptionManager) {
    this.core = core;
    this.encryptionManager = encryptionManager;
  }

  /**
   * **SIGNAL APPROACH: Get public room messages from localStorage only**
   */
  public async getPublicRoomMessages(
    roomId: string,
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<any[]> {
    try {
      console.log(
        "🔍 PublicRoomManager.getPublicRoomMessages: Starting for room",
        roomId
      );

      // **SIGNAL APPROACH: Load messages from localStorage only**
      const messages =
        await this._loadPublicRoomMessagesFromLocalStorage(roomId);

      console.log(
        "🔍 PublicRoomManager.getPublicRoomMessages: Loaded messages:",
        messages.length
      );
      return messages;
    } catch (error) {
      console.error(
        "🔍 PublicRoomManager.getPublicRoomMessages: Error:",
        error
      );
      return [];
    }
  }

  /**
   * **SIGNAL APPROACH: Load public room messages from localStorage**
   */
  private async _loadPublicRoomMessagesFromLocalStorage(
    roomId: string
  ): Promise<any[]> {
    try {
      // **IMPROVED: Use schema for localStorage key**
      const localStorageKey = MessagingSchema.publicRooms.localStorage(roomId);
      const storedMessages = localStorage.getItem(localStorageKey);

      if (storedMessages) {
        const messages = JSON.parse(storedMessages);
        console.log(
          "📱 PublicRoom: Loaded messages from localStorage:",
          messages.length
        );
        return messages;
      }

      console.log(
        "📱 PublicRoom: No messages in localStorage for room:",
        roomId
      );
      return [];
    } catch (error) {
      console.warn("⚠️ PublicRoom: Error loading from localStorage:", error);
      return [];
    }
  }

  /**
   * **SIGNAL APPROACH: Save public room message to localStorage**
   */
  private async _savePublicRoomMessageToLocalStorage(
    roomId: string,
    message: any
  ): Promise<void> {
    try {
      // **IMPROVED: Use schema for localStorage key**
      const localStorageKey = MessagingSchema.publicRooms.localStorage(roomId);
      const existingMessages = JSON.parse(
        localStorage.getItem(localStorageKey) || "[]"
      );

      // Add new message
      const updatedMessages = [...existingMessages, message];

      // Keep only last 1000 messages to prevent localStorage overflow
      const trimmedMessages = updatedMessages.slice(-1000);

      localStorage.setItem(localStorageKey, JSON.stringify(trimmedMessages));
      console.log(
        "📱 PublicRoom: Saved message to localStorage for room:",
        roomId
      );
    } catch (error) {
      console.warn("⚠️ PublicRoom: Error saving to localStorage:", error);
    }
  }

  /**
   * **SIGNAL APPROACH: Add public room message listener for real-time messages**
   */
  public async addPublicRoomMessageListener(
    roomId: string,
    callback: (message: any) => void
  ): Promise<void> {
    try {
      console.log(
        "🔍 PublicRoomManager.addPublicRoomMessageListener: Adding listener for room",
        roomId
      );

      // **FIXED: Check if listener is already active for this room**
      if (this.activeRoomListeners.has(roomId)) {
        console.log(
          "🔍 PublicRoomManager.addPublicRoomMessageListener: Listener already active for room",
          roomId,
          "- skipping duplicate activation"
        );
        return;
      }

      // **IMPROVED: Use schema for room messages path**
      const messagesPath = MessagingSchema.publicRooms.messages(roomId);
      const roomMessagesNode = this.core.db.gun.get(messagesPath);

      // **FIXED: Only listen for NEW messages, not existing ones**
      // Use a timestamp-based approach to only process messages newer than current time
      const currentTime = Date.now();
      const cutoffTime = currentTime - 2000; // **FIXED: Increased to 2 seconds for better reliability**

      // **FIXED: Set up listener with better duplicate prevention**
      // Create a new Set for this room's processed message IDs
      const processedMessageIds = new Set<string>();

      const handler = roomMessagesNode
        .map()
        .on(async (messageData: any, messageId: string) => {
          console.log("🔍 PublicRoomManager: Message received", {
            roomId,
            messageId,
            hasData: !!messageData,
            messageTimestamp: messageData?.timestamp,
            currentTime,
            cutoffTime,
          });

          // **FIXED: Only process NEW messages (created after we started listening)**
          if (messageData && messageId && messageData.timestamp) {
            const messageAge = currentTime - messageData.timestamp;

            // **FIXED: Check for duplicates first using the persisted Set**
            // Get the current listener data to access the persisted processedMessageIds
            const currentListenerData = this.activeRoomListeners.get(roomId);
            if (
              currentListenerData &&
              currentListenerData.processedMessageIds.has(messageId)
            ) {
              console.log("⏭️ Skipping duplicate message:", messageId);
              return;
            }

            // Only process messages that are very recent (within last 2 seconds)
            // This prevents loading old messages from GunDB
            if (messageData.timestamp >= cutoffTime) {
              console.log(
                "🚀 Processing NEW public room message:",
                messageId,
                "age:",
                messageAge,
                "ms"
              );

              // Mark as processed in the persisted Set
              if (currentListenerData) {
                currentListenerData.processedMessageIds.add(messageId);
              }

              // Process the message
              const processedMessage =
                await this._processIncomingPublicRoomMessage(
                  messageData,
                  messageId,
                  roomId
                );

              if (processedMessage) {
                // Save to localStorage
                await this._savePublicRoomMessageToLocalStorage(
                  roomId,
                  processedMessage
                );

                // Call the callback
                callback(processedMessage);
              }
            } else {
              console.log(
                "⏭️ Skipping old message:",
                messageId,
                "age:",
                messageAge,
                "ms (too old)"
              );
            }
          }
        });

      // **FIXED: Store the handler and processedMessageIds to track active listeners**
      this.activeRoomListeners.set(roomId, { handler, processedMessageIds });

      console.log(
        "🔍 PublicRoomManager.addPublicRoomMessageListener: Listener added successfully for room",
        roomId
      );
    } catch (error) {
      console.error(
        "🔍 PublicRoomManager.addPublicRoomMessageListener: Error:",
        error
      );
    }
  }

  /**
   * **SIGNAL APPROACH: Process incoming public room message**
   */
  private async _processIncomingPublicRoomMessage(
    messageData: any,
    messageId: string,
    roomId: string
  ): Promise<any | null> {
    try {
      console.log("🔍 _processIncomingPublicRoomMessage: Processing", {
        messageId,
        roomId,
        hasContent: !!messageData?.content,
        hasFrom: !!messageData?.from,
      });

      if (!messageData?.content || !messageData?.from) {
        console.log(
          "🔍 _processIncomingPublicRoomMessage: Invalid message data"
        );
        return null;
      }

      // Create message object (public messages are not encrypted)
      const processedMessage = {
        id: messageId,
        from: messageData.from,
        roomId,
        timestamp: messageData.timestamp || Date.now(),
        content: messageData.content,
      };

      console.log(
        "🔍 _processIncomingPublicRoomMessage: Message processed successfully"
      );
      return processedMessage;
    } catch (error) {
      console.error("🔍 _processIncomingPublicRoomMessage: Error:", error);
      return null;
    }
  }

  /**
   * Creates a new public room
   */
  public async createPublicRoom(
    roomName: string,
    description?: string
  ): Promise<{ success: boolean; roomData?: PublicRoomData; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per creare una sala pubblica.",
      };
    }

    if (
      !roomName ||
      typeof roomName !== "string" ||
      roomName.trim().length === 0
    ) {
      return {
        success: false,
        error: "Il nome della sala è obbligatorio.",
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
      const roomId = roomName.toLowerCase().replace(/[^a-z0-9]/g, "-");
      const timestamp = Date.now();

      // Create room data
      const roomData: PublicRoomData = {
        id: roomId,
        name: roomName.trim(),
        description: description?.trim(),
        createdBy: senderPub,
        createdAt: timestamp,
        memberCount: 0,
        isActive: true,
      };

      // **IMPROVED: Use schema for public rooms collection**
      const roomsNode = this.core.db.gun.get(MessagingSchema.collections.publicRooms);
      await new Promise<void>((resolve, reject) => {
        roomsNode.get(roomId).put(roomData, (ack: any) => {
          if (ack.err) {
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
      });

      return { success: true, roomData };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || "Errore durante la creazione della sala",
      };
    }
  }

  /**
   * Gets all available public rooms
   */
  public async getPublicRooms(): Promise<PublicRoomData[]> {
    if (!this.core.isLoggedIn()) {
      return [];
    }

    return new Promise((resolve) => {
      const rooms: PublicRoomData[] = [];
      // **IMPROVED: Use schema for public rooms collection**
      const roomsNode = this.core.db.gun.get(MessagingSchema.collections.publicRooms);

      roomsNode.map().on((roomData: any, roomId: string) => {
        if (roomData && roomData.name && roomData.isActive !== false) {
          rooms.push({
            id: roomId,
            name: roomData.name,
            description: roomData.description,
            messageCount: roomData.messageCount || 0,
            createdBy: roomData.createdBy,
            createdAt: roomData.createdAt,
            memberCount: roomData.memberCount || 0,
            lastMessage: roomData.lastMessage,
            lastMessageTime: roomData.lastMessageTime,
            isActive: roomData.isActive !== false,
          });
        }
      });

      // Resolve after a short delay to allow GunDB to sync
      setTimeout(() => {
        resolve(rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)));
      }, 1000);
    });
  }

  /**
   * Gets a specific public room by ID
   */
  public async getPublicRoom(roomId: string): Promise<PublicRoomData | null> {
    if (!this.core.isLoggedIn() || !roomId) {
      return null;
    }

    return new Promise((resolve) => {
      // **IMPROVED: Use schema for public rooms collection**
      const roomsNode = this.core.db.gun.get(MessagingSchema.collections.publicRooms);

      roomsNode.get(roomId).on((roomData: any) => {
        if (roomData && roomData.name && roomData.isActive !== false) {
          resolve({
            id: roomId,
            name: roomData.name,
            description: roomData.description,
            messageCount: roomData.messageCount || 0,
            createdBy: roomData.createdBy,
            createdAt: roomData.createdAt,
            memberCount: roomData.memberCount || 0,
            lastMessage: roomData.lastMessage,
            lastMessageTime: roomData.lastMessageTime,
            isActive: roomData.isActive !== false,
          });
        } else {
          resolve(null);
        }
      });
    });
  }

  /**
   * Starts room discovery to listen for new rooms
   */
  public startRoomDiscovery(): void {
    if (!this.core.isLoggedIn() || this._isDiscoveringRooms) {
      return;
    }

    this._isDiscoveringRooms = true;
    // **IMPROVED: Use schema for public rooms collection**
    const roomsNode = this.core.db.gun.get(MessagingSchema.collections.publicRooms);

    this.roomDiscoveryListener = roomsNode
      .map()
      .on((roomData: any, roomId: string) => {
        // Room discovery callback - can be used for real-time updates
        if (roomData && roomData.name) {
          console.log("🔍 PublicRoomManager: New room discovered", {
            roomId,
            roomName: roomData.name,
          });
        }
      });
  }

  /**
   * Stops room discovery
   */
  public stopRoomDiscovery(): void {
    if (this.roomDiscoveryListener) {
      this.roomDiscoveryListener.off();
      this.roomDiscoveryListener = null;
    }
    this._isDiscoveringRooms = false;
  }

  /**
   * Updates room metadata (last message, member count, etc.)
   */
  private async updateRoomMetadata(
    roomId: string,
    updates: Partial<PublicRoomData>
  ): Promise<void> {
    if (!this.core.isLoggedIn()) return;

    try {
      const roomsNode = this.core.db.gun.get("public_rooms");
      const roomNode = roomsNode.get(roomId);

      // **IMPROVED: Get current room data**
      const currentData = await new Promise<any>((resolve) => {
        roomNode.on((data: any) => resolve(data));
      });

      if (currentData) {
        // Update with new data
        const updatedData = { ...currentData, ...updates };
        await new Promise<void>((resolve, reject) => {
          roomNode.put(updatedData, (ack: any) => {
            if (ack.err) {
              reject(new Error(ack.err));
            } else {
              resolve();
            }
          });
        });
      }
    } catch (error) {
      console.error("Error updating room metadata:", error);
    }
  }

  /**
   * Sends a message to a public room (unencrypted)
   */
  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio pubblico.",
      };
    }

    if (
      !roomId ||
      !messageContent ||
      typeof roomId !== "string" ||
      typeof messageContent !== "string"
    ) {
      return {
        success: false,
        error:
          "ID stanza e messaggio sono obbligatori e devono essere stringhe valide.",
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
      let messageId = generateMessageId();
      const username =
        (this.core.db.user?.is?.alias as string) ||
        `User_${senderPub.slice(0, 8)}`;

      // **FIXED: Generate unique message ID without checking for duplicates**
      // This ensures each message has a unique ID for proper tracking

      // **FIXED: Don't mark own messages as processed during sending**
      // This allows them to come through the listener properly
      // Only mark as processed when received through the listener

      // Crea il messaggio pubblico
      const publicMessage: PublicMessage = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
        roomId,
        username,
      };

      // Firma il messaggio per autenticità
      const signature = await this.core.db.sea.sign(
        messageContent,
        currentUserPair
      );

      // Aggiungi la firma al messaggio
      const signedMessage = {
        ...publicMessage,
        signature,
      };

      // **FIXED: Use GunDB's fire-and-forget approach**
      // GunDB operations don't need to wait for confirmation
      this.sendToGunDB(roomId, messageId, signedMessage, "public").catch(
        (error) => {
          console.warn("⚠️ GunDB put warning (non-blocking):", error);
        }
      );

      // **SIGNAL APPROACH: Save sent message to localStorage immediately**
      const messageForLocalStorage = {
        id: messageId,
        from: senderPub,
        roomId,
        timestamp: publicMessage.timestamp,
        content: messageContent,
        username,
      };

      // Save to localStorage immediately (non-blocking)
      this._savePublicRoomMessageToLocalStorage(
        roomId,
        messageForLocalStorage
      ).catch((error) => {
        console.warn("⚠️ localStorage save warning (non-blocking):", error);
      });

      // Update room metadata with last message (non-blocking)
      this.updateRoomMetadata(roomId, {
        lastMessage: {
          id: messageId,
          content: messageContent.substring(0, 100),
          from: senderPub,
          timestamp: publicMessage.timestamp,
          roomId,
          username,
        },
        lastMessageTime: publicMessage.timestamp,
      }).catch((error) => {
        console.warn("⚠️ Room metadata update warning (non-blocking):", error);
      });

      // **FIXED: Return success immediately - GunDB is fire-and-forget**
      return { success: true, messageId };
    } catch (error: any) {
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante l'invio del messaggio pubblico",
      };
    }
  }

  /**
   * Starts listening to public room messages
   */
  public startListeningPublic(roomId: string): void {
    if (!this.core.isLoggedIn() || !roomId) {
      return;
    }

    // **FIXED: Check if already listening to this room**
    if (this.activeRoomListeners.has(roomId)) {
      console.log(
        "🔍 PublicRoomManager.startListeningPublic: Already listening to room",
        roomId
      );
      return;
    }

    // **FIXED: Use the same approach as sendPublicMessage to get user pair**
    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error("❌ PublicRoomManager: No current user pair available");
      return;
    }

    console.log(
      "🔍 PublicRoomManager.startListeningPublic: Starting for room",
      roomId
    );

    const currentUserPub = currentUserPair.pub;

    // **FIXED: Use the SIGNAL approach with addPublicRoomMessageListener instead of direct GunDB listener**
    // This prevents duplicate processing of messages
    this.addPublicRoomMessageListener(roomId, (message: any) => {
      // Process the message through the registered listeners
      if (this.publicMessageListeners.length > 0) {
        this.publicMessageListeners.forEach((callback) => {
          try {
            callback(message);
          } catch (error) {
            console.error("Error in public message listener:", error);
          }
        });
      }
    });
  }

  /**
   * Removes a specific public message listener
   */
  public removePublicMessageListener(callback: PublicMessageListener): void {
    const index = this.publicMessageListeners.indexOf(callback);
    if (index > -1) {
      this.publicMessageListeners.splice(index, 1);
    }
  }

  /**
   * **FIXED: Stop listening to a specific room**
   */
  public stopListeningToRoom(roomId: string): void {
    const listenerData = this.activeRoomListeners.get(roomId);
    if (listenerData) {
      try {
        if (
          listenerData.handler &&
          typeof listenerData.handler.off === "function"
        ) {
          listenerData.handler.off();
          console.log(
            "🔍 PublicRoomManager: Stopped listener for specific room",
            roomId
          );
        }
      } catch (error) {
        console.warn(
          "⚠️ PublicRoomManager: Error stopping listener for room",
          roomId,
          error
        );
      }
      this.activeRoomListeners.delete(roomId);
    }
  }

  /**
   * **FIXED: Check if a specific room has an active listener**
   */
  public hasActiveRoomListener(roomId: string): boolean {
    return this.activeRoomListeners.has(roomId);
  }

  /**
   * Stops listening to public room messages
   */
  public stopListeningPublic(): void {
    // **FIXED: Clean up all active room listeners**
    this.activeRoomListeners.forEach((listenerData, roomId) => {
      try {
        if (
          listenerData.handler &&
          typeof listenerData.handler.off === "function"
        ) {
          listenerData.handler.off();
          console.log(
            "🔍 PublicRoomManager: Stopped listener for room",
            roomId
          );
        }
      } catch (error) {
        console.warn(
          "⚠️ PublicRoomManager: Error stopping listener for room",
          roomId,
          error
        );
      }
    });

    // **FIXED: Clear all listeners and reset state**
    this.publicMessageListeners = [];
    this.activeRoomListeners.clear();

    console.log("🔍 PublicRoomManager: Stopped listening to all public rooms");
  }

  /**
   * Shared method to send messages to GunDB
   */
  private async sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group"
  ): Promise<void> {
    let safePath: string;

    if (type === "public") {
      // **IMPROVED: Use schema for public room path**
      safePath = MessagingSchema.publicRooms.messages(path);
    } else if (type === "group") {
      safePath = path;
    } else {
      safePath = createSafePath(path);
    }

    const messageNode = this.core.db.gun.get(safePath);

    return new Promise<void>((resolve, reject) => {
      try {
        messageNode.get(messageId).put(messageData, (ack: any) => {
          if (ack.err) {
            console.error("❌ PublicRoomManager: GunDB put error", ack.err);
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
      } catch (error) {
        console.error("❌ PublicRoomManager: GunDB put exception", error);
        reject(error);
      }
    });
  }

  /**
   * Registers a callback for public messages
   */
  public onPublicMessage(callback: PublicMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.publicMessageListeners.push(callback);
  }

  /**
   * Gets the current listening status
   */
  public isListeningPublic(): boolean {
    return this.activeRoomListeners.size > 0;
  }

  /**
   * Gets the room discovery status
   */
  public isDiscoveringRooms(): boolean {
    return this._isDiscoveringRooms;
  }

  /**
   * Gets the number of public message listeners
   */
  public getPublicMessageListenersCount(): number {
    return this.publicMessageListeners.length;
  }

  /**
   * Gets the number of processed public messages
   */
  public getProcessedPublicMessagesCount(): number {
    return 0; // No longer tracking processed messages
  }

  /**
   * Initializes default public rooms if none exist
   */
  public async initializeDefaultRooms(): Promise<void> {
    if (!this.core.isLoggedIn()) return;

    try {
      const existingRooms = await this.getPublicRooms();

      // Only create default rooms if no rooms exist
      if (existingRooms.length === 0) {
        const defaultRooms = [
          {
            name: "general",
            description: "Discussione generale - benvenuti tutti!",
          },
          {
            name: "help",
            description: "Supporto e aiuto per l'uso dell'app",
          },
          {
            name: "random",
            description: "Argomenti casuali e conversazioni informali",
          },
          {
            name: "announcements",
            description: "Annunci ufficiali e aggiornamenti",
          },
        ];

        for (const room of defaultRooms) {
          try {
            await this.createPublicRoom(room.name, room.description);
            console.log(`✅ Created default room: ${room.name}`);
          } catch (error) {
            console.error(
              `❌ Failed to create default room ${room.name}:`,
              error
            );
          }
        }
      }
    } catch (error) {
      console.error("Error initializing default rooms:", error);
    }
  }
}