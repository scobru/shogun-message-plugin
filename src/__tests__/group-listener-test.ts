import { MessagingPlugin } from "../messagingPlugin";

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
      JSON.stringify({ content: "decrypted" }),
    ),
    verify: jest.fn(async (signature: string, pub: string) => "verified_data"),
  };

  const gun = {
    get: jest.fn(() => ({
      map: jest.fn(() => ({
        on: jest.fn((callback: any) => {
          // Don't simulate incoming message to avoid async issues
          return { off: jest.fn() }; // Return a listener object with off method
        }),
      })),
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
      getUserData: jest.fn().mockResolvedValue({}),
    },
    isLoggedIn: () => true,
  };

  return { core, sea, gun, currentUserPair };
}

describe("Group Listener Activation", () => {
  let mockCore: any;

  beforeEach(() => {
    const mock = makeCoreMock();
    mockCore = mock.core;
  });

  test("joinChat should activate group listener", async () => {
    const plugin = new MessagingPlugin();
    await plugin.initialize(mockCore);

    const groupId = "test_group_123";
    const result = await plugin.joinChat("group", groupId);

    // joinChat returns success: false when group doesn't exist, but still activates listener
    expect(result.success).toBe(false);
    expect(result.error).toContain("Group not found");

    // Verifica che il listener sia stato attivato
    expect(plugin.hasGroupListener(groupId)).toBe(true);

    // Verifica lo status dei listener
    const status = plugin.getListenerStatus();
    expect(status.groupListenersCount).toBeGreaterThan(0);
  });

  test("addGroupListener should activate listener directly", async () => {
    const plugin = new MessagingPlugin();
    await plugin.initialize(mockCore);

    const groupId = "test_group_456";

    // addGroupListener doesn't return a result object
    plugin.addGroupListener(groupId);

    expect(plugin.hasGroupListener(groupId)).toBe(true);
  });

  test("removeGroupListener should deactivate listener", async () => {
    const plugin = new MessagingPlugin();
    await plugin.initialize(mockCore);

    const groupId = "test_group_789";

    // Add listener first
    plugin.addGroupListener(groupId);
    expect(plugin.hasGroupListener(groupId)).toBe(true);

    // Remove listener
    plugin.removeGroupListener(groupId);
    expect(plugin.hasGroupListener(groupId)).toBe(false);
  });
});
