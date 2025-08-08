import { ShogunCore } from "shogun-core";
import { GroupData, TokenRoomData } from "./types";
import { generateInviteLink } from "./utils";
import { GroupManager } from "./groupManager";
import { TokenRoomManager } from "./tokenRoomManager";

/**
 * Chat management functionality for the messaging plugin
 */
export class ChatManager {
  private core: ShogunCore;
  private groupManager: GroupManager;
  private tokenRoomManager: TokenRoomManager;

  constructor(
    core: ShogunCore,
    groupManager: GroupManager,
    tokenRoomManager: TokenRoomManager
  ) {
    this.core = core;
    this.groupManager = groupManager;
    this.tokenRoomManager = tokenRoomManager;
  }

  /**
   * Joins a group using an invitation link
   */
  public async joinGroup(
    groupId: string
  ): Promise<{ success: boolean; groupData?: GroupData; error?: string }> {
    const currentUser = this.core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    console.log(
      `[ChatManager] 🔍 joinGroup called for user ${currentUserPub.slice(0, 20)}... to group ${groupId}`
    );

    try {
      // Get group data
      const groupData = await this.groupManager.getGroupData(groupId);
      if (!groupData) {
        console.log(`[ChatManager] ❌ Group not found: ${groupId}`);
        return {
          success: false,
          error: "Group not found or invitation invalid",
        };
      }

      console.log(`[ChatManager] 🔍 Group data retrieved:`, {
        groupId,
        groupName: groupData.name,
        currentMembers: groupData.members,
        currentMembersCount: groupData.members.length,
        currentUserPub: currentUserPub.slice(0, 20) + "...",
      });

      // Check if user is already a member
      if (groupData.members.includes(currentUserPub)) {
        console.log(
          `[ChatManager] ⚠️ User already a member of group ${groupId}`
        );

        // Even if user is already a member, ensure the chat reference is stored
        console.log(
          `[ChatManager] 💾 Storing group reference for existing member`
        );
        await this.storeChatReferenceInUserProfile(
          currentUserPub,
          "group",
          groupId,
          groupData.name
        );

        // Add a small delay to ensure GunDB sync
        console.log(`[ChatManager] ⏳ Waiting for GunDB sync...`);
        await new Promise((resolve) => setTimeout(resolve, 500));

        console.log(
          `[ChatManager] ✅ User is already a member of group ${groupId}`
        );
        return { success: true, groupData: groupData };
      }

      // Add user to the group
      console.log(`[ChatManager] ➕ Adding user to group...`);
      const result = await this.groupManager.addMemberToGroup(
        groupId,
        currentUserPub
      );
      if (!result.success) {
        console.log(
          `[ChatManager] ❌ Failed to add user to group:`,
          result.error
        );
        return result;
      }

      // Verify the user was actually added by re-fetching group data
      console.log(`[ChatManager] 🔍 Verifying user was added to group...`);
      await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for GunDB to sync

      const updatedGroupData = await this.groupManager.getGroupData(groupId);
      if (!updatedGroupData) {
        console.log(`[ChatManager] ❌ Could not retrieve updated group data`);
        return { success: false, error: "Failed to verify group membership" };
      }

      const isNowMember = updatedGroupData.members.includes(currentUserPub);
      console.log(`[ChatManager] 🔍 Membership verification:`, {
        isNowMember,
        updatedMembers: updatedGroupData.members,
        updatedMembersCount: updatedGroupData.members.length,
        currentUserPub: currentUserPub.slice(0, 20) + "...",
      });

      if (!isNowMember) {
        console.log(`[ChatManager] ❌ User was not properly added to group`);
        return {
          success: false,
          error: "Failed to join group - membership not confirmed",
        };
      }

      // Double-check membership using the dedicated method
      const membershipCheck = await this.groupManager.isGroupMember(
        groupId,
        currentUserPub
      );
      if (!membershipCheck.success || !membershipCheck.isMember) {
        console.log(
          `[ChatManager] ❌ Membership verification failed:`,
          membershipCheck.error
        );
        return { success: false, error: "Failed to verify group membership" };
      }

      console.log(`[ChatManager] ✅ Membership verified successfully`);

      // Store group reference in user profile
      console.log(`[ChatManager] 💾 Storing group reference in user profile`);
      await this.storeChatReferenceInUserProfile(
        currentUserPub,
        "group",
        groupId,
        updatedGroupData.name
      );

      // Add a small delay to ensure GunDB sync
      console.log(`[ChatManager] ⏳ Waiting for GunDB sync...`);
      await new Promise((resolve) => setTimeout(resolve, 500));

      console.log(`[ChatManager] ✅ Successfully joined group ${groupId}`);
      return { success: true, groupData: updatedGroupData };
    } catch (error) {
      console.error(`[ChatManager] ❌ Error joining group:`, error);
      return { success: false, error: `Failed to join group: ${error}` };
    }
  }

  /**
   * Joins any chat type using an invitation link
   */
  public async joinChat(
    chatType: "private" | "public" | "group" | "token",
    chatId: string,
    token?: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    const currentUser = this.core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    console.log(`[ChatManager] 🔍 joinChat called:`, {
      chatType,
      chatId,
      token: token ? `${token.slice(0, 8)}...` : "none",
      currentUserPub: currentUserPub?.slice(0, 20) + "...",
      isLoggedIn: this.core.isLoggedIn(),
    });

    if (!currentUserPub) {
      console.log(`[ChatManager] ❌ joinChat: User not authenticated`);
      return { success: false, error: "User not authenticated" };
    }

    try {
      switch (chatType) {
        case "private":
          console.log(
            `[ChatManager] 🔍 joinChat: Processing private chat join`
          );
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
          console.log(`[ChatManager] 🔍 joinChat: Processing public chat join`);
          // For public rooms, start listening to the room
          // Note: This would need to be handled by the main plugin
          return {
            success: true,
            chatData: {
              type: "public",
              id: chatId,
              name: `Public Room: ${chatId}`,
            },
          };

        case "group":
          console.log(`[ChatManager] 🔍 joinChat: Processing group chat join`);
          // For groups, use the existing joinGroup method
          const result = await this.joinGroup(chatId);
          console.log(`[ChatManager] 🔍 joinChat: joinGroup result:`, result);

          if (result.success && result.groupData) {
            console.log(`[ChatManager] ✅ joinChat: Successfully joined group`);
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
          console.log(
            `[ChatManager] ❌ joinChat: Failed to join group:`,
            result.error
          );
          return result;

        case "token":
          console.log(`[ChatManager] 🔍 joinChat: Processing token room join`);
          if (!token) {
            console.log(
              `[ChatManager] ❌ joinChat: Token required for token room`
            );
            return {
              success: false,
              error: "Token required for token room access",
            };
          }

          // For token rooms, use the token room manager
          const tokenResult = await this.tokenRoomManager.joinTokenRoom(
            chatId,
            token
          );
          console.log(
            `[ChatManager] 🔍 joinChat: joinTokenRoom result:`,
            tokenResult
          );

          if (tokenResult.success && tokenResult.roomData) {
            console.log(
              `[ChatManager] ✅ joinChat: Successfully joined token room`
            );
            return {
              success: true,
              chatData: {
                type: "token",
                id: chatId,
                name: tokenResult.roomData.name,
                roomData: tokenResult.roomData,
              },
            };
          }
          console.log(
            `[ChatManager] ❌ joinChat: Failed to join token room:`,
            tokenResult.error
          );
          return tokenResult;

        default:
          console.log(
            `[ChatManager] ❌ joinChat: Invalid chat type: ${chatType}`
          );
          return { success: false, error: "Invalid chat type" };
      }
    } catch (error) {
      console.error(`[ChatManager] ❌ Error joining chat:`, error);
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
    const currentUser = this.core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    try {
      console.log(
        `[ChatManager] 🔍 Getting chats for user: ${currentUserPub.slice(0, 20)}...`
      );

      const chats: any[] = [];

      // First, try to get the consolidated chat list
      try {
        console.log(`[ChatManager] 🔍 Trying to get consolidated chat list...`);
        const chatList = await this.core.db.getUserData("chatList");

        if (chatList && typeof chatList === "object") {
          console.log(
            `[ChatManager] ✅ Found consolidated chat list with ${Object.keys(chatList).length} chats`
          );

          // Process each chat reference from the consolidated list
          for (const [chatId, chatRef] of Object.entries(chatList)) {
            if (chatId === "_" || !chatRef) continue;

            console.log(`[ChatManager] 🔍 Processing chat from list:`, chatRef);

            const chatData = await this.processChatReference(chatRef as any);
            if (chatData) {
              chats.push(chatData);
            }
          }

          console.log(
            `[ChatManager] ✅ Retrieved ${chats.length} chats from consolidated list`
          );
          return { success: true, chats };
        }
      } catch (listError) {
        console.warn(
          `[ChatManager] ⚠️ Could not get consolidated chat list:`,
          listError
        );
      }

      // Fallback to the old approach if consolidated list doesn't work
      console.log(
        `[ChatManager] 🔍 Falling back to individual chat type retrieval...`
      );

      // Retrieve stored chat references from user's profile
      const chatTypes: ("private" | "public" | "group" | "token")[] = [
        "private",
        "public",
        "group",
        "token",
      ];

      for (const chatType of chatTypes) {
        try {
          console.log(
            `[ChatManager] 🔍 Retrieving ${chatType} chat references...`
          );

          // Use a different approach to get all stored chat references for this type
          const chatReferences = await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error(`Timeout getting ${chatType} chats (10s)`));
            }, 10000);

            // Get the chats container for this type
            this.core.db.gun
              .user()
              .get("chats")
              .get(chatType)
              .once((data: any) => {
                clearTimeout(timeout);
                resolve(data);
              });
          });

          console.log(
            `[ChatManager] 🔍 Retrieved ${chatType} chat references:`,
            chatReferences
          );

          if (chatReferences && typeof chatReferences === "object") {
            // Process each chat reference - iterate through all keys
            const chatIds = Object.keys(chatReferences).filter(
              (id) => id !== "_" && chatReferences[id]
            );
            console.log(
              `[ChatManager] 🔍 Found ${chatIds.length} ${chatType} chat IDs:`,
              chatIds
            );

            for (const chatId of chatIds) {
              const chatRef = chatReferences[chatId];
              console.log(
                `[ChatManager] 🔍 Processing ${chatType} chat reference:`,
                chatRef
              );

              const chatData = await this.processChatReference(chatRef);
              if (chatData) {
                chats.push(chatData);
              }
            }
          } else {
            console.log(
              `[ChatManager] ℹ️ No ${chatType} chat references found or invalid format`
            );
          }
        } catch (error) {
          console.warn(
            `[ChatManager] ⚠️ Could not retrieve ${chatType} chats:`,
            error
          );
          // Continue with other chat types
        }
      }

      console.log(`[ChatManager] ✅ Retrieved ${chats.length} total chats`);
      return { success: true, chats };
    } catch (error) {
      console.error(`[ChatManager] ❌ Error getting user chats:`, error);
      return { success: false, error: `Failed to get chats: ${error}` };
    }
  }

  /**
   * Stores a chat reference in the user's profile for persistence
   */
  public async storeChatReferenceInUserProfile(
    userPub: string,
    chatType: "private" | "public" | "group" | "token",
    chatId: string,
    chatName?: string
  ): Promise<void> {
    try {
      console.log(`[ChatManager] 💾 Storing chat reference:`, {
        userPub: userPub.slice(0, 20) + "...",
        chatType,
        chatId,
        chatName,
        path: `chats/${chatType}/${chatId}`,
      });

      // Store chat reference in user's profile
      const chatReference = {
        type: chatType,
        id: chatId,
        name: chatName || `${chatType} chat`,
        joinedAt: Date.now(),
      };

      console.log(`[ChatManager] 💾 Chat reference object:`, chatReference);

      // Store individual chat reference
      await this.core.db.putUserData(
        `chats/${chatType}/${chatId}`,
        chatReference
      );

      // Also maintain a list of all chat references for easy retrieval
      try {
        const existingChatList =
          (await this.core.db.getUserData("chatList")) || {};
        const updatedChatList = {
          ...existingChatList,
          [chatId]: chatReference,
        };

        await this.core.db.putUserData("chatList", updatedChatList);
        console.log(
          `[ChatManager] ✅ Updated chat list with ${Object.keys(updatedChatList).length} chats`
        );
      } catch (listError) {
        console.warn(`[ChatManager] ⚠️ Could not update chat list:`, listError);
      }

      console.log(
        `[ChatManager] ✅ Stored chat reference for user ${userPub.slice(0, 20)}...`
      );

      // Verify the data was stored by reading it back
      try {
        const storedData = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Timeout verifying stored chat reference (5s)`));
          }, 5000);

          this.core.db.gun
            .user()
            .get("chats")
            .get(chatType)
            .get(chatId)
            .once((data: any) => {
              clearTimeout(timeout);
              resolve(data);
            });
        });

        console.log(`[ChatManager] 🔍 Verification - stored data:`, storedData);

        if (storedData && storedData.id === chatId) {
          console.log(`[ChatManager] ✅ Chat reference verified successfully`);
        } else {
          console.warn(
            `[ChatManager] ⚠️ Chat reference verification failed - data mismatch`
          );
        }
      } catch (verifyError) {
        console.warn(
          `[ChatManager] ⚠️ Could not verify stored chat reference:`,
          verifyError
        );
      }
    } catch (error) {
      console.warn(`[ChatManager] ⚠️ Could not store chat reference:`, error);
    }
  }

  /**
   * Generates an invitation link for any chat type
   */
  public generateInviteLink(
    chatType: "private" | "public" | "group" | "token",
    chatId: string,
    chatName?: string,
    token?: string
  ): string {
    return generateInviteLink(chatType, chatId, chatName, token);
  }

  /**
   * Helper method to process a chat reference and fetch additional data
   */
  private async processChatReference(chatRef: any): Promise<any | null> {
    try {
      console.log(`[ChatManager] 🔍 Processing chat reference:`, chatRef);

      // Handle GunDB references - if it's a reference, we need to resolve it
      if (chatRef && typeof chatRef === "object" && chatRef["#"]) {
        console.log(
          `[ChatManager] 🔍 Resolving GunDB reference: ${chatRef["#"]}`
        );
        try {
          const resolvedRef = await new Promise<any>((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error("Timeout resolving GunDB reference (5s)"));
            }, 5000);

            // Use the reference directly to get the data
            this.core.db.gun.get(chatRef["#"]).once((data: any) => {
              clearTimeout(timeout);
              console.log(`[ChatManager] 🔍 Raw resolved data:`, data);
              resolve(data);
            });
          });
          console.log(`[ChatManager] 🔍 Resolved reference:`, resolvedRef);

          // If the resolved data is still a reference, try to resolve it further
          if (
            resolvedRef &&
            typeof resolvedRef === "object" &&
            resolvedRef["#"]
          ) {
            console.log(
              `[ChatManager] 🔍 Resolving nested reference: ${resolvedRef["#"]}`
            );
            const nestedRef = await new Promise<any>((resolve, reject) => {
              const timeout = setTimeout(() => {
                reject(
                  new Error("Timeout resolving nested GunDB reference (5s)")
                );
              }, 5000);

              this.core.db.gun.get(resolvedRef["#"]).once((data: any) => {
                clearTimeout(timeout);
                console.log(`[ChatManager] 🔍 Raw nested resolved data:`, data);
                resolve(data);
              });
            });
            console.log(
              `[ChatManager] 🔍 Nested resolved reference:`,
              nestedRef
            );
            chatRef = nestedRef;
          } else {
            chatRef = resolvedRef;
          }
        } catch (resolveError) {
          console.warn(
            `[ChatManager] ⚠️ Could not resolve GunDB reference:`,
            resolveError
          );
          return null;
        }
      }

      // Validate the chat reference structure
      if (!chatRef || typeof chatRef !== "object") {
        console.warn(
          `[ChatManager] ⚠️ Invalid chat reference - not an object:`,
          chatRef
        );
        return null;
      }

      // Check if we have the required fields
      const chatType = chatRef.type;
      const chatId = chatRef.id;

      if (!chatType || !chatId) {
        console.warn(
          `[ChatManager] ⚠️ Invalid chat reference - missing type or id:`,
          {
            type: chatType,
            id: chatId,
            fullRef: chatRef,
          }
        );
        return null;
      }

      let chatData: any = {
        type: chatType,
        id: chatId,
        name: chatRef.name || `${chatType} chat`,
        joinedAt: chatRef.joinedAt || Date.now(),
      };

      // For group chats, fetch additional group data
      if (chatType === "group") {
        try {
          console.log(`[ChatManager] 🔍 Fetching group data for ${chatId}...`);
          const groupData = await this.groupManager.getGroupData(chatId);
          if (groupData) {
            console.log(`[ChatManager] ✅ Group data retrieved:`, groupData);
            chatData = {
              ...chatData,
              name: groupData.name,
              members: groupData.members,
              createdBy: groupData.createdBy,
              createdAt: groupData.createdAt,
              encryptionKey: groupData.encryptionKey,
            };
          } else {
            console.warn(`[ChatManager] ⚠️ No group data found for ${chatId}`);
          }
        } catch (error) {
          console.warn(
            `[ChatManager] ⚠️ Could not fetch group data for ${chatId}:`,
            error
          );
        }
      }

      // For token rooms, fetch additional room data
      if (chatType === "token") {
        try {
          console.log(
            `[ChatManager] 🔍 Fetching token room data for ${chatId}...`
          );
          const roomData = await this.tokenRoomManager.getTokenRoomData(chatId);
          if (roomData) {
            console.log(
              `[ChatManager] ✅ Token room data retrieved:`,
              roomData
            );
            chatData = {
              ...chatData,
              name: roomData.name,
              description: roomData.description,
              createdBy: roomData.createdBy,
              createdAt: roomData.createdAt,
              maxParticipants: roomData.maxParticipants,
              // Note: We don't include the token for security reasons
            };
          } else {
            console.warn(
              `[ChatManager] ⚠️ No token room data found for ${chatId}`
            );
          }
        } catch (error) {
          console.warn(
            `[ChatManager] ⚠️ Could not fetch token room data for ${chatId}:`,
            error
          );
        }
      }

      console.log(`[ChatManager] ✅ Processed ${chatType} chat:`, chatData);
      return chatData;
    } catch (error) {
      console.warn(`[ChatManager] ⚠️ Error processing chat reference:`, error);
      return null;
    }
  }
}
