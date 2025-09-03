import { ShogunCore } from "shogun-core";
import { MessagingSchema } from "./schema";

/**
 * Utility functions for the messaging plugin
 * Ora utilizza MessagingSchema per consistenza
 */

/**
 * Generates cryptographically-strong random hex string of given byte length
 */
function randomHex(byteLength: number = 8): string {
  const array = new Uint8Array(byteLength);
  // Use Web Crypto API when available (Node 20+ and browsers)
  if ((globalThis as any)?.crypto?.getRandomValues) {
    (globalThis as any).crypto.getRandomValues(array);
  } else {
    // Very rare fallback: fill with time-based values to avoid crashing
    for (let i = 0; i < array.length; i++) {
      array[i] = (Date.now() + i) & 0xff;
    }
  }
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generates a unique message ID using schema
 */
export function generateMessageId(): string {
  return MessagingSchema.utils.generateMessageId();
}

/**
 * Generates a unique group ID using schema
 */
export function generateGroupId(): string {
  return MessagingSchema.utils.generateGroupId();
}

/**
 * Creates a safe path for GunDB operations using schema
 */
export function createSafePath(pubKey: string, prefix: string = "msg"): string {
  return MessagingSchema.privateMessages.recipient(pubKey);
}

/**
 * Simple hash function for creating safe paths
 */
export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

/**
 * Creates a unique conversation identifier using schema
 */
export function createConversationId(user1: string, user2: string): string {
  return MessagingSchema.utils.createConversationId(user1, user2);
}

/**
 * Creates a conversation path for GunDB using schema
 */
export function createConversationPath(
  user1Pub: string,
  user2Pub: string
): string {
  return MessagingSchema.privateMessages.conversation(user1Pub, user2Pub);
}

/**
 * Limits the size of a Map to prevent memory issues
 */
export function limitMapSize<T>(map: Map<string, T>, maxSize: number): void {
  if (map.size > maxSize) {
    const entries = Array.from(map.entries());
    const toRemove = entries.slice(0, map.size - maxSize);
    toRemove.forEach(([key]) => map.delete(key));
  }
}

/**
 * Cleans up expired entries from a Map based on timestamps
 */
export function cleanupExpiredEntries(
  map: Map<string, number>,
  ttl: number
): void {
  const now = Date.now();
  const expiredIds: string[] = [];

  for (const [key, timestamp] of map.entries()) {
    if (now - timestamp > ttl) {
      expiredIds.push(key);
    }
  }

  expiredIds.forEach((id) => map.delete(id));
}

/**
 * Generates an invitation link for any chat type
 */
export function generateInviteLink(
  chatType: "private" | "public" | "group" | "token",
  chatId: string,
  chatName?: string,
  token?: string,
  baseUrlOverride?: string
): string {
  const baseUrl =
    baseUrlOverride ||
    (typeof window !== "undefined" && (window as any)?.location?.origin
      ? (window as any).location.origin
      : "");
  const encodedType = encodeURIComponent(chatType);
  const encodedId = encodeURIComponent(chatId);
  const encodedName = chatName ? encodeURIComponent(chatName) : "";
  const encodedToken = token ? encodeURIComponent(token) : "";

  let url = `${baseUrl}/chat-invite/${encodedType}/${encodedId}`;

  const params = new URLSearchParams();
  if (encodedName) params.append("name", encodedName);
  if (encodedToken) params.append("token", encodedToken);

  const queryString = params.toString();
  if (queryString) {
    url += `?${queryString}`;
  }

  return url;
}

/**
 * Generates a secure random token for encrypted rooms
 */
export function generateSecureToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    ""
  );
}

/**
 * Creates a unique token room ID
 */
export function generateTokenRoomId(): string {
  const timestamp = Date.now();
  const random = randomHex(8);
  return `tr_${timestamp}_${random}`;
}

/**
 * Shared method to send messages to GunDB
 */
export async function sendToGunDB(
  core: ShogunCore,
  path: string,
  messageId: string,
  messageData: any,
  type: "private" | "public" | "group",
  senderPub?: string
): Promise<void> {
  if (!core || !core.db || !core.db.gun) {
    throw new Error("Shogun Core or GunDB not initialized.");
  }

  let safePath: string;

      if (type === "public") {
      // **IMPROVED: Use schema for public room path**
      safePath = MessagingSchema.publicRooms.messages(path);
    } else if (type === "group") {
      safePath = path;
    } else {
      // For private messages, if the path already looks like a conversation path, use it as is
      if (path.startsWith("conversation_")) {
        safePath = path;
      } else if (senderPub) {
        safePath = createConversationPath(senderPub, path);
      } else {
        safePath = createSafePath(path);
      }
    }

  const messageNode = core.db.gun.get(safePath);

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
