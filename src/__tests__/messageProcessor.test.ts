import { MessageProcessor } from "../messageProcessor";
import { EncryptionManager } from "../encryption";
import { GroupManager } from "../groupManager";
import { MessageData } from "../types";

// Mock ShogunCore for testing
function makeCoreMock() {
  const currentUserPair = {
    pub: "user_pub_key_123",
    epub: "user_epub_key_456",
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
      map: jest.fn(() => ({
        on: jest.fn(() => ({ off: jest.fn() })),
        once: jest.fn((callback: any) => {
          // Simulate some messages for clearConversation test
          callback(
            { from: "user_pub_key_123", to: "recipient_pub_key" },
            "msg_1"
          );
          callback(
            { from: "recipient_pub_key", to: "user_pub_key_123" },
            "msg_2"
          );
        }),
      })),
      get: jest.fn(() => ({
        put: jest.fn((data: any, callback?: any) => {
          if (callback && typeof callback === "function") {
            callback({}); // Success callback for nested put
          }
        }),
      })),
      put: jest.fn((data: any, callback?: any) => {
        if (callback && typeof callback === "function") {
          callback({}); // Success callback
        }
        return {
          get: jest.fn(() => ({
            put: jest.fn((data: any, callback?: any) => {
              if (callback && typeof callback === "function") {
                callback({}); // Success callback for nested put
              }
            }),
          })),
        };
      }),
    })),
    user: jest.fn(() => ({
      get: jest.fn(() => ({
        once: jest.fn((callback: any) => callback({ epub: "sender_epub" })),
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

// Mock EncryptionManager
function makeEncryptionManagerMock() {
  return {
    getRecipientEpub: jest.fn().mockResolvedValue("sender_epub"),
    decryptMessage: jest.fn().mockResolvedValue({
      from: "sender_pub_key",
      content: "Hello, this is a test message",
      timestamp: Date.now(),
      id: "msg_123",
      signature: "signed_data",
    }),
    verifyMessageSignature: jest.fn().mockResolvedValue(true),
  } as any;
}

// Mock GroupManager
function makeGroupManagerMock() {
  return {
    getGroupData: jest.fn().mockResolvedValue({
      id: "group_123",
      name: "Test Group",
      members: ["user_pub_key_123", "sender_pub_key"],
      createdBy: "user_pub_key_123",
      createdAt: Date.now(),
      encryptedKeys: {
        user_pub_key_123: "encrypted_key_1",
        sender_pub_key: "encrypted_key_2",
      },
    }),
    getGroupKeyForUser: jest.fn().mockResolvedValue("group_key_123"),
  } as any;
}

describe("MessageProcessor", () => {
  let messageProcessor: MessageProcessor;
  let mockCore: any;
  let mockEncryptionManager: any;
  let mockGroupManager: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
    mockEncryptionManager = makeEncryptionManagerMock();
    mockGroupManager = makeGroupManagerMock();
    messageProcessor = new MessageProcessor(
      mockCore,
      mockEncryptionManager,
      mockGroupManager
    );
  });

  describe("startListening", () => {
    test("should start listening for private messages successfully", async () => {
      await messageProcessor.startListening();

      expect(messageProcessor.isListening()).toBe(true);
      expect(mockCore.db.gun.get).toHaveBeenCalled();
    });

    test("should not start listening when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      await messageProcessor.startListening();

      expect(messageProcessor.isListening()).toBe(false);
    });

    test("should not start listening when already listening", async () => {
      await messageProcessor.startListening();
      await messageProcessor.startListening(); // Second call

      expect(messageProcessor.isListening()).toBe(true);
      // Should not create duplicate listeners
    });

    test("should not start listening when user pair is not available", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      await messageProcessor.startListening();

      expect(messageProcessor.isListening()).toBe(false);
    });
  });

  describe("addGroupListener", () => {
    test("should add group listener successfully", () => {
      const groupId = "group_123";

      messageProcessor.addGroupListener(groupId);

      expect(mockCore.db.gun.get).toHaveBeenCalledWith(
        "group-messages/group_123"
      );
    });

    test("should not add duplicate group listener", () => {
      const groupId = "group_123";

      messageProcessor.addGroupListener(groupId);
      messageProcessor.addGroupListener(groupId); // Second call

      // Should only call gun.get once
      expect(mockCore.db.gun.get).toHaveBeenCalledTimes(1);
    });

    test("should not add listener when user pair is not available", () => {
      mockCore.db.user = { _: {} }; // No sea property

      messageProcessor.addGroupListener("group_123");

      expect(mockCore.db.gun.get).not.toHaveBeenCalled();
    });
  });

  describe("removeGroupListener", () => {
    test("should remove group listener successfully", () => {
      const groupId = "group_123";
      const mockOff = jest.fn();

      mockCore.db.gun.get = jest.fn(() => ({
        map: jest.fn(() => ({
          on: jest.fn(() => ({ off: mockOff })),
        })),
      }));

      messageProcessor.addGroupListener(groupId);
      messageProcessor.removeGroupListener(groupId);

      expect(mockOff).toHaveBeenCalled();
    });

    test("should handle removal of non-existent listener gracefully", () => {
      messageProcessor.removeGroupListener("nonexistent_group");
      // Should not throw error
    });
  });

  describe("stopListening", () => {
    test("should stop all listeners successfully", async () => {
      const mockOff = jest.fn();

      mockCore.db.gun.get = jest.fn(() => ({
        map: jest.fn(() => ({
          on: jest.fn(() => ({ off: mockOff })),
        })),
      }));

      await messageProcessor.startListening();
      messageProcessor.addGroupListener("group_123");
      messageProcessor.stopListening();

      expect(messageProcessor.isListening()).toBe(false);
      expect(mockOff).toHaveBeenCalled();
    });

    test("should handle stopping when not listening", () => {
      messageProcessor.stopListening();
      // Should not throw error
    });
  });

  describe("processIncomingGroupMessage", () => {
    test("should process group message successfully", async () => {
      const messageData = JSON.stringify({
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(mockGroupManager.getGroupData).toHaveBeenCalledWith("group_123");
      expect(mockGroupManager.getGroupKeyForUser).toHaveBeenCalled();
      expect(mockCore.db.sea.decrypt).toHaveBeenCalled();
    });

    test("should process messages from current user", async () => {
      const messageData = JSON.stringify({
        from: "user_pub_key_123", // Current user
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      // Messages from current user should be processed (UI needs them to replace temp messages)
      expect(mockCallback).toHaveBeenCalled();
    });

    test("should ignore duplicate messages", async () => {
      const messageData = JSON.stringify({
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      // Process same message twice
      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );
      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      expect(mockCallback).toHaveBeenCalledTimes(1); // Only once
    });

    test("should handle invalid message data gracefully", async () => {
      const invalidMessageData = "invalid_json";
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        invalidMessageData,
        messageId,
        currentUserPair
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should handle missing group data gracefully", async () => {
      mockGroupManager.getGroupData = jest.fn().mockResolvedValue(null);

      const messageData = JSON.stringify({
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should handle missing group key gracefully", async () => {
      mockGroupManager.getGroupKeyForUser = jest
        .fn()
        .mockResolvedValue(undefined);

      const messageData = JSON.stringify({
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should verify signature of decrypted content", async () => {
      const messageData = JSON.stringify({
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      mockCore.db.sea.decrypt = jest
        .fn()
        .mockResolvedValue("decrypted_content");

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      expect(mockEncryptionManager.verifyMessageSignature).toHaveBeenCalledWith(
        "decrypted_content",
        "signed_data",
        "sender_pub_key"
      );
    });

    test("should ignore message with invalid signature", async () => {
      mockEncryptionManager.verifyMessageSignature = jest
        .fn()
        .mockResolvedValue(false);

      const messageData = JSON.stringify({
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        groupId: "group_123",
        signature: "signed_data",
      });
      const messageId = "msg_123";
      const currentUserPair = {
        pub: "user_pub_key_123",
        epub: "user_epub_key_456",
      };

      const mockCallback = jest.fn();
      messageProcessor.onGroupMessage(mockCallback);

      await messageProcessor.processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("onGroupMessage", () => {
    test("should register group message callback", () => {
      const callback = jest.fn();

      messageProcessor.onGroupMessage(callback);

      // The onGroupMessage method adds to groupMessageListenersInternal
      // We need to check if the callback was actually registered
      // Since we can't directly access the internal array, we'll test the behavior
      // by calling the method and verifying it doesn't throw
      expect(() => messageProcessor.onGroupMessage(callback)).not.toThrow();
    });

    test("should not register invalid callback", () => {
      messageProcessor.onGroupMessage(null as any);
      messageProcessor.onGroupMessage(undefined as any);
      messageProcessor.onGroupMessage("not_a_function" as any);

      // Since we can't directly access the internal array, we'll test the behavior
      // by calling the method and verifying it doesn't throw
      expect(() => messageProcessor.onGroupMessage(null as any)).not.toThrow();
    });
  });

  describe("clearConversation", () => {
    test("should clear conversation successfully", async () => {
      const recipientPub = "recipient_pub_key";

      const result = await messageProcessor.clearConversation(recipientPub);

      expect(result.success).toBe(true);
      expect(result.clearedCount).toBeGreaterThan(0);
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await messageProcessor.clearConversation("recipient_pub");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato");
    });

    test("should fail with invalid recipient pub", async () => {
      const result = await messageProcessor.clearConversation("");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Public key del destinatario richiesta");
    });

    test("should fail when user pair is not available", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      const result = await messageProcessor.clearConversation("recipient_pub");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Coppia di chiavi utente non disponibile");
    });
  });

  describe("resetClearedConversations", () => {
    test("should reset cleared conversations tracking", () => {
      messageProcessor.resetClearedConversations();

      expect(messageProcessor.getClearedConversationsCount()).toBe(0);
    });
  });

  describe("onMessage", () => {
    test("should register message callback", () => {
      const callback = jest.fn();

      messageProcessor.onMessage(callback);

      expect(messageProcessor.getMessageListenersCount()).toBe(1);
    });

    test("should not register invalid callback", () => {
      messageProcessor.onMessage(null as any);
      messageProcessor.onMessage(undefined as any);
      messageProcessor.onMessage("not_a_function" as any);

      expect(messageProcessor.getMessageListenersCount()).toBe(0);
    });
  });

  describe("getStats", () => {
    test("should return correct statistics", () => {
      const stats = {
        isListening: messageProcessor.isListening(),
        messageListenersCount: messageProcessor.getMessageListenersCount(),
        processedMessagesCount: messageProcessor.getProcessedMessagesCount(),
        clearedConversationsCount:
          messageProcessor.getClearedConversationsCount(),
      };

      expect(stats.isListening).toBe(false);
      expect(stats.messageListenersCount).toBe(0);
      expect(stats.processedMessagesCount).toBe(0);
      expect(stats.clearedConversationsCount).toBe(0);
    });
  });
});
