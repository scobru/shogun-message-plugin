# Shogun Messaging Plugin

A comprehensive end-to-end encrypted messaging plugin for the Shogun protocol, built on GunDB. This plugin provides both private encrypted messaging and public room messaging capabilities.

## Features

- **End-to-End Encryption**: Secure private messaging using GunDB's SEA encryption
- **Public Room Messaging**: Unencrypted messages to public rooms with signature verification
- **Automatic epub Publishing**: Ensures your encryption key is available on the network
- **Multiple Fallback Strategies**: 7 different methods to find recipient encryption keys
- **MetaMask Support**: Full compatibility with MetaMask authentication
- **Duplicate Prevention**: Intelligent message deduplication
- **Conversation Management**: Clear conversations and track cleared chats
- **Performance Optimized**: Efficient message processing and cleanup
- **DRY Code Design**: Shared utilities for both private and public messaging

## Installation

```bash
npm install shogun-message-plugin
```

## Quick Start

```typescript
import { MessagingPlugin } from "shogun-message-plugin";

// Initialize the plugin
const messagingPlugin = new MessagingPlugin();

// Register with Shogun Core
sdk.register(messagingPlugin);

// Listen for private messages
messagingPlugin.onMessage((message) => {
  console.log("Private message received:", message);
});

// Listen for public room messages
messagingPlugin.onPublicMessage((message) => {
  console.log("Public message received:", message);
});
```

## API Reference

### Private Messaging

#### `sendMessage(recipientPub: string, content: string): Promise<MessageResponse>`

Sends an encrypted message to a specific user.

```typescript
const result = await messagingPlugin.sendMessage(
  "recipient_public_key",
  "Hello, this is encrypted!"
);

if (result.success) {
  console.log("Message sent with ID:", result.messageId);
} else {
  console.error("Failed to send:", result.error);
}
```

#### `onMessage(callback: MessageListener): void`

Registers a callback for incoming private messages.

```typescript
messagingPlugin.onMessage((message) => {
  console.log(`From: ${message.from}`);
  console.log(`Content: ${message.content}`);
  console.log(`Timestamp: ${message.timestamp}`);
});
```

### Public Room Messaging

#### `sendPublicMessage(roomId: string, content: string): Promise<MessageResponse>`

Sends an unencrypted message to a public room.

```typescript
const result = await messagingPlugin.sendPublicMessage(
  "general",
  "Hello everyone in the general room!"
);

if (result.success) {
  console.log("Public message sent with ID:", result.messageId);
} else {
  console.error("Failed to send:", result.error);
}
```

#### `startListeningPublic(roomId: string): void`

Starts listening to messages in a specific public room.

```typescript
messagingPlugin.startListeningPublic("general");
```

#### `stopListeningPublic(): void`

Stops listening to public room messages.

```typescript
messagingPlugin.stopListeningPublic();
```

#### `onPublicMessage(callback: PublicMessageListener): void`

Registers a callback for incoming public room messages.

```typescript
messagingPlugin.onPublicMessage((message) => {
  console.log(`Room: ${message.roomId}`);
  console.log(`From: ${message.username || message.from}`);
  console.log(`Content: ${message.content}`);
  console.log(`Timestamp: ${message.timestamp}`);
});
```

### Utility Methods

#### `publishUserEpub(): Promise<boolean>`

Manually publishes your encryption key to the network.

```typescript
const success = await messagingPlugin.publishUserEpub();
if (success) {
  console.log("Your encryption key is now available on the network");
}
```

#### `clearConversation(recipientPub: string): Promise<MessageResponse>`

Clears all messages in a conversation with a specific user.

```typescript
const result = await messagingPlugin.clearConversation("recipient_public_key");
if (result.success) {
  console.log("Conversation cleared successfully");
}
```

#### `resetClearedConversations(): void`

Resets the tracking of cleared conversations.

```typescript
messagingPlugin.resetClearedConversations();
```

#### `getStats(): MessagingStats`

Gets current plugin statistics.

```typescript
const stats = messagingPlugin.getStats();
console.log("Plugin stats:", stats);
```

## Data Structures

### MessageData (Private Messages)

```typescript
interface MessageData {
  from: string; // Sender's public key
  content: string; // Message content
  timestamp: number; // Unix timestamp
  id: string; // Unique message ID
  signature?: string; // Message signature
  roomId?: string; // Room ID (for future use)
  isPublic?: boolean; // Flag for public messages
}
```

### PublicMessage (Public Room Messages)

```typescript
interface PublicMessage {
  from: string; // Sender's public key
  content: string; // Message content
  timestamp: number; // Unix timestamp
  id: string; // Unique message ID
  roomId: string; // Room identifier
  username?: string; // Optional display name
}
```

### MessageResponse

```typescript
interface MessageResponse {
  success: boolean; // Operation success status
  messageId?: string; // Generated message ID
  error?: string; // Error message if failed
}
```

### MessagingStats

```typescript
interface MessagingStats {
  isListening: boolean; // Private listener status
  isListeningPublic: boolean; // Public listener status
  messageListenersCount: number; // Private listeners count
  publicMessageListenersCount: number; // Public listeners count
  processedMessagesCount: number; // Private messages processed
  processedPublicMessagesCount: number; // Public messages processed
  clearedConversationsCount: number; // Cleared conversations
  version: string; // Plugin version
  hasActiveListener: boolean; // Private listener active
  hasActivePublicListener: boolean; // Public listener active
}
```

## Complete Example

```typescript
import { MessagingPlugin } from "shogun-message-plugin";

// Initialize plugin
const messagingPlugin = new MessagingPlugin();
sdk.register(messagingPlugin);

// Set up private message handling
messagingPlugin.onMessage((message) => {
  console.log("🔒 Private message:", message.content);
});

// Set up public message handling
messagingPlugin.onPublicMessage((message) => {
  console.log(`📢 [${message.roomId}] ${message.username}: ${message.content}`);
});

// Start listening to public room
messagingPlugin.startListeningPublic("general");

// Send private message
await messagingPlugin.sendMessage("user_pub_key", "Secret message");

// Send public message
await messagingPlugin.sendPublicMessage("general", "Hello everyone!");

// Publish your encryption key
await messagingPlugin.publishUserEpub();

// Get statistics
const stats = messagingPlugin.getStats();
console.log("Plugin status:", stats);
```

## Encryption Key Management (epub)

The plugin implements 7 fallback strategies to find recipient encryption keys:

1. **Self-messaging**: Uses current user's epub for self-messages
2. **User Data**: Checks `recipientUser.get("is")`
3. **Public Space**: Checks `~recipientPub` path
4. **Pattern Derivation**: Derives epub from pub key pattern
5. **Profile Data**: Checks `recipientUser.get("profile")`
6. **Root Data**: Checks `recipientUser.get("~")`
7. **Direct Access**: Checks `core.db.gun.get(recipientPub)`

### Automatic epub Publishing

The plugin automatically publishes your encryption key to the network when:

- You log in
- The plugin initializes while you're logged in
- You manually call `publishUserEpub()`

## Public Room Architecture

Public rooms use a different architecture than private messages:

- **Path Structure**: `room_{roomId}` in GunDB
- **No Encryption**: Messages are unencrypted but signed
- **Signature Verification**: Optional signature verification for authenticity
- **Username Display**: Optional username field for better UX
- **Room-based Routing**: Messages are routed by room ID

## Duplicate Management

The plugin prevents duplicate messages through:

- **Message ID Tracking**: Unique IDs for each message
- **Timestamp-based Cleanup**: Automatic cleanup of old message IDs
- **Size Limiting**: Prevents memory leaks by limiting tracked messages

## Performance

- **Intelligent Fallbacks**: Multiple strategies for finding encryption keys
- **Efficient Cleanup**: Automatic cleanup of processed message IDs
- **Shared Utilities**: DRY code design reduces duplication
- **Optimized Listeners**: Single listener per message type

## Common Errors

| Error                                 | Cause                                    | Solution                                                   |
| ------------------------------------- | ---------------------------------------- | ---------------------------------------------------------- |
| "Recipient epub not found"            | Recipient's encryption key not available | Call `publishUserEpub()` or ensure recipient has logged in |
| "MetaMask doesn't work"               | Browser extension issues                 | Check MetaMask installation and permissions                |
| "Cannot get recipient encryption key" | Network or key issues                    | Try the fallback strategies or check connectivity          |

## Troubleshooting

### "Recipient epub not found" Error

This usually means the recipient hasn't logged in or their data isn't published to the network.

**Solutions:**

1. Call `publishUserEpub()` to ensure your key is available
2. Ask the recipient to log in at least once
3. Check network connectivity to GunDB peers
4. Try messaging yourself for testing

### MetaMask Issues

**Solutions:**

1. Ensure MetaMask is installed and unlocked
2. Check browser console for permission errors
3. Try refreshing the page
4. Check if the site is using HTTPS (required for MetaMask)

## Versions

| Version | Features                                                |
| ------- | ------------------------------------------------------- |
| 4.7.0   | Added public room messaging, DRY optimization           |
| 4.6.0   | Enhanced epub fallback strategies, automatic publishing |
| 4.5.0   | MetaMask support, conversation management               |
| 4.4.0   | Duplicate prevention, performance improvements          |
| 4.3.0   | Basic E2E messaging with GunDB                          |

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## Bug Reports

When reporting bugs, please include:

- Plugin version
- Browser and version
- Authentication method used
- Console error messages
- Steps to reproduce
- Debug logs for MetaMask issues

## License

MIT License - see LICENSE file for details.
