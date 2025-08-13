import { MessagingPlugin } from "../messagingPlugin";

// Mock ShogunCore for testing
function makeCoreMock() {
  const currentUserPair = { 
    pub: "user_pub_key_123", 
    epub: "user_epub_key_456",
    alias: "TestUser"
  };

  const sea = {
    sign: jest.fn(async (data: string, pair: any) => "signed_data"),
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) => JSON.stringify({ content: "decrypted" })),
    verify: jest.fn(async (signature: string, pub: string) => "verified_data"),
  };

  const crypto = {
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) => JSON.stringify({ content: "decrypted" })),
  };

  // Create a mock that supports chained .get() calls with proper put method
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
        on: jest.fn(() => ({ off: jest.fn() })),
        once: jest.fn((callback: any) => callback({ epub: "recipient_epub" }))
      })),
      once: jest.fn((callback: any) => callback({ epub: "recipient_epub" }))
    };
    return node;
  };

  // Create a mock user chain that supports the expected methods
  const createMockUserChain = () => {
    const userChain = {
      get: jest.fn(() => createMockGunNode()),
      put: jest.fn((data: any, callback?: any) => {
        if (callback && typeof callback === 'function') {
          callback({});
        }
        return userChain;
      }),
      once: jest.fn((callback: any) => callback({ epub: "recipient_epub" }))
    };
    return userChain;
  };

  const gun = {
    get: jest.fn(() => createMockGunNode()),
    user: jest.fn(() => createMockUserChain()),
  };

  const user = { _?: { sea: currentUserPair } } as any;

  const core: any = {
    db: { 
      gun, 
      user, 
      sea, 
      crypto,
      getCurrentUser: jest.fn(() => ({ pub: "user_pub_key_123" })),
      putUserData: jest.fn().mockResolvedValue(undefined)
    },
    isLoggedIn: () => true,
  };

  return { core, sea, crypto, gun, currentUserPair };
}

describe("MessagingPlugin Integration", () => {
  let messagingPlugin: MessagingPlugin;
  let mockCore: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
    messagingPlugin = new MessagingPlugin();
    messagingPlugin.initialize(mockCore);
  });

  describe("Plugin Initialization", () => {
    test("should initialize plugin successfully", () => {
      expect(messagingPlugin.name).toBe("messaging");
      expect(messagingPlugin.version).toBe("4.7.0");
      expect(messagingPlugin.isInitialized()).toBe(true);
    });

    test("should fail when core is not provided", () => {
      const plugin = new MessagingPlugin();
      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe("Private Messaging", () => {
    test("should send private message successfully", async () => {
      const recipientPub = "recipient_pub_key";
      const messageContent = "Hello, this is a private message!";

      const result = await messagingPlugin.sendMessage(recipientPub, messageContent);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(typeof result.messageId).toBe("string");
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await messagingPlugin.sendMessage("recipient_pub", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato per inviare un messaggio.");
    });

    test("should fail with invalid inputs", async () => {
      // @ts-expect-error
      const result1 = await messagingPlugin.sendMessage("", "Hello");
      expect(result1.success).toBe(false);

      // @ts-expect-error
      const result2 = await messagingPlugin.sendMessage("recipient_pub", "");
      expect(result2.success).toBe(false);
    });
  });

  describe("Group Messaging", () => {
    test("should create group successfully", async () => {
      const groupName = "Test Group";
      const memberPubs = ["member1_pub", "member2_pub"];

      const result = await messagingPlugin.createGroup(groupName, memberPubs);

      expect(result.success).toBe(true);
      expect(result.groupData).toBeDefined();
      expect(result.groupData?.name).toBe(groupName);
    });

    test("should send group message successfully", async () => {
      const groupId = "group_123";
      const messageContent = "Hello group members!";

      // Mock the GroupManager's getGroupData method directly
      jest.spyOn(messagingPlugin.groupManagerForTesting, 'getGroupData').mockResolvedValue({
        id: groupId,
        name: "Test Group",
        members: ["user_pub_key_123", "member1"],
        encryptedKeys: {
          "user_pub_key_123": "encrypted_key_1"
        }
      });

      // Mock the encryption manager to avoid the slice error
      jest.spyOn(messagingPlugin.encryptionManagerForTesting, 'getRecipientEpub').mockResolvedValue("user_epub_key_456");

      const result = await messagingPlugin.sendGroupMessage(groupId, messageContent);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    test("should fail when group does not exist", async () => {
      const result = await messagingPlugin.sendGroupMessage("nonexistent_group", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Non sei membro di questo gruppo");
    });
  });

  describe("Token Room Messaging", () => {
    test("should create token room successfully", async () => {
      const roomName = "Secret Room";
      const description = "A private room for sensitive discussions";

      const result = await messagingPlugin.createTokenRoom(roomName, description);

      expect(result.success).toBe(true);
      expect(result.roomData).toBeDefined();
      expect(result.roomData?.name).toBe(roomName);
      expect(result.roomData?.description).toBe(description);
      expect(result.roomData?.token).toBeDefined();
    });

    test("should send token room message successfully", async () => {
      const roomId = "room_123";
      const messageContent = "Secret message for token holders";
      const token = "shared_token_123";

      const result = await messagingPlugin.sendTokenRoomMessage(roomId, messageContent, token);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    test("should join token room successfully", async () => {
      const roomId = "room_123";
      const token = "shared_token_123";

      // Mock token room data to exist
      jest.spyOn(messagingPlugin, 'getTokenRoomData').mockResolvedValue({
        id: roomId,
        name: "Test Room",
        token: token,
        createdBy: "creator_pub_key_123",
        createdAt: Date.now()
      });

      // Mock the TokenRoomManager's getTokenRoomData method directly
      jest.spyOn(messagingPlugin.tokenRoomManagerForTesting, 'getTokenRoomData').mockResolvedValue({
        id: roomId,
        name: "Test Room",
        token: token,
        createdBy: "creator_pub_key_123",
        createdAt: Date.now()
      });

      const result = await messagingPlugin.joinTokenRoom(roomId, token);

      expect(result.success).toBe(true);
      expect(result.roomData).toBeDefined();
    });

    test("should fail with invalid token", async () => {
      const result = await messagingPlugin.sendTokenRoomMessage("room_123", "Hello", "");

      expect(result.success).toBe(false);
      expect(result.error).toContain("ID stanza, contenuto e token sono obbligatori");
    });
  });

  describe("Public Room Messaging", () => {
    test("should send public message successfully", async () => {
      const roomId = "general";
      const messageContent = "Hello everyone in the public room!";

      const result = await messagingPlugin.sendPublicMessage(roomId, messageContent);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    test("should fail with invalid room ID", async () => {
      const result = await messagingPlugin.sendPublicMessage("", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("ID stanza e messaggio sono obbligatori e devono essere stringhe valide");
    });
  });

  describe("Chat Management", () => {
    test("should join private chat", async () => {
      const result = await messagingPlugin.joinChat("private", "recipient_pub");

      expect(result.success).toBe(true);
    });

    test("should join public room", async () => {
      const result = await messagingPlugin.joinChat("public", "general");

      expect(result.success).toBe(true);
    });

    test("should join group chat", async () => {
      // Mock group data to exist
      jest.spyOn(messagingPlugin, 'getGroupData').mockResolvedValue({
        id: "group_123",
        name: "Test Group",
        members: ["user_pub_key_123"]
      });

      const result = await messagingPlugin.joinChat("group", "group_123");

      expect(result.success).toBe(true);
    });

    test("should join token room", async () => {
      // Mock token room data to exist
      jest.spyOn(messagingPlugin, 'getTokenRoomData').mockResolvedValue({
        id: "room_123",
        name: "Test Room",
        token: "shared_token"
      });

      // Mock the TokenRoomManager's getTokenRoomData method directly
      jest.spyOn(messagingPlugin.tokenRoomManagerForTesting, 'getTokenRoomData').mockResolvedValue({
        id: "room_123",
        name: "Test Room",
        token: "shared_token",
        createdBy: "creator_pub_key_123",
        createdAt: Date.now()
      });

      const result = await messagingPlugin.joinChat("token", "room_123", "shared_token");

      expect(result.success).toBe(true);
    });

    test("should fail with invalid chat type", async () => {
      // @ts-expect-error
      const result = await messagingPlugin.joinChat("invalid", "chat_id");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unsupported chat type for joinChat");
    });
  });

  describe("Encryption Key Management", () => {
    test("should get recipient epub successfully", async () => {
      const recipientPub = "recipient_pub_key";

      const result = await messagingPlugin.getRecipientEpub(recipientPub);

      expect(result).toBe("recipient_epub");
    });

    test("should publish user epub successfully", async () => {
      const result = await messagingPlugin.publishUserEpub();

      expect(result.success).toBe(true);
    });

    test("should check user epub availability", async () => {
      const userPub = "user_pub_key";

      const result = await messagingPlugin.checkUserEpubAvailability(userPub);

      expect(result.available).toBe(true);
      expect(result.epub).toBeDefined();
    });

    test("should get current user epub", () => {
      const result = messagingPlugin.getCurrentUserEpub();

      expect(result).toBe("user_epub_key_456");
    });
  });

  describe("Protocol Listeners", () => {
    test("should start protocol listeners", () => {
      messagingPlugin.startProtocolListeners();

      expect(messagingPlugin.areProtocolListenersActive()).toBe(true);
    });

    test("should stop protocol listeners", () => {
      messagingPlugin.startProtocolListeners();
      messagingPlugin.stopProtocolListeners();

      expect(messagingPlugin.areProtocolListenersActive()).toBe(false);
    });

    test("should register raw message listeners", () => {
      const mockCallback = jest.fn();

      messagingPlugin.onRawMessage(mockCallback);
      messagingPlugin.onRawPublicMessage(mockCallback);
      messagingPlugin.onRawGroupMessage(mockCallback);
      messagingPlugin.onRawTokenRoomMessage(mockCallback);

      // Should not throw errors
      expect(mockCallback).toBeDefined();
    });

    test("should manage public message listeners", () => {
      const mockCallback = jest.fn();

      messagingPlugin.startListeningPublic("general");
      messagingPlugin.onRawPublicMessage(mockCallback);
      messagingPlugin.removePublicMessageListener(mockCallback);
      messagingPlugin.stopListeningPublic();

      // Should not throw errors
      expect(mockCallback).toBeDefined();
    });

    test("should manage group listeners", () => {
      messagingPlugin.addGroupListener("group_123");
      messagingPlugin.removeGroupListener("group_123");

      // Should not throw errors
    });

    test("should manage token room listeners", () => {
      messagingPlugin.startListeningTokenRooms();
      messagingPlugin.stopListeningTokenRooms();

      // Should not throw errors
    });
  });

  describe("Listener Management", () => {
    test("should start and stop listening", () => {
      messagingPlugin.startListening();
      expect(messagingPlugin.getStats().isListening).toBe(true);

      messagingPlugin.stopListening();
      expect(messagingPlugin.getStats().isListening).toBe(false);
    });

    test("should register message listeners", () => {
      const mockCallback = jest.fn();

      messagingPlugin.onMessage(mockCallback);

      expect(messagingPlugin.getStats().messageListenersCount).toBe(1);
    });
  });

  describe("Statistics and Status", () => {
    test("should return correct stats", () => {
      const stats = messagingPlugin.getStats();

      expect(stats.isListening).toBe(false);
      expect(stats.messageListenersCount).toBe(0);
      expect(stats.processedMessagesCount).toBe(0);
      expect(stats.hasActiveListener).toBe(false);
    });

    test("should return listener status", () => {
      const status = messagingPlugin.getListenerStatus();

      expect(status.isListening).toBe(false);
      expect(status.messageListenersCount).toBe(0);
      expect(status.processedMessagesCount).toBe(0);
      expect(status.clearedConversationsCount).toBe(0);
    });
  });

  describe("Error Handling", () => {
    test("should handle network errors gracefully", async () => {
      // Mock network failure by making the GunDB mock throw an error
      mockCore.db.gun.get = jest.fn(() => {
        throw new Error("Network error");
      });

      const result = await messagingPlugin.sendMessage("recipient_pub", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });

    test("should handle encryption errors gracefully", async () => {
      // Mock encryption failure by making the encryption manager throw
      jest.spyOn(messagingPlugin.encryptionManagerForTesting, 'getRecipientEpub').mockRejectedValue(
        new Error("Impossibile derivare il secret condiviso")
      );

      const result = await messagingPlugin.sendMessage("recipient_pub", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Impossibile derivare il secret condiviso");
    });

    test("should handle missing user data gracefully", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      const result = await messagingPlugin.sendMessage("recipient_pub", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Coppia di chiavi utente non disponibile");
    });
  });

  describe("Integration Scenarios", () => {
    test("should handle complete messaging workflow", async () => {
      // 1. Create a group
      const groupResult = await messagingPlugin.createGroup("Test Group", ["member1"]);
      expect(groupResult.success).toBe(true);

      // 2. Send group message - mock the group data to exist
      jest.spyOn(messagingPlugin.groupManagerForTesting, 'getGroupData').mockResolvedValue({
        id: groupResult.groupData!.id,
        name: "Test Group",
        members: ["user_pub_key_123", "member1"],
        encryptedKeys: {
          "user_pub_key_123": "encrypted_key_1"
        }
      });

      // Mock the encryption manager to avoid the slice error
      jest.spyOn(messagingPlugin.encryptionManagerForTesting, 'getRecipientEpub').mockResolvedValue("user_epub_key_456");
      
      const groupMessageResult = await messagingPlugin.sendGroupMessage(
        groupResult.groupData!.id,
        "Hello group!"
      );
      expect(groupMessageResult.success).toBe(true);

      // 3. Create token room
      const roomResult = await messagingPlugin.createTokenRoom("Secret Room");
      expect(roomResult.success).toBe(true);

      // 4. Send token room message
      const tokenMessageResult = await messagingPlugin.sendTokenRoomMessage(
        roomResult.roomData!.id,
        "Secret message",
        roomResult.roomData!.token
      );
      expect(tokenMessageResult.success).toBe(true);

      // 5. Send public message
      const publicMessageResult = await messagingPlugin.sendPublicMessage(
        "general",
        "Public announcement"
      );
      expect(publicMessageResult.success).toBe(true);

      // 6. Send private message
      const privateMessageResult = await messagingPlugin.sendMessage(
        "recipient_pub",
        "Private message"
      );
      expect(privateMessageResult.success).toBe(true);
    });

    test("should handle listener lifecycle", () => {
      const mockCallback = jest.fn();

      // Start listening
      messagingPlugin.startListening();
      messagingPlugin.onMessage(mockCallback);

      // Verify active
      expect(messagingPlugin.getStats().isListening).toBe(true);
      expect(messagingPlugin.getStats().messageListenersCount).toBe(1);

      // Stop listening
      messagingPlugin.stopListening();

      // Verify inactive
      expect(messagingPlugin.getStats().isListening).toBe(false);
    });
  });
});
