// Simple test to verify public rooms functionality
const { MessagingPlugin } = require("./dist/cjs/index.js");

// Mock ShogunCore
class MockShogunCore {
  constructor() {
    this.db = {
      user: {
        is: { alias: "TestUser" },
        _: { sea: { pub: "test-pub-key" } },
      },
      gun: {
        get: (path) => ({
          map: () => ({
            on: (callback) => {
              // Mock listener
              return { off: () => {} };
            },
            once: (callback) => {
              // Mock data retrieval
              callback(null);
            },
          }),
          put: (data, ack) => {
            // Mock put operation
            ack({ err: null });
          },
        }),
        sea: {
          sign: async (data, pair) => "mock-signature",
        },
      },
      isLoggedIn: () => true,
    };
  }
}

// Mock EncryptionManager
class MockEncryptionManager {
  async verifyMessageSignature(content, signature, pub) {
    return true;
  }
}

async function testPublicRooms() {
  console.log("🧪 Testing Public Rooms Implementation...");

  try {
    const core = new MockShogunCore();
    const encryptionManager = new MockEncryptionManager();
    const plugin = new MessagingPlugin();

    // Initialize plugin
    await plugin.initialize(core);
    console.log("✅ Plugin initialized successfully");

    // Test creating a public room
    const createResult = await plugin.createPublicRoom(
      "test-room",
      "Test room description"
    );
    console.log("✅ Create room result:", createResult);

    // Test getting public rooms
    const rooms = await plugin.getPublicRooms();
    console.log("✅ Get rooms result:", rooms);

    // Test sending a public message
    const sendResult = await plugin.sendPublicMessage(
      "test-room",
      "Hello world!"
    );
    console.log("✅ Send message result:", sendResult);

    console.log("🎉 All tests passed!");
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
testPublicRooms();
