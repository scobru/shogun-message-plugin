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

/**
 * Public room management functionality for the messaging plugin
 */
export class PublicRoomManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private publicMessageListeners: PublicMessageListener[] = [];
  private _isListeningPublic = false;
  private processedPublicMessageIds = new Map<string, number>();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore
  private publicMessageListener: any = null;
  private roomDiscoveryListener: any = null;
  private _isDiscoveringRooms = false;

  constructor(core: ShogunCore, encryptionManager: EncryptionManager) {
    this.core = core;
    this.encryptionManager = encryptionManager;
  }

  /**
   * Creates a new public room
   */
  public async createPublicRoom(
    roomName: string,
    description?: string,
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

      // Store room data in GunDB
      const roomsNode = this.core.db.gun.get("public_rooms");
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
      const roomsNode = this.core.db.gun.get("public_rooms");

      roomsNode.map().once((roomData: any, roomId: string) => {
        if (roomData && roomData.name && roomData.isActive !== false) {
          rooms.push({
            id: roomId,
            name: roomData.name,
            description: roomData.description,
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
        resolve(rooms.sort((a, b) => b.createdAt - a.createdAt));
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
      const roomsNode = this.core.db.gun.get("public_rooms");

      roomsNode.get(roomId).once((roomData: any) => {
        if (roomData && roomData.name && roomData.isActive !== false) {
          resolve({
            id: roomId,
            name: roomData.name,
            description: roomData.description,
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
    const roomsNode = this.core.db.gun.get("public_rooms");

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
    updates: Partial<PublicRoomData>,
  ): Promise<void> {
    if (!this.core.isLoggedIn()) return;

    try {
      const roomsNode = this.core.db.gun.get("public_rooms");
      const roomNode = roomsNode.get(roomId);

      // Get current room data
      const currentData = await new Promise<any>((resolve) => {
        roomNode.once((data: any) => resolve(data));
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
    messageContent: string,
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
      const messageId = generateMessageId();
      const username =
        (this.core.db.user?.is?.alias as string) ||
        `User_${senderPub.slice(0, 8)}`;

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
        currentUserPair,
      );

      // Aggiungi la firma al messaggio
      const signedMessage = {
        ...publicMessage,
        signature,
      };

      // Usa il metodo condiviso per inviare a GunDB
      await this.sendToGunDB(roomId, messageId, signedMessage, "public");

      // Update room metadata with last message
      await this.updateRoomMetadata(roomId, {
        lastMessage: messageContent.substring(0, 100),
        lastMessageTime: publicMessage.timestamp,
      });

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
    if (
      !this.core.isLoggedIn() ||
      this._isListeningPublic ||
      !this.core.db.user ||
      !roomId
    ) {
      return;
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      return;
    }

    this._isListeningPublic = true;
    const currentUserPub = currentUserPair.pub;

    // Listener per messaggi pubblici
    const roomNode = this.core.db.gun.get(`room_${roomId}`).map();

    this.publicMessageListener = roomNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingPublicMessage(
          messageData,
          messageId,
          currentUserPub,
          roomId,
        );
      },
    );
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
   * Stops listening to public room messages
   */
  public stopListeningPublic(): void {
    if (!this._isListeningPublic) return;

    if (this.publicMessageListener) {
      this.publicMessageListener.off();
      this.publicMessageListener = null;
    }

    this._isListeningPublic = false;
    this.processedPublicMessageIds.clear();
  }

  /**
   * Processes incoming public messages
   */
  private async processIncomingPublicMessage(
    messageData: any,
    messageId: string,
    currentUserPub: string,
    roomId: string,
  ): Promise<void> {
    // Validazione base
    if (
      !messageData?.content ||
      !messageData?.from ||
      !messageData?.roomId ||
      messageData.roomId !== roomId
    ) {
      return;
    }

    // Controllo duplicati per ID
    if (this.processedPublicMessageIds.has(messageId)) {
      return;
    }

    this.cleanupProcessedMessages();
    this.processedPublicMessageIds.set(messageId, Date.now());

    try {
      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.encryptionManager.verifyMessageSignature(
          messageData.content,
          messageData.signature,
          messageData.from,
        );
        if (!isValid) {
          this.processedPublicMessageIds.delete(messageId);
          return;
        }
      }

      // Notifica i listener
      if (this.publicMessageListeners.length > 0) {
        this.publicMessageListeners.forEach((callback) => {
          try {
            callback(messageData as PublicMessage);
          } catch (error) {
            // Silent error handling
          }
        });
      }
    } catch (error) {
      this.processedPublicMessageIds.delete(messageId);
    }
  }

  /**
   * Enhanced cleanup for public messages
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    // Clean up public message IDs
    for (const [
      messageId,
      timestamp,
    ] of this.processedPublicMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedPublicMessageIds.delete(id));

    // Limit size of map
    if (this.processedPublicMessageIds.size > this.MAX_PROCESSED_MESSAGES) {
      const sortedEntries = Array.from(
        this.processedPublicMessageIds.entries(),
      ).sort(([, a], [, b]) => a - b);

      const toRemove = sortedEntries.slice(
        0,
        this.processedPublicMessageIds.size - this.MAX_PROCESSED_MESSAGES,
      );
      toRemove.forEach(([id]) => this.processedPublicMessageIds.delete(id));
    }
  }

  /**
   * Shared method to send messages to GunDB
   */
  private async sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group",
  ): Promise<void> {
    let safePath: string;

    if (type === "public") {
      safePath = `room_${path}`;
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
    return this._isListeningPublic;
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
    return this.processedPublicMessageIds.size;
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
              error,
            );
          }
        }
      }
    } catch (error) {
      console.error("Error initializing default rooms:", error);
    }
  }
}
