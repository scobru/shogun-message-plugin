import { MessagingPlugin } from "../messagingPlugin";

// Mock ShogunCore per testare la messaggistica dei gruppi
function makeCoreMock() {
  const currentUserPair = { pub: "sender_pub", epub: "sender_epub" };

  // Create a mock that supports chained .get() calls with proper put method
  const mockData = new Map();

  const createMockGunNode = (path?: string): any => {
    const node: any = {
      put: jest.fn((data: any, callback?: any): any => {
        if (path) {
          mockData.set(path, data);
        }
        if (callback && typeof callback === "function") {
          callback({});
        }
        return node;
      }),
      get: jest.fn((key?: string): any => {
        const fullPath = key ? `${path || ""}/${key}` : path || "";
        const data = mockData.get(fullPath);
        const childNode = createMockGunNode(fullPath);
        childNode.once = jest.fn((callback: any) => {
          if (data) {
            callback(data);
          } else {
            callback(null);
          }
        });
        return childNode;
      }),
      map: jest.fn(() => ({
        on: jest.fn(() => ({ off: jest.fn() })),
        once: jest.fn((callback: any) => {
          // Mock the map behavior for members and encryptedKeys
          if (path && path.includes("members")) {
            // Return members as { pubkey: true } structure
            callback(true, "sender_pub");
            callback(true, "member1_pub");
            callback(true, "member2_pub");
          } else if (path && path.includes("encryptedKeys")) {
            // Return encrypted keys as { pubkey: encryptedKey } structure
            callback("encrypted_key_for_sender", "sender_pub");
            callback("encrypted_key_for_member1", "member1_pub");
            callback("encrypted_key_for_member2", "member2_pub");
          } else {
            callback({ epub: "recipient_epub" });
          }
        }),
      })),
      once: jest.fn((callback: any) => {
        const data = path ? mockData.get(path) : null;
        if (data) {
          callback(data);
        } else {
          callback(null);
        }
      }),
      on: jest.fn((callback: any) => {
        const data = path ? mockData.get(path) : null;
        if (data) {
          callback(data);
        }
        return { off: jest.fn() };
      }),
    };
    return node;
  };

  // Create a mock user chain that supports the expected methods
  const createMockUserChain = (userPub?: string): any => {
    const userChain: any = {
      get: jest.fn((key?: string): any => {
        const childNode = createMockGunNode(
          key ? `${userPub}/${key}` : userPub,
        );
        // Mock the "is" property to return user data with epub
        if (key === "is") {
          childNode.once = jest.fn((callback: any) => {
            callback({ epub: `${userPub}_epub` });
          });
        }
        return childNode;
      }),
      put: jest.fn((data: any, callback?: any): any => {
        if (callback && typeof callback === "function") {
          callback({});
        }
        return userChain;
      }),
      once: jest.fn((callback: any) => callback({ epub: `${userPub}_epub` })),
    };
    return userChain;
  };

  const user = { _: { sea: currentUserPair } } as any;

  const sea = {
    sign: jest.fn(async (_data: string, _pair: any) => "signed"),
    secret: jest.fn(async (_epub: string, _pair: any) => "shared_secret"),
    encrypt: jest.fn(async (_msg: any, _secret: string) => "enc"),
    decrypt: jest.fn(async (_msg: any, _secret: string) => "decrypted_message"),
    verify: jest.fn(async () => true),
  };

  const crypto = {
    secret: jest.fn(async () => "shared_secret"),
    encrypt: jest.fn(async () => "enc"),
    decrypt: jest.fn(async () => "decrypted_message"),
  };

  const gun = {
    get: jest.fn((key?: string) => createMockGunNode(key)),
    user: jest.fn((userPub?: string) => createMockUserChain(userPub)),
  } as any;

  const core: any = {
    db: {
      gun,
      user,
      sea,
      crypto,
      getCurrentUser: jest.fn(() => ({ pub: "sender_pub" })),
      putUserData: jest.fn().mockResolvedValue(undefined),
      getUserData: jest.fn().mockResolvedValue({}),
    },
    isLoggedIn: () => true,
  };

  return { core, gun, sea, crypto };
}

describe("Group Messaging", () => {
  test("should create group and send message", async () => {
    const { core } = makeCoreMock();
    const plugin = new MessagingPlugin();
    await plugin.initialize(core as any);

    const groupName = "Test Group";
    const memberPubs = ["member1_pub", "member2_pub"];

    // Create group
    console.log("🔍 Test: Creating group...");
    const createResult = await plugin.createGroup(groupName, memberPubs);
    console.log("🔍 Test: Create result:", createResult);

    expect(createResult.success).toBe(true);
    expect(createResult.groupData).toBeDefined();

    if (createResult.success && createResult.groupData) {
      const groupId = createResult.groupData.id;

      // Check if listener is active
      const hasListener = plugin.hasGroupListener(groupId);
      console.log("🔍 Test: Has group listener:", hasListener);
      expect(hasListener).toBe(true);

      // Send message
      console.log("🔍 Test: Sending message...");
      const messageContent = "Hello group!";
      const sendResult = await plugin.sendGroupMessage(groupId, messageContent);
      console.log("🔍 Test: Send result:", sendResult);

      expect(sendResult.success).toBe(true);
      expect(sendResult.messageId).toBeDefined();
    }
  });

  test("should verify listener status", async () => {
    const { core } = makeCoreMock();
    const plugin = new MessagingPlugin();
    await plugin.initialize(core as any);

    // Check initial status
    const initialStatus = plugin.getListenerStatus();
    console.log("🔍 Test: Initial status:", initialStatus);

    // Create group
    const createResult = await plugin.createGroup("Test Group", ["member1"]);

    if (createResult.success && createResult.groupData) {
      // Check status after group creation
      const status = plugin.getListenerStatus();
      console.log("🔍 Test: Status after group creation:", status);

      expect(status.isListeningGroups).toBe(true);
      expect(status.groupListenersCount).toBeGreaterThan(0);
    }
  });
});
