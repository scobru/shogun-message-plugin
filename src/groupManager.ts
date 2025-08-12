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
    console.log(
      "[GroupManager] 📋 Creating group with members:",
      allMemberPubs
    );

    // Store members as a Gun-friendly map instead of a raw array
    const membersMap: { [pub: string]: boolean } = {};
    for (const pub of allMemberPubs) {
      membersMap[pub] = true;
      console.log(`[GroupManager] ✅ Added member to map: ${pub}`);
    }
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

    const groupId = `group_${Date.now()}_${Array.from(
      new Uint8Array(8).map((_, i) => i)
    )
      .map(() => {
        const a = new Uint8Array(1);
        (globalThis as any)?.crypto?.getRandomValues?.(a);
        return a[0].toString(16).padStart(2, "0");
      })
      .join("")}`;
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

    // Ensure members and encryptedKeys are materialized under their own nodes
    // to avoid eventual-consistency gaps right after group creation
    try {
      // Materialize members map entries
      const memberWrites = Object.keys(membersMap).map(
        (pub) =>
          new Promise<void>((resolve, reject) => {
            this.core.db.gun
              .get(groupId)
              .get("members")
              .get(pub)
              .put(true, (ack: any) => {
                if (ack && ack.err) reject(new Error(ack.err));
                else resolve();
              });
          })
      );

      // Materialize encryptedKeys entries per member
      const keyWrites = Object.entries(encryptedKeys).map(
        ([pub, enc]) =>
          new Promise<void>((resolve, reject) => {
            this.core.db.gun
              .get(groupId)
              .get("encryptedKeys")
              .get(pub)
              .put(enc, (ack: any) => {
                if (ack && ack.err) reject(new Error(ack.err));
                else resolve();
              });
          })
      );

      await Promise.all([...memberWrites, ...keyWrites]);
    } catch (e) {
      // TODO: Consider surfacing a warning to the caller if needed.
      console.warn(
        "[GroupManager] ⚠️ Non-critical warning: some group fields may not be fully materialized yet",
        e
      );
    }

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

    let groupData = await this.getGroupData(groupId);
    if (!groupData) {
      return { success: false, error: "Gruppo non trovato." };
    }

    // **FIX: Improved membership verification**
    const isMember = await this.verifyGroupMembership(groupData, senderPub);
    if (!isMember) {
      return { success: false, error: "Non sei membro di questo gruppo." };
    }

    try {
      // **FIX: Improved group key retrieval**
      const groupKey = await this.getGroupKeyForUser(
        groupData,
        senderPub,
        currentUserPair
      );
      if (!groupKey) {
        return {
          success: false,
          error: "Impossibile ottenere la chiave del gruppo per l'utente.",
        };
      }

      // **FIX: Sign the plaintext content BEFORE encryption**
      const signature = await this.core.db.sea.sign(
        messageContent,
        currentUserPair
      );

      // Encrypt the message with the group key
      const encryptedContent = await this.core.db.sea.encrypt(
        messageContent,
        groupKey
      );

      const messageId = `msg_${Date.now()}_${Array.from(
        new Uint8Array(8).map((_, i) => i)
      )
        .map(() => {
          const a = new Uint8Array(1);
          (globalThis as any)?.crypto?.getRandomValues?.(a);
          return a[0].toString(16).padStart(2, "0");
        })
        .join("")}`;
      const message = {
        id: messageId,
        from: senderPub,
        content: encryptedContent,
        timestamp: Date.now(),
        groupId: groupId,
        signature: signature, // Use signature of plaintext
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
        console.log(`[GroupManager] 🔍 Raw group data for ${groupId}:`, data);

        let normalizedMembers: string[] = [];
        // Explicitly fetch members by mapping over the 'members' node
        const membersNode = this.core.db.gun.get(groupId).get("members");
        await new Promise<void>((resolve) => {
          let collectedMembers: string[] = [];
          membersNode.map().once((value: any, key: string) => {
            if (value === true) {
              // Assuming members are stored as { pubkey: true }
              collectedMembers.push(key);
            }
          });
          // Add a timeout to ensure collection even if map is slow or empty
          setTimeout(() => {
            normalizedMembers = Array.from(new Set(collectedMembers)); // Remove duplicates
            resolve();
          }, 1000); // Wait up to 1 second for members to be collected
        });
        console.log(
          "[GroupManager] 📋 Members from Gun.map():",
          normalizedMembers
        );

        let normalizedEncryptedKeys: Record<string, string> = {};
        // Explicitly fetch encrypted keys by mapping over the 'encryptedKeys' node
        const encryptedKeysNode = this.core.db.gun
          .get(groupId)
          .get("encryptedKeys");
        await new Promise<void>((resolve) => {
          let collectedKeys: Record<string, string> = {};
          encryptedKeysNode.map().once((value: any, key: string) => {
            if (typeof value === "string") {
              collectedKeys[key] = value;
            }
          });
          // Add a timeout to ensure collection
          setTimeout(() => {
            normalizedEncryptedKeys = collectedKeys;
            resolve();
          }, 1000); // Wait up to 1 second for keys to be collected
        });
        console.log(
          "[GroupManager] 📋 Encrypted keys from Gun.map():",
          Object.keys(normalizedEncryptedKeys)
        );

        const groupData: GroupData = {
          id: data.id,
          name: data.name,
          members: normalizedMembers, // Use the explicitly fetched members
          createdBy: data.createdBy,
          createdAt: data.createdAt,
          encryptedKeys: normalizedEncryptedKeys, // Use the explicitly fetched keys
        };
        console.log(`[GroupManager] ✅ Normalized group data for ${groupId}:`, {
          id: groupData.id,
          name: groupData.name,
          memberCount: groupData.members.length,
          members: groupData.members,
          encryptedKeyCount: Object.keys(groupData.encryptedKeys).length,
          encryptedKeys: Object.keys(groupData.encryptedKeys),
        });
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

  /**
   * **NEW: Improved group membership verification**
   */
  private async verifyGroupMembership(
    groupData: GroupData,
    userPub: string
  ): Promise<boolean> {
    const normalize = (k?: string) =>
      typeof k === "string" ? k.split(".")[0] : "";
    const userPubNorm = normalize(userPub);
    const createdByNorm = normalize(groupData.createdBy);

    // Check if user is the creator
    if (createdByNorm === userPubNorm || groupData.createdBy === userPub) {
      return true;
    }

    // Check if user has an encrypted key (authoritative membership check)
    const encryptedKeys = groupData.encryptedKeys || {};
    const hasEncryptedKey = Object.keys(encryptedKeys).some((k) => {
      const kn = normalize(k);
      return kn === userPubNorm || k === userPub;
    });
    if (hasEncryptedKey) {
      return true;
    }

    // Check members array as fallback
    const members = Array.isArray(groupData.members) ? groupData.members : [];
    return members.some((member) => {
      const memberNorm = normalize(member);
      return memberNorm === userPubNorm || member === userPub;
    });
  }

  /**
   * **NEW: Improved group key retrieval with retries and fallbacks**
   */
  public async getGroupKeyForUser(
    groupData: GroupData,
    userPub: string,
    currentUserPair: any
  ): Promise<string | undefined> {
    const normalize = (k?: string) =>
      typeof k === "string" ? k.split(".")[0] : "";
    const userPubNorm = normalize(userPub);
    const createdByNorm = normalize(groupData.createdBy);

    console.log(
      `[GroupManager] 🔑 Getting group key for user ${userPub} (normalized: ${userPubNorm})`
    );
    console.log(
      `[GroupManager] 📋 Available encrypted keys:`,
      Object.keys(groupData.encryptedKeys || {})
    );

    // Try to get encrypted key for user
    let encryptedGroupKey: string | undefined =
      groupData.encryptedKeys[userPub];
    if (!encryptedGroupKey) {
      // Fallback to normalized key match
      const encryptedKeyEntries = Object.entries(groupData.encryptedKeys || {});
      const found = encryptedKeyEntries.find(
        ([k]) => normalize(k) === userPubNorm
      );
      if (found) encryptedGroupKey = found[1];
    }

    // If still not present, try direct path traversal
    if (!encryptedGroupKey) {
      try {
        const segments = userPub.split(".");
        let node = this.core.db.gun.get(groupData.id).get("encryptedKeys");
        for (const seg of segments) {
          node = node.get(seg);
        }
        encryptedGroupKey = await new Promise<string | undefined>((resolve) => {
          node.once((val: any) => {
            resolve(typeof val === "string" ? val : undefined);
          });
          setTimeout(() => resolve(undefined), 1000);
        });
      } catch {}
    }

    // Self-heal: if user is creator and own key is missing, try to recover
    if (!encryptedGroupKey && createdByNorm === userPubNorm) {
      console.log(
        "[GroupManager] ⚠️ Creator's key missing, attempting recovery..."
      );
      encryptedGroupKey = await this.recoverCreatorGroupKey(
        groupData,
        currentUserPair
      );
      if (encryptedGroupKey) {
        console.log("[GroupManager] ✅ Creator's key recovered.");
        // Attempt to persist the recovered key back to GunDB for future use
        try {
          await new Promise<void>((resolve, reject) => {
            this.core.db.gun
              .get(groupData.id)
              .get("encryptedKeys")
              .get(userPub)
              .put(encryptedGroupKey, (ack: any) => {
                if (ack.err) reject(new Error(ack.err));
                else resolve();
              });
          });
          console.log(
            "[GroupManager] 💾 Recovered creator key persisted to GunDB."
          );
        } catch (e) {
          console.warn(
            "[GroupManager] ⚠️ Failed to persist recovered creator key:",
            e
          );
        }
      }
    }

    if (!encryptedGroupKey) {
      return undefined;
    }

    // Decrypt the group key
    const creatorEpub = await this.encryptionManager.getRecipientEpub(
      groupData.createdBy
    );
    const sharedSecret = await this.core.db.sea.secret(
      creatorEpub,
      currentUserPair
    );
    if (!sharedSecret) {
      return undefined;
    }

    const groupKey = await this.core.db.sea.decrypt(
      encryptedGroupKey,
      sharedSecret
    );

    return groupKey || undefined;
  }

  /**
   * **NEW: Recover group key for creator if missing**
   */
  private async recoverCreatorGroupKey(
    groupData: GroupData,
    currentUserPair: any
  ): Promise<string | undefined> {
    const normalize = (k?: string) =>
      typeof k === "string" ? k.split(".")[0] : "";
    const creatorPubNorm = normalize(groupData.createdBy);

    // Try to recover from other members' encrypted keys
    for (const [memberPub, encKey] of Object.entries(
      groupData.encryptedKeys || {}
    )) {
      const memberPubNorm = normalize(memberPub);
      if (!encKey || memberPubNorm === creatorPubNorm) continue;

      try {
        // Derive shared secret with this member to decrypt the group key
        const memberEpub =
          await this.encryptionManager.getRecipientEpub(memberPub);
        const sharedWithMember = await this.core.db.sea.secret(
          memberEpub,
          currentUserPair
        );
        if (!sharedWithMember) continue;

        const recoveredGroupKey = await this.core.db.sea.decrypt(
          encKey,
          sharedWithMember
        );
        if (!recoveredGroupKey) continue;

        // Re-encrypt group key for the creator and persist
        const creatorEpub = await this.encryptionManager.getRecipientEpub(
          groupData.createdBy
        );
        const sharedForSelf = await this.core.db.sea.secret(
          creatorEpub,
          currentUserPair
        );
        if (!sharedForSelf) continue;

        const selfEncKey = await this.core.db.sea.encrypt(
          recoveredGroupKey,
          sharedForSelf
        );
        if (typeof selfEncKey === "string") {
          // Persist under encryptedKeys[creatorPub]
          await new Promise<void>((resolve, reject) => {
            this.core.db.gun
              .get(groupData.id)
              .get("encryptedKeys")
              .get(groupData.createdBy)
              .put(selfEncKey, (ack: any) => {
                if (ack && ack.err) reject(new Error(ack.err));
                else resolve();
              });
          });
          return selfEncKey;
        }
      } catch {}
    }
    return undefined;
  }
}
