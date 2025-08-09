import { ShogunCore } from "shogun-core";
import { EncryptionManager } from "./encryption";
import { GroupData } from "./types";

/**
 * Group chat management for the messaging plugin
 */
export class GroupManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;

  constructor(core: ShogunCore, encryptionManager: EncryptionManager) {
    this.core = core;
    this.encryptionManager = encryptionManager;
  }

  /**
   * Creates a new group chat
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

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      return {
        success: false,
        error: "Coppia di chiavi utente non disponibile",
      };
    }
    const creatorPub = currentUserPair.pub;

    // Generate a proper random symmetric key for the group (string, Gun-friendly)
    const cryptoApi: Crypto | undefined = (globalThis as any)?.crypto;
    if (!cryptoApi?.getRandomValues) {
      return {
        success: false,
        error: "Crypto API non disponibile per generare la chiave del gruppo.",
      };
    }
    const randomBytes = new Uint8Array(32);
    cryptoApi.getRandomValues(randomBytes);
    const groupKey = Array.from(randomBytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (!groupKey) {
      return {
        success: false,
        error: "Impossibile generare la chiave del gruppo.",
      };
    }

    const allMemberPubs = Array.from(new Set([creatorPub, ...memberPubs]));
    // Store members as a Gun-friendly map instead of a raw array
    const membersMap: { [pub: string]: boolean } = {};
    for (const pub of allMemberPubs) membersMap[pub] = true;
    const encryptedKeys: { [pub: string]: string } = {};
    const failedMembers: string[] = [];

    // Encrypt the group key for each member
    for (const memberPub of allMemberPubs) {
      try {
        const memberEpub =
          await this.encryptionManager.getRecipientEpub(memberPub);
        const sharedSecret = await this.core.db.sea.secret(
          memberEpub,
          currentUserPair
        );
        if (!sharedSecret) {
          throw new Error("Failed to generate shared secret");
        }
        const encryptedKey = await this.core.db.sea.encrypt(
          groupKey,
          sharedSecret
        );
        if (typeof encryptedKey === "string") {
          encryptedKeys[memberPub] = encryptedKey;
        } else {
          throw new Error("Encryption returned non-string value");
        }
      } catch (error) {
        console.error(
          `[GroupManager] ❌ Failed to encrypt key for ${memberPub}:`,
          error
        );
        failedMembers.push(memberPub);
      }
    }

    if (failedMembers.length > 0) {
      return {
        success: false,
        error: `Impossibile creare le chiavi di cifratura per i seguenti membri: ${failedMembers.join(", ")}. Creazione del gruppo annullata.`,
      };
    }

    const groupId = `group_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    const groupData: GroupData = {
      id: groupId,
      name: groupName,
      members: allMemberPubs,
      createdBy: creatorPub,
      createdAt: Date.now(),
      encryptedKeys: encryptedKeys,
    };

    // Save group data to GunDB (avoid arrays: store members as a map)
    const groupDataToStore: any = {
      id: groupId,
      name: groupName,
      // Store members as an object map for Gun compatibility
      members: membersMap,
      createdBy: creatorPub,
      createdAt: Date.now(),
      encryptedKeys: encryptedKeys,
    };

    await new Promise<void>((resolve, reject) => {
      this.core.db.gun.get(groupId).put(groupDataToStore, (ack: any) => {
        if (ack.err) {
          reject(new Error(`Error saving group data: ${ack.err}`));
        } else {
          resolve();
        }
      });
    });

    return { success: true, groupData };
  }

  /**
   * Sends a message to a group
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio.",
      };
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      return {
        success: false,
        error: "Coppia di chiavi utente non disponibile",
      };
    }
    const senderPub = currentUserPair.pub;

    const groupData = await this.getGroupData(groupId);
    if (!groupData) {
      return { success: false, error: "Gruppo non trovato." };
    }

    if (!groupData.members.includes(senderPub)) {
      return { success: false, error: "Non sei membro di questo gruppo." };
    }

    try {
      // Decrypt the group key
      const encryptedGroupKey = groupData.encryptedKeys[senderPub];
      if (!encryptedGroupKey) {
        return {
          success: false,
          error: "Impossibile trovare la chiave di gruppo per l'utente.",
        };
      }

      // We need to find the creator's epub to derive the secret to decrypt the key
      const creatorEpub = await this.encryptionManager.getRecipientEpub(
        groupData.createdBy
      );
      const sharedSecret = await this.core.db.sea.secret(
        creatorEpub,
        currentUserPair
      );
      if (!sharedSecret) {
        return {
          success: false,
          error: "Impossibile generare la chiave condivisa.",
        };
      }
      const groupKey = await this.core.db.sea.decrypt(
        encryptedGroupKey,
        sharedSecret
      );

      if (!groupKey) {
        return {
          success: false,
          error: "Impossibile decifrare la chiave del gruppo.",
        };
      }

      // Encrypt the message with the group key
      const encryptedContent = await this.core.db.sea.encrypt(
        messageContent,
        groupKey
      );

      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
      const message = {
        id: messageId,
        from: senderPub,
        content: encryptedContent,
        timestamp: Date.now(),
        groupId: groupId,
        signature: await this.core.db.sea.sign(
          encryptedContent,
          currentUserPair
        ),
      };

      // Send to the group's message node
      const messagePath = `group-messages/${groupId}`;
      this.core.db.gun
        .get(messagePath)
        .get(messageId)
        .put(JSON.stringify(message));

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
      const data = await new Promise<any | null>((resolve, reject) => {
        this.core.db.gun.get(groupId).once((data: any) => {
          if (data) {
            resolve(data);
          } else {
            resolve(null);
          }
        });
      });

      if (data) {
        // Normalize members: convert object map -> array if needed
        let normalizedMembers: string[] = [];
        if (Array.isArray(data.members)) {
          normalizedMembers = data.members as string[];
        } else if (data.members && typeof data.members === "object") {
          normalizedMembers = Object.keys(data.members).filter(
            (pub) => !!data.members[pub]
          );
        }

        const groupData: GroupData = {
          id: data.id,
          name: data.name,
          members: normalizedMembers,
          createdBy: data.createdBy,
          createdAt: data.createdAt,
          encryptedKeys: data.encryptedKeys || {},
        };
        return groupData;
      }
      return null;
    } catch (error) {
      console.error(
        `[GroupManager] ❌ Error getting group data for ${groupId}:`,
        error
      );
      return null;
    }
  }
}
