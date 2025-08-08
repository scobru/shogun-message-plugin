import { GroupManager } from "./groupManager";
import { EncryptionManager } from "./encryption";
import { ChatManager } from "./chatManager";
import { ShogunCore } from "shogun-core";

// Mock dependencies
jest.mock("./encryption");
jest.mock("./chatManager");

describe("GroupManager", () => {
  let groupManager: GroupManager;
  let mockCore: any;
  let mockEncryptionManager: jest.Mocked<EncryptionManager>;
  let mockChatManager: jest.Mocked<ChatManager>;

  beforeEach(() => {
    // Reset mocks before each test
    jest.clearAllMocks();

    mockCore = {
      isLoggedIn: jest.fn(),
      db: {
        user: {
          _: {
            sea: {
              pub: "creator_pub",
              priv: "creator_priv",
            },
          },
        },
        sea: {
          secret: jest.fn().mockResolvedValue("shared_secret"),
          encrypt: jest.fn().mockResolvedValue("encrypted_key"),
          sign: jest.fn().mockResolvedValue("signature"),
        },
        gun: {
          get: jest.fn().mockReturnThis(),
          put: jest.fn((data, cb) => cb({ err: null, ok: true })),
          once: jest.fn(),
        },
      },
    };

    mockEncryptionManager = new EncryptionManager(mockCore) as jest.Mocked<EncryptionManager>;
    mockChatManager = new ChatManager(mockCore, {} as any, {} as any) as jest.Mocked<ChatManager>;

    groupManager = new GroupManager(mockCore, mockEncryptionManager);
    groupManager.setChatManager(mockChatManager);
  });

  describe("createGroup", () => {
    it("should create a group successfully and include the creator in encrypted keys", async () => {
      mockCore.isLoggedIn.mockReturnValue(true);
      mockEncryptionManager.getRecipientEpub = jest.fn().mockResolvedValue("member_epub");

      const groupName = "Test Group";
      const memberPubs = ["member1_pub", "member2_pub"];
      const result = await groupManager.createGroup(groupName, memberPubs);

      expect(result.success).toBe(true);
      expect(result.groupData).toBeDefined();
      expect(result.groupData?.name).toBe(groupName);
      expect(result.groupData?.members).toEqual(["creator_pub", ...memberPubs]);
      expect(result.groupData?.createdBy).toBe("creator_pub");

      // Verify that keys were encrypted for all members, including the creator
      expect(mockEncryptionManager.getRecipientEpub).toHaveBeenCalledTimes(3);
      expect(mockEncryptionManager.getRecipientEpub).toHaveBeenCalledWith("creator_pub");
      expect(mockEncryptionManager.getRecipientEpub).toHaveBeenCalledWith("member1_pub");
      expect(mockEncryptionManager.getRecipientEpub).toHaveBeenCalledWith("member2_pub");

      expect(result.groupData?.encryptedKeys).toHaveProperty("creator_pub");
      expect(result.groupData?.encryptedKeys).toHaveProperty("member1_pub");
      expect(result.groupData?.encryptedKeys).toHaveProperty("member2_pub");

      // Verify that the group data was saved to GunDB
      expect(mockCore.db.gun.get).toHaveBeenCalledWith(expect.stringContaining("group_"));
      expect(mockCore.db.gun.put).toHaveBeenCalled();
    });

    it("should fail if the user is not logged in", async () => {
      mockCore.isLoggedIn.mockReturnValue(false);
      const result = await groupManager.createGroup("Test Group", ["member1_pub"]);
      expect(result.success).toBe(false);
      expect(result.error).toBe("Devi essere loggato per creare un gruppo.");
    });

    it("should fail if key encryption fails for a member", async () => {
        mockCore.isLoggedIn.mockReturnValue(true);
        // Fail encryption for the second member
        mockEncryptionManager.getRecipientEpub
            .mockResolvedValueOnce("creator_epub")
            .mockRejectedValueOnce(new Error("Failed to get epub for member1_pub"))
            .mockResolvedValueOnce("member2_epub");

        const groupName = "Test Group";
        const memberPubs = ["member1_pub", "member2_pub"];
        const result = await groupManager.createGroup(groupName, memberPubs);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Impossibile creare le chiavi di cifratura per i seguenti membri: member1_pub. Creazione del gruppo annullata.");
        expect(mockCore.db.gun.put).not.toHaveBeenCalled(); // Ensure group is not saved
    });
  });

  describe("sendGroupMessage", () => {
    let groupData: any;

    beforeEach(() => {
        groupData = {
            id: "test_group_id",
            name: "Test Group",
            members: ["creator_pub", "member1_pub"],
            createdBy: "creator_pub",
            encryptionKey: "group_key",
            encryptedKeys: {
                "creator_pub": "creator_encrypted_key",
                "member1_pub": "member1_encrypted_key",
            },
        };
        // Mock getGroupData to return our test data
        groupManager.getGroupData = jest.fn().mockResolvedValue(groupData);
    });

    it("should send a group message successfully using stored keys", async () => {
        mockCore.isLoggedIn.mockReturnValue(true);

        const groupId = "test_group_id";
        const messageContent = "Hello, team!";
        const result = await groupManager.sendGroupMessage(groupId, messageContent);

        expect(result.success).toBe(true);
        expect(result.messageId).toBeDefined();

        // Verify that we are NOT re-encrypting keys
        expect(mockEncryptionManager.getRecipientEpub).not.toHaveBeenCalled();
        expect(mockCore.db.sea.secret).not.toHaveBeenCalled();

        // Verify that the message was sent to GunDB with the stored keys
        expect(mockCore.db.gun.get).toHaveBeenCalledWith(`group_${groupId}`);
        const sentMessage = mockCore.db.gun.put.mock.calls[0][0];
        expect(sentMessage.encryptedKeys).toEqual(groupData.encryptedKeys);
        expect(sentMessage.encryptedContent).toBe("encrypted_key"); // From our mock
    });

    it("should fail if the user is not a member of the group", async () => {
        mockCore.isLoggedIn.mockReturnValue(true);
        mockCore.db.user._.sea.pub = "not_a_member_pub"; // Switch user
        const result = await groupManager.sendGroupMessage("test_group_id", "Hi");

        expect(result.success).toBe(false);
        expect(result.error).toBe("Non sei membro di questo gruppo.");
    });
  });
});
