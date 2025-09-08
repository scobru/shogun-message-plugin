import { ShogunCore } from "shogun-core";
import { EncryptionManager } from "./encryption";
import { GroupData } from "./types";
import { MessagingSchema } from "./schema";


/**
 * Group chat management for the messaging plugin
 */
export class GroupManager {
  private core: ShogunCore;
  private encryptionManager: EncryptionManager;
  
  // **NEW: Performance metrics tracking**
  private performanceMetrics = {
    messagesSent: 0,
    averageResponseTime: 0,
    totalResponseTime: 0,
    responseCount: 0,
  };

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
        "🔍 GroupManager: User not logged in, skipping initialization"
      );
      return;
    }

    try {
      console.log(
        "🔍 GroupManager: Initializing and loading group memberships"
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
        "🔍 _loadGroupMembershipsFromPersistence: Loading group memberships"
      );

      // Get user's groups from their profile
      const userGroups = await this.core.db.getUserData("groups");
      if (!userGroups) {
        console.log(
          "🔍 _loadGroupMembershipsFromPersistence: No group memberships found"
        );
        return;
      }

      console.log(
        "🔍 _loadGroupMembershipsFromPersistence: Found group memberships:",
        userGroups
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
              }
            );

            // Verify the group still exists by trying to get its data
            const groupData = await this.getGroupData(membership.id);
            if (groupData) {
              console.log(
                "🔍 _loadGroupMembershipsFromPersistence: Successfully loaded group:",
                membership.id
              );
              // The group listener will be activated by MessagingPlugin._activateExistingListeners
            } else {
              console.warn(
                "🔍 _loadGroupMembershipsFromPersistence: Group data not found for:",
                membership.id
              );
            }
          }
        }
      }

      console.log(
        "🔍 _loadGroupMembershipsFromPersistence: Loaded group memberships"
      );
    } catch (error) {
      console.error(
        "🔍 _loadGroupMembershipsFromPersistence: Error loading group memberships:",
        error
      );
    }
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
        error: "You must be logged in to create a group.",
      };
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      return {
        success: false,
        error: "User key pair not available",
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
            "Crypto API not available to generate the group key.",
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
          error: "Unable to generate group key.",
        };
      }

      // Encrypt group key for each member
      const encryptedKeys: { [memberPub: string]: string } = {};
      const failedMembers: string[] = [];

      console.log(
        "🔍 createGroup: Starting encryption for members:",
        allMembers
      );

      for (const memberPub of allMembers) {
        try {
          console.log(`🔍 createGroup: Encrypting for member: ${memberPub}`);

          // **FIX: Add timeout to encryption operations**
          const encryptionTimeout = new Promise<void>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Encryption timeout for member ${memberPub}`));
            }, 2000); // 5 second timeout per member
          });

          const encryptionPromise = (async () => {
            const memberEpub =
              await this.encryptionManager.getRecipientEpub(memberPub);
            console.log(`🔍 createGroup: Got epub for ${memberPub}`);

            const sharedSecret = await this.core.db.sea.secret(
              memberEpub,
              currentUserPair
            );
            console.log(`🔍 createGroup: Got shared secret for ${memberPub}`);

            if (!sharedSecret) {
              throw new Error(`No shared secret available for ${memberPub}`);
            }

            const encryptedKey = await this.core.db.sea.encrypt(
              groupKey,
              sharedSecret
            );
            console.log(`🔍 createGroup: Encrypted key for ${memberPub}`);

            if (typeof encryptedKey !== "string") {
              throw new Error("Encryption returned non-string value");
            }

            encryptedKeys[memberPub] = encryptedKey;
          })();

          await Promise.race([encryptionPromise, encryptionTimeout]);
        } catch (error) {
          console.error(
            `🔍 createGroup: Failed to encrypt for ${memberPub}:`,
            error
          );
          failedMembers.push(memberPub);
        }
      }

      console.log(
        "🔍 createGroup: Encryption completed, failed members:",
        failedMembers
      );

      if (failedMembers.length > 0) {
        return {
          success: false,
          error: `Unable to create encryption keys for the following members: ${failedMembers.join(", ")}. Group creation cancelled.`,
        };
      }

      // **IMPROVED: Use schema utility for group ID generation**
      const groupId = MessagingSchema.utils.generateGroupId();

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
        admins: [creatorPub], // Creator is admin by default
        createdBy: creatorPub,
        createdAt: Date.now(),
        lastActivity: Date.now(),
        encryptedKeys,
      };

      // Sign the encryptedKeys map for integrity (by creator)
      try {
        const keysPayload = JSON.stringify(encryptedKeys, Object.keys(encryptedKeys).sort());
        const keysSignature = await this.core.db.sea.sign(keysPayload, currentUserPair);
        if (typeof keysSignature === "string") {
          (groupData as any).keysSignature = keysSignature;
        }
      } catch (_) {}

      // Log the data structure for debugging
      console.log("🔍 createGroup: Group data structure:", {
        id: groupData.id,
        name: groupData.name,
        membersCount: groupData.members.length,
        createdBy: groupData.createdBy,
        createdAt: groupData.createdAt,
        encryptedKeysCount: Object.keys(groupData.encryptedKeys || {}).length,
      });

      // Save group data to GunDB using a simpler structure
      await new Promise<void>((resolve, reject) => {
        const groupNode = this.core.db.gun.get(groupId);

        // **FIX: Add timeout to prevent hanging**
        const timeout = setTimeout(() => {
          console.error("🔍 createGroup: Timeout saving group data to GunDB");
          reject(new Error("Timeout saving group data to GunDB"));
        }, 10000); // 10 second timeout

        // Save basic info
        groupNode.put(basicGroupData, (ack1: any) => {
          if (ack1 && ack1.err) {
            clearTimeout(timeout);
            console.error("🔍 createGroup: Error saving basic data:", ack1);
            reject(new Error(`Error saving basic group data: ${ack1.err}`));
            return;
          }

          // Save members
          groupNode.get("members").put(membersData, (ack2: any) => {
            if (ack2 && ack2.err) {
              clearTimeout(timeout);
              console.error("🔍 createGroup: Error saving members:", ack2);
              reject(new Error(`Error saving group members: ${ack2.err}`));
              return;
            }

            // Save encrypted keys
            groupNode.get("encryptedKeys").put(keysData, (ack3: any) => {
              clearTimeout(timeout);
              if (ack3 && ack3.err) {
                console.error(
                  "🔍 createGroup: Error saving encrypted keys:",
                  ack3
                );
                reject(new Error(`Error saving encrypted keys: ${ack3.err}`));
              } else {
                // Save keys signature if present
                const sig = (groupData as any).keysSignature;
                if (sig) {
                  groupNode.get("keysSignature").put(sig, (ack4: any) => {
                    if (ack4 && ack4.err) {
                      console.error("🔍 createGroup: Error saving keysSignature:", ack4);
                      reject(new Error(`Error saving keys signature: ${ack4.err}`));
                    } else {
                      console.log("🔍 createGroup: Group data saved successfully");
                      resolve();
                    }
                  });
                } else {
                  console.log("🔍 createGroup: Group data saved successfully");
                  resolve();
                }
              }
            });
          });
        });
      });

      // **FIX: Note: Listener activation will be handled by MessagingPlugin**
      // The MessagingPlugin will automatically activate listeners for new groups
      // through its _activateExistingListeners method

      // **FIX: Save group membership to user profile for persistence**
      console.log("🔍 createGroup: About to save group membership...");
      await this._saveGroupMembership(groupId, groupName);
      console.log("🔍 createGroup: Group membership saved, returning success");

      return { success: true, groupData };
    } catch (error: any) {
      return {
        success: false,
        error:
          error.message || "Unknown error during group creation",
      };
    }
  }

  /**
   * Save group membership to user profile for persistence
   */
  private async _saveGroupMembership(
    groupId: string,
    groupName: string
  ): Promise<void> {
    console.log("🔍 _saveGroupMembership: Starting...");

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.log(
        "🔍 _saveGroupMembership: User not logged in or no user data"
      );
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

      console.log("🔍 _saveGroupMembership: Calling putUserData...");

      // **FIX: Add timeout to putUserData to prevent hanging**
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error("Timeout saving group membership to user data"));
        }, 5000); // 5 second timeout
      });

      await Promise.race([
        this.core.db.putUserData(`groups/${groupId}`, groupMembership),
        timeoutPromise,
      ]);

      console.log(
        "🔍 _saveGroupMembership: Group membership saved successfully"
      );
    } catch (error) {
      console.error(
        "🔍 _saveGroupMembership: Error saving group membership:",
        error
      );
    }
  }

  /**
   * **SIGNAL APPROACH: Get group messages from localStorage only**
   */
  public async getGroupMessages(
    groupId: string,
    options: {
      limit?: number;
      before?: string;
      after?: string;
    } = {}
  ): Promise<any[]> {
    try {
      console.log(
        "🔍 GroupManager.getGroupMessages: Starting for group",
        groupId
      );

      // **SIGNAL APPROACH: Load messages from localStorage only**
      const messages = await this._loadGroupMessagesFromLocalStorage(groupId);

      console.log(
        "🔍 GroupManager.getGroupMessages: Loaded messages:",
        messages.length
      );
      return messages;
    } catch (error) {
      console.error("🔍 GroupManager.getGroupMessages: Error:", error);
      return [];
    }
  }

  /**
   * **SIGNAL APPROACH: Load group messages from localStorage**
   */
  private async _loadGroupMessagesFromLocalStorage(
    groupId: string
  ): Promise<any[]> {
    try {
      // **IMPROVED: Use schema for localStorage key**
      if (typeof window === "undefined" || !window.localStorage) {
        return [];
      }
      const localStorageKey = MessagingSchema.groups.localStorage(groupId);
      const storedMessages = window.localStorage.getItem(localStorageKey);

      if (storedMessages) {
        const messages = JSON.parse(storedMessages);
        console.log(
          "📱 Group: Loaded messages from localStorage:",
          messages.length
        );
        return messages;
      }

      console.log("📱 Group: No messages in localStorage for group:", groupId);
      return [];
    } catch (error) {
      console.warn("⚠️ Group: Error loading from localStorage:", error);
      return [];
    }
  }

  /**
   * **SIGNAL APPROACH: Save group message to localStorage**
   */
  private async _saveGroupMessageToLocalStorage(
    groupId: string,
    message: any
  ): Promise<void> {
    try {
      // **IMPROVED: Use schema for localStorage key**
      if (typeof window === "undefined" || !window.localStorage) {
        return;
      }
      const localStorageKey = MessagingSchema.groups.localStorage(groupId);
      const existingMessages = JSON.parse(
        window.localStorage.getItem(localStorageKey) || "[]"
      );

      // Add new message
      const updatedMessages = [...existingMessages, message];

      // Keep only last 1000 messages to prevent localStorage overflow
      const trimmedMessages = updatedMessages.slice(-1000);

      window.localStorage.setItem(localStorageKey, JSON.stringify(trimmedMessages));
      console.log(
        "📱 Group: Saved message to localStorage for group:",
        groupId
      );
    } catch (error) {
      console.warn("⚠️ Group: Error saving to localStorage:", error);
    }
  }

  /**
   * **SIGNAL APPROACH: Add group message listener for real-time messages**
   */
  public async addGroupMessageListener(
    groupId: string,
    callback: (message: any) => void
  ): Promise<void> {
    try {
      console.log(
        "🔍 GroupManager.addGroupMessageListener: Adding listener for group",
        groupId
      );

      // **IMPROVED: Use schema for group messages path**
      const messagesPath = MessagingSchema.groups.messages(groupId);
      const groupMessagesNode = this.core.db.gun.get(messagesPath).map();

      // Set up listener with NEW message filtering
      const handler = groupMessagesNode.on(
        async (messageData: any, messageId: string) => {
          console.log("🔍 GroupManager: Message received", {
            groupId,
            messageId,
            hasData: !!messageData,
          });

          // **SIGNAL APPROACH: Only process NEW messages, ignore existing ones**
          if (messageData && messageId && messageData.timestamp) {
            const messageAge = Date.now() - messageData.timestamp;
            const isNewMessage = messageAge < 5000; // 5 seconds threshold

            if (isNewMessage) {
              console.log("🚀 Processing NEW group message:", messageId);

              // Process and decrypt the message
              const decryptedMessage = await this._processIncomingGroupMessage(
                messageData,
                messageId,
                groupId
              );

              if (decryptedMessage) {
                // Save to localStorage
                await this._saveGroupMessageToLocalStorage(
                  groupId,
                  decryptedMessage
                );

                // Call the callback
                callback(decryptedMessage);
              }
            } else {
              console.log(
                "🚀 Ignoring OLD group message:",
                messageId,
                "age:",
                messageAge,
                "ms"
              );
            }
          } else if (messageData && messageId) {
            // If no timestamp, assume it's new and process it
            console.log(
              "🚀 Processing group message without timestamp:",
              messageId
            );

            const decryptedMessage = await this._processIncomingGroupMessage(
              messageData,
              messageId,
              groupId
            );

            if (decryptedMessage) {
              await this._saveGroupMessageToLocalStorage(
                groupId,
                decryptedMessage
              );
              callback(decryptedMessage);
            }
          }
        }
      );

      console.log(
        "🔍 GroupManager.addGroupMessageListener: Listener added successfully"
      );
    } catch (error) {
      console.error("🔍 GroupManager.addGroupMessageListener: Error:", error);
    }
  }

  /**
   * **SIGNAL APPROACH: Process incoming group message**
   */
  private async _processIncomingGroupMessage(
    messageData: any,
    messageId: string,
    groupId: string
  ): Promise<any | null> {
    try {
      console.log("🔍 _processIncomingGroupMessage: Processing", {
        messageId,
        groupId,
        hasContent: !!messageData?.content,
        hasFrom: !!messageData?.from,
      });

      if (!messageData?.content || !messageData?.from) {
        console.log("🔍 _processIncomingGroupMessage: Invalid message data");
        return null;
      }

      // Get group data and key for decryption
      const groupData = await this.getGroupData(groupId);
      if (!groupData) {
        console.log("🔍 _processIncomingGroupMessage: Group data not found");
        return null;
      }

      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair) {
        console.log("🔍 _processIncomingGroupMessage: No user pair available");
        return null;
      }

      const groupKey = await this.getGroupKeyForUser(
        groupData,
        currentUserPair.pub,
        currentUserPair
      );
      if (!groupKey) {
        console.log("🔍 _processIncomingGroupMessage: Failed to get group key");
        return null;
      }

      // Decrypt the message
      const decryptedContent = await this.core.db.sea.decrypt(
        messageData.content,
        groupKey
      );
      if (!decryptedContent) {
        console.log("🔍 _processIncomingGroupMessage: Decryption failed");
        return null;
      }

      // Create message object
      const decryptedMessage = {
        id: messageId,
        from: messageData.from,
        groupId,
        timestamp: messageData.timestamp || Date.now(),
        content:
          typeof decryptedContent === "string"
            ? decryptedContent
            : JSON.stringify(decryptedContent),
      };

      console.log(
        "🔍 _processIncomingGroupMessage: Message processed successfully"
      );
      return decryptedMessage;
    } catch (error) {
      console.error("🔍 _processIncomingGroupMessage: Error:", error);
      return null;
    }
  }

  /**
   * Sends a message to a group
   */
  public async sendGroupMessage(
    groupId: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const startTime = performance.now();
    
    console.log(
      "🔍 GroupManager.sendGroupMessage: Starting for group",
      groupId
    );

    if (!this.core.isLoggedIn() || !this.core.db.user) {
      console.log("🔍 GroupManager.sendGroupMessage: User not logged in");
      return {
        success: false,
        error: "You must be logged in to send a message.",
      };
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      console.log("🔍 GroupManager.sendGroupMessage: No user pair available");
      return {
        success: false,
        error: "User key pair not available",
      };
    }
    const senderPub = currentUserPair.pub;
    console.log("🔍 GroupManager.sendGroupMessage: Sender pub", senderPub);

    let groupData = await this.getGroupData(groupId);
    if (!groupData) {
      console.log(
        "🔍 GroupManager.sendGroupMessage: Group data not found for",
        groupId
      );
      return { success: false, error: "Group not found." };
    }

    console.log("🔍 GroupManager.sendGroupMessage: Group data found:", {
      id: groupData.id,
      name: groupData.name,
      membersCount: groupData.members.length,
      encryptedKeysCount: Object.keys(groupData.encryptedKeys || {}).length,
    });

    // **FIX: Improved membership verification**
    console.log(
      "🔍 GroupManager.sendGroupMessage: Verifying membership for",
      senderPub
    );
    const isMember = await this.verifyGroupMembership(groupData, senderPub);
    console.log("🔍 GroupManager.sendGroupMessage: Is member:", isMember);
    if (!isMember) {
      console.log(
        "🔍 GroupManager.sendGroupMessage: User is not a member of the group"
      );
      return { success: false, error: "You are not a member of this group." };
    }

    try {
      // **FIX: Improved group key retrieval**
      console.log(
        "🔍 GroupManager.sendGroupMessage: Getting group key for user"
      );
      const groupKey = await this.getGroupKeyForUser(
        groupData,
        senderPub,
        currentUserPair
      );
      console.log(
        "🔍 GroupManager.sendGroupMessage: Group key obtained:",
        !!groupKey
      );
      if (!groupKey) {
        console.log(
          "🔍 GroupManager.sendGroupMessage: Failed to get group key"
        );
        return {
          success: false,
          error: "Unable to obtain group key for the user.",
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

              // **IMPROVED: Use schema utility for message ID generation**
        const messageId = MessagingSchema.utils.generateMessageId();
      const message = {
        id: messageId,
        from: senderPub,
        content: encryptedContent,
        timestamp: Date.now(),
        groupId: groupId,
        signature: signature, // Use signature of plaintext
      };

      // Send to the group's message node
      const messagePath = MessagingSchema.groups.messages(groupId);
      console.log(
        "🔍 GroupManager.sendGroupMessage: Sending to path",
        messagePath
      );
      console.log("🔍 GroupManager.sendGroupMessage: Message ID", messageId);

      this.core.db.gun
        .get(messagePath)
        .get(messageId)
        .put(JSON.stringify(message));

      // **SIGNAL APPROACH: Save sent message to localStorage**
      const decryptedMessage = {
        id: messageId,
        from: senderPub,
        groupId: groupId,
        timestamp: Date.now(),
        content: messageContent,
      };
      await this._saveGroupMessageToLocalStorage(groupId, decryptedMessage);

      console.log(
        "🔍 GroupManager.sendGroupMessage: Message sent successfully"
      );
      
      // **NEW: Update performance metrics**
      this.performanceMetrics.messagesSent++;
      
      return { success: true, messageId };
    } catch (error: any) {
      return {
        success: false,
        error:
          error.message ||
          "Unknown error while sending group message",
      };
    } finally {
      // **NEW: Track response time**
      const responseTime = performance.now() - startTime;
      this.performanceMetrics.totalResponseTime += responseTime;
      this.performanceMetrics.responseCount++;
      this.performanceMetrics.averageResponseTime =
        this.performanceMetrics.totalResponseTime /
        this.performanceMetrics.responseCount;
    }
  }

  /**
   * Retrieves group data from GunDB
   */
  public async getGroupData(groupId: string): Promise<GroupData | null> {
    try {
      const data = await new Promise<any | null>((resolve, reject) => {
        this.core.db.gun.get(groupId).on((data: any) => {
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
          membersNode.map().on((value: any, key: string) => {
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
          encryptedKeysNode.map().on((value: any, key: string) => {
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
          keysSignature: data.keysSignature,
        };

        // Verify keysSignature if present (best-effort)
        try {
          if (groupData.keysSignature && groupData.createdBy) {
            const keysPayload = JSON.stringify(groupData.encryptedKeys, Object.keys(groupData.encryptedKeys).sort());
            const isValid = await this.encryptionManager.verifyMessageSignature(
              keysPayload,
              groupData.keysSignature,
              groupData.createdBy
            );
            if (!isValid) {
              console.warn("🔍 getGroupData: Invalid keysSignature detected for group", groupId);
            }
          }
        } catch (_) {}
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
    return members.some((member: any) => {
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

    // Try to get encrypted key for user
    let encryptedGroupKey: string | undefined =
      groupData.encryptedKeys?.[userPub];
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
          node = node.get(seg) as any;
        }
        encryptedGroupKey = await new Promise<string | undefined>((resolve) => {
          node.on((val: any) => {
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
        currentUserPair
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
      groupData.createdBy || ""
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
   * **NEW: Get performance metrics**
   */
  public getPerformanceMetrics(): any {
    return { ...this.performanceMetrics };
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
          encKey as string,
          sharedWithMember
        );
        if (!recoveredGroupKey) continue;

        // Re-encrypt group key for the creator and persist
        const creatorEpub = await this.encryptionManager.getRecipientEpub(
          groupData.createdBy || ""
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
              .get(groupData.createdBy || "")
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
