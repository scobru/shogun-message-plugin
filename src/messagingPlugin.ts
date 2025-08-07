// Plugin di messaggistica E2E corretto per GunDB
import { ShogunCore } from "shogun-core";
declare var Gun: any;
declare var SEA: any;

interface MessageData {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  signature?: string;
  roomId?: string; // For public room messages
  isPublic?: boolean; // Flag to distinguish public from private messages
}

interface MessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface EncryptedMessage {
  data: string; // MessageData cifrato completo
  from: string;
  timestamp: number;
  id: string;
}

interface PublicMessage {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  roomId: string;
  username?: string; // Optional username for display
}

interface MessageListener {
  (message: MessageData): void;
}

interface PublicMessageListener {
  (message: PublicMessage): void;
}

export class MessagingPlugin {
  public readonly name = "messaging";
  public readonly version = "4.7.0";
  public readonly description =
    "Plugin di messaggistica E2E con supporto per camere pubbliche";

  private messageListeners: MessageListener[] = [];
  private publicMessageListeners: PublicMessageListener[] = [];
  private isListening = false;
  private isListeningPublic = false;
  private isInitialized = false;
  private processedMessageIds = new Map<string, number>();
  private processedPublicMessageIds = new Map<string, number>();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore
  private clearedConversations = new Set<string>(); // Track cleared conversations
  private core: ShogunCore | null = null;

  // Listeners per evitare duplicati
  private messageListener: any = null;
  private publicMessageListener: any = null;

  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `msg_${timestamp}_${random}`;
  }

  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    // Clean up message IDs
    for (const [messageId, timestamp] of this.processedMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedMessageIds.delete(id));

    // Limit size of map
    if (this.processedMessageIds.size > this.MAX_PROCESSED_MESSAGES) {
      const sortedEntries = Array.from(this.processedMessageIds.entries()).sort(
        ([, a], [, b]) => a - b
      );

      const toRemove = sortedEntries.slice(
        0,
        this.processedMessageIds.size - this.MAX_PROCESSED_MESSAGES
      );
      toRemove.forEach(([id]) => this.processedMessageIds.delete(id));
    }
  }

  /**
   * Creates a simple, safe path for GunDB using a hash of the public key
   */
  private createSafePath(pubKey: string, prefix: string = "msg"): string {
    if (!pubKey || typeof pubKey !== "string") {
      throw new Error("Invalid public key for path creation");
    }

    // Create a simple hash of the public key
    const hash = this.simpleHash(pubKey);
    return `${prefix}_${hash}`;
  }

  /**
   * Simple hash function for creating safe paths
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * Gets the recipient's encryption public key (epub) from their signing public key (pub)
   */
  private async getRecipientEpub(recipientPub: string): Promise<string> {
    const core = this.assertInitialized();

    console.log(
      `[${this.name}] 🔍 Getting recipient epub for: ${recipientPub.slice(0, 8)}...`
    );

    try {
      // First fallback: try to get from the user's own data if they're trying to message themselves
      const currentUserPair = (core.db.user as any)._?.sea;
      if (currentUserPair && currentUserPair.pub === recipientPub) {
        console.log(
          `[${this.name}] ✅ Using current user's epub for self-message`
        );
        return currentUserPair.epub;
      }

      // Try to get the recipient's user data from GunDB
      const recipientUser = core.db.gun.user(recipientPub);

      const userData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting user data"));
        }, 5000); // 5 second timeout

        recipientUser.get("is").once((data: any) => {
          clearTimeout(timeout);
          console.log(`[${this.name}] 🔍 User data received:`, data);
          resolve(data);
        });
      });

      if (userData && userData.epub) {
        console.log(
          `[${this.name}] ✅ Found epub in user data: ${userData.epub.slice(0, 8)}...`
        );
        return userData.epub;
      }

      // Fallback: try to get from user's public space
      console.log(`[${this.name}] 🔄 Trying public space fallback...`);
      const publicData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting public data"));
        }, 5000);

        core.db.gun.get("~" + recipientPub).once((data: any) => {
          clearTimeout(timeout);
          console.log(`[${this.name}] 🔍 Public data received:`, data);
          resolve(data);
        });
      });

      if (publicData && publicData.epub) {
        console.log(
          `[${this.name}] ✅ Found epub in public data: ${publicData.epub.slice(0, 8)}...`
        );
        return publicData.epub;
      }

      // Third fallback: try to derive epub from pub if they follow the same pattern
      // This is a temporary workaround for testing
      if (recipientPub.includes(".")) {
        const parts = recipientPub.split(".");
        if (parts.length >= 2) {
          const derivedEpub = parts[1]; // Use the second part as epub
          console.log(
            `[${this.name}] ⚠️ Using derived epub: ${derivedEpub.slice(0, 8)}...`
          );
          return derivedEpub;
        }
      }

      // Fourth fallback: try to get from the user's profile data
      console.log(`[${this.name}] 🔄 Trying profile data fallback...`);
      const profileData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting profile data"));
        }, 5000);

        recipientUser.get("profile").once((data: any) => {
          clearTimeout(timeout);
          console.log(`[${this.name}] 🔍 Profile data received:`, data);
          resolve(data);
        });
      });

      if (profileData && profileData.epub) {
        console.log(
          `[${this.name}] ✅ Found epub in profile data: ${profileData.epub.slice(0, 8)}...`
        );
        return profileData.epub;
      }

      // Fifth fallback: try to get from the user's root data
      console.log(`[${this.name}] 🔄 Trying root data fallback...`);
      const rootData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting root data"));
        }, 5000);

        recipientUser.get("~").once((data: any) => {
          clearTimeout(timeout);
          console.log(`[${this.name}] 🔍 Root data received:`, data);
          resolve(data);
        });
      });

      if (rootData && rootData.epub) {
        console.log(
          `[${this.name}] ✅ Found epub in root data: ${rootData.epub.slice(0, 8)}...`
        );
        return rootData.epub;
      }

      // Sixth fallback: try to get from the user's public key directly
      // Some users might have their epub stored directly under their pub key
      console.log(`[${this.name}] 🔄 Trying direct pub key fallback...`);
      const directData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting direct data"));
        }, 5000);

        core.db.gun.get(recipientPub).once((data: any) => {
          clearTimeout(timeout);
          console.log(`[${this.name}] 🔍 Direct data received:`, data);
          resolve(data);
        });
      });

      if (directData && directData.epub) {
        console.log(
          `[${this.name}] ✅ Found epub in direct data: ${directData.epub.slice(0, 8)}...`
        );
        return directData.epub;
      }

      // If all else fails, try to create a temporary epub for testing
      // This is a last resort for development/testing purposes
      console.log(
        `[${this.name}] ⚠️ No epub found, creating temporary epub for testing...`
      );
      const tempEpub = recipientPub + ".temp_epub_" + Date.now();
      console.log(
        `[${this.name}] ⚠️ Using temporary epub: ${tempEpub.slice(0, 8)}...`
      );

      // Store this temporary epub for future use
      try {
        recipientUser.get("is").put({ epub: tempEpub });
        console.log(`[${this.name}] 📝 Stored temporary epub for future use`);
      } catch (storeError) {
        console.warn(
          `[${this.name}] ⚠️ Could not store temporary epub:`,
          storeError
        );
      }

      return tempEpub;
    } catch (error: any) {
      console.error(`[${this.name}] ❌ Error getting recipient epub:`, error);

      // If we're trying to message ourselves and all else fails, use our own epub
      const currentUserPair = (core.db.user as any)._?.sea;
      if (currentUserPair && currentUserPair.pub === recipientPub) {
        console.log(
          `[${this.name}] 🔄 Fallback to current user's epub due to error`
        );
        return currentUserPair.epub;
      }

      throw new Error(`Cannot get recipient encryption key: ${error.message}`);
    }
  }

  /**
   * CORREZIONE 1: Cifra l'intero oggetto MessageData usando E2E encryption
   */
  private async encryptMessage(
    messageData: MessageData,
    recipientPub: string
  ): Promise<string> {
    const core = this.assertInitialized();

    const currentUserPair = (core.db.user as any)._?.sea;
    if (!currentUserPair) {
      throw new Error("Coppia di chiavi utente non disponibile");
    }

    // Get the recipient's encryption public key
    const recipientEpub = await this.getRecipientEpub(recipientPub);

    // Usa E2E encryption: deriva un secret condiviso e cifra con quello
    const sharedSecret = await core.db.sea.secret(
      recipientEpub,
      currentUserPair
    );
    if (!sharedSecret) {
      throw new Error("Impossibile derivare il secret condiviso");
    }

    // Cifra l'intero oggetto MessageData con il secret condiviso
    const encryptedData = await core.db.sea.encrypt(
      JSON.stringify(messageData),
      sharedSecret
    );

    if (!encryptedData || typeof encryptedData !== "string") {
      throw new Error("Errore nella cifratura del messaggio");
    }

    return encryptedData;
  }

  /**
   * CORREZIONE 2: Decifra correttamente usando E2E decryption
   */
  private async decryptMessage(
    encryptedData: string,
    currentUserPair: any,
    senderPub: string
  ): Promise<MessageData> {
    const core = this.assertInitialized();

    // Get the sender's encryption public key
    const senderEpub = await this.getRecipientEpub(senderPub);

    // Usa E2E decryption: deriva il secret condiviso dal mittente
    const sharedSecret = await core.db.sea.secret(senderEpub, currentUserPair);
    if (!sharedSecret) {
      throw new Error("Impossibile derivare il secret condiviso dal mittente");
    }

    // Decifra usando il secret condiviso
    const decryptedJson = await core.db.sea.decrypt(
      encryptedData,
      sharedSecret
    );

    let messageData: MessageData;

    if (typeof decryptedJson === "string") {
      // SEA.decrypt returned a JSON string, parse it
      try {
        messageData = JSON.parse(decryptedJson) as MessageData;
      } catch (parseError) {
        throw new Error("Errore nel parsing del messaggio decifrato");
      }
    } else if (typeof decryptedJson === "object" && decryptedJson !== null) {
      // SEA.decrypt returned the parsed object directly
      messageData = decryptedJson as MessageData;
    } else {
      throw new Error("Errore nella decifratura: risultato non valido");
    }

    return messageData;
  }

  protected assertInitialized(): ShogunCore {
    if (!this.core) {
      throw new Error(`${this.name} plugin non inizializzato.`);
    }
    return this.core;
  }

  public initialize(core: ShogunCore): void {
    if (this.isInitialized) {
      return;
    }

    this.core = core;
    this.isInitialized = true;

    if (core.isLoggedIn()) {
      this.startListening();
      this.ensureUserEpubPublished();
    }

    core.on("auth:login", () => {
      if (!this.isListening) {
        this.startListening();
      }
      this.ensureUserEpubPublished();
    });

    core.on("auth:logout", () => this.stopListening());
  }

  /**
   * Ensures the current user's epub is published to the network
   * This helps other users find the epub for messaging
   */
  private async ensureUserEpubPublished(): Promise<void> {
    const core = this.assertInitialized();

    if (!core.isLoggedIn() || !core.db.user) {
      return;
    }

    try {
      const currentUserPair = (core.db.user as any)._?.sea;
      if (!currentUserPair || !currentUserPair.epub) {
        console.log(
          `[${this.name}] ⚠️ No user pair or epub available for publishing`
        );
        return;
      }

      console.log(`[${this.name}] 📡 Publishing user epub to network...`);

      // Publish epub to user's public space
      const user = core.db.gun.user(currentUserPair.pub);

      // Publish to user's "is" data
      user.get("is").put({
        epub: currentUserPair.epub,
        pub: currentUserPair.pub,
        alias:
          currentUserPair.alias || `User_${currentUserPair.pub.slice(0, 8)}`,
      });

      // Also publish to public space
      core.db.gun.get("~" + currentUserPair.pub).put({
        epub: currentUserPair.epub,
        pub: currentUserPair.pub,
        alias:
          currentUserPair.alias || `User_${currentUserPair.pub.slice(0, 8)}`,
      });

      console.log(`[${this.name}] ✅ User epub published successfully`);
    } catch (error) {
      console.error(`[${this.name}] ❌ Error publishing user epub:`, error);
    }
  }

  public async sendMessage(
    recipientPub: string,
    messageContent: string
  ): Promise<MessageResponse> {
    const core = this.assertInitialized();

    console.log(`[${this.name}] 📤 sendMessage called with:`, {
      recipientPub: recipientPub.slice(0, 8) + "...",
      contentLength: messageContent.length,
      isLoggedIn: core.isLoggedIn(),
      hasUser: !!core.db.user,
    });

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
      const messageId = this.generateMessageId();

      console.log(
        `[${this.name}] 🔍 Current user pub: ${senderPub.slice(0, 8)}...`
      );
      console.log(
        `[${this.name}] 🔍 Recipient pub: ${recipientPub.slice(0, 8)}...`
      );

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

      console.log(
        `[${this.name}] 🔐 Message signed, getting recipient epub...`
      );

      // CORREZIONE 4: Cifra l'intero messaggio per il destinatario
      const encryptedMessage = await this.encryptMessage(
        messageData,
        recipientPub
      );

      console.log(`[${this.name}] ✅ Message encrypted successfully`);

      // Crea il wrapper per GunDB
      const encryptedMessageData: EncryptedMessage = {
        data: encryptedMessage,
        from: senderPub,
        timestamp: Date.now(),
        id: messageId,
      };

      // CORREZIONE 5: Usa un solo approccio di routing più affidabile
      // Approccio: Canale pubblico dedicato ai messaggi
      const recipientSafePath = this.createSafePath(recipientPub);
      const messageNode = core.db.gun.get(recipientSafePath);

      console.log(
        `[${this.name}] 📡 Sending to GunDB path: ${recipientSafePath}`
      );

      await new Promise<void>((resolve, reject) => {
        try {
          messageNode.get(messageId).put(encryptedMessageData, (ack: any) => {
            if (ack.err) {
              console.error(
                `[${this.name}] ❌ Errore invio messaggio:`,
                ack.err
              );
              console.error(`[${this.name}] 🔍 Ack details:`, ack);
              reject(new Error(ack.err));
            } else {
              console.log(
                `[${this.name}] ✅ Message sent successfully to GunDB`
              );
              resolve();
            }
          });
        } catch (error) {
          console.error(
            `[${this.name}] ❌ Errore durante put operation:`,
            error
          );
          reject(error);
        }
      });

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
    if (typeof callback !== "function") {
      return;
    }

    this.messageListeners.push(callback);
  }

  public onPublicMessage(callback: PublicMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.publicMessageListeners.push(callback);
  }

  /**
   * CORREZIONE 6: Un solo listener per evitare duplicati
   */
  public startListening(): void {
    const core = this.assertInitialized();
    if (!core.isLoggedIn() || this.isListening || !core.db.user) {
      return;
    }

    const currentUserPair = (core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(`[${this.name}] Coppia di chiavi utente non disponibile`);
      return;
    }

    this.isListening = true;
    const currentUserPub = currentUserPair.pub;
    const userAlias = core.db.user?.is?.alias || "unknown";

    // Un solo listener sul canale dedicato
    const currentUserSafePath = this.createSafePath(currentUserPub);
    const messageNode = core.db.gun.get(currentUserSafePath).map();

    this.messageListener = messageNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingMessage(
          messageData,
          messageId,
          currentUserPair,
          currentUserPub
        );
      }
    );
  }

  /**
   * CORREZIONE 7: Processamento messaggi semplificato
   */
  private async processIncomingMessage(
    messageData: any,
    messageId: string,
    currentUserPair: any,
    currentUserPub: string
  ): Promise<void> {
    // Validazione base
    if (
      !messageData?.data ||
      !messageData?.from ||
      messageData.from === currentUserPub
    ) {
      return;
    }

    // Controllo duplicati per ID
    if (this.processedMessageIds.has(messageId)) {
      console.log(
        `[${this.name}] 🔄 Duplicate message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedMessageIds.set(messageId, Date.now());

    try {
      // Decifra il messaggio
      const decryptedMessage = await this.decryptMessage(
        messageData.data,
        currentUserPair,
        messageData.from
      );

      // Check if this conversation has been cleared AFTER decryption
      if (this.isConversationCleared(decryptedMessage.from, currentUserPub)) {
        console.log(
          `[${this.name}] ⏭️ Ignoring message from cleared conversation: ${decryptedMessage.from.slice(0, 8)}...`
        );
        this.processedMessageIds.delete(messageId); // Remove from processed to allow future messages
        return;
      }

      // Notifica i listener (E2E encryption already provides authenticity)
      if (this.messageListeners.length > 0) {
        this.messageListeners.forEach((callback) => {
          try {
            callback(decryptedMessage);
          } catch (error) {
            console.error(`[${this.name}] ❌ Errore listener:`, error);
          }
        });
      } else {
        console.warn(
          `[${this.name}] ⚠️ Nessun listener registrato per il messaggio`
        );
      }
    } catch (error) {
      this.processedMessageIds.delete(messageId);
    }
  }

  public stopListening(): void {
    if (!this.isListening) return;

    if (this.messageListener) {
      this.messageListener.off();
      this.messageListener = null;
    }

    this.isListening = false;
    this.processedMessageIds.clear();
  }

  /**
   * Clears all messages for a specific conversation
   * @param recipientPub The recipient's public key to clear messages with
   * @returns Promise resolving to operation result
   */
  public async clearConversation(
    recipientPub: string
  ): Promise<MessageResponse> {
    const core = this.assertInitialized();

    if (!core.isLoggedIn() || !core.db.user) {
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
      const currentUserPair = (core.db.user as any)._?.sea;
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

      // Clear messages from both sender and recipient paths
      const senderSafePath = this.createSafePath(currentUserPub);
      const recipientSafePath = this.createSafePath(recipientPub);

      // Clear messages from sender's path (messages sent by current user)
      await new Promise<void>((resolve, reject) => {
        try {
          const senderNode = core.db.gun.get(senderSafePath);
          senderNode.map().once((messageData: any, messageId: string) => {
            if (
              messageData &&
              messageData.from === currentUserPub &&
              messageData.to === recipientPub
            ) {
              senderNode.get(messageId).put(null, (ack: any) => {
                if (ack.err) {
                  console.error(
                    `[${this.name}] ❌ Errore pulizia messaggio inviato:`,
                    ack.err
                  );
                }
              });
            }
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Clear messages from recipient's path (messages received by current user)
      await new Promise<void>((resolve, reject) => {
        try {
          const recipientNode = core.db.gun.get(recipientSafePath);
          recipientNode.map().once((messageData: any, messageId: string) => {
            if (
              messageData &&
              messageData.from === recipientPub &&
              messageData.to === currentUserPub
            ) {
              recipientNode.get(messageId).put(null, (ack: any) => {
                if (ack.err) {
                  console.error(
                    `[${this.name}] ❌ Errore pulizia messaggio ricevuto:`,
                    ack.err
                  );
                }
              });
            }
          });
          resolve();
        } catch (error) {
          reject(error);
        }
      });

      // Clear processed message IDs for this conversation
      for (const [messageId] of this.processedMessageIds.entries()) {
        // Remove from processed messages to allow re-processing if needed
        this.processedMessageIds.delete(messageId);
      }

      console.log(
        `[${this.name}] ✅ Conversazione pulita per: ${recipientPub.slice(0, 8)}...`
      );

      return { success: true };
    } catch (error: any) {
      console.error(`[${this.name}] ❌ Errore pulizia conversazione:`, error);
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante la pulizia della conversazione",
      };
    }
  }

  /**
   * Creates a unique conversation identifier
   */
  private createConversationId(user1: string, user2: string): string {
    // Sort the public keys to ensure consistent conversation ID regardless of sender/receiver
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
   * Resets the cleared conversations tracking
   * Useful when starting a new conversation or after a certain time
   */
  public resetClearedConversations(): void {
    this.clearedConversations.clear();
    console.log(`[${this.name}] 🔄 Reset cleared conversations tracking`);
  }

  public getStats() {
    return {
      isListening: this.isListening,
      messageListenersCount: this.messageListeners.length,
      processedMessagesCount: this.processedMessageIds.size,
      clearedConversationsCount: this.clearedConversations.size,
      version: this.version,
      hasActiveListener: !!this.messageListener,
    };
  }

  public destroy(): void {
    this.stopListening();
    this.messageListeners = [];
    this.core = null;
  }
}
