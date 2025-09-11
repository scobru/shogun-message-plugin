# Shogun Message Plugin

[![npm version](https://badge.fury.io/js/shogun-message-plugin.svg)](https://badge.fury.io/js/shogun-message-plugin)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

An advanced end-to-end encrypted messaging plugin for the Shogun ecosystem, inspired by Signal's security model with forward secrecy, message chaining, and group encryption capabilities.

## Features

🔐 **End-to-End Encryption** - All messages are encrypted using GunDB's SEA (Security, Encryption, Authorization)  
🔗 **Message Chaining** - Sequential message verification for enhanced security  
🔄 **Forward Secrecy** - Automatic key rotation and cleanup  
👥 **Group Messaging** - Encrypted group chats with shared keys  
📨 **Inbox System** - Reliable message delivery with date-based organization  
🌐 **Decentralized** - Built on GunDB for peer-to-peer communication  
⚡ **Real-time** - Instant message delivery and synchronization  
🛡️ **Secure** - Protection against replay attacks and message tampering  

## Installation

```bash
npm install shogun-message-plugin
# or
yarn add shogun-message-plugin
```

## Quick Start

```typescript
import { LindaLib } from 'shogun-message-plugin';
import { ShogunCore } from 'shogun-core';

// Initialize the core
const core = new ShogunCore({
  peers: ['https://peer.wallie.io/gun', 'https://relay.shogun-eco.xyz/gun'],
  scope: 'linda',
  radisk: true,
  localStorage: true
});

// Create messaging instance
const messaging = new LindaLib(['https://peer.wallie.io/gun'], core);

// Login and start messaging
await messaging.login('your-alias', 'your-password');
await messaging.publishUserKeys();

// Send a message
const result = await messaging.sendMessage('recipient-public-key', 'Hello World!');
console.log('Message sent:', result.success);
```

## Basic Usage

### Private Messaging

```typescript
// Send an encrypted message
const result = await messaging.sendMessage(
  'recipient-public-key',
  'Hello, this is encrypted!'
);

// Listen for messages
messaging.listenForMessages('sender-public-key', (message) => {
  console.log('Received:', message.content);
  console.log('From:', message.from);
  console.log('Timestamp:', new Date(message.timestamp));
});
```

### Group Messaging

```typescript
// Create a group
const groupId = await messaging.createGroup(
  'My Team',
  ['member1-pub', 'member2-pub', 'member3-pub']
);

// Send group message
await messaging.sendGroupMessage(groupId, 'Welcome to the team!');

// Listen for group messages
messaging.listenForGroupMessages(groupId, (message) => {
  console.log(`[${message.from}]: ${message.content}`);
});
```

### Inbox System

```typescript
// Start listening for inbox messages
messaging.startInboxListening((message) => {
  console.log('New message:', message.content);
});

// Send via inbox system
await messaging.sendMessageInbox(
  'recipient-pub',
  'recipient-epub',
  'Message content'
);

// Retrieve inbox messages
const inboxResult = await messaging.receiveMessageInbox({ limit: 50 });
if (inboxResult.success) {
  inboxResult.messages?.forEach(msg => {
    console.log('Inbox message:', msg);
  });
}
```

## Advanced Features

### Message Chaining

The plugin implements message chaining for enhanced security:

```typescript
// Get chain statistics
const stats = messaging.getChainStats('recipient-public-key');
console.log('Message count:', stats.messageCount);
console.log('Last index:', stats.lastIndex);
console.log('Chain ID:', stats.chainId);
```

### User Key Management

```typescript
// Check if user keys are published
const published = await messaging.areUserKeysPublished();

// Force publish keys (useful for debugging)
const result = await messaging.forcePublishUserKeys();

// Debug user keys
const debug = await messaging.debugUserKeys('user-public-key');
```

### Plugin Status

```typescript
// Get comprehensive plugin status
const status = messaging.getPluginStatus();
console.log('Initialized:', status.isInitialized);
console.log('User logged in:', status.userLoggedIn);
console.log('Public key:', status.publicKey);
console.log('Message chains:', status.messageChains);
console.log('Group keys:', status.groupKeys);
console.log('Inbox listening:', status.inboxListening);
```

## Configuration

### Core Configuration

```typescript
const core = new ShogunCore({
  peers: [
    'https://peer.wallie.io/gun',
    'https://relay.shogun-eco.xyz/gun'
  ],
  scope: 'linda',
  radisk: true,        // Enable persistent storage
  localStorage: true   // Enable browser storage
});
```

### Plugin Configuration

```typescript
const messaging = new LindaLib(
  ['https://peer.wallie.io/gun'], // Peers
  core                            // ShogunCore instance
);
```

## Error Handling

```typescript
try {
  const result = await messaging.sendMessage(recipientPub, content);
  if (!result.success) {
    console.error('Send failed:', result.error);
    // Handle specific errors
    switch (result.error) {
      case 'Utente non loggato.':
        await messaging.login(alias, password);
        break;
      case 'Core non inizializzato.':
        await messaging.initialize(core);
        break;
      default:
        console.error('Unknown error:', result.error);
    }
  }
} catch (error) {
  console.error('Unexpected error:', error);
}
```

## Browser Support

The plugin works in both Node.js and browser environments:

### Browser

```html
<script src="https://unpkg.com/gun/gun.js"></script>
<script src="https://unpkg.com/shogun-message-plugin/dist/browser/index.js"></script>
<script>
  const messaging = new ShogunMessage.LindaLib();
</script>
```

### Node.js

```typescript
import { LindaLib } from 'shogun-message-plugin';
import { ShogunCore } from 'shogun-core';
```

## API Reference

For complete API documentation, see [API.md](./API.md).

### Main Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `login(alias, password)` | Authenticate user | `Promise<void>` |
| `sendMessage(recipient, content)` | Send encrypted message | `Promise<MessageSendResult>` |
| `listenForMessages(sender, callback)` | Listen for messages | `void` |
| `createGroup(name, members)` | Create encrypted group | `Promise<string>` |
| `sendGroupMessage(groupId, content)` | Send group message | `Promise<void>` |
| `startInboxListening(callback)` | Start inbox listener | `void` |
| `publishUserKeys()` | Publish encryption keys | `Promise<void>` |

## Security Model

The plugin implements a comprehensive security model:

- **End-to-End Encryption**: All messages encrypted with recipient's public key
- **Forward Secrecy**: Keys rotated to prevent future message decryption
- **Message Integrity**: Digital signatures verify message authenticity
- **Replay Protection**: Message chaining prevents replay attacks
- **Anonymous Communication**: No central authority required

## Performance

- **Real-time**: Messages delivered instantly across the network
- **Efficient**: Minimal bandwidth usage through smart caching
- **Scalable**: Handles thousands of messages and groups
- **Reliable**: Automatic retry and error recovery

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details.

### Development Setup

```bash
git clone https://github.com/shogun-org/shogun-message-plugin.git
cd shogun-message-plugin
npm install
npm run dev
```

### Testing

```bash
npm test
npm run test:coverage
```

### Building

```bash
npm run build
```

## Examples

Check out the [examples](./examples/) directory for complete working examples:

- [Basic Messaging](./examples/basic-messaging.ts)
- [Group Chat](./examples/group-chat.ts)
- [Inbox System](./examples/inbox-system.ts)
- [React Integration](./examples/react-integration.tsx)

## Troubleshooting

### Common Issues

**"User not logged in"**
```typescript
await messaging.login('your-alias', 'your-password');
```

**"Core not initialized"**
```typescript
await messaging.initialize(core);
```

**"Keys not found"**
```typescript
await messaging.publishUserKeys();
```

**"Network connection failed"**
```typescript
// Check peer URLs and network connectivity
const core = new ShogunCore({
  peers: ['https://peer.wallie.io/gun'] // Try different peers
});
```

### Debug Mode

```typescript
// Enable debug logging
messaging.setInboxDebugMode(true);

// Check plugin status
const status = messaging.getPluginStatus();
console.log('Plugin status:', status);
```

## License

MIT License - see [LICENSE](./LICENSE) file for details.

## Support

- 📖 [Documentation](./API.md)
- 🐛 [Issue Tracker](https://github.com/shogun-org/shogun-message-plugin/issues)
- 💬 [Discord Community](https://discord.gg/shogun)
- 📧 [Email Support](mailto:support@shogun-eco.xyz)

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for version history and updates.

---

**Built with ❤️ by the Shogun Team**
