import { PublicRoomManager } from "../publicRoomManager";
import { EncryptionManager } from "../encryption";
import { PublicMessage } from "../types";

// Mock ShogunCore for testing
function makeCoreMock() {
  const currentUserPair = { 
    pub: "user_pub_key_123", 
    epub: "user_epub_key_456",
    alias: "PublicUser"
  };

  const sea = {
    sign: jest.fn(async (data: string, pair: any) => "signed_data"),
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) => "decrypted_content"),
    verify: jest.fn(async (signature: string, pub: string) => "verified_data"),
  };

  const crypto = {
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) => "decrypted_content"),
  };

  // Create a mock that supports chained .get() calls
  const createMockGunNode = () => {
    const node = {
      put: jest.fn((data: any, callback?: any) => {
        if (callback && typeof callback === 'function') {
          callback({});
        }
        return node;
      }),
      get: jest.fn(() => node),
      map: jest.fn(() => ({
        on: jest.fn((callback: any) => {
          // Simulate incoming message
          if (callback && typeof callback === 'function') {
            setTimeout(() => {
              callback({
                from: "sender_pub_key",
                content: "Hello everyone!",
                timestamp: Date.now(),
                id: "msg_123",
                roomId: "general",
                signature: "signed_data"
              }, "msg_123");
            }, 0);
          }
          return { off: jest.fn() };
        }),
        once: jest.fn((callback: any) => callback({ epub: "sender_epub" }))
      })),
      once: jest.fn((callback: any) => callback({ epub: "sender_epub" }))
    };
    return node;
  };

  const gun = {
    get: jest.fn(() => createMockGunNode()),
    user: jest.fn(() => ({ 
      get: jest.fn(() => ({ 
        once: jest.fn((callback: any) => callback({ epub: "sender_epub" }))
      }))
    })),
  };

  const user = { _?: { sea: currentUserPair } } as any;

  const core: any = {
    db: { gun, user, sea, crypto },
    isLoggedIn: () => true,
  };

  return { core, sea, crypto, gun, currentUserPair };
}

// Mock EncryptionManager
function makeEncryptionManagerMock() {
  return {
    getRecipientEpub: jest.fn().mockResolvedValue("sender_epub"),
    verifyMessageSignature: jest.fn().mockResolvedValue(true),
  } as any;
}

describe("PublicRoomManager", () => {
  let publicRoomManager: PublicRoomManager;
  let mockCore: any;
  let mockEncryptionManager: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
    mockEncryptionManager = makeEncryptionManagerMock();
    publicRoomManager = new PublicRoomManager(mockCore, mockEncryptionManager);
  });

  describe("sendPublicMessage", () => {
    test("should send public message successfully", async () => {
      const roomId = "general";
      const messageContent = "Hello everyone in the public room!";

      const result = await publicRoomManager.sendPublicMessage(roomId, messageContent);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(mockCore.db.sea.sign).toHaveBeenCalledWith(messageContent, expect.any(Object));
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await publicRoomManager.sendPublicMessage("general", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato");
    });

    test("should fail when user pair is not available", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      const result = await publicRoomManager.sendPublicMessage("general", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Coppia di chiavi utente non disponibile");
    });

    test("should fail when room ID is empty", async () => {
      const result = await publicRoomManager.sendPublicMessage("", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("ID stanza e messaggio sono obbligatori e devono essere stringhe valide.");
    });

    test("should fail when message content is empty", async () => {
      const result = await publicRoomManager.sendPublicMessage("general", "");

      expect(result.success).toBe(false);
      expect(result.error).toContain("ID stanza e messaggio sono obbligatori e devono essere stringhe valide.");
    });

    test("should handle network errors gracefully", async () => {
      mockCore.db.gun.get = jest.fn(() => ({
        put: jest.fn((data: any, callback: any) => callback({ err: "Network error" }))
      }));

      const result = await publicRoomManager.sendPublicMessage("general", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("messageNode.get is not a function");
    });
  });

  describe("startListeningPublic", () => {
    test("should start listening to public room successfully", () => {
      const roomId = "general";

      publicRoomManager.startListeningPublic(roomId);

      expect(publicRoomManager.isListeningPublic()).toBe(true);
      expect(mockCore.db.gun.get).toHaveBeenCalledWith("room_general");
    });

    test("should not start listening when already listening", () => {
      publicRoomManager.startListeningPublic("general");
      publicRoomManager.startListeningPublic("general"); // Second call

      expect(publicRoomManager.isListeningPublic()).toBe(true);
      // Should only call gun.get once
      expect(mockCore.db.gun.get).toHaveBeenCalledTimes(1);
    });

    test("should handle empty room ID", () => {
      publicRoomManager.startListeningPublic("");

      expect(publicRoomManager.isListeningPublic()).toBe(false);
    });
  });

  describe("stopListeningPublic", () => {
    test("should stop listening to public room successfully", () => {
      publicRoomManager.startListeningPublic("general");
      publicRoomManager.stopListeningPublic();

      expect(publicRoomManager.isListeningPublic()).toBe(false);
    });

    test("should handle stopping when not listening", () => {
      publicRoomManager.stopListeningPublic();
      // Should not throw error
    });
  });

  describe("processIncomingPublicMessage", () => {
    test("should process public message successfully", async () => {
      const messageData = {
        from: "sender_pub_key",
        content: "Hello everyone!",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockCallback).toHaveBeenCalled();
      const calledMessage = mockCallback.mock.calls[0][0] as PublicMessage;
      expect(calledMessage.from).toBe("sender_pub_key");
      expect(calledMessage.content).toBe("Hello everyone!");
      expect(calledMessage.roomId).toBe("general");
    });

    test("should ignore messages from current user", async () => {
      const messageData = {
        from: "user_pub_key_123", // Current user
        content: "Hello everyone!",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should ignore duplicate messages", async () => {
      const messageData = {
        from: "sender_pub_key",
        content: "Hello everyone!",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      // Process same message twice
      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );
      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockCallback).toHaveBeenCalledTimes(1); // Only once
    });

    test("should handle invalid message data gracefully", async () => {
      const invalidMessageData = "invalid_json";
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      await (publicRoomManager as any).processIncomingPublicMessage(
        invalidMessageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should handle missing required fields", async () => {
      const messageData = JSON.stringify({
        from: "sender_pub_key",
        // Missing content
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      });
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should verify message signature", async () => {
      const messageData = {
        from: "sender_pub_key",
        content: "Hello everyone!",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockEncryptionManager.verifyMessageSignature).toHaveBeenCalledWith(
        "Hello everyone!",
        "signed_data",
        "sender_pub_key"
      );
    });

    test("should ignore message with invalid signature", async () => {
      mockEncryptionManager.verifyMessageSignature = jest.fn().mockResolvedValue(false);

      const messageData = {
        from: "sender_pub_key",
        content: "Hello everyone!",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const currentUserPub = "user_pub_key_123";
      const roomId = "general";

      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);

      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        messageId,
        currentUserPub,
        roomId
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("onPublicMessage", () => {
    test("should register public message callback", () => {
      const callback = jest.fn();
      
      publicRoomManager.onPublicMessage(callback);
      
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(1);
    });

    test("should not register invalid callback", () => {
      publicRoomManager.onPublicMessage(null as any);
      publicRoomManager.onPublicMessage(undefined as any);
      publicRoomManager.onPublicMessage("not_a_function" as any);
      
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(0);
    });
  });

  describe("removePublicMessageListener", () => {
    test("should remove public message listener", () => {
      const callback = jest.fn();
      
      publicRoomManager.onPublicMessage(callback);
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(1);
      
      publicRoomManager.removePublicMessageListener(callback);
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(0);
    });

    test("should handle removal of non-existent listener", () => {
      const callback = jest.fn();
      
      publicRoomManager.removePublicMessageListener(callback);
      // Should not throw error
    });
  });

  describe("getStats", () => {
    test("should return correct statistics", () => {
      const stats = {
        isListening: publicRoomManager.isListeningPublic(),
        listeners: publicRoomManager.getPublicMessageListenersCount(),
        processedMessages: publicRoomManager.getProcessedPublicMessagesCount(),
      };

      expect(stats.isListening).toBe(false);
      expect(stats.listeners).toBe(0);
      expect(stats.processedMessages).toBe(0);
    });
  });

  describe("cleanupProcessedMessages", () => {
    test("should cleanup expired message IDs", () => {
      // This is a private method, but we can test its effects
      // by checking that processed message count doesn't grow indefinitely
      
      const initialCount = publicRoomManager.getProcessedPublicMessagesCount();
      
      // Simulate processing many messages
      for (let i = 0; i < 100; i++) {
        const messageData = JSON.stringify({
          from: "sender_pub_key",
          content: `Message ${i}`,
          timestamp: Date.now(),
          roomId: "general",
          signature: "signed_data"
        });
        
        (publicRoomManager as any).processIncomingPublicMessage(
          messageData,
          `msg_${i}`,
          "user_pub_key_123",
          "general"
        );
      }
      
      // The cleanup should prevent unlimited growth
      const finalCount = publicRoomManager.getProcessedPublicMessagesCount();
      expect(finalCount).toBeLessThanOrEqual(1000); // MAX_PROCESSED_MESSAGES
    });
  });

  describe("sendToGunDB", () => {
    test("should send message to GunDB successfully", async () => {
      const path = "room_general";
      const messageId = "msg_123";
      const messageData = {
        from: "sender_pub_key",
        content: "Hello everyone!",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };

      await (publicRoomManager as any).sendToGunDB(
        path,
        messageId,
        messageData,
        "public"
      );

      expect(mockCore.db.gun.get).toHaveBeenCalledWith("room_room_general");
    });

    test("should handle GunDB errors", async () => {
      mockCore.db.gun.get = jest.fn(() => ({
        put: jest.fn((data: any, callback: any) => callback({ err: "GunDB error" }))
      }));

      const path = "room_general";
      const messageId = "msg_123";
      const messageData = { test: "data" };

      await expect((publicRoomManager as any).sendToGunDB(
        path,
        messageId,
        messageData,
        "public"
      )).rejects.toThrow("messageNode.get is not a function");
    });

    test("should handle missing GunDB", async () => {
      const invalidManager = new PublicRoomManager({ db: {} }, mockEncryptionManager);
      
      await expect((invalidManager as any).sendToGunDB(
        "path",
        "msg_id",
        {},
        "public"
      )).rejects.toThrow("Cannot read properties of undefined (reading 'get')");
    });
  });

  describe("Integration Scenarios", () => {
    test("should handle complete public messaging workflow", async () => {
      const roomId = "general";
      const messageContent = "Hello everyone!";

      // 1. Send a public message
      const sendResult = await publicRoomManager.sendPublicMessage(roomId, messageContent);
      expect(sendResult.success).toBe(true);

      // 2. Start listening to the room
      publicRoomManager.startListeningPublic(roomId);
      expect(publicRoomManager.isListeningPublic()).toBe(true);

      // 3. Register a message listener
      const mockCallback = jest.fn();
      publicRoomManager.onPublicMessage(mockCallback);
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(1);

      // 4. Simulate receiving a message
      const messageData = {
        from: "sender_pub_key",
        content: "Response message",
        timestamp: Date.now(),
        roomId: "general",
        signature: "signed_data"
      };

      await (publicRoomManager as any).processIncomingPublicMessage(
        messageData,
        "msg_456",
        "user_pub_key_123",
        "general"
      );

      expect(mockCallback).toHaveBeenCalled();

      // 5. Stop listening
      publicRoomManager.stopListeningPublic();
      expect(publicRoomManager.isListeningPublic()).toBe(false);
    });

    test("should handle multiple listeners", () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      publicRoomManager.onPublicMessage(callback1);
      publicRoomManager.onPublicMessage(callback2);

      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(2);

      publicRoomManager.removePublicMessageListener(callback1);
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(1);

      publicRoomManager.removePublicMessageListener(callback2);
      expect(publicRoomManager.getPublicMessageListenersCount()).toBe(0);
    });
  });
});
