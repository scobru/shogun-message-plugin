import { GroupManager } from "../groupManager";
import { EncryptionManager } from "../encryption";
import { GroupData } from "../types";

// Mock ShogunCore for testing
function makeCoreMock() {
  const currentUserPair = { 
    pub: "creator_pub_key_123", 
    epub: "creator_epub_key_456",
    alias: "GroupCreator"
  };

  const sea = {
    sign: jest.fn(async (data: string, pair: any) => "signed_data"),
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) => "group_key_123"),
  };

  const crypto = {
    secret: jest.fn(async (epub: string, pair: any) => "shared_secret_key"),
    encrypt: jest.fn(async (data: any, secret: string) => "encrypted_data"),
    decrypt: jest.fn(async (data: string, secret: string) => "group_key_123"),
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
        on: jest.fn(() => ({ off: jest.fn() })),
        once: jest.fn((callback: any) => callback({ epub: "member_epub" }))
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
    getRecipientEpub: jest.fn().mockImplementation((pub: string) => {
      if (pub === "creator_pub_key_123") {
        return Promise.resolve("creator_epub_key_456");
      }
      return Promise.resolve("member_epub");
    }),
  } as any;
}

describe("GroupManager", () => {
  let groupManager: GroupManager;
  let mockCore: any;
  let mockEncryptionManager: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
    mockEncryptionManager = makeEncryptionManagerMock();
    groupManager = new GroupManager(mockCore, mockEncryptionManager);
  });

  describe("createGroup", () => {
    test("should create group successfully with valid members", async () => {
      const groupName = "Test Group";
      const memberPubs = ["member1_pub", "member2_pub"];

      const result = await groupManager.createGroup(groupName, memberPubs);

      expect(result.success).toBe(true);
      expect(result.groupData).toBeDefined();
      expect(result.groupData?.name).toBe(groupName);
      expect(result.groupData?.members).toContain("creator_pub_key_123");
      expect(result.groupData?.members).toContain("member1_pub");
      expect(result.groupData?.members).toContain("member2_pub");
      expect(result.groupData?.createdBy).toBe("creator_pub_key_123");
      expect(result.groupData?.encryptedKeys).toBeDefined();
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await groupManager.createGroup("Test Group", ["member1"]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato");
    });

    test("should fail when user pair is not available", async () => {
      mockCore.db.user = { _: {} }; // No sea property

      const result = await groupManager.createGroup("Test Group", ["member1"]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Coppia di chiavi utente non disponibile");
    });

    test("should fail when crypto API is not available", async () => {
      // Mock crypto to be undefined
      const originalCrypto = (globalThis as any).crypto;
      delete (globalThis as any).crypto;

      const result = await groupManager.createGroup("Test Group", ["member1"]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Crypto API non disponibile");

      // Restore crypto
      (globalThis as any).crypto = originalCrypto;
    });

    test("should fail when member encryption fails", async () => {
      mockEncryptionManager.getRecipientEpub = jest.fn().mockRejectedValue(
        new Error("Cannot get epub")
      );

      const result = await groupManager.createGroup("Test Group", ["member1"]);

      expect(result.success).toBe(false);
      expect(result.error).toContain("Impossibile creare le chiavi di cifratura");
    });

    test("should handle duplicate members gracefully", async () => {
      const groupName = "Test Group";
      const memberPubs = ["member1_pub", "member1_pub", "creator_pub_key_123"]; // Duplicates

      const result = await groupManager.createGroup(groupName, memberPubs);

      expect(result.success).toBe(true);
      expect(result.groupData?.members).toHaveLength(2); // Should deduplicate
      expect(result.groupData?.members).toContain("member1_pub");
      expect(result.groupData?.members).toContain("creator_pub_key_123");
    });
  });

  describe("sendGroupMessage", () => {
    const mockGroupData: GroupData = {
      id: "group_123",
      name: "Test Group",
      members: ["creator_pub_key_123", "member1_pub", "member2_pub"],
      createdBy: "creator_pub_key_123",
      createdAt: Date.now(),
      encryptedKeys: {
        "creator_pub_key_123": "encrypted_key_1",
        "member1_pub": "encrypted_key_2",
        "member2_pub": "encrypted_key_3"
      }
    };

    beforeEach(() => {
      // Mock getGroupData to return our test data
      jest.spyOn(groupManager, 'getGroupData').mockResolvedValue(mockGroupData);
    });

    test("should send group message successfully", async () => {
      const messageContent = "Hello group members!";

      const result = await groupManager.sendGroupMessage("group_123", messageContent);

      expect(result.success).toBe(true);
      expect(result.messageId).toBeDefined();
      expect(mockCore.db.sea.sign).toHaveBeenCalledWith(messageContent, expect.any(Object));
      expect(mockCore.db.sea.encrypt).toHaveBeenCalledWith(messageContent, "group_key_123");
    });

    test("should fail when user is not logged in", async () => {
      mockCore.isLoggedIn = () => false;

      const result = await groupManager.sendGroupMessage("group_123", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Devi essere loggato");
    });

    test("should fail when group is not found", async () => {
      jest.spyOn(groupManager, 'getGroupData').mockResolvedValue(null);

      const result = await groupManager.sendGroupMessage("nonexistent_group", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Gruppo non trovato");
    });

    test("should fail when user is not a member", async () => {
      const nonMemberGroupData = {
        ...mockGroupData,
        members: ["other_member_1", "other_member_2"],
        encryptedKeys: {
          "other_member_1": "encrypted_key_1",
          "other_member_2": "encrypted_key_2"
        }
      };
      jest.spyOn(groupManager, 'getGroupData').mockResolvedValue(nonMemberGroupData);

      const result = await groupManager.sendGroupMessage("group_123", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Non sei membro di questo gruppo");
    });

    test("should fail when group key retrieval fails", async () => {
      jest.spyOn(groupManager, 'getGroupKeyForUser').mockResolvedValue(undefined);

      const result = await groupManager.sendGroupMessage("group_123", "Hello");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Impossibile ottenere la chiave del gruppo");
    });
  });

  describe("getGroupData", () => {
    test("should retrieve group data successfully", async () => {
      const groupData = {
        id: "group_123",
        name: "Test Group",
        members: { "member1": true, "member2": true },
        createdBy: "creator_pub_key_123",
        createdAt: Date.now(),
        encryptedKeys: { "member1": "key1", "member2": "key2" }
      };

      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn((callback: any) => callback(groupData)),
        get: jest.fn(() => ({
          map: jest.fn(() => ({
            once: jest.fn((callback: any) => {
              callback(true, "member1");
              callback(true, "member2");
            })
          }))
        }))
      }));

      const result = await groupManager.getGroupData("group_123");

      expect(result).toBeDefined();
      expect(result?.id).toBe("group_123");
      expect(result?.name).toBe("Test Group");
      expect(result?.members).toContain("member1");
      expect(result?.members).toContain("member2");
    });

    test("should return null when group does not exist", async () => {
      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn((callback: any) => callback(null))
      }));

      const result = await groupManager.getGroupData("nonexistent_group");

      expect(result).toBeNull();
    });

    test("should handle errors gracefully", async () => {
      mockCore.db.gun.get = jest.fn(() => ({
        once: jest.fn(() => {
          throw new Error("Network error");
        })
      }));

      const result = await groupManager.getGroupData("group_123");

      expect(result).toBeNull();
    });
  });

  describe("verifyGroupMembership", () => {
    const mockGroupData: GroupData = {
      id: "group_123",
      name: "Test Group",
      members: ["member1_pub", "member2_pub"],
      createdBy: "creator_pub_key_123",
      createdAt: Date.now(),
      encryptedKeys: {
        "member1_pub": "encrypted_key_1",
        "member2_pub": "encrypted_key_2"
      }
    };

    test("should verify creator membership", async () => {
      const result = await (groupManager as any).verifyGroupMembership(
        mockGroupData,
        "creator_pub_key_123"
      );

      expect(result).toBe(true);
    });

    test("should verify member with encrypted key", async () => {
      const result = await (groupManager as any).verifyGroupMembership(
        mockGroupData,
        "member1_pub"
      );

      expect(result).toBe(true);
    });

    test("should verify member from members array", async () => {
      const groupDataWithoutKeys = {
        ...mockGroupData,
        encryptedKeys: {}
      };

      const result = await (groupManager as any).verifyGroupMembership(
        groupDataWithoutKeys,
        "member1_pub"
      );

      expect(result).toBe(true);
    });

    test("should reject non-member", async () => {
      const result = await (groupManager as any).verifyGroupMembership(
        mockGroupData,
        "non_member_pub"
      );

      expect(result).toBe(false);
    });
  });

  describe("getGroupKeyForUser", () => {
    const mockGroupData: GroupData = {
      id: "group_123",
      name: "Test Group",
      members: ["creator_pub_key_123", "member1_pub"],
      createdBy: "creator_pub_key_123",
      createdAt: Date.now(),
      encryptedKeys: {
        "creator_pub_key_123": "encrypted_key_1",
        "member1_pub": "encrypted_key_2"
      }
    };

    test("should get group key for user with encrypted key", async () => {
      const result = await groupManager.getGroupKeyForUser(
        mockGroupData,
        "creator_pub_key_123",
        { pub: "creator_pub_key_123", epub: "creator_epub" }
      );

      expect(result).toBe("group_key_123");
      expect(mockCore.db.sea.secret).toHaveBeenCalled();
      expect(mockCore.db.sea.decrypt).toHaveBeenCalled();
    });

    test("should handle missing encrypted key", async () => {
      const groupDataWithoutUserKey = {
        ...mockGroupData,
        encryptedKeys: { "member1_pub": "encrypted_key_2" }
      };

      // Mock the recovery to fail
      jest.spyOn(groupManager as any, 'recoverCreatorGroupKey').mockResolvedValue(undefined);

      const result = await groupManager.getGroupKeyForUser(
        groupDataWithoutUserKey,
        "creator_pub_key_123",
        { pub: "creator_pub_key_123", epub: "creator_epub" }
      );

      expect(result).toBeUndefined();
    });

    test("should handle decryption failure", async () => {
      mockCore.db.sea.decrypt = jest.fn().mockResolvedValue(null);

      const result = await groupManager.getGroupKeyForUser(
        mockGroupData,
        "creator_pub_key_123",
        { pub: "creator_pub_key_123", epub: "creator_epub" }
      );

      expect(result).toBeUndefined();
    });

    test("should handle shared secret derivation failure", async () => {
      mockCore.db.sea.secret = jest.fn().mockResolvedValue(null);

      const result = await groupManager.getGroupKeyForUser(
        mockGroupData,
        "creator_pub_key_123",
        { pub: "creator_pub_key_123", epub: "creator_epub" }
      );

      expect(result).toBeUndefined();
    });
  });

  describe("recoverCreatorGroupKey", () => {
    const mockGroupData: GroupData = {
      id: "group_123",
      name: "Test Group",
      members: ["creator_pub_key_123", "member1_pub"],
      createdBy: "creator_pub_key_123",
      createdAt: Date.now(),
      encryptedKeys: {
        "member1_pub": "encrypted_key_2" // Creator's key is missing
      }
    };

    test("should recover creator key from member's encrypted key", async () => {
      const result = await (groupManager as any).recoverCreatorGroupKey(
        mockGroupData,
        { pub: "creator_pub_key_123", epub: "creator_epub" }
      );

      expect(result).toBeDefined();
      expect(mockCore.db.sea.secret).toHaveBeenCalled();
      expect(mockCore.db.sea.decrypt).toHaveBeenCalled();
      expect(mockCore.db.sea.encrypt).toHaveBeenCalled();
    });

    test("should return undefined when recovery fails", async () => {
      mockCore.db.sea.decrypt = jest.fn().mockResolvedValue(null);

      const result = await (groupManager as any).recoverCreatorGroupKey(
        mockGroupData,
        { pub: "creator_pub_key_123", epub: "creator_epub" }
      );

      expect(result).toBeUndefined();
    });
  });
});
