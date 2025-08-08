import { ShogunCore } from "shogun-core";

/**
 * Utility functions for the messaging plugin
 */

/**
 * Generates a unique message ID
 */
export function generateMessageId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `msg_${timestamp}_${random}`;
}

/**
 * Generates a unique group ID
 */
export function generateGroupId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  return `${timestamp}_${random}`;
}

/**
 * Creates a simple, safe path for GunDB using a hash of the public key
 */
export function createSafePath(pubKey: string, prefix: string = "msg"): string {
  if (!pubKey || typeof pubKey !== "string") {
    throw new Error("Invalid public key for path creation");
  }

  // Create a simple hash of the public key
  const hash = simpleHash(pubKey);
  return `${prefix}_${hash}`;
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
 * Creates a unique conversation identifier
 */
export function createConversationId(user1: string, user2: string): string {
  // Sort the public keys to ensure consistent conversation ID regardless of sender/receiver
  const sorted = [user1, user2].sort();
  return `${sorted[0]}_${sorted[1]}`;
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
  token?: string
): string {
  const baseUrl = window.location.origin;
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
  const random = Math.random().toString(36).substring(2, 15);
  return `token_room_${timestamp}_${random}`;
}

/**
 * Shared method to send messages to GunDB
 */
export async function sendToGunDB(
  core: ShogunCore,
  path: string,
  messageId: string,
  messageData: any,
  type: "private" | "public" | "group"
): Promise<void> {
  if (!core || !core.db || !core.db.gun) {
    throw new Error("Shogun Core or GunDB not initialized.");
  }

  let safePath: string;

  if (type === "public") {
    safePath = `room_${path}`;
  } else if (type === "group") {
    safePath = path;
  } else {
    safePath = createSafePath(path);
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
