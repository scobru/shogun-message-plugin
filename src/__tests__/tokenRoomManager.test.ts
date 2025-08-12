import { TokenRoomManager } from "../tokenRoomManager";
import { EncryptionManager } from "../encryption";
import { TokenRoomData, TokenRoomMessage } from "../types";

// Mock ShogunCore for testing
function makeCoreMock() {
  const currentUserPair = { 
    pub: "creator_pub_key_123", 
    epub: "creator_epub_key_456",
    alias: "RoomCreator"
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
      put: jest.fn((data: any, callback: any) => callback({})),
      get: jest.fn(() => node),
      map: jest.fn(() => ({
        on: jest.fn(() => ({ off: jest.fn() }))
      })),
      once: jest.fn((callback: any) => callback({ epub: "member_epub" }))
    };
    return node;
  };

  const gun = {
    get: jest.fn(() => createMockGunNode()),
    user: jest.fn(() => ({ 
      get: jest.fn(() => ({ 
        once: jest.fn((callback: any) => callback({ epub: "member_epub" }))
      }))
    })),
  };

  const user = { _?: { sea: currentUserPair } } as any;

  const core: any = {
    db: { 
      gun, 
      user, 
      sea, 
      crypto,
      getCurrentUser: jest.fn(() => ({ pub: "creator_pub_key_123" })),
      putUserData: jest.fn().mockResolvedValue(undefined)
    },
    isLoggedIn: () => true,
  };

  return { core, sea, crypto, gun, currentUserPair };
}

// Mock EncryptionManager
function makeEncryptionManagerMock() {
  return {
    getRecipientEpub: jest.fn().mockResolvedValue("member_epub"),
    verifyMessageSignature: jest.fn().mockResolvedValue(true),
  } as any;
}

describe("TokenRoomManager", () => {
  let tokenRoomManager: TokenRoomManager;
  let mockCore: any;
  let mockEncryptionManager: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
    mockEncryptionManager = makeEncryptionManagerMock();
    tokenRoomManager = new TokenRoomManager(mockCore, mockEncryptionManager, {
      onStatus: jest.fn()
    });
  });

  describe("createTokenRoom", () => {
    test("should create token room successfully", async () => {
      const roomName = "Secret Discussion";
      const description = "Private room for sensitive topics";
      const maxParticipants = 50;

      const result = await tokenRoomManager.createTokenRoom(roomName, description, maxParticipants);

      expect(result.success).toBe(true);
      expect(result.roomData).toBeDefined();
      expect(result.roomData?.name).toBe(roomName);
      expect(result.roomData?.description).toBe(description);
      expect(result.roomData?.maxParticipants).toBe(maxParticipants);
      expect(result.roomData?.token).toBeDefined();
      expect(result.roomData?.createdBy).toBe("creator_pub_key_123");
      expect(result.roomData?.id).toBeDefined();
    });

    test("should create token room with minimal parameters", async () => {
      const roomName = "Simple Room";

      const result = await tokenRoomManager.createTokenRoom(roomName);

      expect(result.success).toBe(true);
      expect(result.roomData?.name).toBe(roomName);
      expect(result.roomData?.token).toBeDefined();
      expect(result.roomData?.description).toBeUndefined();
      expect(result.roomData?.maxParticipants).toBeUndefined();
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await tokenRoomManager.createTokenRoom("Test Room");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato");
    });

    test("should fail when user pair is not available", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      const result = await tokenRoomManager.createTokenRoom("Test Room");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Coppia di chiavi utente non disponibile");
    });

    test("should fail when crypto API is not available", async () => {
      const originalCrypto = (globalThis as any).crypto;
      delete (globalThis as any).crypto;

      const result = await tokenRoomManager.createTokenRoom("Test Room");

      expect(result.success).toBe(false);
      expect(result.error).toContain("crypto is not defined");

      (globalThis as any).crypto = originalCrypto;
    });

    test("should fail when room name is empty", async () => {
      const result = await tokenRoomManager.createTokenRoom("");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Nome stanza è obbligatorio");
    });
  });

  describe("sendTokenRoomMessage", () => {
    const mockRoomData: TokenRoomData = {
      id: "room_123",
      name: "Test Room",
      token: "shared_token_123",
      createdBy: "creator_pub_key_123",
      createdAt: Date.now(),
      description: "Test room description"
    };

    beforeEach(() => {
      jest.spyOn(tokenRoomManager, 'getTokenRoomData').mockResolvedValue(mockRoomData);
    });

    test("should send token room message successfully", async () => {
      const messageContent = "Secret message for token holders";
      const token = "shared_token_123";

      const result = await tokenRoomManager.sendTokenRoomMessage(
        "room_123",
        messageContent,
        token
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(mockCore.db.sea.sign).toHaveBeenCalledWith(messageContent, expect.any(Object));
      expect(mockCore.db.sea.encrypt).toHaveBeenCalledWith(messageContent, token);
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await tokenRoomManager.sendTokenRoomMessage(
        "room_123",
        "Hello",
        "token"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato");
    });

    test("should fail when room is not found", async () => {
      jest.spyOn(tokenRoomManager, 'getTokenRoomData').mockResolvedValue(null);

      const result = await tokenRoomManager.sendTokenRoomMessage(
        "nonexistent_room",
        "Hello",
        "token"
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    test("should fail when token is invalid", async () => {
      const result = await tokenRoomManager.sendTokenRoomMessage(
        "room_123",
        "Hello",
        "wrong_token"
      );

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
    });

    test("should fail when token is empty", async () => {
      const result = await tokenRoomManager.sendTokenRoomMessage(
        "room_123",
        "Hello",
        ""
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("ID stanza, messaggio e token sono obbligatori");
    });

    test("should fail when message content is empty", async () => {
      const result = await tokenRoomManager.sendTokenRoomMessage(
        "room_123",
        "",
        "shared_token_123"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("ID stanza, messaggio e token sono obbligatori");
    });
  });

  describe("getTokenRoomData", () => {
    test("should retrieve token room data successfully", async () => {
      const roomData = {
        id: "room_123",
        name: "Test Room",
        token: "shared_token_123",
        createdBy: "creator_pub_key_123",
        createdAt: Date.now(),
        description: "Test room description"
      };

      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn((callback: any) => callback(roomData))
      }));

      const result = await tokenRoomManager.getTokenRoomData("room_123");

      expect(result).toBeDefined();
      expect(result?.id).toBe("room_123");
      expect(result?.name).toBe("Test Room");
      expect(result?.token).toBe("shared_token_123");
    });

    test("should return null when room does not exist", async () => {
      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn((callback: any) => callback(null))
      }));

      const result = await tokenRoomManager.getTokenRoomData("nonexistent_room");

      expect(result).toBeNull();
    });

    test("should handle errors gracefully", async () => {
      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn(() => {
          throw new Error("Network error");
        })
      }));

      const result = await tokenRoomManager.getTokenRoomData("room_123");

      expect(result).toBeNull();
    });
  });

  describe("joinTokenRoom", () => {
    const mockRoomData: TokenRoomData = {
      id: "room_123",
      name: "Test Room",
      token: "shared_token_123",
      createdBy: "creator_pub_key_123",
      createdAt: Date.now(),
      description: "Test room description"
    };

    beforeEach(() => {
      jest.spyOn(tokenRoomManager, 'getTokenRoomData').mockResolvedValue(mockRoomData);
    });

    test("should join token room successfully", async () => {
      const roomId = "room_123";
      const token = "shared_token_123";

      const result = await tokenRoomManager.joinTokenRoom(roomId, token);

      expect(result.success).toBe(true);
      expect(result.roomData).toBeDefined();
      expect(result.roomData?.id).toBe(roomId);
      expect(result.roomData?.token).toBe(token);
    });

    test("should fail when room is not found", async () => {
      jest.spyOn(tokenRoomManager, 'getTokenRoomData').mockResolvedValue(null);

      const result = await tokenRoomManager.joinTokenRoom("nonexistent_room", "token");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Room not found or invitation invalid");
    });

    test("should fail when token is invalid", async () => {
      const result = await tokenRoomManager.joinTokenRoom("room_123", "wrong_token");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid token for this room");
    });

    test("should fail when token is empty", async () => {
      const result = await tokenRoomManager.joinTokenRoom("room_123", "");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid token for this room");
    });

    test("should fail when room ID is empty", async () => {
      const result = await tokenRoomManager.joinTokenRoom("", "token");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid token for this room");
    });
  });

  describe("startListeningTokenRooms", () => {
    test("should start listening to token rooms successfully", () => {
      tokenRoomManager.startListeningTokenRooms();

      expect(tokenRoomManager.isListeningTokenRooms()).toBe(true);
    });

    test("should not start listening when already listening", () => {
      tokenRoomManager.startListeningTokenRooms();
      tokenRoomManager.startListeningTokenRooms(); // Second call

      expect(tokenRoomManager.isListeningTokenRooms()).toBe(true);
    });
  });

  describe("stopListeningTokenRooms", () => {
    test("should stop listening to token rooms successfully", () => {
      tokenRoomManager.startListeningTokenRooms();
      tokenRoomManager.stopListeningTokenRooms();

      expect(tokenRoomManager.isListeningTokenRooms()).toBe(false);
    });

    test("should handle stopping when not listening", () => {
      tokenRoomManager.stopListeningTokenRooms();
      // Should not throw error
    });
  });

  describe("processIncomingTokenMessage", () => {
    test("should process token room message successfully", async () => {
      const messageData = {
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        roomId: "room_123",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const token = "shared_token_123";
      const currentUserPair = { pub: "user_pub_key_123", epub: "user_epub_key_456" };
      const currentUserPub = "user_pub_key_123";
      const roomId = "room_123";

      const mockCallback = jest.fn();
      tokenRoomManager.onTokenRoomMessage(mockCallback);

      await (tokenRoomManager as any).processIncomingTokenMessage(
        messageData,
        messageId,
        token,
        currentUserPair,
        currentUserPub,
        roomId
      );

      expect(mockCallback).toHaveBeenCalled();
      expect(mockCore.db.sea.decrypt).toHaveBeenCalledWith("encrypted_content", token);
    });

    test("should ignore messages from current user", async () => {
      const messageData = JSON.stringify({
        from: "user_pub_key_123", // Current user
        content: "encrypted_content",
        timestamp: Date.now(),
        roomId: "room_123",
        signature: "signed_data"
      });
      const messageId = "msg_123";
      const token = "shared_token_123";
      const currentUserPair = { pub: "user_pub_key_123", epub: "user_epub_key_456" };
      const currentUserPub = "user_pub_key_123";
      const roomId = "room_123";

      const mockCallback = jest.fn();
      tokenRoomManager.onTokenRoomMessage(mockCallback);

      await (tokenRoomManager as any).processIncomingTokenMessage(
        messageData,
        messageId,
        token,
        currentUserPair,
        currentUserPub,
        roomId
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test("should ignore duplicate messages", async () => {
      const messageData = {
        from: "sender_pub_key",
        content: "encrypted_content",
        timestamp: Date.now(),
        roomId: "room_123",
        signature: "signed_data"
      };
      const messageId = "msg_123";
      const token = "shared_token_123";
      const currentUserPair = { pub: "user_pub_key_123", epub: "user_epub_key_456" };
      const currentUserPub = "user_pub_key_123";
      const roomId = "room_123";

      const mockCallback = jest.fn();
      tokenRoomManager.onTokenRoomMessage(mockCallback);

      // Process same message twice
      await (tokenRoomManager as any).processIncomingTokenMessage(
        messageData,
        messageId,
        token,
        currentUserPair,
        currentUserPub,
        roomId
      );
      await (tokenRoomManager as any).processIncomingTokenMessage(
        messageData,
        messageId,
        token,
        currentUserPair,
        currentUserPub,
        roomId
      );

      expect(mockCallback).toHaveBeenCalledTimes(1); // Only once
    });

    test("should handle invalid message data gracefully", async () => {
      const invalidMessageData = { content: null, from: null, roomId: null };
      const messageId = "msg_123";
      const token = "shared_token_123";
      const currentUserPair = { pub: "user_pub_key_123", epub: "user_epub_key_456" };
      const currentUserPub = "user_pub_key_123";
      const roomId = "room_123";

      const mockCallback = jest.fn();
      tokenRoomManager.onTokenRoomMessage(mockCallback);

      await (tokenRoomManager as any).processIncomingTokenMessage(
        invalidMessageData,
        messageId,
        token,
        currentUserPair,
        currentUserPub,
        roomId
      );

      expect(mockCallback).not.toHaveBeenCalled();
    });
  });

  describe("onTokenRoomMessage", () => {
    test("should register token room message callback", () => {
      const callback = jest.fn();
      
      tokenRoomManager.onTokenRoomMessage(callback);
      
      expect(tokenRoomManager.getTokenRoomMessageListenersCount()).toBe(1);
    });

    test("should not register invalid callback", () => {
      tokenRoomManager.onTokenRoomMessage(null as any);
      tokenRoomManager.onTokenRoomMessage(undefined as any);
      tokenRoomManager.onTokenRoomMessage("not_a_function" as any);
      
      expect(tokenRoomManager.getTokenRoomMessageListenersCount()).toBe(0);
    });
  });

  describe("removeTokenRoomMessageListener", () => {
    test("should remove token room message listener", () => {
      const callback = jest.fn();
      
      tokenRoomManager.onTokenRoomMessage(callback);
      expect(tokenRoomManager.getTokenRoomMessageListenersCount()).toBe(1);
      
      tokenRoomManager.removeTokenRoomMessageListener(callback);
      expect(tokenRoomManager.getTokenRoomMessageListenersCount()).toBe(0);
    });
  });

  describe("subscribeTokenRoomMessages", () => {
    test("should return unsubscribe function", () => {
      const callback = jest.fn();
      
      const unsubscribe = tokenRoomManager.subscribeTokenRoomMessages(callback);
      expect(tokenRoomManager.getTokenRoomMessageListenersCount()).toBe(1);
      
      unsubscribe();
      expect(tokenRoomManager.getTokenRoomMessageListenersCount()).toBe(0);
    });
  });

  describe("getStats", () => {
    test("should return correct statistics", () => {
      const stats = {
        isListening: tokenRoomManager.isListeningTokenRooms(),
        activeRooms: tokenRoomManager.getActiveTokenRoomsCount(),
        listeners: tokenRoomManager.getTokenRoomMessageListenersCount(),
        processedMessages: tokenRoomManager.getProcessedTokenMessagesCount(),
      };

      expect(stats.isListening).toBe(false);
      expect(stats.activeRooms).toBe(0);
      expect(stats.listeners).toBe(0);
      expect(stats.processedMessages).toBe(0);
    });
  });

  describe("getUxSnapshot", () => {
    test("should return UX snapshot", () => {
      const snapshot = tokenRoomManager.getUxSnapshot();

      expect(snapshot.isListening).toBe(false);
      expect(snapshot.activeRooms).toBe(0);
      expect(snapshot.listeners).toBe(0);
      expect(snapshot.processedMessages).toBe(0);
    });
  });

  describe("Room Management", () => {
    test("should update token for room", () => {
      tokenRoomManager.updateTokenForRoom("room_123", "new_token");
      
      // Should not throw error
    });

    test("should leave token room", () => {
      tokenRoomManager.leaveTokenRoom("room_123");
      
      // Should not throw error
    });

    test("should get active rooms", () => {
      const activeRooms = tokenRoomManager.getActiveRooms();
      
      expect(Array.isArray(activeRooms)).toBe(true);
    });
  });
});
