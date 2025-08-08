import { ShogunCore } from "shogun-core";
import { TokenRoomData } from "./types";
import { generateInviteLink } from "./utils";
import { TokenRoomManager } from "./tokenRoomManager";
import { EncryptionManager } from "./encryption";

/**
 * Chat management functionality for the messaging plugin
 */
export class ChatManager {
  private core: ShogunCore;
  private tokenRoomManager: TokenRoomManager;
  private encryptionManager: EncryptionManager;

  constructor(
    core: ShogunCore,
    tokenRoomManager: TokenRoomManager,
    encryptionManager: EncryptionManager
  ) {
    this.core = core;
    this.tokenRoomManager = tokenRoomManager;
    this.encryptionManager = encryptionManager;
  }

  /**
   * Joins a chat (private, public, or token room)
   */
  public async joinChat(
    chatType: "private" | "public" | "token",
    chatId: string,
    token?: string
  ): Promise<{ success: boolean; chatData?: any; error?: string }> {
    const currentUser = this.core.db.getCurrentUser();
    const currentUserPub = currentUser?.pub;

    if (!currentUserPub) {
      return { success: false, error: "User not authenticated" };
    }

    console.log(
      `[ChatManager] 🔍 joinChat called for user ${currentUserPub.slice(0, 20)}... to ${chatType} chat ${chatId}`
    );

    try {
      switch (chatType) {
        case "private":
          console.log(
            `[ChatManager] 🔍 joinChat: Processing private chat join`
          );
          // For private chats, just store the reference
          await this.storeChatReferenceInUserProfile(
            currentUserPub,
            "private",
            chatId,
            `Chat with ${chatId.slice(0, 8)}...`
          );
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
          // For public rooms, just store the reference
          await this.storeChatReferenceInUserProfile(
            currentUserPub,
            "public",
            chatId,
            `Public Room: ${chatId}`
          );
          return {
            success: true,
            chatData: {
              type: "public",
              id: chatId,
              name: `Public Room: ${chatId}`,
            },
          };

        case "token":
          console.log(`[ChatManager] 🔍 joinChat: Processing token room join`);
          if (!token) {
            return {
              success: false,
              error: "Token is required for token room access",
            };
          }
          // For token rooms, use the token room manager
          const result = await this.tokenRoomManager.joinTokenRoom(
            chatId,
            token
          );
          if (result.success && result.roomData) {
            await this.storeChatReferenceInUserProfile(
              currentUserPub,
              "token",
              chatId,
              result.roomData.name
            );
            return {
              success: true,
              chatData: {
                type: "token",
                id: chatId,
                name: result.roomData.name,
                roomData: result.roomData,
              },
            };
          }
          return result;

        default:
          return {
            success: false,
            error: `Unsupported chat type: ${chatType}`,
          };
      }
    } catch (error) {
      console.error(`[ChatManager] ❌ Error joining chat:`, error);
      return { success: false, error: `Failed to join chat: ${error}` };
    }
  }

  /**
   * Gets the user's chats
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
        `[ChatManager] 🔍 Getting chats for user ${currentUserPub.slice(0, 20)}...`
      );

      const chats: any[] = [];

      // Get private chats
      try {
        const privateChats = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout getting private chats (10s)"));
          }, 10000);

          this.core.db.gun
            .get(`user_${currentUserPub}`)
            .get("chats")
            .get("private")
            .map()
            .once((data: any) => {
              clearTimeout(timeout);
              resolve(data);
            });
        });

        if (privateChats) {
          Object.entries(privateChats).forEach(
            ([chatId, chatData]: [string, any]) => {
              if (chatData && chatData.id) {
                chats.push({
                  type: "private",
                  id: chatId,
                  name: chatData.name || `Chat with ${chatId.slice(0, 8)}...`,
                  joinedAt: chatData.joinedAt,
                });
              }
            }
          );
        }
      } catch (error) {
        console.warn(`[ChatManager] ⚠️ Could not get private chats:`, error);
      }

      // Get public chats
      try {
        const publicChats = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout getting public chats (10s)"));
          }, 10000);

          this.core.db.gun
            .get(`user_${currentUserPub}`)
            .get("chats")
            .get("public")
            .map()
            .once((data: any) => {
              clearTimeout(timeout);
              resolve(data);
            });
        });

        if (publicChats) {
          Object.entries(publicChats).forEach(
            ([chatId, chatData]: [string, any]) => {
              if (chatData && chatData.id) {
                chats.push({
                  type: "public",
                  id: chatId,
                  name: chatData.name || `Public Room: ${chatId}`,
                  joinedAt: chatData.joinedAt,
                });
              }
            }
          );
        }
      } catch (error) {
        console.warn(`[ChatManager] ⚠️ Could not get public chats:`, error);
      }

      // Get token chats
      try {
        const tokenChats = await new Promise<any>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error("Timeout getting token chats (10s)"));
          }, 10000);

          this.core.db.gun
            .get(`user_${currentUserPub}`)
            .get("chats")
            .get("token")
            .map()
            .once((data: any) => {
              clearTimeout(timeout);
              resolve(data);
            });
        });

        if (tokenChats) {
          Object.entries(tokenChats).forEach(
            ([chatId, chatData]: [string, any]) => {
              if (chatData && chatData.id) {
                chats.push({
                  type: "token",
                  id: chatId,
                  name: chatData.name || `Token Room: ${chatId}`,
                  joinedAt: chatData.joinedAt,
                });
              }
            }
          );
        }
      } catch (error) {
        console.warn(`[ChatManager] ⚠️ Could not get token chats:`, error);
      }

      console.log(`[ChatManager] ✅ Found ${chats.length} chats for user`);
      return { success: true, chats };
    } catch (error) {
      console.error(`[ChatManager] ❌ Error getting chats:`, error);
      return { success: false, error: `Failed to get chats: ${error}` };
    }
  }

  /**
   * Removes a chat reference from a user's profile
   */
  public async removeChatReferenceFromUserProfile(
    userPub: string,
    chatType: "private" | "public" | "token",
    chatId: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout removing chat reference (10s)"));
      }, 10000);

      this.core.db.gun
        .get(`user_${userPub}`)
        .get("chats")
        .get(chatType)
        .get(chatId)
        .put(null, (ack: any) => {
          clearTimeout(timeout);
          if (ack.err) {
            reject(new Error(`Error removing chat reference: ${ack.err}`));
          } else {
            console.log(
              `[ChatManager] ✅ Removed ${chatType} chat reference ${chatId} from user profile`
            );
            resolve();
          }
        });
    });
  }

  /**
   * Stores a chat reference in a user's profile
   */
  public async storeChatReferenceInUserProfile(
    userPub: string,
    chatType: "private" | "public" | "token",
    chatId: string,
    chatName?: string
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout storing chat reference (10s)"));
      }, 10000);

      const chatReference = {
        id: chatId,
        type: chatType,
        name: chatName || chatId,
        joinedAt: Date.now(),
      };

      this.core.db.gun
        .get(`user_${userPub}`)
        .get("chats")
        .get(chatType)
        .get(chatId)
        .put(chatReference, (ack: any) => {
          clearTimeout(timeout);
          if (ack.err) {
            reject(new Error(`Error storing chat reference: ${ack.err}`));
          } else {
            console.log(
              `[ChatManager] ✅ Stored ${chatType} chat reference ${chatId} in user profile`
            );
            resolve();
          }
        });
    });
  }

  /**
   * Generates an invite link for a chat
   */
  public generateInviteLink(
    chatType: "private" | "public" | "token",
    chatId: string,
    chatName?: string
  ): string {
    return generateInviteLink(chatType, chatId, chatName);
  }

  /**
   * Sends a private message to a recipient
   */
  public async sendMessage(
    recipientPub: string,
    messageContent: string
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return {
        success: false,
        error: "Devi essere loggato per inviare un messaggio.",
      };
    }

    if (!recipientPub || !messageContent) {
      return {
        success: false,
        error: "Destinatario e messaggio sono obbligatori.",
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
      const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;

      // Create the complete message
      const messageData: any = {
        from: senderPub,
        content: messageContent,
        timestamp: Date.now(),
        id: messageId,
      };

      // Sign the message
      messageData.signature = await this.core.db.sea.sign(
        messageData.content,
        currentUserPair
      );

      // Encrypt the entire message for the recipient
      const recipientEpub =
        await this.encryptionManager.getRecipientEpub(recipientPub);
      const sharedSecret = await this.core.db.sea.secret(
        recipientEpub,
        currentUserPair
      );
      const encryptedMessage = await this.core.db.sea.encrypt(
        messageData,
        sharedSecret || ""
      );

      // Create the wrapper for GunDB
      const encryptedMessageData = {
        data: encryptedMessage,
        from: senderPub,
        timestamp: Date.now(),
        id: messageId,
      };

      // Send to GunDB
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout sending message (10s)"));
        }, 10000);

        this.core.db.gun
          .get(`user_${recipientPub}`)
          .get(messageId)
          .put(encryptedMessageData, (ack: any) => {
            clearTimeout(timeout);
            if (ack.err) {
              reject(new Error(`Error sending message: ${ack.err}`));
            } else {
              resolve();
            }
          });
      });

      return { success: true, messageId };
    } catch (error: any) {
      console.error(`[ChatManager] ❌ Error sending message:`, error);
      return {
        success: false,
        error:
          error.message || "Errore sconosciuto durante l'invio del messaggio",
      };
    }
  }
}
