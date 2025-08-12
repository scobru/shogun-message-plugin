import {
  MessageData,
  PublicMessage,
  GroupMessage,
  TokenRoomMessage,
  TokenRoomData,
  GroupData,
  MessageResponse,
  MessageListener,
  PublicMessageListener,
  GroupMessageListener,
  TokenRoomMessageListener,
  BaseEvent,
  BaseConfig,
  BaseCacheEntry,
  BaseBackupOptions,
  BaseImportOptions,
  EncryptedMessage,
  DecryptedMessage,
  MessageSendResult,
  Conversation,
  MessageEventType,
  MessageEvent,
  MessagingConfig,
  MessagingPluginInterface,
} from "../types";

describe("Types", () => {
  describe("MessageData", () => {
    test("should create valid MessageData", () => {
      const messageData: MessageData = {
        from: "sender_pub_key",
        content: "Hello, this is a test message",
        timestamp: Date.now(),
        id: "msg_123",
        signature: "signed_data",
        roomId: "room_123",
        isPublic: false,
        groupId: "group_123",
        isGroup: false,
      };

      expect(messageData.from).toBe("sender_pub_key");
      expect(messageData.content).toBe("Hello, this is a test message");
      expect(messageData.timestamp).toBeGreaterThan(0);
      expect(messageData.id).toBe("msg_123");
      expect(messageData.signature).toBe("signed_data");
      expect(messageData.roomId).toBe("room_123");
      expect(messageData.isPublic).toBe(false);
      expect(messageData.groupId).toBe("group_123");
      expect(messageData.isGroup).toBe(false);
    });

    test("should create MessageData with minimal required fields", () => {
      const messageData: MessageData = {
        from: "sender_pub_key",
        content: "Hello",
        timestamp: Date.now(),
        id: "msg_123",
      };

      expect(messageData.from).toBe("sender_pub_key");
      expect(messageData.content).toBe("Hello");
      expect(messageData.timestamp).toBeGreaterThan(0);
      expect(messageData.id).toBe("msg_123");
    });
  });

  describe("PublicMessage", () => {
    test("should create valid PublicMessage", () => {
      const publicMessage: PublicMessage = {
        from: "sender_pub_key",
        content: "Hello everyone!",
        timestamp: Date.now(),
        id: "msg_123",
        roomId: "general",
        username: "TestUser",
      };

      expect(publicMessage.from).toBe("sender_pub_key");
      expect(publicMessage.content).toBe("Hello everyone!");
      expect(publicMessage.timestamp).toBeGreaterThan(0);
      expect(publicMessage.id).toBe("msg_123");
      expect(publicMessage.roomId).toBe("general");
      expect(publicMessage.username).toBe("TestUser");
    });
  });

  describe("GroupMessage", () => {
    test("should create valid GroupMessage", () => {
      const groupMessage: GroupMessage = {
        from: "sender_pub_key",
        content: "Hello group!",
        timestamp: Date.now(),
        id: "msg_123",
        groupId: "group_123",
        username: "TestUser",
        signature: "signed_data",
      };

      expect(groupMessage.from).toBe("sender_pub_key");
      expect(groupMessage.content).toBe("Hello group!");
      expect(groupMessage.timestamp).toBeGreaterThan(0);
      expect(groupMessage.id).toBe("msg_123");
      expect(groupMessage.groupId).toBe("group_123");
      expect(groupMessage.username).toBe("TestUser");
      expect(groupMessage.signature).toBe("signed_data");
    });
  });

  describe("TokenRoomMessage", () => {
    test("should create valid TokenRoomMessage", () => {
      const tokenRoomMessage: TokenRoomMessage = {
        from: "sender_pub_key",
        content: "Secret message",
        timestamp: Date.now(),
        id: "msg_123",
        roomId: "room_123",
        username: "TestUser",
        signature: "signed_data",
      };

      expect(tokenRoomMessage.from).toBe("sender_pub_key");
      expect(tokenRoomMessage.content).toBe("Secret message");
      expect(tokenRoomMessage.timestamp).toBeGreaterThan(0);
      expect(tokenRoomMessage.id).toBe("msg_123");
      expect(tokenRoomMessage.roomId).toBe("room_123");
      expect(tokenRoomMessage.username).toBe("TestUser");
      expect(tokenRoomMessage.signature).toBe("signed_data");
    });
  });

  describe("TokenRoomData", () => {
    test("should create valid TokenRoomData", () => {
      const tokenRoomData: TokenRoomData = {
        id: "room_123",
        name: "Secret Room",
        token: "shared_token_123",
        createdBy: "creator_pub_key",
        createdAt: Date.now(),
        description: "A private room for sensitive discussions",
        maxParticipants: 50,
      };

      expect(tokenRoomData.id).toBe("room_123");
      expect(tokenRoomData.name).toBe("Secret Room");
      expect(tokenRoomData.token).toBe("shared_token_123");
      expect(tokenRoomData.createdBy).toBe("creator_pub_key");
      expect(tokenRoomData.createdAt).toBeGreaterThan(0);
      expect(tokenRoomData.description).toBe(
        "A private room for sensitive discussions"
      );
      expect(tokenRoomData.maxParticipants).toBe(50);
    });
  });

  describe("GroupData", () => {
    test("should create valid GroupData", () => {
      const groupData: GroupData = {
        id: "group_123",
        name: "Test Group",
        members: ["member1_pub", "member2_pub"],
        createdBy: "creator_pub_key",
        createdAt: Date.now(),
        encryptedKeys: {
          member1_pub: "encrypted_key_1",
          member2_pub: "encrypted_key_2",
        },
      };

      expect(groupData.id).toBe("group_123");
      expect(groupData.name).toBe("Test Group");
      expect(groupData.members).toContain("member1_pub");
      expect(groupData.members).toContain("member2_pub");
      expect(groupData.createdBy).toBe("creator_pub_key");
      expect(groupData.createdAt).toBeGreaterThan(0);
      expect(groupData.encryptedKeys["member1_pub"]).toBe("encrypted_key_1");
      expect(groupData.encryptedKeys["member2_pub"]).toBe("encrypted_key_2");
    });
  });

  describe("MessageResponse", () => {
    test("should create successful MessageResponse", () => {
      const successResponse: MessageResponse = {
        success: true,
        messageId: "msg_123",
      };

      expect(successResponse.success).toBe(true);
      expect(successResponse.messageId).toBe("msg_123");
      expect(successResponse.error).toBeUndefined();
    });

    test("should create failed MessageResponse", () => {
      const failedResponse: MessageResponse = {
        success: false,
        error: "Failed to send message",
      };

      expect(failedResponse.success).toBe(false);
      expect(failedResponse.error).toBe("Failed to send message");
      expect(failedResponse.messageId).toBeUndefined();
    });
  });

  describe("BaseEvent", () => {
    test("should create valid BaseEvent", () => {
      const baseEvent: BaseEvent = {
        type: "test_event",
        data: { test: "data" },
        timestamp: Date.now(),
      };

      expect(baseEvent.type).toBe("test_event");
      expect(baseEvent.data).toEqual({ test: "data" });
      expect(baseEvent.timestamp).toBeGreaterThan(0);
    });
  });

  describe("BaseConfig", () => {
    test("should create valid BaseConfig", () => {
      const baseConfig: BaseConfig = {
        enabled: true,
        maxRetries: 3,
        retryDelay: 1000,
      };

      expect(baseConfig.enabled).toBe(true);
      expect(baseConfig.maxRetries).toBe(3);
      expect(baseConfig.retryDelay).toBe(1000);
    });
  });

  describe("BaseCacheEntry", () => {
    test("should create valid BaseCacheEntry", () => {
      const cacheEntry: BaseCacheEntry<string> = {
        value: "cached_value",
        timestamp: Date.now(),
        ttl: 3600000, // 1 hour
      };

      expect(cacheEntry.value).toBe("cached_value");
      expect(cacheEntry.timestamp).toBeGreaterThan(0);
      expect(cacheEntry.ttl).toBe(3600000);
    });
  });

  describe("BaseBackupOptions", () => {
    test("should create valid BaseBackupOptions", () => {
      const backupOptions: BaseBackupOptions = {
        includeMetadata: true,
        compress: false,
      };

      expect(backupOptions.includeMetadata).toBe(true);
      expect(backupOptions.compress).toBe(false);
    });
  });

  describe("BaseImportOptions", () => {
    test("should create valid BaseImportOptions", () => {
      const importOptions: BaseImportOptions = {
        validateData: true,
        overwrite: false,
      };

      expect(importOptions.validateData).toBe(true);
      expect(importOptions.overwrite).toBe(false);
    });
  });

  describe("EncryptedMessage", () => {
    test("should create valid EncryptedMessage", () => {
      const encryptedMessage: EncryptedMessage = {
        data: "encrypted_data_string",
        from: "sender_pub_key",
        timestamp: Date.now(),
        id: "msg_123",
      };

      expect(encryptedMessage.data).toBe("encrypted_data_string");
      expect(encryptedMessage.from).toBe("sender_pub_key");
      expect(encryptedMessage.timestamp).toBeGreaterThan(0);
      expect(encryptedMessage.id).toBe("msg_123");
    });
  });

  describe("DecryptedMessage", () => {
    test("should create valid DecryptedMessage", () => {
      const decryptedMessage: DecryptedMessage = {
        from: "sender_pub_key",
        to: "recipient_pub_key",
        content: "Hello, this is decrypted!",
        timestamp: Date.now(),
        id: "msg_123",
      };

      expect(decryptedMessage.from).toBe("sender_pub_key");
      expect(decryptedMessage.to).toBe("recipient_pub_key");
      expect(decryptedMessage.content).toBe("Hello, this is decrypted!");
      expect(decryptedMessage.timestamp).toBeGreaterThan(0);
      expect(decryptedMessage.id).toBe("msg_123");
    });
  });

  describe("MessageSendResult", () => {
    test("should create valid MessageSendResult", () => {
      const sendResult: MessageSendResult = {
        success: true,
        messageId: "msg_123",
        error: undefined,
      };

      expect(sendResult.success).toBe(true);
      expect(sendResult.messageId).toBe("msg_123");
      expect(sendResult.error).toBeUndefined();
    });
  });

  describe("Conversation", () => {
    test("should create valid Conversation", () => {
      const conversation: Conversation = {
        participantPub: "participant_pub_key",
        lastMessage: {
          from: "sender_pub_key",
          to: "recipient_pub_key",
          content: "Last message",
          timestamp: Date.now(),
          id: "msg_123",
        },
        unreadCount: 5,
        lastActivity: Date.now(),
      };

      expect(conversation.participantPub).toBe("participant_pub_key");
      expect(conversation.lastMessage?.content).toBe("Last message");
      expect(conversation.unreadCount).toBe(5);
      expect(conversation.lastActivity).toBeGreaterThan(0);
    });
  });

  describe("MessageEventType", () => {
    test("should have correct enum values", () => {
      expect(MessageEventType.MESSAGE_RECEIVED).toBe("messageReceived");
      expect(MessageEventType.MESSAGE_SENT).toBe("messageSent");
      expect(MessageEventType.CONVERSATION_UPDATED).toBe("conversationUpdated");
      expect(MessageEventType.ERROR).toBe("error");
    });
  });

  describe("MessageEvent", () => {
    test("should create valid MessageEvent", () => {
      const messageEvent: MessageEvent = {
        type: MessageEventType.MESSAGE_RECEIVED,
        message: {
          from: "sender_pub_key",
          to: "recipient_pub_key",
          content: "Hello!",
          timestamp: Date.now(),
          id: "msg_123",
        },
        conversation: {
          participantPub: "sender_pub_key",
          unreadCount: 1,
          lastActivity: Date.now(),
        },
        timestamp: Date.now(),
      };

      expect(messageEvent.type).toBe(MessageEventType.MESSAGE_RECEIVED);
      expect(messageEvent.message?.content).toBe("Hello!");
      expect(messageEvent.conversation?.participantPub).toBe("sender_pub_key");
      expect(messageEvent.timestamp).toBeGreaterThan(0);
    });
  });

  describe("MessagingConfig", () => {
    test("should create valid MessagingConfig", () => {
      const messagingConfig: MessagingConfig = {
        enabled: true,
        maxRetries: 3,
        retryDelay: 1000,
        autoListen: true,
        messageRetentionDays: 30,
        maxMessageLength: 1000,
        enableNotifications: true,
      };

      expect(messagingConfig.enabled).toBe(true);
      expect(messagingConfig.maxRetries).toBe(3);
      expect(messagingConfig.retryDelay).toBe(1000);
      expect(messagingConfig.autoListen).toBe(true);
      expect(messagingConfig.messageRetentionDays).toBe(30);
      expect(messagingConfig.maxMessageLength).toBe(1000);
      expect(messagingConfig.enableNotifications).toBe(true);
    });
  });

  describe("Listener Types", () => {
    test("should create valid MessageListener", () => {
      const messageListener: MessageListener = (message: MessageData) => {
        console.log("Received message:", message.content);
      };

      expect(typeof messageListener).toBe("function");
    });

    test("should create valid PublicMessageListener", () => {
      const publicMessageListener: PublicMessageListener = (
        message: PublicMessage
      ) => {
        console.log("Received public message:", message.content);
      };

      expect(typeof publicMessageListener).toBe("function");
    });

    test("should create valid GroupMessageListener", () => {
      const groupMessageListener: GroupMessageListener = (
        message: GroupMessage
      ) => {
        console.log("Received group message:", message.content);
      };

      expect(typeof groupMessageListener).toBe("function");
    });

    test("should create valid TokenRoomMessageListener", () => {
      const tokenRoomMessageListener: TokenRoomMessageListener = (
        message: TokenRoomMessage
      ) => {
        console.log("Received token room message:", message.content);
      };

      expect(typeof tokenRoomMessageListener).toBe("function");
    });
  });

  describe("MessagingPluginInterface", () => {
    test("should define interface structure", () => {
      // This test ensures the interface is properly defined
      // We can't instantiate an interface, but we can check its structure
      const mockPlugin: MessagingPluginInterface = {
        sendMessage: jest.fn().mockResolvedValue({ success: true }),
        onMessage: jest.fn(),
        startListening: jest.fn(),
        stopListening: jest.fn(),
        isListening: jest.fn().mockReturnValue(false),
        getConfig: jest.fn().mockReturnValue({}),
        updateConfig: jest.fn(),
        getConversations: jest.fn().mockResolvedValue([]),
        getMessageHistory: jest.fn().mockResolvedValue([]),
        createCertificate: jest.fn().mockResolvedValue({}),
        removeCertificate: jest.fn(),
        getActiveCertificates: jest.fn().mockReturnValue([]),
        hasCertificate: jest.fn().mockReturnValue(false),
      };

      expect(typeof mockPlugin.sendMessage).toBe("function");
      expect(typeof mockPlugin.onMessage).toBe("function");
      expect(typeof mockPlugin.startListening).toBe("function");
      expect(typeof mockPlugin.stopListening).toBe("function");
      expect(typeof mockPlugin.isListening).toBe("function");
      expect(typeof mockPlugin.getConfig).toBe("function");
      expect(typeof mockPlugin.updateConfig).toBe("function");
    });
  });

  describe("Type Compatibility", () => {
    test("should allow MessageData to be used as DecryptedMessage", () => {
      const messageData: MessageData = {
        from: "sender_pub_key",
        content: "Hello",
        timestamp: Date.now(),
        id: "msg_123",
      };

      // This should compile without errors
      const decryptedMessage: DecryptedMessage = {
        ...messageData,
        to: "recipient_pub_key",
      };

      expect(decryptedMessage.from).toBe("sender_pub_key");
      expect(decryptedMessage.to).toBe("recipient_pub_key");
    });

    test("should allow MessageResponse to be used as MessageSendResult", () => {
      const messageResponse: MessageResponse = {
        success: true,
        messageId: "msg_123",
      };

      // This should compile without errors
      const sendResult: MessageSendResult = messageResponse;

      expect(sendResult.success).toBe(true);
      expect(sendResult.messageId).toBe("msg_123");
    });
  });
});
