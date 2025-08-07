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
  groupId?: string; // For group messages
  isGroup?: boolean; // Flag to distinguish group messages
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

// Nuove interfacce per gruppi
interface GroupMessage {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  groupId: string;
  username?: string;
  encryptedContent: string; // Contenuto cifrato con encryption key
  encryptedKeys: { [recipientPub: string]: string }; // Encryption keys cifrate per ogni membro
  signature?: string; // Firma digitale del messaggio
}

interface GroupData {
  id: string;
  name: string;
  members: string[]; // Array di public keys
  createdBy: string;
  createdAt: number;
  encryptionKey: string; // Chiave di cifratura del gruppo
}

interface GroupMessageListener {
  (message: GroupMessage): void;
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
    "Plugin di messaggistica E2E con supporto per camere pubbliche e gruppi criptati";

  private messageListeners: MessageListener[] = [];
  private publicMessageListeners: PublicMessageListener[] = [];
  private groupMessageListeners: GroupMessageListener[] = [];
  private isListening = false;
  private isListeningPublic = false;
  private isListeningGroups = false;
  private isInitialized = false;
  private processedMessageIds = new Map<string, number>();
  private processedPublicMessageIds = new Map<string, number>();
  private processedGroupMessageIds = new Map<string, number>();
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore
  private clearedConversations = new Set<string>(); // Track cleared conversations
  private core: ShogunCore | null = null;

  // Listeners per evitare duplicati
  private messageListener: any = null;
  private publicMessageListener: any = null;
  private groupMessageListener: any = null;

  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `msg_${timestamp}_${random}`;
  }

  /**
   * Creates a new encrypted group
   * @param groupName The name of the group
   * @param memberPubs Array of member public keys (excluding creator)
   * @returns Promise resolving to group data
   */
  public async createGroup(
    groupName: string,
    memberPubs: string[]
  ): Promise<{ success: boolean; groupData?: GroupData; error?: string }> {
    const core = this.assertInitialized();

    if (!core.isLoggedIn() || !core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per creare un gruppo.",
      };
    }

    if (!groupName || !memberPubs || memberPubs.length === 0) {
      return {
        success: false,
        error: "Nome gruppo e membri sono obbligatori.",
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

      const creatorPub = currentUserPair.pub;
      const groupId = this.generateGroupId();

      // Genera una chiave di cifratura per il gruppo
      const encryptionKey = `group_key_${groupId}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Aggiungi il creatore ai membri
      const allMembers = [creatorPub, ...memberPubs];

      // DEBUG: Log the allMembers array immediately after creation
      console.log(`[${this.name}] 🔍 DEBUG - allMembers created:`, {
        type: typeof allMembers,
        isArray: Array.isArray(allMembers),
        length: allMembers.length,
        value: allMembers,
        sample: allMembers.slice(0, 2),
        creatorPub: creatorPub,
        memberPubs: memberPubs,
      });

      // Crea i dati del gruppo - store members as a simple array
      const groupData: GroupData = {
        id: groupId,
        name: groupName,
        members: allMembers,
        createdBy: creatorPub,
        createdAt: Date.now(),
        encryptionKey,
      };

      // Store group data with members as an object with numbered keys for GunDB compatibility
      const gunDBGroupData = {
        id: groupId,
        name: groupName,
        createdBy: creatorPub,
        createdAt: Date.now(),
        encryptionKey,
        members: allMembers.reduce(
          (acc: { [key: string]: string }, member: string, index: number) => {
            acc[`member_${index}`] = member;
            return acc;
          },
          {}
        ),
      };

      // DEBUG: Log the exact structure before putting to GunDB
      console.log(`[${this.name}] 🔍 DEBUG - allMembers:`, {
        type: typeof allMembers,
        isArray: Array.isArray(allMembers),
        length: allMembers.length,
        value: allMembers,
        sample: allMembers.slice(0, 2),
      });

      console.log(`[${this.name}] 🔍 DEBUG - gunDBGroupData.members:`, {
        type: typeof gunDBGroupData.members,
        isArray: Array.isArray(gunDBGroupData.members),
        isObject:
          typeof gunDBGroupData.members === "object" &&
          gunDBGroupData.members !== null,
        keys: Array.isArray(gunDBGroupData.members)
          ? gunDBGroupData.members.length
          : Object.keys(gunDBGroupData.members),
        values: Array.isArray(gunDBGroupData.members)
          ? gunDBGroupData.members
          : Object.values(gunDBGroupData.members),
        value: gunDBGroupData.members,
      });

      console.log(`[${this.name}] 🔍 DEBUG - Full gunDBGroupData:`, {
        ...gunDBGroupData,
        members: gunDBGroupData.members, // Log members separately to see full structure
      });

      // Salva il gruppo nel database
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout saving group data"));
        }, 5000);

        core.db.gun.get(`group_${groupId}`).put(gunDBGroupData, (ack: any) => {
          clearTimeout(timeout);
          if (ack.err) {
            reject(new Error(`Error saving group: ${ack.err}`));
          } else {
            resolve();
          }
        });
      });

      // Store group reference in user's profile for persistence
      await this.storeChatReferenceInUserProfile(
        creatorPub,
        "group",
        groupId,
        groupName
      );

      // Test immediate retrieval to verify data is stored correctly
      try {
        const testRetrieval = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout testing immediate retrieval"));
          }, 3000);

          core.db.gun.get(`group_${groupId}`).once((data: any) => {
            clearTimeout(timeout);
            resolve(data);
          });
        });

        console.log(`[${this.name}] 🔍 DEBUG - Immediate retrieval result:`, {
          testRetrieval,
          testMembers: testRetrieval?.members,
          testMembersType: typeof testRetrieval?.members,
          testMembersIsArray: Array.isArray(testRetrieval?.members),
          testMembersKeys:
            testRetrieval?.members && typeof testRetrieval?.members === "object"
              ? Object.keys(testRetrieval?.members)
              : null,
        });
      } catch (error) {
        console.warn(
          `[${this.name}] ⚠️ Could not test immediate retrieval:`,
          error
        );
      }

      // Pubblica il gruppo per ogni membro
      for (const memberPub of allMembers) {
        const memberNode = core.db.gun.get(`user_${memberPub}`).get("groups");
        await new Promise<void>((resolve, reject) => {
          memberNode.get(groupId).put(gunDBGroupData, (ack: any) => {
            if (ack.err) {
              console.warn(
                `[${this.name}] ⚠️ Could not publish group to member ${memberPub.slice(0, 8)}...`
              );
            }
            resolve();
          });
        });
      }

      console.log(`[${this.name}] ✅ Group created successfully: ${groupId}`);
      return { success: true, groupData };
    } catch (error: any) {
      console.error(`[${this.name}] ❌ Error creating group:`, error);
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante la creazione del gruppo",
      };
    }
  }

  /**
   * Generates a unique group ID
   */
  private generateGroupId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `group_${timestamp}_${random}`;
  }

  /**
   * Sends a message to an encrypted group using Multiple People Encryption
   * @param groupId The group identifier
   * @param messageContent The message content
   * @returns Promise resolving to operation result
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    const core = this.assertInitialized();

    console.log(`[${this.name}] 📤 sendGroupMessage called with:`, {
      groupId,
      contentLength: messageContent.length,
      isLoggedIn: core.isLoggedIn(),
      hasUser: !!core.db.user,
    });

    if (!core.isLoggedIn() || !core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio di gruppo.",
      };
    }

    if (!groupId || !messageContent) {
      return {
        success: false,
        error: "ID gruppo e messaggio sono obbligatori.",
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
      const username =
        (core.db.user?.is?.alias as string) || `User_${senderPub.slice(0, 8)}`;

      // Recupera i dati del gruppo
      const groupData = await this.getGroupData(groupId);
      if (!groupData) {
        return {
          success: false,
          error: "Gruppo non trovato o accesso negato.",
        };
      }

      // Verifica che il mittente sia membro del gruppo
      let members: string[];
      if (Array.isArray(groupData.members)) {
        // Members is already an array
        members = groupData.members;
      } else if (
        groupData.members &&
        typeof groupData.members === "object" &&
        !Array.isArray(groupData.members)
      ) {
        // Fallback: Members might be stored as an object with member_0, member_1, etc. keys
        // Extract and sort by the numeric part of the key
        const memberEntries = Object.entries(groupData.members)
          .filter(
            ([key, value]) =>
              key.startsWith("member_") && typeof value === "string"
          )
          .sort(([keyA], [keyB]) => {
            const numA = parseInt(keyA.replace("member_", ""));
            const numB = parseInt(keyB.replace("member_", ""));
            return numA - numB;
          });

        members = memberEntries.map(([_, value]) => value as string);
      } else {
        return {
          success: false,
          error: "Formato membri del gruppo non valido.",
        };
      }

      // DEBUG: Log membership check details
      console.log(`[${this.name}] 🔍 DEBUG - Membership check:`, {
        senderPub: senderPub,
        senderPubShort: senderPub.slice(0, 20) + "...",
        members: members,
        membersShort: members.map((m) => m.slice(0, 20) + "..."),
        isMember: members.includes(senderPub),
        groupDataMembers: groupData.members,
        groupDataMembersType: typeof groupData.members,
        groupDataMembersIsArray: Array.isArray(groupData.members),
      });

      if (!members.includes(senderPub)) {
        return {
          success: false,
          error: "Non sei membro di questo gruppo.",
        };
      }

      console.log(
        `[${this.name}] 🔐 Encrypting group message for ${members.length} members...`
      );

      // STEP 1: Cifra il contenuto del messaggio con la chiave del gruppo
      if (!groupData.encryptionKey) {
        return {
          success: false,
          error: "Chiave di cifratura del gruppo non disponibile.",
        };
      }
      const encryptedContent = await core.db.sea.encrypt(
        messageContent,
        groupData.encryptionKey
      );

      // STEP 2: Per ogni membro, cifra la chiave del gruppo con il loro secret
      const encryptedKeys: { [recipientPub: string]: string } = {};

      for (const memberPub of members) {
        if (memberPub === senderPub) continue; // Salta il mittente

        try {
          // Ottieni l'epub del membro
          const memberEpub = await this.getRecipientEpub(memberPub);

          // Genera il secret condiviso
          const sharedSecret = await core.db.sea.secret(
            memberEpub,
            currentUserPair
          );

          // Cifra la chiave del gruppo per questo membro
          const encryptedKey = await core.db.sea.encrypt(
            groupData.encryptionKey!,
            sharedSecret || ""
          );
          encryptedKeys[memberPub] = encryptedKey;

          console.log(
            `[${this.name}] ✅ Encrypted key for member: ${memberPub.slice(0, 8)}...`
          );
        } catch (error) {
          console.warn(
            `[${this.name}] ⚠️ Could not encrypt for member ${memberPub.slice(0, 8)}...:`,
            error
          );
        }
      }

      // Crea il messaggio di gruppo
      const groupMessage: GroupMessage = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
        groupId,
        username,
        encryptedContent,
        encryptedKeys,
      };

      // Firma il messaggio
      const signature = await core.db.sea.sign(messageContent, currentUserPair);
      groupMessage.signature = signature;

      // Invia il messaggio al gruppo
      await this.sendToGunDB(
        `group_${groupId}`,
        messageId,
        groupMessage,
        "group"
      );

      console.log(`[${this.name}] ✅ Group message sent successfully`);
      return { success: true, messageId };
    } catch (error: any) {
      console.error(`[${this.name}] ❌ Error sending group message:`, error);
      return {
        success: false,
        error:
          error.message ||
          "Errore sconosciuto durante l'invio del messaggio di gruppo",
      };
    }
  }

  /**
   * Retrieves group data from GunDB
   */
  private async getGroupData(groupId: string): Promise<GroupData | null> {
    const core = this.assertInitialized();

    try {
      const groupData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting group data"));
        }, 5000);

        core.db.gun.get(`group_${groupId}`).once((data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      if (!groupData) {
        return null;
      }

      // DEBUG: Log the group data retrieval process
      console.log(
        `[${this.name}] 🔍 DEBUG - getGroupData for groupId: ${groupId}`,
        {
          rawGroupData: groupData,
          rawMembers: groupData.members,
          rawMembersType: typeof groupData.members,
          rawMembersIsArray: Array.isArray(groupData.members),
        }
      );

      // Handle members data - now stored as object with member_0, member_1, etc. keys
      let members: string[];

      if (Array.isArray(groupData.members)) {
        // Legacy format: Members is an array, use it directly
        members = groupData.members;
      } else if (
        groupData.members &&
        typeof groupData.members === "object" &&
        !Array.isArray(groupData.members)
      ) {
        // Check if this is a GunDB reference object (has # property)
        if (groupData.members["#"]) {
          // This is a GunDB reference, we need to wait for the actual data
          console.log(
            `[${this.name}] 🔄 Waiting for GunDB reference to resolve...`
          );

          const resolvedMembers = await new Promise<any>((resolve, reject) => {
            const memberTimeout = setTimeout(() => {
              reject(new Error("Timeout resolving members reference"));
            }, 3000);

            core.db.gun
              .get(`group_${groupId}`)
              .get("members")
              .once((memberData: any) => {
                clearTimeout(memberTimeout);
                resolve(memberData);
              });
          });

          if (
            resolvedMembers &&
            typeof resolvedMembers === "object" &&
            !Array.isArray(resolvedMembers)
          ) {
            // Extract members from the resolved object
            const memberEntries = Object.entries(resolvedMembers)
              .filter(
                ([key, value]) =>
                  key.startsWith("member_") && typeof value === "string"
              )
              .sort(([keyA], [keyB]) => {
                const numA = parseInt(keyA.replace("member_", ""));
                const numB = parseInt(keyB.replace("member_", ""));
                return numA - numB;
              });

            members = memberEntries.map(([_, value]) => value as string);
          } else {
            members = [];
          }
        } else {
          // New format: Members stored as object with member_0, member_1, etc. keys
          // Extract and sort by the numeric part of the key
          const memberEntries = Object.entries(groupData.members)
            .filter(
              ([key, value]) =>
                key.startsWith("member_") && typeof value === "string"
            )
            .sort(([keyA], [keyB]) => {
              const numA = parseInt(keyA.replace("member_", ""));
              const numB = parseInt(keyB.replace("member_", ""));
              return numA - numB;
            });

          members = memberEntries.map(([_, value]) => value as string);
        }
      } else {
        // Members doesn't exist or is in invalid format
        console.warn(
          `[${this.name}] ⚠️ Invalid members format in group data:`,
          groupData.members
        );
        members = [];
      }

      console.log(`[${this.name}] 🔍 DEBUG - Final processed members:`, {
        rawMembers: groupData.members,
        processedMembers: members,
        processedMembersLength: members.length,
      });

      return {
        id: groupData.id || groupId,
        name: groupData.name,
        members: members,
        createdBy: groupData.createdBy,
        createdAt: groupData.createdAt,
        encryptionKey: groupData.encryptionKey,
      };
    } catch (error: any) {
      console.error(`[${this.name}] ❌ Error getting group data:`, error);
      return null;
    }
  }

  /**
   * Sends a message to a public room (unencrypted)
   * @param roomId The room identifier
   * @param messageContent The message content
   * @returns Promise resolving to operation result
   */
  public async sendPublicMessage(
    roomId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    const core = this.assertInitialized();

    console.log(`[${this.name}] 📤 sendPublicMessage called with:`, {
      roomId,
      contentLength: messageContent.length,
      isLoggedIn: core.isLoggedIn(),
      hasUser: !!core.db.user,
    });

    if (!core.isLoggedIn() || !core.db.user) {
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
      const currentUserPair = (core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const senderPub = currentUserPair.pub;
      const messageId = this.generateMessageId();
      const username =
        (core.db.user?.is?.alias as string) || `User_${senderPub.slice(0, 8)}`;

      console.log(
        `[${this.name}] 🔍 Current user pub: ${senderPub.slice(0, 8)}...`
      );
      console.log(`[${this.name}] 🔍 Room ID: ${roomId}`);

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
      const signature = await core.db.sea.sign(messageContent, currentUserPair);

      // Aggiungi la firma al messaggio
      const signedMessage = {
        ...publicMessage,
        signature,
      };

      // Usa il metodo condiviso per inviare a GunDB
      await this.sendToGunDB(roomId, messageId, signedMessage, "public");

      console.log(`[${this.name}] ✅ Public message sent successfully`);

      return { success: true, messageId };
    } catch (error: any) {
      console.error(
        `[${this.name}] ❌ Errore invio messaggio pubblico:`,
        error
      );
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
   * @param roomId The room identifier to listen to
   */
  public startListeningPublic(roomId: string): void {
    const core = this.assertInitialized();
    if (!core.isLoggedIn() || this.isListeningPublic || !core.db.user) {
      return;
    }

    const currentUserPair = (core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(`[${this.name}] Coppia di chiavi utente non disponibile`);
      return;
    }

    this.isListeningPublic = true;
    const currentUserPub = currentUserPair.pub;

    console.log(
      `[${this.name}] 🔊 Starting public room listener for: ${roomId}`
    );

    // Listener per messaggi pubblici
    const roomNode = core.db.gun.get(`room_${roomId}`).map();

    this.publicMessageListener = roomNode.on(
      async (messageData: any, messageId: string) => {
        await this.processIncomingPublicMessage(
          messageData,
          messageId,
          currentUserPub,
          roomId
        );
      }
    );
  }

  /**
   * Removes a specific public message listener
   * @param callback The callback function to remove
   */
  public removePublicMessageListener(callback: PublicMessageListener): void {
    const index = this.publicMessageListeners.indexOf(callback);
    if (index > -1) {
      this.publicMessageListeners.splice(index, 1);
      console.log(`[${this.name}] 🗑️ Removed public message listener`);
    }
  }

  /**
   * Stops listening to public room messages
   */
  public stopListeningPublic(): void {
    if (!this.isListeningPublic) return;

    if (this.publicMessageListener) {
      this.publicMessageListener.off();
      this.publicMessageListener = null;
    }

    this.isListeningPublic = false;
    this.processedPublicMessageIds.clear();
    console.log(`[${this.name}] 🔇 Stopped public room listener`);
  }

  /**
   * Processes incoming public messages
   */
  private async processIncomingPublicMessage(
    messageData: any,
    messageId: string,
    currentUserPub: string,
    roomId: string
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
      console.log(
        `[${this.name}] 🔄 Duplicate public message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedPublicMessageIds.set(messageId, Date.now());

    try {
      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.verifyMessageSignature(
          messageData.content,
          messageData.signature,
          messageData.from
        );
        if (!isValid) {
          console.warn(
            `[${this.name}] ⚠️ Invalid signature for public message from: ${messageData.from.slice(0, 8)}...`
          );
          // Non bloccare il messaggio, solo loggare l'avviso
        }
      }

      // Notifica i listener
      if (this.publicMessageListeners.length > 0) {
        this.publicMessageListeners.forEach((callback) => {
          try {
            callback(messageData as PublicMessage);
          } catch (error) {
            console.error(`[${this.name}] ❌ Errore listener pubblico:`, error);
          }
        });
      } else {
        console.warn(
          `[${this.name}] ⚠️ Nessun listener pubblico registrato per il messaggio`
        );
      }
    } catch (error) {
      this.processedPublicMessageIds.delete(messageId);
      console.error(
        `[${this.name}] ❌ Errore processamento messaggio pubblico:`,
        error
      );
    }
  }

  /**
   * Shared method to send messages to GunDB (DRY principle)
   */
  private async sendToGunDB(
    path: string,
    messageId: string,
    messageData: any,
    type: "private" | "public" | "group"
  ): Promise<void> {
    const core = this.assertInitialized();
    let safePath: string;

    if (type === "public") {
      safePath = `room_${path}`;
    } else if (type === "group") {
      safePath = path; // Per i gruppi, il path è già corretto (es: group_123)
    } else {
      safePath = this.createSafePath(path);
    }

    const messageNode = core.db.gun.get(safePath);

    console.log(
      `[${this.name}] 📡 Sending ${type} message to GunDB path: ${safePath}`
    );

    return new Promise<void>((resolve, reject) => {
      try {
        messageNode.get(messageId).put(messageData, (ack: any) => {
          if (ack.err) {
            console.error(
              `[${this.name}] ❌ Errore invio messaggio ${type}:`,
              ack.err
            );
            console.error(`[${this.name}] 🔍 Ack details:`, ack);
            reject(new Error(ack.err));
          } else {
            console.log(
              `[${this.name}] ✅ ${type} message sent successfully to GunDB`
            );
            resolve();
          }
        });
      } catch (error) {
        console.error(
          `[${this.name}] ❌ Errore durante put operation ${type}:`,
          error
        );
        reject(error);
      }
    });
  }

  /**
   * Verifies message signature
   */
  private async verifyMessageSignature(
    content: string,
    signature: string,
    senderPub: string
  ): Promise<boolean> {
    const core = this.assertInitialized();

    try {
      const isValid = await core.db.sea.verify(signature, senderPub);
      return !!isValid;
    } catch (error) {
      console.error(`[${this.name}] ❌ Errore verifica firma:`, error);
      return false;
    }
  }

  /**
   * Enhanced cleanup for both private and public messages
   */
  private cleanupProcessedMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    // Clean up private message IDs
    for (const [messageId, timestamp] of this.processedMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedMessageIds.delete(id));

    // Clean up public message IDs
    expiredIds.length = 0;
    for (const [
      messageId,
      timestamp,
    ] of this.processedPublicMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedPublicMessageIds.delete(id));

    // Clean up group message IDs
    expiredIds.length = 0;
    for (const [
      messageId,
      timestamp,
    ] of this.processedGroupMessageIds.entries()) {
      if (now - timestamp > this.MESSAGE_TTL) {
        expiredIds.push(messageId);
      }
    }

    expiredIds.forEach((id) => this.processedGroupMessageIds.delete(id));

    // Limit size of all maps
    this.limitMapSize(this.processedMessageIds);
    this.limitMapSize(this.processedPublicMessageIds);
    this.limitMapSize(this.processedGroupMessageIds);
  }

  /**
   * Shared method to limit map size (DRY principle)
   */
  private limitMapSize(map: Map<string, number>): void {
    if (map.size > this.MAX_PROCESSED_MESSAGES) {
      const sortedEntries = Array.from(map.entries()).sort(
        ([, a], [, b]) => a - b
      );

      const toRemove = sortedEntries.slice(
        0,
        map.size - this.MAX_PROCESSED_MESSAGES
      );
      toRemove.forEach(([id]) => map.delete(id));
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
  public async getRecipientEpub(recipientPub: string): Promise<string> {
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
      this.startListeningGroups(); // Avvia i listener per i messaggi di gruppo
    }

    core.on("auth:login", () => {
      if (!this.isListening) {
        this.startListening();
      }
      this.ensureUserEpubPublished();
      this.startListeningGroups(); // Avvia i listener per i messaggi di gruppo
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

      await this.sendToGunDB(
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
   * Registers a callback for group messages
   */
  public onGroupMessage(callback: GroupMessageListener): void {
    if (typeof callback !== "function") {
      return;
    }

    this.groupMessageListeners.push(callback);
  }

  /**
   * Removes a specific group message listener
   * @param callback The callback function to remove
   */
  public removeGroupMessageListener(callback: GroupMessageListener): void {
    const index = this.groupMessageListeners.indexOf(callback);
    if (index > -1) {
      this.groupMessageListeners.splice(index, 1);
      console.log(`[${this.name}] 🗑️ Removed group message listener`);
    }
  }

  /**
   * Starts listening to group messages
   */
  public startListeningGroups(): void {
    const core = this.assertInitialized();
    if (!core.isLoggedIn() || this.isListeningGroups || !core.db.user) {
      return;
    }

    const currentUserPair = (core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.error(`[${this.name}] Coppia di chiavi utente non disponibile`);
      return;
    }

    this.isListeningGroups = true;
    const currentUserPub = currentUserPair.pub;

    console.log(`[${this.name}] 🔊 Starting group message listener`);

    // Listener per messaggi di gruppo
    const userGroupsNode = core.db.gun
      .get(`user_${currentUserPub}`)
      .get("groups")
      .map();

    this.groupMessageListener = userGroupsNode.on(
      async (groupData: any, groupId: string) => {
        if (groupData && groupData.id) {
          await this.startListeningToGroup(
            groupId,
            currentUserPair,
            currentUserPub
          );
        }
      }
    );
  }

  /**
   * Starts listening to a specific group
   */
  private async startListeningToGroup(
    groupId: string,
    currentUserPair: any,
    currentUserPub: string
  ): Promise<void> {
    const core = this.assertInitialized();

    console.log(`[${this.name}] 🔊 Listening to group: ${groupId}`);

    const groupMessagesNode = core.db.gun.get(`group_${groupId}`).map();

    groupMessagesNode.on(async (messageData: any, messageId: string) => {
      await this.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair,
        currentUserPub,
        groupId
      );
    });
  }

  /**
   * Processes incoming group messages using Multiple People Encryption
   */
  private async processIncomingGroupMessage(
    messageData: any,
    messageId: string,
    currentUserPair: any,
    currentUserPub: string,
    groupId: string
  ): Promise<void> {
    // Validazione base
    if (
      !messageData?.encryptedContent ||
      !messageData?.from ||
      !messageData?.groupId ||
      messageData.groupId !== groupId
    ) {
      return;
    }

    // Controllo duplicati per ID
    if (this.processedGroupMessageIds.has(messageId)) {
      console.log(
        `[${this.name}] 🔄 Duplicate group message ID detected: ${messageId.slice(0, 20)}...`
      );
      return;
    }

    this.cleanupProcessedMessages();
    this.processedGroupMessageIds.set(messageId, Date.now());

    try {
      // STEP 1: Ottieni la chiave cifrata per questo utente
      const encryptedKey = messageData.encryptedKeys?.[currentUserPub];
      if (!encryptedKey) {
        console.warn(
          `[${this.name}] ⚠️ No encrypted key found for user in group message`
        );
        return;
      }

      // STEP 2: Decifra la chiave del gruppo usando il secret condiviso
      const senderEpub = await this.getRecipientEpub(messageData.from);
      const sharedSecret = await this.core!.db.sea.secret(
        senderEpub,
        currentUserPair
      );
      const decryptedGroupKey = await this.core!.db.sea.decrypt(
        encryptedKey,
        sharedSecret || ""
      );

      if (!decryptedGroupKey) {
        console.error(`[${this.name}] ❌ Could not decrypt group key`);
        return;
      }

      // STEP 3: Decifra il contenuto del messaggio usando la chiave del gruppo
      const decryptedContent = await this.core!.db.sea.decrypt(
        messageData.encryptedContent,
        decryptedGroupKey
      );

      if (!decryptedContent) {
        console.error(`[${this.name}] ❌ Could not decrypt message content`);
        return;
      }

      // Verifica la firma se presente
      if (messageData.signature) {
        const isValid = await this.verifyMessageSignature(
          decryptedContent,
          messageData.signature,
          messageData.from
        );
        if (!isValid) {
          console.warn(
            `[${this.name}] ⚠️ Invalid signature for group message from: ${messageData.from.slice(0, 8)}...`
          );
        }
      }

      // Crea il messaggio decifrato
      const decryptedGroupMessage: GroupMessage = {
        ...messageData,
        content: decryptedContent,
      };

      // Notifica i listener
      if (this.groupMessageListeners.length > 0) {
        this.groupMessageListeners.forEach((callback) => {
          try {
            callback(decryptedGroupMessage);
          } catch (error) {
            console.error(`[${this.name}] ❌ Errore listener gruppo:`, error);
          }
        });
      } else {
        console.warn(
          `[${this.name}] ⚠️ Nessun listener gruppo registrato per il messaggio`
        );
      }
    } catch (error) {
      this.processedGroupMessageIds.delete(messageId);
      console.error(
        `[${this.name}] ❌ Errore processamento messaggio gruppo:`,
        error
      );
    }
  }

  /**
   * Stops listening to group messages
   */
  public stopListeningGroups(): void {
    if (!this.isListeningGroups) return;

    if (this.groupMessageListener) {
      this.groupMessageListener.off();
      this.groupMessageListener = null;
    }

    this.isListeningGroups = false;
    this.processedGroupMessageIds.clear();
    console.log(`[${this.name}] 🔇 Stopped group message listener`);
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

  /**
   * Adds a new member to an existing group
   */
  public async addMemberToGroup(
    groupId: string,
    newMemberPub: string
  ): Promise<{ success: boolean; error?: string }> {
    const core = this.assertInitialized();
    const currentUser = core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      // Get current group data
      const groupData = await this.getGroupData(groupId);
      if (!groupData) {
        return { success: false, error: "Group not found" };
      }

      // Check if user is the group creator or a member
      if (
        groupData.createdBy !== currentUserPub &&
        !groupData.members.includes(currentUserPub)
      ) {
        return {
          success: false,
          error: "You are not authorized to add members to this group",
        };
      }

      // Check if member is already in the group
      if (groupData.members.includes(newMemberPub)) {
        return { success: false, error: "Member is already in the group" };
      }

      // Add new member to the group
      const updatedMembers = [...groupData.members, newMemberPub];

      // Update group data with new member
      const updatedGroupData = {
        ...groupData,
        members: updatedMembers.reduce(
          (acc: { [key: string]: string }, member: string, index: number) => {
            acc[`member_${index}`] = member;
            return acc;
          },
          {}
        ),
      };

      // Save updated group data
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout updating group data"));
        }, 5000);

        core.db.gun
          .get(`group_${groupId}`)
          .put(updatedGroupData, (ack: any) => {
            clearTimeout(timeout);
            if (ack.err) {
              reject(new Error(`Error updating group: ${ack.err}`));
            } else {
              resolve();
            }
          });
      });

      console.log(
        `[${this.name}] ✅ Added member ${newMemberPub.slice(0, 20)}... to group ${groupId}`
      );
      return { success: true };
    } catch (error) {
      console.error(`[${this.name}] ❌ Error adding member to group:`, error);
      return { success: false, error: `Failed to add member: ${error}` };
    }
  }

  /**
   * Generates an invitation link for any chat type (private, public room, or group)
   */
  public generateInviteLink(
    chatType: "private" | "public" | "group",
    chatId: string,
    chatName?: string
  ): string {
    const baseUrl = window.location.origin;
    const encodedType = encodeURIComponent(chatType);
    const encodedId = encodeURIComponent(chatId);
    const encodedName = chatName ? encodeURIComponent(chatName) : "";

    return `${baseUrl}/chat-invite/${encodedType}/${encodedId}${encodedName ? `?name=${encodedName}` : ""}`;
  }

  /**
   * Joins a group using an invitation link
   */
  public async joinGroup(
    groupId: string
  ): Promise<{ success: boolean; groupData?: GroupData; error?: string }> {
    const core = this.assertInitialized();
    const currentUser = core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      // Get group data
      const groupData = await this.getGroupData(groupId);
      if (!groupData) {
        return {
          success: false,
          error: "Group not found or invitation invalid",
        };
      }

      // Check if user is already a member
      if (groupData.members.includes(currentUserPub)) {
        return {
          success: false,
          error: "You are already a member of this group",
        };
      }

      // Add user to the group
      const result = await this.addMemberToGroup(groupId, currentUserPub);
      if (!result.success) {
        return result;
      }

      // Start listening to the group
      this.startListeningToGroup(groupId, currentUser, currentUserPub);

      console.log(`[${this.name}] ✅ Successfully joined group ${groupId}`);
      return { success: true, groupData };
    } catch (error) {
      console.error(`[${this.name}] ❌ Error joining group:`, error);
      return { success: false, error: `Failed to join group: ${error}` };
    }
  }

  /**
   * Joins any chat type using an invitation link
   */
  public async joinChat(
    chatType: "private" | "public" | "group",
    chatId: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    const core = this.assertInitialized();
    const currentUser = core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      switch (chatType) {
        case "private":
          // For private chats, we just need to start listening
          // The chat will be available immediately
          return {
            success: true,
            chatData: {
              type: "private",
              id: chatId,
              name: `Chat with ${chatId.slice(0, 8)}...`,
            },
          };

        case "public":
          // For public rooms, start listening to the room
          this.startListeningPublic(chatId);
          return {
            success: true,
            chatData: {
              type: "public",
              id: chatId,
              name: `Public Room: ${chatId}`,
            },
          };

        case "group":
          // For groups, use the existing joinGroup method
          const result = await this.joinGroup(chatId);
          if (result.success && result.groupData) {
            return {
              success: true,
              chatData: {
                type: "group",
                id: chatId,
                name: result.groupData.name,
                groupData: result.groupData,
              },
            };
          }
          return result;

        default:
          return { success: false, error: "Invalid chat type" };
      }
    } catch (error) {
      console.error(`[${this.name}] ❌ Error joining chat:`, error);
      return { success: false, error: `Failed to join chat: ${error}` };
    }
  }

  /**
   * Gets all chats that the current user has access to
   */
  public async getMyChats(): Promise<{
    success: boolean;
    chats?: any[];
    error?: string;
  }> {
    const core = this.assertInitialized();
    const currentUser = core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      // This is a simplified implementation
      // In a real scenario, you would store chat references in the user's profile
      console.log(
        `[${this.name}] 🔍 Getting chats for user: ${currentUserPub.slice(0, 20)}...`
      );

      // TODO: Implement proper chat indexing by user
      // This would require storing chat references in the user's profile
      return { success: true, chats: [] };
    } catch (error) {
      console.error(`[${this.name}] ❌ Error getting user chats:`, error);
      return { success: false, error: `Failed to get chats: ${error}` };
    }
  }

  /**
   * Stores a chat reference in the user's profile for persistence
   */
  private async storeChatReferenceInUserProfile(
    userPub: string,
    chatType: "private" | "public" | "group",
    chatId: string,
    chatName?: string
  ): Promise<void> {
    const core = this.assertInitialized();

    try {
      // Store chat reference in user's profile
      const chatReference = {
        type: chatType,
        id: chatId,
        name: chatName || `${chatType} chat`,
        joinedAt: Date.now(),
      };

      await core.db.putUserData(`chats/${chatType}/${chatId}`, chatReference);
      console.log(
        `[${this.name}] ✅ Stored chat reference for user ${userPub.slice(0, 20)}...`
      );
    } catch (error) {
      console.warn(`[${this.name}] ⚠️ Could not store chat reference:`, error);
    }
  }

  public getStats() {
    return {
      isListening: this.isListening,
      isListeningPublic: this.isListeningPublic,
      isListeningGroups: this.isListeningGroups,
      messageListenersCount: this.messageListeners.length,
      publicMessageListenersCount: this.publicMessageListeners.length,
      groupMessageListenersCount: this.groupMessageListeners.length,
      processedMessagesCount: this.processedMessageIds.size,
      processedPublicMessagesCount: this.processedPublicMessageIds.size,
      processedGroupMessagesCount: this.processedGroupMessageIds.size,
      clearedConversationsCount: this.clearedConversations.size,
      version: this.version,
      hasActiveListener: !!this.messageListener,
      hasActivePublicListener: !!this.publicMessageListener,
      hasActiveGroupListener: !!this.groupMessageListener,
    };
  }

  public destroy(): void {
    this.stopListening();
    this.stopListeningPublic();
    this.stopListeningGroups();
    this.messageListeners = [];
    this.publicMessageListeners = [];
    this.groupMessageListeners = [];
    this.core = null;
  }
}
