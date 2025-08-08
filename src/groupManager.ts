import { ShogunCore } from "shogun-core";
import { GroupData, GroupMessage, MessageResponse } from "./types";
import { generateGroupId, createSafePath } from "./utils";
import { EncryptionManager } from "./encryption";
import { ChatManager } from "./chatManager";

/**
 * Group management functionality for the messaging plugin
 */
export class GroupManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  private chatManager?: ChatManager;
  private readonly MAX_PROCESSED_MESSAGES = 1000;
  private readonly MESSAGE_TTL = 24 * 60 * 60 * 1000; // 24 ore

  constructor(
    core: ShogunCore,
    encryptionManager: EncryptionManager,
    chatManager?: ChatManager
  ) {
    this.core = core;
    this.encryptionManager = encryptionManager;
    this.chatManager = chatManager;
  }

  /**
   * Sets the ChatManager reference after initialization to avoid circular dependencies
   */
  public setChatManager(chatManager: ChatManager): void {
    this.chatManager = chatManager;
  }

  /**
   * Creates a new encrypted group
   */
  public async createGroup(
    groupName: string,
    memberPubs: string[]
  ): Promise<{ success: boolean; groupData?: GroupData; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
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
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const creatorPub = currentUserPair.pub;
      const groupId = generateGroupId();

      // Genera una chiave di cifratura per il gruppo
      const encryptionKey = `group_key_${groupId}_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Aggiungi il creatore ai membri
      const allMembers = [creatorPub, ...memberPubs];

      // Crea i dati del gruppo
      const groupData: GroupData = {
        id: groupId,
        name: groupName,
        members: allMembers,
        createdBy: creatorPub,
        createdAt: Date.now(),
        encryptionKey,
        encryptedKeys: {},
      };

      // Create encrypted keys for all members
      console.log(
        `[GroupManager] 🔐 Creating encrypted keys for ${allMembers.length} initial members`
      );
      for (const memberPub of allMembers) {
        if (memberPub === creatorPub) continue; // Skip creator as they don't need their own encrypted key

        try {
          const memberEpub =
            await this.encryptionManager.getRecipientEpub(memberPub);
          const sharedSecret = await this.core.db.sea.secret(
            memberEpub,
            currentUserPair
          );
          const encryptedKey = await this.core.db.sea.encrypt(
            encryptionKey,
            sharedSecret || ""
          );
          groupData.encryptedKeys![memberPub] = encryptedKey;
          console.log(
            `[GroupManager] ✅ Created encrypted key for member ${memberPub.slice(0, 8)}...`
          );
        } catch (error) {
          console.warn(
            `[GroupManager] ⚠️ Could not create encrypted key for member ${memberPub.slice(0, 8)}...:`,
            error
          );
        }
      }

      // Store group data with members as an object with numbered keys for GunDB compatibility
      const gunDBGroupData = {
        id: groupId,
        name: groupName,
        createdBy: creatorPub,
        createdAt: Date.now(),
        encryptionKey,
        encryptedKeys: groupData.encryptedKeys,
        members: allMembers.reduce(
          (acc: { [key: string]: string }, member: string, index: number) => {
            acc[`member_${index}`] = member;
            return acc;
          },
          {}
        ),
      };

      // Salva il gruppo nel database
      let saveAttempts = 0;
      const maxSaveAttempts = 3;

      while (saveAttempts < maxSaveAttempts) {
        try {
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(
                new Error(
                  "Timeout saving group data (15s) - network may be slow"
                )
              );
            }, 15000);

            this.core.db.gun
              .get(`group_${groupId}`)
              .put(gunDBGroupData, (ack: any) => {
                clearTimeout(timeout);
                if (ack.err) {
                  reject(new Error(`Error saving group: ${ack.err}`));
                } else {
                  resolve();
                }
              });
          });

          break;
        } catch (error) {
          saveAttempts++;
          console.warn(
            `[GroupManager] ⚠️ Save attempt ${saveAttempts} failed:`,
            error
          );

          if (saveAttempts >= maxSaveAttempts) {
            throw new Error(
              `Failed to save group after ${maxSaveAttempts} attempts: ${error}`
            );
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }

      // Pubblica il gruppo per ogni membro
      for (const memberPub of allMembers) {
        const memberNode = this.core.db.gun
          .get(`user_${memberPub}`)
          .get("groups");
        await new Promise<void>((resolve, reject) => {
          memberNode.get(groupId).put(gunDBGroupData, (ack: any) => {
            if (ack.err) {
              console.warn(
                `[GroupManager] ⚠️ Could not publish group to member ${memberPub.slice(0, 8)}...`
              );
            }
            resolve();
          });
        });
      }

      // Store group reference in user's chat list for persistence
      if (this.chatManager) {
        try {
          console.log(
            `[GroupManager] 💾 Storing group reference in user's chat list for persistence`
          );
          await this.chatManager.storeChatReferenceInUserProfile(
            creatorPub,
            "group",
            groupId,
            groupName
          );
          console.log(
            `[GroupManager] ✅ Group reference stored in user's chat list`
          );
        } catch (error) {
          console.warn(
            `[GroupManager] ⚠️ Could not store group reference in chat list:`,
            error
          );
        }
      } else {
        console.warn(
          `[GroupManager] ⚠️ ChatManager not available, group reference not stored in chat list`
        );
      }

      console.log(`[GroupManager] ✅ Group created successfully: ${groupId}`);
      return { success: true, groupData };
    } catch (error: any) {
      console.error(`[GroupManager] ❌ Error creating group:`, error);
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante la creazione del gruppo",
      };
    }
  }

  /**
   * Sends a message to an encrypted group using Multiple People Encryption
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<MessageResponse> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
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
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        return {
          success: false,
          error: "Coppia di chiavi utente non disponibile",
        };
      }

      const senderPub = currentUserPair.pub;
      const messageId = this.generateMessageId();
      const username =
        (this.core.db.user?.is?.alias as string) ||
        `User_${senderPub.slice(0, 8)}`;

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
        members = groupData.members;
      } else if (
        groupData.members &&
        typeof groupData.members === "object" &&
        !Array.isArray(groupData.members)
      ) {
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

      if (!members.includes(senderPub)) {
        return {
          success: false,
          error: "Non sei membro di questo gruppo.",
        };
      }

      // STEP 1: Cifra il contenuto del messaggio con la chiave del gruppo
      if (!groupData.encryptionKey) {
        return {
          success: false,
          error: "Chiave di cifratura del gruppo non disponibile.",
        };
      }
      const encryptedContent = await this.core.db.sea.encrypt(
        messageContent,
        groupData.encryptionKey
      );

      // STEP 2: Per ogni membro, cifra la chiave del gruppo con il loro secret
      const encryptedKeys: { [recipientPub: string]: string } = {};

      // Create encrypted keys for all members (don't use stored keys to avoid GunDB references)
      for (const memberPub of members) {
        try {
          console.log(
            `[GroupManager] 🔐 Creating encrypted key for member ${memberPub.slice(0, 8)}...`
          );

          let encryptedKey: string;

          if (memberPub === senderPub) {
            // For the sender, encrypt the group key with their own public key
            // This allows the sender to decrypt their own messages
            const senderEpub =
              await this.encryptionManager.getRecipientEpub(senderPub);
            const sharedSecret = await this.core.db.sea.secret(
              senderEpub,
              currentUserPair
            );
            encryptedKey = await this.core.db.sea.encrypt(
              groupData.encryptionKey!,
              sharedSecret || ""
            );
          } else {
            // For other members, encrypt the group key with their epub
            const memberEpub =
              await this.encryptionManager.getRecipientEpub(memberPub);
            const sharedSecret = await this.core.db.sea.secret(
              memberEpub,
              currentUserPair
            );
            encryptedKey = await this.core.db.sea.encrypt(
              groupData.encryptionKey!,
              sharedSecret || ""
            );
          }

          encryptedKeys[memberPub] = encryptedKey;
          console.log(
            `[GroupManager] ✅ Created encrypted key for member ${memberPub.slice(0, 8)}...`
          );
        } catch (error) {
          console.warn(
            `[GroupManager] ⚠️ Could not encrypt for member ${memberPub.slice(0, 8)}...:`,
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
        encryptedKeys: JSON.parse(JSON.stringify(encryptedKeys)), // Deep copy to avoid GunDB references
      };

      console.log(
        `[GroupManager] 🔍 Final group message encrypted keys:`,
        encryptedKeys
      );
      console.log(`[GroupManager] 🔍 Group message structure:`, {
        from: groupMessage.from,
        groupId: groupMessage.groupId,
        encryptedKeysCount: Object.keys(groupMessage.encryptedKeys || {})
          .length,
        encryptedKeys: groupMessage.encryptedKeys,
      });

      // Firma il messaggio
      const signature = await this.core.db.sea.sign(
        messageContent,
        currentUserPair
      );
      groupMessage.signature = signature;

      // Invia il messaggio al gruppo
      await this.sendToGunDB(
        `group_${groupId}`,
        messageId,
        groupMessage,
        "group"
      );

      console.log(`[GroupManager] ✅ Group message sent successfully`);
      return { success: true, messageId };
    } catch (error: any) {
      console.error(`[GroupManager] ❌ Error sending group message:`, error);
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
  public async getGroupData(groupId: string): Promise<GroupData | null> {
    try {
      const groupData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting group data (15s)"));
        }, 15000);

        this.core.db.gun.get(`group_${groupId}`).once((data: any) => {
          clearTimeout(timeout);
          resolve(data);
        });
      });

      if (!groupData) {
        return null;
      }

      // Handle members data
      let members: string[];

      if (Array.isArray(groupData.members)) {
        members = groupData.members;
      } else if (
        groupData.members &&
        typeof groupData.members === "object" &&
        !Array.isArray(groupData.members)
      ) {
        if (groupData.members["#"]) {
          const resolvedMembers = await new Promise<any>((resolve, reject) => {
            const memberTimeout = setTimeout(() => {
              reject(new Error("Timeout resolving members reference (10s)"));
            }, 10000);

            this.core.db.gun
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
        members = [];
      }

      return {
        id: groupData.id || groupId,
        name: groupData.name,
        members: members,
        createdBy: groupData.createdBy,
        createdAt: groupData.createdAt,
        encryptionKey: groupData.encryptionKey,
        encryptedKeys: groupData.encryptedKeys || {},
      };
    } catch (error: any) {
      console.error(`[GroupManager] ❌ Error getting group data:`, error);
      return null;
    }
  }

  /**
   * Adds a new member to an existing group
   */
  public async addMemberToGroup(
    groupId: string,
    newMemberPub: string
  ): Promise<{ success: boolean; error?: string }> {
    const currentUser = this.core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      const groupData = await this.getGroupData(groupId);
      if (!groupData) {
        return { success: false, error: "Group not found" };
      }

      if (
        groupData.createdBy !== currentUserPub &&
        !groupData.members.includes(currentUserPub) &&
        newMemberPub !== currentUserPub
      ) {
        return {
          success: false,
          error: "You are not authorized to add members to this group",
        };
      }

      if (groupData.members.includes(newMemberPub)) {
        return { success: false, error: "Member is already in the group" };
      }

      // Create encrypted copy of group key for the new member
      let updatedGroupData = {
        ...groupData,
        members: [...groupData.members, newMemberPub].reduce(
          (acc: { [key: string]: string }, member: string, index: number) => {
            acc[`member_${index}`] = member;
            return acc;
          },
          {}
        ),
      };

      // If the group has an encryption key, create an encrypted copy for the new member
      if (groupData.encryptionKey) {
        try {
          console.log(
            `[GroupManager] 🔐 Creating encrypted group key for new member ${newMemberPub.slice(0, 20)}...`
          );

          const currentUserPair = (this.core.db.user as any)._?.sea;
          if (!currentUserPair) {
            console.warn(
              `[GroupManager] ⚠️ Current user pair not available for key encryption`
            );
          } else {
            const newMemberEpub =
              await this.encryptionManager.getRecipientEpub(newMemberPub);
            const sharedSecret = await this.core.db.sea.secret(
              newMemberEpub,
              currentUserPair
            );
            const encryptedGroupKey = await this.core.db.sea.encrypt(
              groupData.encryptionKey,
              sharedSecret || ""
            );

            // Store the encrypted group key for the new member
            if (!updatedGroupData.encryptedKeys) {
              updatedGroupData.encryptedKeys = {};
            }
            updatedGroupData.encryptedKeys[newMemberPub] = encryptedGroupKey;

            console.log(
              `[GroupManager] ✅ Created encrypted group key for new member`
            );
          }
        } catch (keyError) {
          console.warn(
            `[GroupManager] ⚠️ Could not create encrypted group key for new member:`,
            keyError
          );
        }
      }

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout updating group data (15s)"));
        }, 15000);

        this.core.db.gun
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

      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log(
        `[GroupManager] ✅ Added member ${newMemberPub.slice(0, 20)}... to group ${groupId}`
      );
      return { success: true };
    } catch (error) {
      console.error(`[GroupManager] ❌ Error adding member to group:`, error);
      return { success: false, error: `Failed to add member: ${error}` };
    }
  }

  /**
   * Verifies if a user is a member of a group
   */
  public async isGroupMember(
    groupId: string,
    userPub: string
  ): Promise<{ success: boolean; isMember: boolean; error?: string }> {
    try {
      const groupData = await this.getGroupData(groupId);
      if (!groupData) {
        return { success: false, isMember: false, error: "Group not found" };
      }

      const isMember = groupData.members.includes(userPub);
      return { success: true, isMember };
    } catch (error) {
      console.error(
        `[GroupManager] ❌ Error checking group membership:`,
        error
      );
      return {
        success: false,
        isMember: false,
        error: `Failed to check membership: ${error}`,
      };
    }
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
            reject(new Error(ack.err));
          } else {
            resolve();
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  private generateMessageId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    return `msg_${timestamp}_${random}`;
  }
}
