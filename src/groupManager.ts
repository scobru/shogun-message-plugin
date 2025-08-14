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
   * Initialize the group manager and load group memberships from persistence
   */
  public async initialize(): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.log(
        "🔍 GroupManager: User not logged in, skipping initialization",
      );
      return;
    }

    try {
      console.log(
        "🔍 GroupManager: Initializing and loading group memberships",
      );
      await this._loadGroupMembershipsFromPersistence();
    } catch (error) {
      console.error("🔍 GroupManager: Error during initialization:", error);
    }
  }

  /**
   * Load group memberships from user profile persistence
   */
  private async _loadGroupMembershipsFromPersistence(): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return;
    }

    try {
      console.log(
        "🔍 _loadGroupMembershipsFromPersistence: Loading group memberships",
      );

      // Get user's groups from their profile
      const userGroups = await this.core.db.getUserData("groups");
      if (!userGroups) {
        console.log(
          "🔍 _loadGroupMembershipsFromPersistence: No group memberships found",
        );
        return;
      }

      console.log(
        "🔍 _loadGroupMembershipsFromPersistence: Found group memberships:",
        userGroups,
      );

      // Load each group membership
      for (const [groupId, groupMembership] of Object.entries(userGroups)) {
        if (
          groupMembership &&
          typeof groupMembership === "object" &&
          "type" in groupMembership
        ) {
          const membership = groupMembership as any;
          if (membership.type === "group" && membership.id && membership.name) {
            console.log(
              "🔍 _loadGroupMembershipsFromPersistence: Loading group:",
              {
                groupId: membership.id,
                groupName: membership.name,
                joinedAt: membership.joinedAt,
              },
            );

            // Verify the group still exists by trying to get its data
            const groupData = await this.getGroupData(membership.id);
            if (groupData) {
              console.log(
                "🔍 _loadGroupMembershipsFromPersistence: Successfully loaded group:",
                membership.id,
              );
              // The group listener will be activated by MessagingPlugin._activateExistingListeners
            } else {
              console.warn(
                "🔍 _loadGroupMembershipsFromPersistence: Group data not found for:",
                membership.id,
              );
            }
          }
        }
      }

      console.log(
        "🔍 _loadGroupMembershipsFromPersistence: Loaded group memberships",
      );
    } catch (error) {
      console.error(
        "🔍 _loadGroupMembershipsFromPersistence: Error loading group memberships:",
        error,
      );
    }
  }

  /**
   * Creates a new group chat
   */
  public async createGroup(
    groupName: string,
    memberPubs: string[],
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

    // **FIX: Add creator to members if not already included**
    const allMembers = memberPubs.includes(creatorPub)
      ? memberPubs
      : [creatorPub, ...memberPubs];

    try {
      // Generate group key using crypto API
      if (!(globalThis as any)?.crypto?.getRandomValues) {
        return {
          success: false,
          error:
            "Crypto API non disponibile per generare la chiave del gruppo.",
        };
      }

      const groupKey = Array.from(new Uint8Array(32).map((_, i) => i))
        .map(() => {
          const a = new Uint8Array(1);
          (globalThis as any)?.crypto?.getRandomValues?.(a);
          return a[0].toString(16).padStart(2, "0");
        })
        .join("");

      if (!groupKey) {
        return {
          success: false,
          error: "Impossibile generare la chiave del gruppo.",
        };
      }

      // Encrypt group key for each member
      const encryptedKeys: { [memberPub: string]: string } = {};
      const failedMembers: string[] = [];

      for (const memberPub of allMembers) {
        try {
          const memberEpub =
            await this.encryptionManager.getRecipientEpub(memberPub);
          const sharedSecret = await this.core.db.sea.secret(
            memberEpub,
            currentUserPair,
          );
          const encryptedKey = await this.core.db.sea.encrypt(
            groupKey,
            sharedSecret,
          );

          if (typeof encryptedKey !== "string") {
            throw new Error("Encryption returned non-string value");
          }

          encryptedKeys[memberPub] = encryptedKey;
        } catch (error) {
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
        new Uint8Array(8).map((_, i) => i),
      )
        .map(() => {
          const a = new Uint8Array(1);
          (globalThis as any)?.crypto?.getRandomValues?.(a);
          return a[0].toString(16).padStart(2, "0");
        })
        .join("")}`;

      // **FIX: Create GunDB-compatible data structure**
      // Save basic group info first
      const basicGroupData = {
        id: groupId,
        name: groupName,
        createdBy: creatorPub,
        createdAt: Date.now(),
      };

      // Save members separately as an object for GunDB compatibility
      const membersData: { [key: string]: boolean } = {};
      allMembers.forEach((member) => {
        membersData[member] = true;
      });

      // Save encrypted keys separately
      const keysData = encryptedKeys;

      const groupData: GroupData = {
        id: groupId,
        name: groupName,
        members: allMembers, // Keep as array for compatibility
        createdBy: creatorPub,
        createdAt: Date.now(),
        encryptedKeys,
      };

      // Log the data structure for debugging
      console.log("🔍 createGroup: Group data structure:", {
        id: groupData.id,
        name: groupData.name,
        membersCount: groupData.members.length,
        createdBy: groupData.createdBy,
        createdAt: groupData.createdAt,
        encryptedKeysCount: Object.keys(groupData.encryptedKeys).length,
      });

      // Save group data to GunDB using a simpler structure
      await new Promise<void>((resolve, reject) => {
        const groupNode = this.core.db.gun.get(groupId);

        // Save basic info
        groupNode.put(basicGroupData, (ack1: any) => {
          if (ack1 && ack1.err) {
            console.error("🔍 createGroup: Error saving basic data:", ack1);
            reject(new Error(`Error saving basic group data: ${ack1.err}`));
            return;
          }

          // Save members
          groupNode.get("members").put(membersData, (ack2: any) => {
            if (ack2 && ack2.err) {
              console.error("🔍 createGroup: Error saving members:", ack2);
              reject(new Error(`Error saving group members: ${ack2.err}`));
              return;
            }

            // Save encrypted keys
            groupNode.get("encryptedKeys").put(keysData, (ack3: any) => {
              if (ack3 && ack3.err) {
                console.error(
                  "🔍 createGroup: Error saving encrypted keys:",
                  ack3,
                );
                reject(new Error(`Error saving encrypted keys: ${ack3.err}`));
              } else {
                console.log("🔍 createGroup: Group data saved successfully");
                resolve();
              }
            });
          });
        });
      });

      // **FIX: Note: Listener activation will be handled by MessagingPlugin**
      // The MessagingPlugin will automatically activate listeners for new groups
      // through its _activateExistingListeners method

      // **FIX: Save group membership to user profile for persistence**
      await this._saveGroupMembership(groupId, groupName);

      return { success: true, groupData };
    } catch (error: any) {
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante la creazione del gruppo",
      };
    }
  }

  /**
   * Save group membership to user profile for persistence
   */
  private async _saveGroupMembership(
    groupId: string,
    groupName: string,
  ): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return;
    }

    try {
      const groupMembership = {
        type: "group",
        id: groupId,
        name: groupName,
        joinedAt: Date.now(),
      };

      console.log("🔍 _saveGroupMembership: Saving group membership:", {
        groupId,
        groupName,
      });

      await this.core.db.putUserData(`groups/${groupId}`, groupMembership);
      console.log(
        "🔍 _saveGroupMembership: Group membership saved successfully",
      );
    } catch (error) {
      console.error(
        "🔍 _saveGroupMembership: Error saving group membership:",
        error,
      );
    }
  }

  /**
   * Sends a message to a group
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string,
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    console.log(
      "🔍 GroupManager.sendGroupMessage: Starting for group",
      groupId,
    );

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.log("🔍 GroupManager.sendGroupMessage: User not logged in");
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio.",
      };
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.log("🔍 GroupManager.sendGroupMessage: No user pair available");
      return {
        success: false,
        error: "Coppia di chiavi utente non disponibile",
      };
    }
    const senderPub = currentUserPair.pub;
    console.log("🔍 GroupManager.sendGroupMessage: Sender pub", senderPub);

    let groupData = await this.getGroupData(groupId);
    if (!groupData) {
      console.log(
        "🔍 GroupManager.sendGroupMessage: Group data not found for",
        groupId,
      );
      return { success: false, error: "Gruppo non trovato." };
    }

    console.log("🔍 GroupManager.sendGroupMessage: Group data found:", {
      id: groupData.id,
      name: groupData.name,
      membersCount: groupData.members.length,
      encryptedKeysCount: Object.keys(groupData.encryptedKeys).length,
    });

    // **FIX: Improved membership verification**
    console.log(
      "🔍 GroupManager.sendGroupMessage: Verifying membership for",
      senderPub,
    );
    const isMember = await this.verifyGroupMembership(groupData, senderPub);
    console.log("🔍 GroupManager.sendGroupMessage: Is member:", isMember);
    if (!isMember) {
      console.log(
        "🔍 GroupManager.sendGroupMessage: User is not a member of the group",
      );
      return { success: false, error: "Non sei membro di questo gruppo." };
    }

    try {
      // **FIX: Improved group key retrieval**
      console.log(
        "🔍 GroupManager.sendGroupMessage: Getting group key for user",
      );
      const groupKey = await this.getGroupKeyForUser(
        groupData,
        senderPub,
        currentUserPair,
      );
      console.log(
        "🔍 GroupManager.sendGroupMessage: Group key obtained:",
        !!groupKey,
      );
      if (!groupKey) {
        console.log(
          "🔍 GroupManager.sendGroupMessage: Failed to get group key",
        );
        return {
          success: false,
          error: "Impossibile ottenere la chiave del gruppo per l'utente.",
        };
      }

      // **FIX: Sign the plaintext content BEFORE encryption**
      const signature = await this.core.db.sea.sign(
        messageContent,
        currentUserPair,
      );

      // Encrypt the message with the group key
      const encryptedContent = await this.core.db.sea.encrypt(
        messageContent,
        groupKey,
      );

      const messageId = `msg_${Date.now()}_${Array.from(
        new Uint8Array(8).map((_, i) => i),
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
      console.log(
        "🔍 GroupManager.sendGroupMessage: Sending to path",
        messagePath,
      );
      console.log("🔍 GroupManager.sendGroupMessage: Message ID", messageId);

      this.core.db.gun
        .get(messagePath)
        .get(messageId)
        .put(JSON.stringify(message));

      console.log(
        "🔍 GroupManager.sendGroupMessage: Message sent successfully",
      );
      return { success: true, messageId };
    } catch (error: any) {
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
        const groupData: GroupData = {
          id: data.id,
          name: data.name,
          members: normalizedMembers, // Use the explicitly fetched members
          createdBy: data.createdBy,
          createdAt: data.createdAt,
          encryptedKeys: normalizedEncryptedKeys, // Use the explicitly fetched keys
        };
        return groupData;
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * **NEW: Improved group membership verification**
   */
  private async verifyGroupMembership(
    groupData: GroupData,
    userPub: string,
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
    currentUserPair: any,
  ): Promise<string | undefined> {
    const normalize = (k?: string) =>
      typeof k === "string" ? k.split(".")[0] : "";
    const userPubNorm = normalize(userPub);
    const createdByNorm = normalize(groupData.createdBy);

    // Try to get encrypted key for user
    let encryptedGroupKey: string | undefined =
      groupData.encryptedKeys[userPub];
    if (!encryptedGroupKey) {
      // Fallback to normalized key match
      const encryptedKeyEntries = Object.entries(groupData.encryptedKeys || {});
      const found = encryptedKeyEntries.find(
        ([k]) => normalize(k) === userPubNorm,
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
      encryptedGroupKey = await this.recoverCreatorGroupKey(
        groupData,
        currentUserPair,
      );
      if (encryptedGroupKey) {
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
        } catch (e) {
          // Silent error handling
        }
      }
    }

    if (!encryptedGroupKey) {
      return undefined;
    }

    // Decrypt the group key
    const creatorEpub = await this.encryptionManager.getRecipientEpub(
      groupData.createdBy,
    );
    const sharedSecret = await this.core.db.sea.secret(
      creatorEpub,
      currentUserPair,
    );
    if (!sharedSecret) {
      return undefined;
    }

    const groupKey = await this.core.db.sea.decrypt(
      encryptedGroupKey,
      sharedSecret,
    );

    return groupKey || undefined;
  }

  /**
   * **NEW: Recover group key for creator if missing**
   */
  private async recoverCreatorGroupKey(
    groupData: GroupData,
    currentUserPair: any,
  ): Promise<string | undefined> {
    const normalize = (k?: string) =>
      typeof k === "string" ? k.split(".")[0] : "";
    const creatorPubNorm = normalize(groupData.createdBy);

    // Try to recover from other members' encrypted keys
    for (const [memberPub, encKey] of Object.entries(
      groupData.encryptedKeys || {},
    )) {
      const memberPubNorm = normalize(memberPub);
      if (!encKey || memberPubNorm === creatorPubNorm) continue;

      try {
        // Derive shared secret with this member to decrypt the group key
        const memberEpub =
          await this.encryptionManager.getRecipientEpub(memberPub);
        const sharedWithMember = await this.core.db.sea.secret(
          memberEpub,
          currentUserPair,
        );
        if (!sharedWithMember) continue;

        const recoveredGroupKey = await this.core.db.sea.decrypt(
          encKey,
          sharedWithMember,
        );
        if (!recoveredGroupKey) continue;

        // Re-encrypt group key for the creator and persist
        const creatorEpub = await this.encryptionManager.getRecipientEpub(
          groupData.createdBy,
        );
        const sharedForSelf = await this.core.db.sea.secret(
          creatorEpub,
          currentUserPair,
        );
        if (!sharedForSelf) continue;

        const selfEncKey = await this.core.db.sea.encrypt(
          recoveredGroupKey,
          sharedForSelf,
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
