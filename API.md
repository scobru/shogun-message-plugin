# Shogun Message Plugin API Documentation

## Overview

The Shogun Message Plugin (`shogun-message-plugin`) is an advanced end-to-end encrypted messaging system built on top of GunDB and the Shogun Core SDK. It provides Signal-inspired messaging with forward secrecy, message chaining, and group encryption capabilities.

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Classes](#core-classes)
- [API Reference](#api-reference)
- [Message Types](#message-types)
- [Schema Reference](#schema-reference)
- [Error Handling](#error-handling)
- [Examples](#examples)

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
```

## Core Classes

### LindaLib

The main messaging class that extends `BasePlugin` and provides all messaging functionality.

**Constructor:**
```typescript
constructor(peers?: string[], core?: ShogunCore)
```

**Properties:**
- `name: string` - Plugin name ("LindaLib")
- `version: string` - Plugin version
- `description: string` - Plugin description
- `publicKey: string | null` - Current user's public key

## API Reference

### Initialization

#### `initialize(core: ShogunCore): Promise<void>`

Initializes the plugin with a ShogunCore instance.

```typescript
await messaging.initialize(core);
```

#### `isReady(): boolean`

Checks if the plugin is ready for messaging operations.

```typescript
if (messaging.isReady()) {
  // Ready to send/receive messages
}
```

### Authentication

#### `login(alias: string, pass: string): Promise<void>`

Authenticates the user with the Shogun Core.

```typescript
await messaging.login('my-alias', 'my-password');
```

#### `publishUserKeys(): Promise<void>`

Publishes the user's encryption keys to the network.

```typescript
await messaging.publishUserKeys();
```

#### `forcePublishUserKeys(): Promise<{ success: boolean; error?: string }>`

Force publishes user keys, useful for debugging.

```typescript
const result = await messaging.forcePublishUserKeys();
if (result.success) {
  console.log('Keys published successfully');
}
```

#### `areUserKeysPublished(): Promise<boolean>`

Checks if user keys are published on the network.

```typescript
const published = await messaging.areUserKeysPublished();
```

### User Key Management

#### `getUserKeys(userPub: string): Promise<any>`

Retrieves encryption keys for a specific user.

```typescript
const keys = await messaging.getUserKeys('user-public-key');
```

#### `waitForUserKeys(userPub: string, timeoutMs?: number): Promise<any>`

Waits for user keys to become available with timeout.

```typescript
const keys = await messaging.waitForUserKeys('user-public-key', 10000);
```

#### `debugUserKeys(userPub: string): Promise<object>`

Debug method to check user keys status.

```typescript
const debug = await messaging.debugUserKeys('user-public-key');
console.log(debug);
```

### Private Messaging

#### `sendMessage(recipientPub: string, content: string): Promise<MessageSendResult>`

Sends an encrypted message to another user.

```typescript
const result = await messaging.sendMessage(
  'recipient-public-key',
  'Hello, this is an encrypted message!'
);

if (result.success) {
  console.log('Message sent:', result.messageId);
} else {
  console.error('Failed to send:', result.error);
}
```

#### `listenForMessages(senderPub: string, callback: (message: any) => void): void`

Listens for messages from a specific sender.

```typescript
messaging.listenForMessages('sender-public-key', (message) => {
  console.log('Received message:', message.content);
  console.log('From:', message.from);
  console.log('Timestamp:', message.timestamp);
});
```

### Inbox System

#### `sendMessageInbox(recipientPub: string, recipientEpub: string, messageContent: string, options?: object): Promise<MessageSendResult>`

Sends a message using the inbox system.

```typescript
const result = await messaging.sendMessageInbox(
  'recipient-public-key',
  'recipient-epub-key',
  'Message content',
  {
    messageType: 'alias',
    senderAlias: 'My Alias',
    recipientAlias: 'Recipient Alias'
  }
);
```

#### `receiveMessageInbox(options?: object): Promise<{ success: boolean; messages?: any[]; error?: string }>`

Retrieves messages from the inbox.

```typescript
const result = await messaging.receiveMessageInbox({
  limit: 50,
  before: '2024-01-01',
  after: '2023-12-01'
});

if (result.success) {
  result.messages?.forEach(message => {
    console.log('Inbox message:', message);
  });
}
```

#### `startInboxListening(callback: (message: any) => void): void`

Starts listening for new inbox messages.

```typescript
messaging.startInboxListening((message) => {
  console.log('New inbox message:', message);
});
```

#### `stopInboxListening(): void`

Stops listening for inbox messages.

```typescript
messaging.stopInboxListening();
```

#### `isInboxListening(): boolean`

Checks if inbox listening is active.

```typescript
if (messaging.isInboxListening()) {
  console.log('Inbox listening is active');
}
```

### Group Messaging

#### `createGroup(groupName: string, memberPubs: string[]): Promise<string>`

Creates a new encrypted group.

```typescript
const groupId = await messaging.createGroup(
  'My Group',
  ['member1-public-key', 'member2-public-key']
);
console.log('Group created:', groupId);
```

#### `sendGroupMessage(groupId: string, content: string): Promise<void>`

Sends a message to a group.

```typescript
await messaging.sendGroupMessage(groupId, 'Hello group!');
```

#### `listenForGroupMessages(groupId: string, callback: (message: any) => void): void`

Listens for messages in a group.

```typescript
messaging.listenForGroupMessages(groupId, (message) => {
  console.log('Group message:', message.content);
  console.log('From:', message.from);
});
```

#### `getGroupData(groupId: string): Promise<any>`

Retrieves group information.

```typescript
const groupData = await messaging.getGroupData(groupId);
console.log('Group name:', groupData.name);
console.log('Creator:', groupData.creator);
```

#### `getGroupMembers(groupId: string): Promise<string[]>`

Gets all members of a group.

```typescript
const members = await messaging.getGroupMembers(groupId);
console.log('Group members:', members);
```

#### `isGroupMember(groupId: string, userPub: string): Promise<boolean>`

Checks if a user is a member of a group.

```typescript
const isMember = await messaging.isGroupMember(groupId, 'user-public-key');
```

#### `addGroupMember(groupId: string, memberPub: string): Promise<void>`

Adds a new member to a group (creator only).

```typescript
await messaging.addGroupMember(groupId, 'new-member-public-key');
```

### Message Chain Management

#### `getChainStats(recipientPub: string): object`

Gets statistics for a message chain with a recipient.

```typescript
const stats = messaging.getChainStats('recipient-public-key');
console.log('Message count:', stats.messageCount);
console.log('Last index:', stats.lastIndex);
console.log('Chain ID:', stats.chainId);
```

### Plugin Management

#### `getPluginStatus(): object`

Gets the current status of the plugin.

```typescript
const status = messaging.getPluginStatus();
console.log('Initialized:', status.isInitialized);
console.log('User logged in:', status.userLoggedIn);
console.log('Public key:', status.publicKey);
console.log('Message chains:', status.messageChains);
console.log('Group keys:', status.groupKeys);
console.log('Inbox listening:', status.inboxListening);
```

#### `resetState(): void`

Resets the plugin state, clearing all caches and stopping listeners.

```typescript
messaging.resetState();
```

#### `destroy(): void`

Destroys the plugin and cleans up all resources.

```typescript
messaging.destroy();
```

#### `cleanup(): void`

Alias for destroy method.

```typescript
messaging.cleanup();
```

### Debug and Utilities

#### `setInboxDebugMode(enabled: boolean): void`

Enables or disables debug mode for inbox operations.

```typescript
messaging.setInboxDebugMode(true);
```

#### `getInboxListenersCount(): number`

Gets the number of active inbox listeners.

```typescript
const count = messaging.getInboxListenersCount();
console.log('Active listeners:', count);
```

## Message Types

### MessageSendResult

```typescript
interface MessageSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
```

### DecryptedMessage

```typescript
interface DecryptedMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
  id: string;
}
```

### GroupData

```typescript
interface GroupData {
  id: string;
  name: string;
  members: string[];
  createdBy: string;
  createdAt: number;
  admins?: string[];
  lastActivity?: number;
  encryptedKeys: { [memberPub: string]: string };
  keysSignature?: string;
}
```

## Schema Reference

The plugin uses a centralized schema system for consistent path management:

### MessagingSchema

```typescript
import { MessagingSchema } from 'shogun-message-plugin';

// Private message paths
const recipientPath = MessagingSchema.privateMessages.recipient('user-pub-key');
const conversationPath = MessagingSchema.privateMessages.conversation('user1', 'user2');

// Group paths
const groupDataPath = MessagingSchema.groups.data('group-id');
const groupMessagesPath = MessagingSchema.groups.messages('group-id');

// User paths
const userProfilePath = MessagingSchema.users.profile('user-pub-key');
const userEpubPath = MessagingSchema.users.epub('user-pub-key');

// Utilities
const messageId = MessagingSchema.utils.generateMessageId();
const groupId = MessagingSchema.utils.generateGroupId();
const formattedDate = MessagingSchema.utils.formatDate(new Date());
```

## Error Handling

The plugin provides comprehensive error handling with detailed error messages:

```typescript
try {
  const result = await messaging.sendMessage(recipientPub, content);
  if (!result.success) {
    console.error('Send failed:', result.error);
  }
} catch (error) {
  console.error('Unexpected error:', error);
}
```

Common error scenarios:
- User not logged in
- Core not initialized
- Recipient keys not found
- Network connectivity issues
- Encryption/decryption failures

## Examples

### Complete Messaging Setup

```typescript
import { LindaLib } from 'shogun-message-plugin';
import { ShogunCore } from 'shogun-core';

async function setupMessaging() {
  // Initialize core
  const core = new ShogunCore({
    peers: ['https://peer.wallie.io/gun'],
    scope: 'linda',
    radisk: true,
    localStorage: true
  });

  // Create messaging instance
  const messaging = new LindaLib([], core);
  
  // Login
  await messaging.login('my-alias', 'my-password');
  
  // Publish keys
  await messaging.publishUserKeys();
  
  // Start listening for messages
  messaging.listenForMessages('friend-public-key', (message) => {
    console.log('Received:', message.content);
  });
  
  // Send a message
  const result = await messaging.sendMessage(
    'friend-public-key',
    'Hello from the encrypted world!'
  );
  
  if (result.success) {
    console.log('Message sent successfully');
  }
}
```

### Group Chat Example

```typescript
async function createGroupChat() {
  // Create group
  const groupId = await messaging.createGroup(
    'Project Team',
    ['member1-pub', 'member2-pub', 'member3-pub']
  );
  
  // Listen for group messages
  messaging.listenForGroupMessages(groupId, (message) => {
    console.log(`[${message.from}]: ${message.content}`);
  });
  
  // Send group message
  await messaging.sendGroupMessage(groupId, 'Welcome to the project team!');
  
  // Add new member
  await messaging.addGroupMember(groupId, 'new-member-pub');
}
```

### Inbox System Example

```typescript
async function useInboxSystem() {
  // Start listening for inbox messages
  messaging.startInboxListening((message) => {
    console.log('New inbox message:', message.content);
  });
  
  // Send message via inbox
  const result = await messaging.sendMessageInbox(
    'recipient-pub',
    'recipient-epub',
    'Message via inbox system'
  );
  
  // Retrieve inbox messages
  const inboxResult = await messaging.receiveMessageInbox({ limit: 20 });
  if (inboxResult.success) {
    inboxResult.messages?.forEach(msg => {
      console.log('Inbox message:', msg);
    });
  }
}
```

## Advanced Features

### Message Chaining

The plugin implements message chaining for enhanced security:

- Each conversation maintains a chain of messages
- Messages are indexed sequentially
- Chain verification ensures message integrity
- Forward secrecy through key rotation

### Forward Secrecy

- Group keys are rotated periodically
- Individual message keys for sensitive conversations
- Automatic key cleanup for deleted messages

### Encryption

- End-to-end encryption using GunDB's SEA (Security, Encryption, Authorization)
- Shared secret derivation using ECDH
- Message authentication through digital signatures
- Group encryption with shared group keys

## Performance Considerations

- Message processing is optimized for real-time communication
- Automatic cleanup of processed messages to prevent memory leaks
- Efficient key caching and retrieval
- Minimal network overhead through smart path management

## Security Features

- End-to-end encryption for all messages
- Forward secrecy implementation
- Message integrity verification
- Secure key exchange and management
- Protection against replay attacks
- Anonymous communication capabilities

## Browser Compatibility

The plugin is built with browser compatibility in mind:

- Webpack configuration for browser builds
- Polyfills for Node.js modules
- UMD build for universal compatibility
- TypeScript definitions for better development experience

## Contributing

When contributing to the plugin:

1. Follow the existing code style
2. Add comprehensive tests for new features
3. Update documentation for API changes
4. Ensure backward compatibility
5. Follow security best practices

## License

MIT License - see LICENSE file for details.
