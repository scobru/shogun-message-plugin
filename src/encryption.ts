import { ShogunCore } from "shogun-core";
import { MessageData, EncryptedMessage } from "./types";
import { MessagingSchema } from "./schema";

/**
 * Encryption utilities for the messaging plugin
 */
export class EncryptionManager {
  private core: ShogunCore;
  private epubCache: Map<string, { epub: string; timestamp: number }>;
  private operationLocks = new Map<string, Promise<any>>();

  constructor(core: ShogunCore) {
    this.core = core;
    this.epubCache = new Map();
  }

  /**
   * **PRODUCTION: Get recipient's encryption public key with caching and fallbacks**
   */
  public async getRecipientEpub(recipientPub: string): Promise<string> {
    // Input validation
    if (!recipientPub || typeof recipientPub !== "string") {
      throw new Error("Invalid recipient public key provided");
    }

    // Use operation lock to prevent concurrent requests for same recipient
    const lockKey = `epub_${recipientPub}`;
    if (this.operationLocks.has(lockKey)) {
      return this.operationLocks.get(lockKey);
    }

    const promise = this._getRecipientEpubInternal(recipientPub);
    this.operationLocks.set(lockKey, promise);

    try {
      const result = await promise;
      return result;
    } finally {
      this.operationLocks.delete(lockKey);
    }
  }

  /**
   * **PRODUCTION: Internal implementation with better error handling and retry logic**
   */
  private async _getRecipientEpubInternal(
    recipientPub: string,
    retryCount: number = 0
  ): Promise<string> {
    const maxRetries = 3;

    try {
      // Check cache first
      const cached = this.epubCache.get(recipientPub);
      if (cached && Date.now() - cached.timestamp < 300000) {
        // Cache is valid for 5 minutes
        return cached.epub;
      }

      // First fallback: try to get from the user's own data if they're trying to message themselves
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (currentUserPair && currentUserPair.pub === recipientPub) {
        const epub = currentUserPair.epub;
        this.epubCache.set(recipientPub, { epub, timestamp: Date.now() });
        return epub;
      }

      // **FIXED: Increased timeout to handle slow network conditions**
      const timeout = 10000; // Increased from 3s to 10s for better reliability

      // Try multiple sources in parallel and handle all outcomes to avoid unhandled rejections
      const results = await Promise.allSettled([
        // Try to get the recipient's user data from GunDB
        this.getUserData(recipientPub, timeout),
        // Fallback: try to get from user's public space
        this.getPublicData(recipientPub, timeout),
        // Third fallback: try to get from the user's profile data
        this.getProfileData(recipientPub, timeout),
        // Fourth fallback: try to get from the user's root data
        this.getRootData(recipientPub, timeout),
        // Fifth fallback: try to get from the user's public key directly
        this.getDirectData(recipientPub, timeout),
        // **NEW: Try to get from the app's user registry (shogun/users/{pub})**
        this.getAppUserData(recipientPub, timeout),
      ]);

      // Use the first fulfilled result containing an epub
      for (let i = 0; i < results.length; i++) {
        const res = results[i];
        const pathNames = ["getUserData", "getPublicData", "getProfileData", "getRootData", "getDirectData", "getAppUserData"];
        
        if (res.status === "fulfilled") {
          const value: any = res.value;
          console.log(`🔍 ${pathNames[i]}: Found data:`, value ? "YES" : "NO", value?.epub ? "with EPUB" : "no EPUB");
          
          if (value && value.epub) {
            console.log(`✅ Found EPUB via ${pathNames[i]}:`, value.epub.substring(0, 20) + "...");
            this.epubCache.set(recipientPub, {
              epub: value.epub,
              timestamp: Date.now(),
            });
            return value.epub;
          }
        } else {
          console.log(`❌ ${pathNames[i]}: Failed -`, res.reason?.message || "Unknown error");
        }
      }

      // If all else fails and we haven't exceeded retry limit, retry
      if (retryCount < maxRetries) {
        console.warn(
          `⚠️ Encryption key fetch failed, retrying (${retryCount + 1}/${maxRetries}) for: ${recipientPub.slice(0, 8)}...`
        );
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * (retryCount + 1))
        ); // Exponential backoff
        return this._getRecipientEpubInternal(recipientPub, retryCount + 1);
      }

      // If all else fails, throw an error instead of creating a temporary epub
      throw new Error(
        `Cannot find encryption public key (epub) for recipient: ${recipientPub.slice(0, 8)}... after ${maxRetries} retries`
      );
    } catch (error) {
      console.error("❌ getRecipientEpub error:", error);
      throw error;
    }
  }

  /**
   * **NEW: Get cached encryption public key without fetching**
   */
  public getCachedEpub(recipientPub: string): string | null {
    const cached = this.epubCache.get(recipientPub);
    if (cached && Date.now() - cached.timestamp < 300000) {
      // Cache is valid for 5 minutes
      return cached.epub;
    }
    return null;
  }

  /**
   * **PRODUCTION: Optimized helper method to get user data with timeout**
   */
  private async getUserData(
    recipientPub: string,
    timeout: number
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout getting user data"));
      }, timeout);

      const recipientUser = this.core.db.gun.user(recipientPub);
      recipientUser.get("is").on((data: any) => {
        clearTimeout(timeoutId);
        resolve(data);
      });
    });
  }

  /**
   * **PRODUCTION: Optimized helper method to get public data with timeout**
   */
  private async getPublicData(
    recipientPub: string,
    timeout: number
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout getting public data"));
      }, timeout);

      this.core.db.gun.get("~" + recipientPub).on((data: any) => {
        clearTimeout(timeoutId);
        resolve(data);
      });
    });
  }

  /**
   * **PRODUCTION: Optimized helper method to get profile data with timeout**
   */
  private async getProfileData(
    recipientPub: string,
    timeout: number
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout getting profile data"));
      }, timeout);

      const recipientUser = this.core.db.gun.user(recipientPub);
      recipientUser.get("profile").on((data: any) => {
        clearTimeout(timeoutId);
        resolve(data);
      });
    });
  }

  /**
   * **PRODUCTION: Optimized helper method to get root data with timeout**
   */
  private async getRootData(
    recipientPub: string,
    timeout: number
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout getting root data"));
      }, timeout);

      const recipientUser = this.core.db.gun.user(recipientPub);
      recipientUser.get("~").on((data: any) => {
        clearTimeout(timeoutId);
        resolve(data);
      });
    });
  }

  /**
   * **PRODUCTION: Optimized helper method to get direct data with timeout**
   */
  private async getDirectData(
    recipientPub: string,
    timeout: number
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout getting direct data"));
      }, timeout);

      this.core.db.gun.get(recipientPub).on((data: any) => {
        clearTimeout(timeoutId);
        resolve(data);
      });
    });
  }

  /**
   * **NEW: Get user data from the app's user registry (shogun/users/{pub})**
   */
  private async getAppUserData(
    recipientPub: string,
    timeout: number
  ): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error("Timeout getting app user data"));
      }, timeout);

      console.log("🔍 getAppUserData: Searching for user in shogun/users/", recipientPub.substring(0, 20) + "...");

      this.core.db.gun
        .get("shogun")
        .get("users")
        .get(recipientPub)
        .on((data: any) => {
          clearTimeout(timeoutId);
          console.log("🔍 getAppUserData: Found data:", data ? "YES" : "NO", data?.epub ? "with EPUB" : "no EPUB");
          resolve(data);
        });
    });
  }

  /**
   * **PRODUCTION: Encrypts the entire MessageData object using E2E encryption**
   */
  public async encryptMessage(
    messageData: MessageData,
    recipientPub: string
  ): Promise<string> {
    // Input validation
    if (!messageData || !recipientPub) {
      throw new Error("Message data and recipient public key are required");
    }

    if (!messageData.content || typeof messageData.content !== "string") {
      throw new Error("Message content is required and must be a string");
    }

    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      throw new Error("User key pair not available");
    }

    // Get the recipient's encryption public key
    const recipientEpub = await this.getRecipientEpub(recipientPub);

    // Use E2E encryption: derive a shared secret and encrypt with it
    const sharedSecret = await this.core.db.sea.secret(
      recipientEpub,
      currentUserPair
    );

    if (!sharedSecret) {
      throw new Error("Unable to derive shared secret");
    }

    const encryptedData = await this.core.db.sea.encrypt(
      JSON.stringify(messageData),
      sharedSecret
    );

    if (!encryptedData || typeof encryptedData !== "string") {
      throw new Error("Error during message encryption");
    }

    return encryptedData;
  }

  /**
   * **PRODUCTION: Decrypts correctly using E2E decryption**
   */
  public async decryptMessage(
    encryptedData: string,
    currentUserPair: any,
    senderPub: string
  ): Promise<MessageData> {
    // Add null checks for input parameters
    if (!encryptedData || typeof encryptedData !== "string") {
      throw new Error("Invalid encrypted data provided");
    }

    if (!currentUserPair) {
      throw new Error("Current user pair is required for decryption");
    }

    if (!senderPub || typeof senderPub !== "string") {
      throw new Error("Sender public key is required for decryption");
    }

    // Get the sender's encryption public key
    const senderEpub = await this.getRecipientEpub(senderPub);

    // Use E2E decryption: derive the shared secret from the sender
    const sharedSecret = await this.core.db.sea.secret(
      senderEpub,
      currentUserPair
    );
    if (!sharedSecret) {
      throw new Error("Unable to derive shared secret from sender");
    }

    const decryptedJson = await this.core.db.sea.decrypt(
      encryptedData,
      sharedSecret
    );

    let messageData: MessageData;

    if (typeof decryptedJson === "string") {
      // SEA.decrypt returned a JSON string; parse it
      try {
        messageData = JSON.parse(decryptedJson) as MessageData;
      } catch (parseError) {
        throw new Error("Error parsing decrypted message JSON");
      }
    } else if (typeof decryptedJson === "object" && decryptedJson !== null) {
      // SEA.decrypt returned the parsed object directly
      messageData = decryptedJson as MessageData;
    } else {
      throw new Error("Decryption error: invalid result");
    }

    return messageData;
  }

  /**
   * **PRODUCTION: Verifies message signature**
   */
  public async verifyMessageSignature(
    content: string,
    signature: string,
    senderPub: string
  ): Promise<boolean> {
    try {
      // Input validation
      if (!content || !signature || !senderPub) {
        return false;
      }

      // SEA.verify returns the original data if signature is valid, otherwise falsy
      const recovered = await this.core.db.sea.verify(signature, senderPub);

      // Compare against the expected content. Keep strict equality on strings,
      // and fallback to JSON comparison if recovered is an object.
      if (typeof recovered === "string") {
        return recovered === content;
      }

      if (recovered && typeof recovered === "object") {
        try {
          const recoveredJson = JSON.stringify(recovered);
          return recoveredJson === content;
        } catch (error) {
          return false;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * **PRODUCTION: Ensures the current user's epub is published to the network**
   */
  public async ensureUserEpubPublished(): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return;
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair || !currentUserPair.epub) {
        return;
      }

      // Publish epub to user's public space
      const user = this.core.db.gun.user(currentUserPair.pub);

      // Publish to user's "is" data
      user.get("is").put({
        epub: currentUserPair.epub,
        pub: currentUserPair.pub,
        alias:
          currentUserPair.alias || `User_${currentUserPair.pub.slice(0, 8)}`,
      });

      // Also publish to public space
      this.core.db.gun.get("~" + currentUserPair.pub).put({
        epub: currentUserPair.epub,
        pub: currentUserPair.pub,
        alias:
          currentUserPair.alias || `User_${currentUserPair.pub.slice(0, 8)}`,
      });
    } catch (error) {
      // Silent error handling
    }
  }

  /**
   * **PRODUCTION: Clear cache for memory management**
   */
  public clearCache(): void {
    this.epubCache.clear();
  }

  /**
   * **PRODUCTION: Get cache statistics**
   */
  public getCacheStats(): {
    size: number;
    entries: Array<{ key: string; age: number }>;
  } {
    const now = Date.now();
    const entries = Array.from(this.epubCache.entries()).map(
      ([key, value]) => ({
        key: key.slice(0, 8) + "...",
        age: now - value.timestamp,
      })
    );

    return {
      size: this.epubCache.size,
      entries,
    };
  }
}
