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

    // Normalize key strings to handle variations in pub formatting (e.g., with/without suffix)
    const normalize = (k?: string) =>
      typeof k === "string" ? k.split(".")[0] : "";
    const senderPubNorm = normalize(senderPub);
    let membersNorm = (groupData.members || []).map(normalize);
    const createdByNorm = normalize(groupData.createdBy);

    let encryptedKeyEntries = Object.entries(groupData.encryptedKeys || {});
    let hasKeyForSender = encryptedKeyEntries.some(
      ([k]) => normalize(k) === senderPubNorm || k === senderPub
    );

    // If key not yet visible (eventual consistency), retry briefly
    if (!hasKeyForSender) {
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const fresh = await this.getGroupData(groupId);
        if (!fresh) break;
        groupData = fresh;
        membersNorm = (groupData.members || []).map(normalize);
        encryptedKeyEntries = Object.entries(groupData.encryptedKeys || {});
        hasKeyForSender = encryptedKeyEntries.some(
          ([k]) => normalize(k) === senderPubNorm || k === senderPub
        );
        if (hasKeyForSender) break;
      }
    }

    const isMember =
      hasKeyForSender ||
      createdByNorm === senderPubNorm ||
      groupData.members.includes(senderPub) ||
      membersNorm.includes(senderPubNorm);

    if (!isMember) {
      return { success: false, error: "Non sei membro di questo gruppo." };
    }

    try {
      // Decrypt the group key
      let encryptedGroupKey: string | undefined =
        groupData.encryptedKeys[senderPub];
      if (!encryptedGroupKey) {
        // Fallback to normalized key match
        const found = encryptedKeyEntries.find(
          ([k]) => normalize(k) === senderPubNorm
        );
        if (found) encryptedGroupKey = found[1];
      }

      // If still not present (due to shallow reads), try direct path traversal using dotted pub
      if (!encryptedGroupKey) {
        try {
          const segments = senderPub.split(".");
          let node = this.core.db.gun.get(groupId).get("encryptedKeys");
          for (const seg of segments) {
            node = node.get(seg);
          }
          encryptedGroupKey = await new Promise<string | undefined>(
            (resolve) => {
              node.once((val: any) => {
                resolve(typeof val === "string" ? val : undefined);
              });
              setTimeout(() => resolve(undefined), 500);
            }
          );
        } catch {}
      }

      // Self-heal: if sender is the creator and own key is missing, try to recover group key
      if (!encryptedGroupKey && createdByNorm === senderPubNorm) {
        for (const [memberPub, encKey] of encryptedKeyEntries) {
          const memberPubNorm = normalize(memberPub);
          if (!encKey || memberPubNorm === senderPubNorm) continue;
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
            const creatorEpub =
              await this.encryptionManager.getRecipientEpub(senderPub);
            const sharedForSelf = await this.core.db.sea.secret(
              creatorEpub,
              currentUserPair
            );
            if (!sharedForSelf) break;
            const selfEncKey = await this.core.db.sea.encrypt(
              recoveredGroupKey,
              sharedForSelf
            );
            if (typeof selfEncKey === "string") {
              // Persist under encryptedKeys[senderPub]
              await new Promise<void>((resolve, reject) => {
                this.core.db.gun
                  .get(groupId)
                  .get("encryptedKeys")
                  .get(senderPub)
                  .put(selfEncKey, (ack: any) => {
                    if (ack && ack.err) reject(new Error(ack.err));
                    else resolve();
                  });
              });
              // Update local view and continue
              groupData.encryptedKeys[senderPub] = selfEncKey;
              encryptedGroupKey = selfEncKey;
            }
            break;
          } catch {}
        }
      }
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

      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
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
        // Helper to flatten nested objects into dot-joined keys
        const flatten = (
          obj: any,
          prefix = "",
          out: Record<string, any> = {}
        ) => {
          if (!obj || typeof obj !== "object") return out;
          for (const [k, v] of Object.entries(obj)) {
            if (k === "_" || k === "#") continue; // skip gun internals
            const fullKey = prefix ? `${prefix}.${k}` : k;
            if (v && typeof v === "object" && !Array.isArray(v)) {
              flatten(v, fullKey, out);
            } else {
              out[fullKey] = v;
            }
          }
          return out;
        };

        // Normalize members: handle array, flat map, or nested map with dots
        let normalizedMembers: string[] = [];
        if (Array.isArray(data.members)) {
          normalizedMembers = data.members as string[];
        } else if (data.members && typeof data.members === "object") {
          const flatMembers = flatten(data.members);
          normalizedMembers = Object.entries(flatMembers)
            .filter(([, val]) => !!val)
            .map(([key]) => key);
        }

        // Normalize encryptedKeys: handle nested maps where pub keys may be split by dots
        let normalizedEncryptedKeys: Record<string, string> = {};
        if (data.encryptedKeys && typeof data.encryptedKeys === "object") {
          const flatKeys = flatten(data.encryptedKeys);
          for (const [k, v] of Object.entries(flatKeys)) {
            if (typeof v === "string") {
              normalizedEncryptedKeys[k] = v;
            }
          }
        }

        const groupData: GroupData = {
          id: data.id,
          name: data.name,
          members: normalizedMembers,
          createdBy: data.createdBy,
          createdAt: data.createdAt,
          encryptedKeys: normalizedEncryptedKeys,
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
