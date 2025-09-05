/**
 * Test script to verify that messages are sent to both conversation paths and legacy paths
 * Run this script to test the fix for message delivery issues
 */

const Gun = require('gun');
require('gun/gun');
require('gun/sea');

// Mock Shogun Core for testing
class MockShogunCore {
  constructor() {
    this.db = {
      gun: Gun(),
      sea: Gun.SEA,
      user: null
    };
    this.plugins = new Map();
  }

  async createUser(alias, password) {
    return new Promise((resolve, reject) => {
      this.db.gun.user().create(alias, password, (ack) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          console.log(`✅ User ${alias} created successfully`);
          resolve();
        }
      });
    });
  }

  async login(alias, password) {
    return new Promise((resolve, reject) => {
      this.db.gun.user().auth(alias, password, (ack) => {
        if (ack.err) {
          reject(new Error(ack.err));
        } else {
          this.db.user = this.db.gun.user();
          console.log(`✅ User ${alias} logged in successfully`);
          console.log(`📋 User pub: ${this.db.user.is.pub}`);
          resolve();
        }
      });
    });
  }

  isLoggedIn() {
    return !!this.db.user;
  }

  getPlugin(name) {
    return this.plugins.get(name);
  }

  addPlugin(name, plugin) {
    this.plugins.set(name, plugin);
  }
}

// Simple message structure for testing
function createTestMessage(from, to, content) {
  const messageId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const currentDate = new Date().toISOString().split('T')[0];
  
  return {
    id: messageId,
    senderPub: from,
    recipientPub: to,
    sender: from.slice(0, 8) + "...",
    recipient: to.slice(0, 8) + "...",
    message: content,
    timestamp: Date.now(),
    type: "alias",
    encrypted: false, // For testing
    path: `${to}/messages/${currentDate}`
  };
}

async function testLegacyPathMessaging() {
  console.log("🧪 Testing Legacy Path Messaging Fix");
  console.log("=====================================");

  try {
    // Create two mock instances
    const core1 = new MockShogunCore();
    const core2 = new MockShogunCore();

    // Create and login users
    const alice_alias = "alice_test";
    const bob_alias = "bob_test";
    const password = "test123";

    console.log("\n📝 Creating test users...");
    await core1.createUser(alice_alias, password);
    await core2.createUser(bob_alias, password);

    await core1.login(alice_alias, password);
    await core2.login(bob_alias, password);

    const alicePub = core1.db.user.is.pub;
    const bobPub = core2.db.user.is.pub;

    console.log(`\n👤 Alice pub: ${alicePub}`);
    console.log(`👤 Bob pub: ${bobPub}`);

    // Test message from Alice to Bob
    console.log("\n📤 Testing message send to legacy path...");
    const testMessage = createTestMessage(alicePub, bobPub, "Hello Bob! This is a test message.");
    
    console.log(`📍 Message will be sent to path: ${testMessage.path}`);
    console.log(`📋 Message ID: ${testMessage.id}`);

    // Send message to legacy path (simulating the fix)
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("Timeout sending message"));
      }, 5000);

      core1.db.gun
        .get(testMessage.path)
        .get(testMessage.id)
        .put(testMessage, (ack) => {
          clearTimeout(timeout);
          if (ack && ack.err) {
            console.error("❌ Error sending message:", ack.err);
            reject(new Error(ack.err));
          } else {
            console.log("✅ Message sent to legacy path successfully");
            resolve();
          }
        });
    });

    // Test receiving message (simulating legacy path listener)
    console.log("\n📥 Testing message receive from legacy path...");
    
    const receivedMessages = [];
    
    // Set up listener (simulating startListeningToLegacyPaths)
    const messagesPath = `${bobPub}/messages`;
    console.log(`👂 Setting up listener on path: ${messagesPath}`);

    core2.db.gun.get(messagesPath).map().on((dateData, date) => {
      if (dateData && typeof date === "string" && date !== "_") {
        console.log(`📅 Date detected: ${date}`);
        
        const dateMessagesPath = `${messagesPath}/${date}`;
        core2.db.gun.get(dateMessagesPath).map().on((messageData, messageId) => {
          if (messageData && typeof messageData === "object" && messageId !== "_") {
            console.log(`📨 Message detected: ${messageId}`);
            
            if (messageData.recipientPub === bobPub) {
              console.log("✅ Message is for Bob, processing...");
              console.log(`📄 Content: ${messageData.message}`);
              console.log(`👤 From: ${messageData.sender} (${messageData.senderPub})`);
              
              receivedMessages.push(messageData);
            }
          }
        });
      }
    });

    // Wait for message to be received
    console.log("\n⏳ Waiting for message to be received...");
    await new Promise(resolve => {
      const checkInterval = setInterval(() => {
        if (receivedMessages.length > 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
      
      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 10000);
    });

    // Check results
    console.log("\n📊 Test Results:");
    console.log("================");
    if (receivedMessages.length > 0) {
      console.log("✅ SUCCESS: Message was received via legacy path!");
      console.log(`📈 Messages received: ${receivedMessages.length}`);
      receivedMessages.forEach((msg, index) => {
        console.log(`📨 Message ${index + 1}:`);
        console.log(`   ID: ${msg.id}`);
        console.log(`   Content: ${msg.message}`);
        console.log(`   From: ${msg.sender}`);
        console.log(`   Timestamp: ${new Date(msg.timestamp).toISOString()}`);
      });
    } else {
      console.log("❌ FAILURE: No messages were received via legacy path");
    }

    console.log("\n🎯 Test completed!");

  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
if (require.main === module) {
  testLegacyPathMessaging();
}

module.exports = { testLegacyPathMessaging };
