import { MessageProcessor } from "./messageProcessor";
import { ShogunCore } from "shogun-core";
import { EncryptionManager } from "./encryption";
import { GroupManager } from "./groupManager";

// Mock ShogunCore
const mockCore = {
  db: {
    gun: {
      get: jest.fn(),
      user: {
        _: {
          sea: {
            pub: "current_user_pub",
            epub: "current_user_epub",
          },
        },
      },
    },
    sea: {
      secret: jest.fn(),
      decrypt: jest.fn(),
    },
    getCurrentUser: jest.fn().mockReturnValue({
      pub: "current_user_pub",
    }),
  },
  isLoggedIn: jest.fn().mockReturnValue(true),
};

// Mock EncryptionManager
const mockEncryptionManager = {
  getRecipientEpub: jest.fn(),
  verifyMessageSignature: jest.fn(),
};

// Mock GroupManager
const mockGroupManager = {
  getGroupData: jest.fn(),
};

describe("MessageProcessor - Group Message Decryption", () => {
  let messageProcessor: MessageProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    messageProcessor = new MessageProcessor(
      mockCore as any,
      mockEncryptionManager as any,
      mockGroupManager as any
    );
  });

  describe("processIncomingGroupMessage", () => {
    it("should decrypt group messages from other members using creator's shared secret", async () => {
      // Mock group data
      const groupData = {
        id: "test_group_id",
        name: "Test Group",
        members: ["creator_pub", "member1_pub", "current_user_pub"],
        createdBy: "creator_pub",
        createdAt: Date.now(),
        encryptionKey: "group_encryption_key",
        encryptedKeys: {
          creator_pub: "creator_encrypted_key",
          member1_pub: "member1_encrypted_key",
          current_user_pub: "current_user_encrypted_key",
        },
      };

      // Mock message data from another member
      const messageData = {
        from: "member1_pub",
        groupId: "test_group_id",
        encryptedContent: "encrypted_message_content",
        encryptedKeys: {
          creator_pub: "creator_encrypted_key",
          member1_pub: "member1_encrypted_key",
          current_user_pub: "current_user_encrypted_key",
        },
        signature: "message_signature",
      };

      const messageId = "msg_123";
      const currentUserPair = {
        pub: "current_user_pub",
        epub: "current_user_epub",
      };

      // Setup mocks
      mockGroupManager.getGroupData.mockResolvedValue(groupData);
      mockEncryptionManager.getRecipientEpub.mockResolvedValue("creator_epub");
      mockCore.db.sea.secret.mockResolvedValue("shared_secret_with_creator");
      mockCore.db.sea.decrypt
        .mockResolvedValueOnce("group_encryption_key") // First call: decrypt group key
        .mockResolvedValueOnce("decrypted_message_content"); // Second call: decrypt message content
      mockEncryptionManager.verifyMessageSignature.mockResolvedValue(true);

      // Register a listener to capture the decrypted message
      let capturedMessage: any = null;
      messageProcessor.onGroupMessage((message) => {
        capturedMessage = message;
      });

      // Call the private method using reflection
      const processIncomingGroupMessage = (
        messageProcessor as any
      ).processIncomingGroupMessage.bind(messageProcessor);
      await processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair,
        "current_user_pub",
        "test_group_id"
      );

      // Verify the decryption process used the creator's epub
      expect(mockGroupManager.getGroupData).toHaveBeenCalledWith(
        "test_group_id"
      );
      expect(mockEncryptionManager.getRecipientEpub).toHaveBeenCalledWith(
        "creator_pub"
      );
      expect(mockCore.db.sea.secret).toHaveBeenCalledWith(
        "creator_epub",
        currentUserPair
      );
      expect(mockCore.db.sea.decrypt).toHaveBeenCalledWith(
        "current_user_encrypted_key",
        "shared_secret_with_creator"
      );
      expect(mockCore.db.sea.decrypt).toHaveBeenCalledWith(
        "encrypted_message_content",
        "group_encryption_key"
      );

      // Verify the message was processed correctly
      expect(capturedMessage).toBeDefined();
      expect(capturedMessage.content).toBe("decrypted_message_content");
      expect(capturedMessage.from).toBe("member1_pub");
      expect(capturedMessage.groupId).toBe("test_group_id");
    });

    it("should handle group messages from the current user using direct group key", async () => {
      // Mock group data
      const groupData = {
        id: "test_group_id",
        name: "Test Group",
        members: ["creator_pub", "current_user_pub"],
        createdBy: "creator_pub",
        createdAt: Date.now(),
        encryptionKey: "group_encryption_key",
        encryptedKeys: {
          creator_pub: "creator_encrypted_key",
          current_user_pub: "current_user_encrypted_key",
        },
      };

      // Mock message data from current user
      const messageData = {
        from: "current_user_pub",
        groupId: "test_group_id",
        encryptedContent: "encrypted_message_content",
        encryptedKeys: {
          creator_pub: "creator_encrypted_key",
          current_user_pub: "current_user_encrypted_key",
        },
        signature: "message_signature",
      };

      const messageId = "msg_123";
      const currentUserPair = {
        pub: "current_user_pub",
        epub: "current_user_epub",
      };

      // Setup mocks
      mockGroupManager.getGroupData.mockResolvedValue(groupData);
      mockCore.db.sea.decrypt.mockResolvedValue("decrypted_message_content");
      mockEncryptionManager.verifyMessageSignature.mockResolvedValue(true);

      // Register a listener to capture the decrypted message
      let capturedMessage: any = null;
      messageProcessor.onGroupMessage((message) => {
        capturedMessage = message;
      });

      // Call the private method using reflection
      const processIncomingGroupMessage = (
        messageProcessor as any
      ).processIncomingGroupMessage.bind(messageProcessor);
      await processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair,
        "current_user_pub",
        "test_group_id"
      );

      // Verify the decryption process used the group key directly
      expect(mockGroupManager.getGroupData).toHaveBeenCalledWith(
        "test_group_id"
      );
      expect(mockEncryptionManager.getRecipientEpub).not.toHaveBeenCalled(); // Should not get creator epub for sender
      expect(mockCore.db.sea.secret).not.toHaveBeenCalled(); // Should not generate shared secret for sender
      expect(mockCore.db.sea.decrypt).toHaveBeenCalledWith(
        "encrypted_message_content",
        "group_encryption_key"
      );

      // Verify the message was processed correctly
      expect(capturedMessage).toBeDefined();
      expect(capturedMessage.content).toBe("decrypted_message_content");
      expect(capturedMessage.from).toBe("current_user_pub");
      expect(capturedMessage.groupId).toBe("test_group_id");
    });

    it("should fail gracefully when group data is not found", async () => {
      const messageData = {
        from: "member1_pub",
        groupId: "test_group_id",
        encryptedContent: "encrypted_message_content",
        encryptedKeys: {
          current_user_pub: "current_user_encrypted_key",
        },
      };

      const messageId = "msg_123";
      const currentUserPair = {
        pub: "current_user_pub",
        epub: "current_user_epub",
      };

      // Setup mocks
      mockGroupManager.getGroupData.mockResolvedValue(null);

      // Register a listener
      let capturedMessage: any = null;
      messageProcessor.onGroupMessage((message) => {
        capturedMessage = message;
      });

      // Call the private method using reflection
      const processIncomingGroupMessage = (
        messageProcessor as any
      ).processIncomingGroupMessage.bind(messageProcessor);
      await processIncomingGroupMessage(
        messageData,
        messageId,
        currentUserPair,
        "current_user_pub",
        "test_group_id"
      );

      // Verify no message was processed
      expect(capturedMessage).toBeNull();
      expect(mockGroupManager.getGroupData).toHaveBeenCalledWith(
        "test_group_id"
      );
      expect(mockEncryptionManager.getRecipientEpub).not.toHaveBeenCalled();
      expect(mockCore.db.sea.secret).not.toHaveBeenCalled();
      expect(mockCore.db.sea.decrypt).not.toHaveBeenCalled();
    });
  });
});
