# Shogun Messaging Plugin

E2E (End-to-End) messaging plugin for Shogun Core with advanced encryption and GunDB support.

## 🚀 Features

- ✅ **Complete E2E encryption** with SEA (Security, Encryption, Authorization)
- ✅ **Digital signature** for message authentication
- ✅ **Decentralized storage** on GunDB
- ✅ **Duplicate management** and automatic TTL
- ✅ **TypeScript API** with complete types
- ✅ **Robust error handling**
- ✅ **Automatic epub publishing** for MetaMask compatibility
- ✅ **Multiple fallback strategies** to find encryption keys
- ✅ **Self-messaging support** for testing and debugging

## 📦 Installation

```bash
npm install shogun-message-plugin
```

## 🔧 Initialization

```typescript
import { MessagingPlugin } from "shogun-message-plugin";
import { ShogunCore } from "shogun-core";

const core = new ShogunCore();
const messagingPlugin = new MessagingPlugin();

// Initialize the plugin
messagingPlugin.initialize(core);

// Register listener for messages
messagingPlugin.onMessage((message) => {
  console.log("New message:", message);
});
```

## 📚 API Reference

### Class `MessagingPlugin`

#### Properties

| Property      | Type     | Description                |
| ------------- | -------- | -------------------------- |
| `name`        | `string` | Plugin name: `"messaging"` |
| `version`     | `string` | Current version: `"4.6.0"` |
| `description` | `string` | Plugin description         |

#### Methods

### `initialize(core: ShogunCore): void`

Initializes the plugin with the ShogunCore instance. **Automatically publishes the user's epub** to ensure compatibility with other clients.

**Parameters:**

- `core` - ShogunCore instance

**Example:**

```typescript
messagingPlugin.initialize(shogunCore);
```

### `sendMessage(recipientPub: string, messageContent: string): Promise<MessageResponse>`

Sends an E2E encrypted message to a recipient. Uses **multiple fallback strategies** to find the recipient's encryption key.

**Parameters:**

- `recipientPub` - Recipient's public key
- `messageContent` - Message content

**Returns:** `Promise<MessageResponse>`

**Example:**

```typescript
const result = await messagingPlugin.sendMessage(
  "Che_fIh6G7qwSkxpZJokqPU_oosvBHwOn8vfCBWFPOM.FuViQQDC6gGFufyOo1_3xrXLQj6bQOwWZgm85dbSfbA",
  "Hello! How are you?"
);

if (result.success) {
  console.log("Message sent:", result.messageId);
} else {
  console.error("Error:", result.error);
}
```

### `publishUserEpub(): Promise<boolean>`

**NEW**: Manually publishes the current user's epub to the GunDB network. Useful for debugging and ensuring other users can find the encryption key.

**Returns:** `Promise<boolean>` - `true` if publishing was successful

**Example:**

```typescript
// Manually publish the user's epub
const success = await messagingPlugin.publishUserEpub();
if (success) {
  console.log("✅ Epub published successfully");
} else {
  console.error("❌ Error publishing epub");
}
```

### `onMessage(callback: MessageListener): void`

Registers a listener to receive incoming messages.

**Parameters:**

- `callback` - Callback function that receives messages

**Example:**

```typescript
messagingPlugin.onMessage((message) => {
  console.log("Message from:", message.from);
  console.log("Content:", message.content);
  console.log("Timestamp:", new Date(message.timestamp));
});
```

### `startListening(): void`

Starts listening for incoming messages.

**Example:**

```typescript
messagingPlugin.startListening();
```

### `stopListening(): void`

Stops listening for messages.

**Example:**

```typescript
messagingPlugin.stopListening();
```

### `clearConversation(recipientPub: string): Promise<MessageResponse>`

**NEW**: Clears all messages from a specific conversation.

**Parameters:**

- `recipientPub` - Recipient's public key

**Returns:** `Promise<MessageResponse>`

**Example:**

```typescript
const result = await messagingPlugin.clearConversation(recipientPub);
if (result.success) {
  console.log("✅ Conversation cleared");
} else {
  console.error("❌ Error:", result.error);
}
```

### `resetClearedConversations(): void`

**NEW**: Resets the cleared conversations tracking.

**Example:**

```typescript
messagingPlugin.resetClearedConversations();
```

### `getStats(): MessagingStats`

Gets plugin statistics.

**Returns:** `MessagingStats`

**Example:**

```typescript
const stats = messagingPlugin.getStats();
console.log("Listening:", stats.isListening);
console.log("Active listeners:", stats.messageListenersCount);
console.log("Processed messages:", stats.processedMessagesCount);
console.log("Cleared conversations:", stats.clearedConversationsCount);
```

### `destroy(): void`

Destroys the plugin and frees resources.

**Example:**

```typescript
messagingPlugin.destroy();
```

## 📋 Types and Interfaces

### `MessageData`

```typescript
interface MessageData {
  from: string; // Sender's public key
  content: string; // Message content
  timestamp: number; // Unix timestamp
  id: string; // Unique message ID
  signature?: string; // Digital signature (optional)
}
```

### `MessageResponse`

```typescript
interface MessageResponse {
  success: boolean; // Operation result
  messageId?: string; // Message ID (if success)
  error?: string; // Error message (if failure)
}
```

### `MessageListener`

```typescript
type MessageListener = (message: MessageData) => void;
```

### `MessagingStats`

```typescript
interface MessagingStats {
  isListening: boolean; // Whether the plugin is listening
  messageListenersCount: number; // Number of registered listeners
  processedMessagesCount: number; // Number of processed messages
  clearedConversationsCount: number; // Number of cleared conversations
  version: string; // Plugin version
  hasActiveListener: boolean; // Whether there's an active listener
}
```

## 🔐 Security

### E2E Encryption

The plugin uses end-to-end encryption with:

1. **Shared key derivation** via `SEA.secret()`
2. **AES-GCM encryption** for messages
3. **Digital signature** for authentication
4. **Automatic integrity verification**

### Encryption Key Management (epub)

**NEW**: The plugin implements multiple fallback strategies to find the recipient's encryption key:

1. **Self-messaging**: If sender and recipient are the same user
2. **User data**: Search in `user.get("is")`
3. **Public space**: Search in `~userPub`
4. **Profile data**: Search in `user.get("profile")`
5. **Root data**: Search in `user.get("~")`
6. **Direct pub key**: Search directly under the public key
7. **Temporary epub**: Create a temporary epub if necessary

### Automatic epub Publishing

**NEW**: At login, the plugin automatically publishes the user's epub in:

- `user.get("is")` - User data
- `~userPub` - Public space

This ensures other users can find the encryption key.

### Security Flow

```
Sender → Encrypt with shared key → GunDB → Recipient → Decrypt with same key
```

### Key Management

- **Signing public key** (`pub`): For authentication
- **Encryption public key** (`epub`): For E2E encryption
- **Private key** (`priv`, `epriv`): For decryption and signing

## 🗄️ Storage

### GunDB Structure

```
messages/
├── msg_[hash_recipient1]/
│   ├── msg_[id1]: { data: encrypted, from: pub, timestamp, id }
│   └── msg_[id2]: { data: encrypted, from: pub, timestamp, id }
└── msg_[hash_recipient2]/
    └── msg_[id3]: { data: encrypted, from: pub, timestamp, id }

users/
├── ~[userPub1]/
│   └── epub: "encryption_public_key"
└── ~[userPub2]/
    └── epub: "encryption_public_key"
```

### Duplicate Management

- **Automatic TTL**: 24 hours for processed messages
- **Local cache**: Maximum 1000 messages in memory
- **Deduplication**: Avoids multiple processing

## ⚡ Performance

### Optimizations

- **Path encoding**: Hash-based for GunDB compatibility
- **Automatic cleanup**: Removal of expired messages
- **Single listener**: Avoids duplicates in listening
- **Memory management**: Limited cache for processed messages
- **Smart fallbacks**: Multiple strategies to find epub

## 🚨 Error Handling

### Common Errors

| Error                           | Cause                  | Solution                |
| ------------------------------- | ---------------------- | ----------------------- |
| `"User not authenticated"`      | User not logged in     | Perform login           |
| `"Recipient epub not found"`    | Missing encryption key | Use `publishUserEpub()` |
| `"Cannot derive shared secret"` | Cryptography problem   | Verify keys             |
| `"Message not authentic"`       | Invalid signature      | Message compromised     |

### Troubleshooting

#### Problem: "Recipient epub not found"

**Cause**: The recipient hasn't published their encryption key.

**Solutions**:

1. **Automatic publishing**: The plugin automatically publishes epub at login
2. **Manual publishing**: Call `publishUserEpub()` to force publishing
3. **Temporary fallback**: The plugin creates a temporary epub if necessary

```typescript
// Force epub publishing
await messagingPlugin.publishUserEpub();

// Verify it was published
const stats = messagingPlugin.getStats();
console.log("Plugin active:", stats.isListening);
```

#### Problem: MetaMask doesn't work

**Cause**: MetaMask doesn't automatically publish epub.

**Solution**: The plugin now automatically handles this case with multiple fallbacks.

### Logging

The plugin provides detailed logging for debugging:

```typescript
// Enable detailed logging
console.log("Messaging stats:", messagingPlugin.getStats());

// Verify epub publishing
await messagingPlugin.publishUserEpub();
```

## 📝 Complete Examples

### Complete Chat

```typescript
import { MessagingPlugin } from "shogun-message-plugin";
import { ShogunCore } from "shogun-core";

class ChatApp {
  private messaging: MessagingPlugin;
  private messages: MessageData[] = [];

  constructor() {
    this.messaging = new MessagingPlugin();
  }

  async initialize(core: ShogunCore) {
    // Initialize plugin
    this.messaging.initialize(core);

    // Register listener
    this.messaging.onMessage((message) => {
      this.messages.push(message);
      this.displayMessage(message);
    });

    // Start listening
    this.messaging.startListening();

    // Publish epub for compatibility
    await this.messaging.publishUserEpub();
  }

  async sendMessage(recipientPub: string, content: string) {
    try {
      const result = await this.messaging.sendMessage(recipientPub, content);

      if (result.success) {
        console.log("✅ Message sent");
        return result.messageId;
      } else {
        console.error("❌ Send error:", result.error);
        return null;
      }
    } catch (error) {
      console.error("❌ Error:", error);
      return null;
    }
  }

  async clearConversation(recipientPub: string) {
    const result = await this.messaging.clearConversation(recipientPub);
    if (result.success) {
      this.messages = this.messages.filter(
        (msg) => msg.from !== recipientPub && msg.to !== recipientPub
      );
    }
    return result.success;
  }

  private displayMessage(message: MessageData) {
    console.log(`💬 ${message.from}: ${message.content}`);
  }

  getStats() {
    return this.messaging.getStats();
  }

  destroy() {
    this.messaging.destroy();
  }
}
```

### Contact Management with MetaMask

```typescript
class ContactManager {
  private contacts = new Map<string, Contact>();
  private messaging: MessagingPlugin;

  constructor(messaging: MessagingPlugin) {
    this.messaging = messaging;
  }

  async sendToContact(contactPub: string, message: string) {
    try {
      // Ensure epub is published
      await this.messaging.publishUserEpub();

      const result = await this.messaging.sendMessage(contactPub, message);
      return result.success;
    } catch (error) {
      console.error("Send error:", error);
      return false;
    }
  }

  async addContact(pub: string, name: string) {
    this.contacts.set(pub, { pub, name, lastSeen: Date.now() });

    // Publish your epub to allow the contact to respond
    await this.messaging.publishUserEpub();
  }

  async testSelfMessaging() {
    // Test message to yourself
    const userPub = "your_public_key_here";
    return await this.sendToContact(userPub, "Test self-message");
  }
}
```

### Debug and Troubleshooting

```typescript
class MessagingDebugger {
  constructor(private messaging: MessagingPlugin) {}

  async diagnoseEpubIssue(recipientPub: string) {
    console.log("🔍 Diagnosing epub issue...");

    // 1. Publish your epub
    await this.messaging.publishUserEpub();

    // 2. Try to send a message
    const result = await this.messaging.sendMessage(recipientPub, "Test");

    // 3. Check statistics
    const stats = this.messaging.getStats();
    console.log("📊 Statistics:", stats);

    return result.success;
  }

  async forceEpubPublishing() {
    console.log("📡 Forcing epub publishing...");
    const success = await this.messaging.publishUserEpub();

    if (success) {
      console.log("✅ Epub published successfully");
    } else {
      console.log("❌ Publishing error");
    }

    return success;
  }
}
```

## 🔄 Versions

| Version | Date | Changes                                                         |
| ------- | ---- | --------------------------------------------------------------- |
| 4.6.0   | 2024 | Automatic epub publishing, multiple fallbacks, MetaMask support |
| 4.5.0   | 2024 | E2E encryption, path encoding, error handling                   |
| 4.0.0   | 2024 | Basic cryptography, digital signature                           |
| 3.0.0   | 2024 | Initial release                                                 |

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributions

1. Fork the repository
2. Create feature branch (`git checkout -b feature/new-feature`)
3. Commit changes (`git commit -am 'Add new feature'`)
4. Push branch (`git push origin feature/new-feature`)
5. Create Pull Request

## 🐛 Bug Reports

To report bugs or request features:

1. Open an issue on GitHub
2. Describe the problem in detail
3. Include logs and stack traces if available
4. Specify plugin version and environment
5. If the problem involves MetaMask, include plugin debug logs
