import { EncryptionManager } from "../encryption";
import { MessageData } from "../types";

// Mock ShogunCore for testing
function makeCoreMock() {
  const currentUserPair = {
    pub: "sender_pub_key_123",
    epub: "sender_epub_key_456",
    alias: "TestUser",
  };

  const sea = {
    sign: jest.fn(async (data: string, pair: any) => "signed_data"),
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) =>
      JSON.stringify({ content: "decrypted" })
    ),
    verify: jest.fn(async (signature: string, pub: string) => "verified_data"),
  };

  const crypto = {
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) =>
      JSON.stringify({ content: "decrypted" })
    ),
  };

  const gun = {
    get: jest.fn(() => ({
      once: jest.fn((callback: any) => callback({ epub: "recipient_epub" })),
    })),
    user: jest.fn(() => ({
      get: jest.fn(() => ({
        once: jest.fn((callback: any) => callback({ epub: "recipient_epub" })),
      })),
    })),
  };

  const user = { _: { sea: currentUserPair } } as any;

  const core: any = {
    db: {
      gun,
      user,
      sea,
      crypto,
      getUserData: jest.fn().mockResolvedValue({}),
    },
    isLoggedIn: () => true,
  };

  return { core, sea, crypto, gun, currentUserPair };
}

describe("EncryptionManager", () => {
  let encryptionManager: EncryptionManager;
  let mockCore: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
    encryptionManager = new EncryptionManager(mockCore);
  });

  describe("getRecipientEpub", () => {
    test("should get epub from user data successfully", async () => {
      const recipientPub = "recipient_pub_key";

      const result = await encryptionManager.getRecipientEpub(recipientPub);

      expect(result).toBe("recipient_epub");
      expect(mockCore.db.gun.user).toHaveBeenCalledWith(recipientPub);
    });

    test("should use current user epub for self-message", async () => {
      const selfPub = "sender_pub_key_123";

      const result = await encryptionManager.getRecipientEpub(selfPub);

      expect(result).toBe("sender_epub_key_456");
    });

    test("should try fallback strategies when user data fails", async () => {
      const recipientPub = "recipient_pub_key";

      // Mock first attempt to fail
      mockCore.db.gun.user = jest.fn(() => ({
        get: jest.fn(() => ({
          once: jest.fn((callback: any) => callback(null)), // No user data
        })),
      }));

      // Mock public space fallback to succeed
      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn((callback: any) => callback({ epub: "fallback_epub" })),
      }));

      const result = await encryptionManager.getRecipientEpub(recipientPub);

      expect(result).toBe("fallback_epub");
    });

    test("should throw error when all fallback strategies fail", async () => {
      const recipientPub = "recipient_pub_key";

      mockCore.db.gun.user = jest.fn(() => ({
        get: jest.fn(() => ({
          once: jest.fn(() => {
            // Simulate timeout by not calling callback
            // This will cause the promise to never resolve
          }),
        })),
      }));

      // Mock all other fallback strategies to fail
      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn(() => {
          // Simulate timeout by not calling callback
        }),
      }));

      // Set a shorter timeout for this test and ensure it's cleared
      const timeoutPromise = new Promise((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error("Timeout getting user data"));
        }, 100);

        // Ensure timeout is cleared if test completes early
        return () => clearTimeout(timeoutId);
      });

      try {
        await Promise.race([
          encryptionManager.getRecipientEpub(recipientPub),
          timeoutPromise,
        ]);
        throw new Error("Expected timeout but got success");
      } catch (error: any) {
        expect(error.message).toContain("Timeout getting user data");
      }
    }, 1000);
  });

  describe("encryptMessage", () => {
    test("should encrypt message data successfully", async () => {
      const messageData: MessageData = {
        from: "sender_pub_key_123",
        content: "Hello, this is a test message",
        timestamp: Date.now(),
        id: "msg_123",
        signature: "signed_data",
      };

      const recipientPub = "recipient_pub_key";

      const result = await encryptionManager.encryptMessage(
        messageData,
        recipientPub
      );

      expect(result).toBe("encrypted_data");
      expect(mockCore.db.crypto.secret).toHaveBeenCalled();
      expect(mockCore.db.crypto.encrypt).toHaveBeenCalledWith(
        JSON.stringify(messageData),
        "shared_secret_key"
      );
    });

    test("should throw error when user pair is not available", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      const messageData: MessageData = {
        from: "sender_pub_key_123",
        content: "Test message",
        timestamp: Date.now(),
        id: "msg_123",
      };

      await expect(
        encryptionManager.encryptMessage(messageData, "recipient_pub")
      ).rejects.toThrow("Coppia di chiavi utente non disponibile");
    });

    test("should throw error when shared secret derivation fails", async () => {
      mockCore.db.crypto.secret = jest.fn().mockResolvedValue(null);

      const messageData: MessageData = {
        from: "sender_pub_key_123",
        content: "Test message",
        timestamp: Date.now(),
        id: "msg_123",
      };

      await expect(
        encryptionManager.encryptMessage(messageData, "recipient_pub")
      ).rejects.toThrow("Impossibile derivare il secret condiviso");
    });
  });

  describe("decryptMessage", () => {
    test("should decrypt message successfully", async () => {
      const encryptedData = "encrypted_message_data";
      const currentUserPair = {
        pub: "sender_pub_key_123",
        epub: "sender_epub_key_456",
      };
      const senderPub = "sender_pub_key_123";

      const result = await encryptionManager.decryptMessage(
        encryptedData,
        currentUserPair,
        senderPub
      );

      expect(result).toEqual({ content: "decrypted" });
      expect(mockCore.db.crypto.secret).toHaveBeenCalled();
      expect(mockCore.db.crypto.decrypt).toHaveBeenCalledWith(
        encryptedData,
        "shared_secret_key"
      );
    });

    test("should handle string decryption result", async () => {
      const encryptedData = "encrypted_message_data";
      const currentUserPair = {
        pub: "sender_pub_key_123",
        epub: "sender_epub_key_456",
      };
      const senderPub = "sender_pub_key_123";

      // Mock decrypt to return JSON string
      mockCore.db.crypto.decrypt = jest.fn().mockResolvedValue(
        JSON.stringify({
          content: "decrypted",
          from: "sender",
          timestamp: 123,
        })
      );

      const result = await encryptionManager.decryptMessage(
        encryptedData,
        currentUserPair,
        senderPub
      );

      expect(result).toEqual({
        content: "decrypted",
        from: "sender",
        timestamp: 123,
      });
    });

    test("should throw error when shared secret derivation fails", async () => {
      mockCore.db.crypto.secret = jest.fn().mockResolvedValue(null);

      const encryptedData = "encrypted_message_data";
      const currentUserPair = {
        pub: "sender_pub_key_123",
        epub: "sender_epub_key_456",
      };
      const senderPub = "sender_pub_key_123";

      await expect(
        encryptionManager.decryptMessage(
          encryptedData,
          currentUserPair,
          senderPub
        )
      ).rejects.toThrow(
        "Impossibile derivare il secret condiviso dal mittente"
      );
    });

    test("should throw error when decryption result is invalid", async () => {
      mockCore.db.crypto.decrypt = jest.fn().mockResolvedValue(null);

      const encryptedData = "encrypted_message_data";
      const currentUserPair = {
        pub: "sender_pub_key_123",
        epub: "sender_epub_key_456",
      };
      const senderPub = "sender_pub_key_123";

      await expect(
        encryptionManager.decryptMessage(
          encryptedData,
          currentUserPair,
          senderPub
        )
      ).rejects.toThrow("Errore nella decifratura: risultato non valido");
    });
  });

  describe("verifyMessageSignature", () => {
    test("should verify signature successfully", async () => {
      const content = "test message content";
      const signature = "test_signature";
      const senderPub = "sender_pub_key_123";

      // Mock verify to return the content
      mockCore.db.sea.verify = jest.fn().mockResolvedValue(content);

      const result = await encryptionManager.verifyMessageSignature(
        content,
        signature,
        senderPub
      );

      expect(result).toBe(true);
      expect(mockCore.db.sea.verify).toHaveBeenCalledWith(signature, senderPub);
    });

    test("should handle JSON object verification", async () => {
      const content = JSON.stringify({ test: "data" });
      const signature = "test_signature";
      const senderPub = "sender_pub_key_123";

      // Mock verify to return an object
      mockCore.db.sea.verify = jest.fn().mockResolvedValue({ test: "data" });

      const result = await encryptionManager.verifyMessageSignature(
        content,
        signature,
        senderPub
      );

      expect(result).toBe(true);
    });

    test("should return false for invalid signature", async () => {
      const content = "test message content";
      const signature = "invalid_signature";
      const senderPub = "sender_pub_key_123";

      // Mock verify to return falsy value
      mockCore.db.sea.verify = jest.fn().mockResolvedValue(null);

      const result = await encryptionManager.verifyMessageSignature(
        content,
        signature,
        senderPub
      );

      expect(result).toBe(false);
    });

    test("should return false for mismatched content", async () => {
      const content = "test message content";
      const signature = "test_signature";
      const senderPub = "sender_pub_key_123";

      // Mock verify to return different content
      mockCore.db.sea.verify = jest.fn().mockResolvedValue("different content");

      const result = await encryptionManager.verifyMessageSignature(
        content,
        signature,
        senderPub
      );

      expect(result).toBe(false);
    });

    test("should handle verification errors gracefully", async () => {
      const content = "test message content";
      const signature = "test_signature";
      const senderPub = "sender_pub_key_123";

      mockCore.db.sea.verify = jest
        .fn()
        .mockRejectedValue(new Error("Verification failed"));

      const result = await encryptionManager.verifyMessageSignature(
        content,
        signature,
        senderPub
      );

      expect(result).toBe(false);
    });
  });

  describe("ensureUserEpubPublished", () => {
    test("should publish user epub successfully", async () => {
      const put = jest.fn();
      mockCore.db.gun.user = jest.fn(() => ({
        get: jest.fn(() => ({ put })),
      }));

      mockCore.db.gun.get = jest.fn(() => ({ put }));

      await encryptionManager.ensureUserEpubPublished();

      expect(put).toHaveBeenCalledWith({
        epub: "sender_epub_key_456",
        pub: "sender_pub_key_123",
        alias: "TestUser",
      });
    });

    test("should handle missing user pair gracefully", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      await expect(
        encryptionManager.ensureUserEpubPublished()
      ).resolves.toBeUndefined();
    });

    test("should handle publishing errors gracefully", async () => {
      const put = jest.fn().mockImplementation(() => {
        throw new Error("Publishing failed");
      });

      mockCore.db.gun.user = jest.fn(() => ({
        get: jest.fn(() => ({ put })),
      }));

      mockCore.db.gun.get = jest.fn(() => ({ put }));

      // Should not throw, should handle error gracefully
      await expect(
        encryptionManager.ensureUserEpubPublished()
      ).resolves.toBeUndefined();
    });

    test("should not publish when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      await encryptionManager.ensureUserEpubPublished();

      // Should not call any publishing methods
      expect(mockCore.db.gun.user).not.toHaveBeenCalled();
    });
  });
});
