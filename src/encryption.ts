import { ShogunCore } from "shogun-core";
import { MessageData, EncryptedMessage } from "./types";

/**
 * Encryption utilities for the messaging plugin
 */
export class EncryptionManager {
  private core: ShogunCore;

  constructor(core: ShogunCore) {
    this.core = core;
  }

  /**
   * Gets the recipient's encryption public key (epub) from their signing public key (pub)
   */
  public async getRecipientEpub(recipientPub: string): Promise<string> {
    console.log(
      `[EncryptionManager] 🔍 Getting recipient epub for: ${recipientPub.slice(0, 8)}...`
    );

    try {
      // First fallback: try to get from the user's own data if they're trying to message themselves
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (currentUserPair && currentUserPair.pub === recipientPub) {
        console.log(
          `[EncryptionManager] ✅ Using current user's epub for self-message`
        );
        return currentUserPair.epub;
      }

      // Try to get the recipient's user data from GunDB
      const recipientUser = this.core.db.gun.user(recipientPub);

      const userData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting user data (5s)"));
        }, 5000);

        recipientUser.get("is").once((data: any) => {
          clearTimeout(timeout);
          console.log(`[EncryptionManager] 🔍 User data received:`, data);
          resolve(data);
        });
      });

      if (userData && userData.epub) {
        console.log(
          `[EncryptionManager] ✅ Found epub in user data: ${userData.epub.slice(0, 8)}...`
        );
        return userData.epub;
      }

      // Fallback: try to get from user's public space
      console.log(`[EncryptionManager] 🔄 Trying public space fallback...`);
      const publicData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting public data (5s)"));
        }, 5000);

        this.core.db.gun.get("~" + recipientPub).once((data: any) => {
          clearTimeout(timeout);
          console.log(`[EncryptionManager] 🔍 Public data received:`, data);
          resolve(data);
        });
      });

      if (publicData && publicData.epub) {
        console.log(
          `[EncryptionManager] ✅ Found epub in public data: ${publicData.epub.slice(0, 8)}...`
        );
        return publicData.epub;
      }

      // Third fallback: try to get from the user's profile data
      console.log(`[EncryptionManager] 🔄 Trying profile data fallback...`);
      const profileData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting profile data (5s)"));
        }, 5000);

        recipientUser.get("profile").once((data: any) => {
          clearTimeout(timeout);
          console.log(`[EncryptionManager] 🔍 Profile data received:`, data);
          resolve(data);
        });
      });

      if (profileData && profileData.epub) {
        console.log(
          `[EncryptionManager] ✅ Found epub in profile data: ${profileData.epub.slice(0, 8)}...`
        );
        return profileData.epub;
      }

      // Fourth fallback: try to get from the user's root data
      console.log(`[EncryptionManager] 🔄 Trying root data fallback...`);
      const rootData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting root data (5s)"));
        }, 5000);

        recipientUser.get("~").once((data: any) => {
          clearTimeout(timeout);
          console.log(`[EncryptionManager] 🔍 Root data received:`, data);
          resolve(data);
        });
      });

      if (rootData && rootData.epub) {
        console.log(
          `[EncryptionManager] ✅ Found epub in root data: ${rootData.epub.slice(0, 8)}...`
        );
        return rootData.epub;
      }

      // Fifth fallback: try to get from the user's public key directly
      console.log(`[EncryptionManager] 🔄 Trying direct pub key fallback...`);
      const directData = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Timeout getting direct data (5s)"));
        }, 5000);

        this.core.db.gun.get(recipientPub).once((data: any) => {
          clearTimeout(timeout);
          console.log(`[EncryptionManager] 🔍 Direct data received:`, data);
          resolve(data);
        });
      });

      if (directData && directData.epub) {
        console.log(
          `[EncryptionManager] ✅ Found epub in direct data: ${directData.epub.slice(0, 8)}...`
        );
        return directData.epub;
      }

      // If all else fails, throw an error instead of creating a temporary epub
      console.error(
        `[EncryptionManager] ❌ Could not find epub for recipient: ${recipientPub.slice(0, 8)}...`
      );
      console.error(
        `[EncryptionManager] ❌ Tried all fallback methods but no epub found`
      );

      throw new Error(
        `Cannot find encryption public key (epub) for recipient: ${recipientPub.slice(0, 8)}...`
      );
    } catch (error: any) {
      console.error(
        `[EncryptionManager] ❌ Error getting recipient epub:`,
        error
      );

      // If we're trying to message ourselves and all else fails, use our own epub
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (currentUserPair && currentUserPair.pub === recipientPub) {
        console.log(
          `[EncryptionManager] 🔄 Fallback to current user's epub due to error`
        );
        return currentUserPair.epub;
      }

      throw new Error(`Cannot get recipient encryption key: ${error.message}`);
    }
  }

  /**
   * Encrypts the entire MessageData object using E2E encryption
   */
  public async encryptMessage(
    messageData: MessageData,
    recipientPub: string
  ): Promise<string> {
    const currentUserPair = (this.core.db.user as any)._?.sea;
    if (!currentUserPair) {
      throw new Error("Coppia di chiavi utente non disponibile");
    }

    // Get the recipient's encryption public key
    const recipientEpub = await this.getRecipientEpub(recipientPub);

    // Usa E2E encryption: deriva un secret condiviso e cifra con quello
    const sharedSecret = await this.core.db.crypto.secret(
      recipientEpub,
      currentUserPair
    );

    if (!sharedSecret) {
      throw new Error("Impossibile derivare il secret condiviso");
    }

    const encryptedData = await this.core.db.crypto.encrypt(
      JSON.stringify(messageData),
      sharedSecret
    );

    if (!encryptedData || typeof encryptedData !== "string") {
      throw new Error("Errore nella cifratura del messaggio");
    }

    return encryptedData;
  }

  /**
   * Decrypts correctly using E2E decryption
   */
  public async decryptMessage(
    encryptedData: string,
    currentUserPair: any,
    senderPub: string
  ): Promise<MessageData> {
    // Get the sender's encryption public key
    const senderEpub = await this.getRecipientEpub(senderPub);

    // Usa E2E decryption: deriva il secret condiviso dal mittente
    const sharedSecret = await this.core.db.crypto.secret(
      senderEpub,
      currentUserPair
    );
    if (!sharedSecret) {
      throw new Error("Impossibile derivare il secret condiviso dal mittente");
    }

    // Decifra usando il secret condiviso
    const decryptedJson = await this.core.db.crypto.decrypt(
      encryptedData,
      sharedSecret
    );

    let messageData: MessageData;

    if (typeof decryptedJson === "string") {
      // SEA.decrypt returned a JSON string, parse it
      try {
        messageData = JSON.parse(decryptedJson) as MessageData;
      } catch (parseError) {
        throw new Error("Errore nel parsing del messaggio decifrato");
      }
    } else if (typeof decryptedJson === "object" && decryptedJson !== null) {
      // SEA.decrypt returned the parsed object directly
      messageData = decryptedJson as MessageData;
    } else {
      throw new Error("Errore nella decifratura: risultato non valido");
    }

    return messageData;
  }

  /**
   * Verifies message signature
   */
  public async verifyMessageSignature(
    content: string,
    signature: string,
    senderPub: string
  ): Promise<boolean> {
    try {
      const isValid = await this.core.db.sea.verify(signature, senderPub);
      return !!isValid;
    } catch (error) {
      console.error(`[EncryptionManager] ❌ Errore verifica firma:`, error);
      return false;
    }
  }

  /**
   * Ensures the current user's epub is published to the network
   */
  public async ensureUserEpubPublished(): Promise<void> {
    if (!this.core.isLoggedIn() || !this.core.db.user) {
      return;
    }

    try {
      const currentUserPair = (this.core.db.user as any)._?.sea;
      if (!currentUserPair || !currentUserPair.epub) {
        console.log(
          `[EncryptionManager] ⚠️ No user pair or epub available for publishing`
        );
        return;
      }

      console.log(`[EncryptionManager] 📡 Publishing user epub to network...`);

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

      console.log(`[EncryptionManager] ✅ User epub published successfully`);
    } catch (error) {
      console.error(
        `[EncryptionManager] ❌ Error publishing user epub:`,
        error
      );
    }
  }
}
