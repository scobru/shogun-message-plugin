# Shogun Message Plugin API Documentation

## Overview

The Shogun Message Plugin provides end-to-end encrypted messaging capabilities for the Shogun SDK. This document describes the complete API surface and usage patterns.

**🚀 PRODUCTION READY**: This plugin is now production-ready with enhanced error handling, performance monitoring, and robust retry mechanisms.

**📝 DOCUMENTATION UPDATED**: This README has been verified against the actual source code implementation to ensure accuracy.

## Installation

```bash
npm install shogun-message-plugin
```

## Quick Start

```typescript
import { MessagingPlugin } from "shogun-message-plugin";
import { ShogunCore } from "shogun-core";

// Initialize the plugin
const messagingPlugin = new MessagingPlugin();
await messagingPlugin.initialize(shogunCore);

// Check health status
const health = await messagingPlugin.getHealthStatus();
if (!health.isHealthy) {
  console.warn("Plugin health issues:", health.issues);
}

// Send a private message
const result = await messagingPlugin.sendMessage(
  recipientPublicKey,
  "Hello, this is an encrypted message!"
);
```

## Core API Reference

### MessagingPlugin Class

The main plugin class that orchestrates all messaging functionality.

#### Constructor

```typescript
new MessagingPlugin();
```

#### Methods

##### `initialize(core: ShogunCore): Promise<void>`

Initializes the plugin with the Shogun core instance.

**Parameters:**

- `core` (ShogunCore): The Shogun core instance

**Returns:** Promise<void>

**Example:**

```typescript
await messagingPlugin.initialize(shogunCore);
```

##### `sendMessage(recipientPub: string, messageContent: string): Promise<MessageSendResult>`

Sends a private end-to-end encrypted message to a recipient.

**Parameters:**

- `recipientPub` (string): The recipient's public key
- `messageContent` (string): The message content to send (max 10,000 characters)

**Returns:** Promise<MessageSendResult>

**Example:**

```typescript
const result = await messagingPlugin.sendMessage(
  "recipient_public_key_here",
  "Hello from Alice!"
);

if (result.success) {
  console.log("Message sent successfully:", result.messageId);
} else {
  console.error("Failed to send message:", result.error);
}
```

##### **NEW: Legacy Compatibility Functions**

###### `sendMessageToLegacyPath(recipientPub: string, messageContent: string, options?: LegacyMessageOptions): Promise<LegacyMessageResult>`

Sends a message to legacy paths for compatibility with existing frontend systems.

**Parameters:**

- `recipientPub` (string): The recipient's public key
- `messageContent` (string): The message content to send
- `options` (LegacyMessageOptions, optional): Additional options for legacy compatibility

**Returns:** Promise<LegacyMessageResult>

**Example:**

```typescript
const result = await messagingPlugin.sendMessageToLegacyPath(
  "recipient_public_key_here",
  "Hello from legacy path!",
  {
    messageType: "alias",
    senderAlias: "Alice",
    recipientAlias: "Bob"
  }
);

if (result.success) {
  console.log("Message sent to legacy path:", result.messageId);
} else {
  console.error("Failed to send to legacy path:", result.error);
}
```

###### `receiveMessageFromLegacyPath(contactPub: string, options?: { limit?: number; before?: string; after?: string }): Promise<LegacyMessagesResult>`

Receives messages from legacy paths for compatibility with existing frontend systems.

**Parameters:**

- `contactPub` (string): The contact's public key
- `options` (object, optional): Options for message retrieval

**Returns:** Promise<LegacyMessagesResult>

**Example:**

```typescript
const result = await messagingPlugin.receiveMessageFromLegacyPath(
  "contact_public_key_here",
  { limit: 50 }
);

if (result.success) {
  console.log("Messages received from legacy path:", result.messages?.length);
} else {
  console.error("Failed to receive from legacy path:", result.error);
}
```

###### `startListeningToLegacyPaths(contactPub: string, callback: (message: any) => void): void`

Starts listening to legacy paths for real-time message compatibility.

**Parameters:**

- `contactPub` (string): The contact's public key
- `callback` (function): Function to call when a new message is received

**Example:**

```typescript
messagingPlugin.startListeningToLegacyPaths(
  "contact_public_key_here",
  (message) => {
    console.log("New message from legacy path:", message);
  }
);
```

###### `stopListeningToLegacyPaths(): void`

Stops listening to legacy paths.

**Example:**

```typescript
messagingPlugin.stopListeningToLegacyPaths();
```

##### `sendGroupMessage(groupId: string, messageContent: string): Promise<MessageSendResult>`

Sends a message to a group chat using Multiple People Encryption (MPE).

**Parameters:**

- `groupId` (string): The group identifier
- `messageContent` (string): The message content to send

**Returns:** Promise<MessageSendResult>

**Example:**

```typescript
const result = await messagingPlugin.sendGroupMessage(
  "group_123",
  "Hello everyone in the group!"
);
```

##### `sendTokenRoomMessage(roomId: string, messageContent: string, token: string): Promise<MessageSendResult>`

Sends an encrypted message to a token-based room.

**Parameters:**

- `roomId` (string): The token room identifier
- `messageContent` (string): The message content to send
- `token` (string): The token required for room access

**Returns:** Promise<MessageSendResult>

**Example:**

```typescript
const result = await messagingPlugin.sendTokenRoomMessage(
  "private_room_456",
  "Secret message for token holders!",
  "room_access_token"
);
```

##### `sendPublicMessage(roomId: string, messageContent: string): Promise<MessageSendResult>`

Sends a signed message to a public room.

**Parameters:**

- `roomId` (string): The public room identifier
- `messageContent` (string): The message content to send

**Returns:** Promise<MessageSendResult>

**Example:**

```typescript
const result = await messagingPlugin.sendPublicMessage(
  "general_chat",
  "Hello public room!"
);
```

### Production Features

#### Health Monitoring

##### `getHealthStatus(): Promise<HealthStatus>`

Get comprehensive health status of the plugin and all components.

**Returns:** Promise<HealthStatus>

**Example:**

```typescript
const health = await messagingPlugin.getHealthStatus();

if (health.isHealthy) {
  console.log("Plugin is healthy");
} else {
  console.warn("Health issues:", health.issues);
  console.log("Component status:", health.components);
  console.log("Performance metrics:", health.performance);
}
```

#### Performance Monitoring

##### `getStats(): PluginStats`

Get detailed performance statistics and metrics.

**Returns:** PluginStats

**Example:**

```typescript
const stats = messagingPlugin.getStats();

console.log("Performance metrics:", {
  messagesSent: stats.performanceMetrics.messagesSent,
  averageResponseTime: stats.performanceMetrics.averageResponseTime,
  encryptionOperations: stats.performanceMetrics.encryptionOperations,
});
```

#### Enhanced Error Handling

All methods now include:

- **Input validation** with detailed error messages
- **Automatic retry** with exponential backoff
- **Operation tracking** for metrics
- **Safe operation wrappers** with error boundaries

### Group Management

#### `createGroup(groupName: string, memberPubs: string[]): Promise<{ success: boolean; groupData?: any; error?: string }>`

Creates a new group chat with the specified members.

**Parameters:**

- `groupName` (string): Name for the group
- `memberPubs` (string[]): Array of member public keys

**Returns:** Promise<{ success: boolean; groupData?: any; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.createGroup("My Team Chat", [
  "member1_pub",
  "member2_pub",
  "member3_pub",
]);

if (result.success) {
  console.log("Group created:", result.groupData.id);
} else {
  console.error("Failed to create group:", result.error);
}
```

#### `addGroupListener(groupId: string): void`

Adds a listener for group messages.

**Parameters:**

- `groupId` (string): The group identifier

**Example:**

```typescript
messagingPlugin.addGroupListener("group_123");
```

#### `removeGroupListener(groupId: string): void`

Removes a group message listener.

**Parameters:**

- `groupId` (string): The group identifier

**Example:**

```typescript
messagingPlugin.removeGroupListener("group_123");
```

#### `hasGroupListener(groupId: string): boolean`

Checks if a group has an active listener.

**Parameters:**

- `groupId` (string): The group identifier

**Returns:** boolean

**Example:**

```typescript
const hasListener = messagingPlugin.hasGroupListener("group_123");
console.log("Group has listener:", hasListener);
```

### Room Management

#### `createPublicRoom(roomName: string, description?: string): Promise<{ success: boolean; roomData?: any; error?: string }>`

Creates a new public room.

**Parameters:**

- `roomName` (string): Name for the public room
- `description` (string, optional): Description for the room

**Returns:** Promise<{ success: boolean; roomData?: any; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.createPublicRoom(
  "General Discussion",
  "Main discussion room"
);

if (result.success) {
  console.log("Public room created:", result.roomData.id);
}
```

#### `createTokenRoom(roomName: string, description?: string, maxParticipants?: number): Promise<{ success: boolean; roomData?: any; error?: string }>`

Creates a new token-based encrypted room.

**Parameters:**

- `roomName` (string): Name for the token room
- `description` (string, optional): Description for the room
- `maxParticipants` (number, optional): Maximum number of participants

**Returns:** Promise<{ success: boolean; roomData?: any; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.createTokenRoom(
  "Private Discussion",
  "Secret discussion room",
  10
);

if (result.success) {
  console.log("Token room created:", result.roomData.id);
}
```

#### `startRoomDiscovery(): void`

Starts the room discovery process.

**Example:**

```typescript
messagingPlugin.startRoomDiscovery();
```

#### `stopRoomDiscovery(): void`

Stops the room discovery process.

**Example:**

```typescript
messagingPlugin.stopRoomDiscovery();
```

#### `initializeDefaultRooms(): Promise<void>`

Initializes default public rooms if none exist.

**Returns:** Promise<void>

**Example:**

```typescript
await messagingPlugin.initializeDefaultRooms();
```

### Message Listening

#### `startListening(): Promise<void>`

**PRODUCTION READY**: Starts listening for incoming messages with enhanced performance and error handling.

**Returns:** Promise<void>

**Features:**

- Automatic retry with exponential backoff
- Performance monitoring
- Error tracking and recovery
- Memory management

**Example:**

```typescript
await messagingPlugin.startListening();
```

#### `stopListening(): Promise<void>`

**PRODUCTION READY**: Stops listening for incoming messages with proper cleanup.

**Returns:** Promise<void>

**Features:**

- Proper resource cleanup
- Memory leak prevention
- Performance metrics finalization

**Example:**

```typescript
await messagingPlugin.stopListening();
```

#### `onMessage(callback: (message: DecryptedMessage) => void): void`

**PRODUCTION READY**: Registers a callback for incoming messages with enhanced filtering.

**Parameters:**

- `callback` (function): Function to call when a message is received

**Features:**

- Message deduplication
- Performance filtering
- Error boundary protection
- Memory optimization

**Example:**

```typescript
messagingPlugin.onMessage((message) => {
  console.log("Received message:", message.content);
  console.log("From:", message.sender);
  console.log("Timestamp:", message.timestamp);
});
```

#### `joinChat(chatType: string, chatId: string, token?: string): Promise<JoinChatResult>`

**PRODUCTION READY**: Join different types of chats with enhanced validation.

**Parameters:**

- `chatType` (string): Type of chat ("private", "public", "group", "token")
- `chatId` (string): Chat identifier
- `token` (string, optional): Token for token rooms

**Features:**

- Enhanced input validation
- Performance optimization
- Error handling with retry
- Automatic listener activation

**Example:**

```typescript
// Join a group chat
const result = await messagingPlugin.joinChat("group", "group_123");
if (result.success) {
  console.log("Joined group:", result.chatData);
}

// Join a token room
const tokenResult = await messagingPlugin.joinChat(
  "token",
  "room_456",
  "token_xyz"
);
if (tokenResult.success) {
  console.log("Joined token room:", result.chatData);
}
```

### Protocol Listeners

#### `startProtocolListeners(): void`

Starts all protocol-level listeners.

**Example:**

```typescript
messagingPlugin.startProtocolListeners();
```

#### `stopProtocolListeners(): void`

Stops all protocol-level listeners.

**Example:**

```typescript
messagingPlugin.stopProtocolListeners();
```

#### `areProtocolListenersActive(): boolean`

Checks if protocol listeners are active.

**Returns:** boolean

**Example:**

```typescript
const areActive = messagingPlugin.areProtocolListenersActive();
console.log("Protocol listeners active:", areActive);
```

#### `areGroupListenersActive(): boolean`

Checks if group listeners are active.

**Returns:** boolean

**Example:**

```typescript
const areActive = messagingPlugin.areGroupListenersActive();
console.log("Group listeners active:", areActive);
```

#### `areTokenRoomListenersActive(): boolean`

Checks if token room listeners are active.

**Returns:** boolean

**Example:**

```typescript
const areActive = messagingPlugin.areTokenRoomListenersActive();
console.log("Token room listeners active:", areActive);
```

### Raw Message Handling

#### `onRawMessage(callback: any): void`

Registers a callback for raw messages.

**Parameters:**

- `callback` (function): Function to call when a raw message is received

**Example:**

```typescript
messagingPlugin.onRawMessage((message) => {
  console.log("Raw message received:", message);
});
```

#### `onRawPublicMessage(callback: any): void`

Registers a callback for raw public messages.

**Parameters:**

- `callback` (function): Function to call when a raw public message is received

**Example:**

```typescript
messagingPlugin.onRawPublicMessage((message) => {
  console.log("Raw public message received:", message);
});
```

#### `onRawTokenRoomMessage(callback: any): void`

Registers a callback for raw token room messages.

**Parameters:**

- `callback` (function): Function to call when a raw token room message is received

**Example:**

```typescript
messagingPlugin.onRawTokenRoomMessage((message) => {
  console.log("Raw token room message received:", message);
});
```

#### `onRawGroupMessage(callback: any): void`

Registers a callback for raw group messages.

**Parameters:**

- `callback` (function): Function to call when a raw group message is received

**Example:**

```typescript
messagingPlugin.onRawGroupMessage((message) => {
  console.log("Raw group message received:", message);
});
```

### Public Room Management

#### `startListeningPublic(roomId: string): void`

Starts listening to a specific public room.

**Parameters:**

- `roomId` (string): The public room identifier

**Example:**

```typescript
messagingPlugin.startListeningPublic("general_chat");
```

#### `stopListeningPublic(): void`

Stops listening to public rooms.

**Example:**

```typescript
messagingPlugin.stopListeningPublic();
```

#### `stopListeningToPublicRoom(roomId: string): void`

Stops listening to a specific public room.

**Parameters:**

- `roomId` (string): The public room identifier

**Example:**

```typescript
messagingPlugin.stopListeningToPublicRoom("general_chat");
```

#### `hasActivePublicRoomListener(roomId: string): boolean`

Checks if a specific public room has an active listener.

**Parameters:**

- `roomId` (string): The public room identifier

**Returns:** boolean

**Example:**

```typescript
const hasListener = messagingPlugin.hasActivePublicRoomListener("general_chat");
console.log("Public room has listener:", hasListener);
```

#### `getPublicRoomMessages(roomId: string, limit?: number): Promise<any[]>`

Gets public room messages from localStorage.

**Parameters:**

- `roomId` (string): The public room identifier
- `limit` (number, optional): Maximum number of messages to retrieve

**Returns:** Promise<any[]>

**Example:**

```typescript
const messages = await messagingPlugin.getPublicRoomMessages("general_chat", 50);
console.log("Public room messages:", messages);
```

#### `removePublicMessageListener(callback: any): void`

Removes a specific public message listener callback.

**Parameters:**

- `callback` (function): The callback to remove

**Example:**

```typescript
messagingPlugin.removePublicMessageListener(myCallbackFunction);
```

### Token Room Management

#### `startListeningTokenRooms(): void`

Starts listening to token rooms.

**Example:**

```typescript
messagingPlugin.startListeningTokenRooms();
```

#### `stopListeningTokenRooms(): void`

Stops listening to token rooms.

**Example:**

```typescript
messagingPlugin.stopListeningTokenRooms();
```

#### `startTokenRoomMessageListener(roomId: string): Promise<void>`

Starts listening to messages from a specific token room.

**Parameters:**

- `roomId` (string): The token room identifier

**Returns:** Promise<void>

**Example:**

```typescript
await messagingPlugin.startTokenRoomMessageListener("private_room_456");
```

#### `stopTokenRoomMessageListener(roomId: string): Promise<void>`

Stops listening to messages from a specific token room.

**Parameters:**

- `roomId` (string): The token room identifier

**Returns:** Promise<void>

**Example:**

```typescript
await messagingPlugin.stopTokenRoomMessageListener("private_room_456");
```

#### `getTokenRoomMessages(roomId: string): Promise<any[]>`

Gets messages from a specific token room.

**Parameters:**

- `roomId` (string): The token room identifier

**Returns:** Promise<any[]>

**Example:**

```typescript
const messages = await messagingPlugin.getTokenRoomMessages("private_room_456");
console.log("Token room messages:", messages);
```

#### `deleteTokenRoom(roomId: string): Promise<{ success: boolean; error?: string }>`

Deletes a token room.

**Parameters:**

- `roomId` (string): The token room identifier

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.deleteTokenRoom("private_room_456");
if (result.success) {
  console.log("Token room deleted successfully");
} else {
  console.error("Failed to delete token room:", result.error);
}
```

### Conversation Management

#### `clearConversation(contactPub: string): Promise<{ success: boolean; error?: string }>`

Clears all messages from a conversation.

**Parameters:**

- `contactPub` (string): The contact's public key

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.clearConversation("contact_public_key");
if (result.success) {
  console.log("Conversation cleared successfully");
} else {
  console.error("Failed to clear conversation:", result.error);
}
```

#### `setMessagesToNull(contactPub: string): Promise<{ success: boolean; error?: string }>`

Sets all messages in a conversation to null.

**Parameters:**

- `contactPub` (string): The contact's public key

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.setMessagesToNull("contact_public_key");
if (result.success) {
  console.log("Messages set to null successfully");
} else {
  console.error("Failed to set messages to null:", result.error);
}
```

#### `clearSingleMessage(contactPub: string, messageId: string): Promise<{ success: boolean; error?: string }>`

Clears a single message from a conversation.

**Parameters:**

- `contactPub` (string): The contact's public key
- `messageId` (string): The message identifier

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.clearSingleMessage("contact_public_key", "message_123");
if (result.success) {
  console.log("Message cleared successfully");
} else {
  console.error("Failed to clear message:", result.error);
}
```

#### `verifyConversationCleared(contactPub: string): Promise<{ success: boolean; error?: string }>`

Verifies that a conversation has been cleared.

**Parameters:**

- `contactPub` (string): The contact's public key

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.verifyConversationCleared("contact_public_key");
if (result.success) {
  console.log("Conversation cleared verification successful");
} else {
  console.error("Conversation cleared verification failed:", result.error);
}
```

#### `markConversationAsCleared(from: string, to: string): void`

Marks a conversation as cleared.

**Parameters:**

- `from` (string): The sender's public key
- `to` (string): The recipient's public key

**Example:**

```typescript
messagingPlugin.markConversationAsCleared("sender_pub", "recipient_pub");
```

#### `isConversationCleared(from: string, to: string): boolean`

Checks if a conversation is marked as cleared.

**Parameters:**

- `from` (string): The sender's public key
- `to` (string): The recipient's public key

**Returns:** boolean

**Example:**

```typescript
const isCleared = messagingPlugin.isConversationCleared("sender_pub", "recipient_pub");
console.log("Conversation is cleared:", isCleared);
```

#### `removeClearedConversation(from: string, to: string): void`

Removes the cleared status from a conversation.

**Parameters:**

- `from` (string): The sender's public key
- `to` (string): The recipient's public key

**Example:**

```typescript
messagingPlugin.removeClearedConversation("sender_pub", "recipient_pub");
```

#### `resetClearedConversations(): void`

Resets all cleared conversation statuses.

**Example:**

```typescript
messagingPlugin.resetClearedConversations();
```

#### `resetClearedConversation(contactPub: string): void`

Resets the cleared status for a specific contact.

**Parameters:**

- `contactPub` (string): The contact's public key

**Example:**

```typescript
messagingPlugin.resetClearedConversation("contact_public_key");
```

#### `reloadMessages(contactPub: string): Promise<any[]>`

Reloads messages for a specific contact.

**Parameters:**

- `contactPub` (string): The contact's public key

**Returns:** Promise<any[]>

**Example:**

```typescript
const messages = await messagingPlugin.reloadMessages("contact_public_key");
console.log("Reloaded messages:", messages);
```

#### `loadExistingMessages(contactPub: string): Promise<any[]>`

Loads existing messages for a specific contact.

**Parameters:**

- `contactPub` (string): The contact's public key

**Returns:** Promise<any[]>

**Example:**

```typescript
const messages = await messagingPlugin.loadExistingMessages("contact_public_key");
console.log("Existing messages:", messages);
```

### Message Content Management

#### `setMessageContent(contactPub: string, messageId: string, newContent: string): Promise<{ success: boolean; error?: string }>`

Updates the content of a specific message.

**Parameters:**

- `contactPub` (string): The contact's public key
- `messageId` (string): The message identifier
- `newContent` (string): The new message content

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.setMessageContent(
  "contact_public_key",
  "message_123",
  "Updated message content"
);
if (result.success) {
  console.log("Message content updated successfully");
} else {
  console.error("Failed to update message content:", result.error);
}
```

#### `removeMessage(contactPub: string, messageId: string): Promise<{ success: boolean; error?: string }>`

Removes a specific message.

**Parameters:**

- `contactPub` (string): The contact's public key
- `messageId` (string): The message identifier

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.removeMessage("contact_public_key", "message_123");
if (result.success) {
  console.log("Message removed successfully");
} else {
  console.error("Failed to remove message:", result.error);
}
```

#### `removeConversationMessages(contactPub: string, messageIds: string[]): Promise<{ success: boolean; error?: string }>`

Removes multiple messages from a conversation.

**Parameters:**

- `contactPub` (string): The contact's public key
- `messageIds` (string[]): Array of message identifiers to remove

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.removeConversationMessages(
  "contact_public_key",
  ["message_123", "message_456"]
);
if (result.success) {
  console.log("Messages removed successfully");
} else {
  console.error("Failed to remove messages:", result.error);
}
```

### Utility Methods

#### `getPublicRooms(): Promise<PublicRoom[]>`

Retrieves available public rooms.

**Returns:** Promise<PublicRoom[]>

**Example:**

```typescript
const rooms = await messagingPlugin.getPublicRooms();
console.log("Public rooms:", rooms);
```

#### `getGroupData(groupId: string): Promise<any | null>`

Retrieves data for a specific group.

**Parameters:**

- `groupId` (string): The group identifier

**Returns:** Promise<any | null>

**Example:**

```typescript
const groupData = await messagingPlugin.getGroupData("group_123");
console.log("Group data:", groupData);
```

#### `getTokenRoomData(roomId: string): Promise<any | null>`

Retrieves data for a specific token room.

**Parameters:**

- `roomId` (string): The token room identifier

**Returns:** Promise<any | null>

**Example:**

```typescript
const roomData = await messagingPlugin.getTokenRoomData("room_456");
console.log("Token room data:", roomData);
```

#### `getRecipientEpub(recipientPub: string): Promise<string>`

Gets the encryption public key for a recipient.

**Parameters:**

- `recipientPub` (string): The recipient's public key

**Returns:** Promise<string>

**Example:**

```typescript
const epub = await messagingPlugin.getRecipientEpub("recipient_public_key");
console.log("Recipient epub:", epub);
```

#### `publishUserEpub(): Promise<{ success: boolean; error?: string }>`

Publishes the current user's encryption public key.

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.publishUserEpub();
if (result.success) {
  console.log("User epub published successfully");
} else {
  console.error("Failed to publish user epub:", result.error);
}
```

#### `checkUserEpubAvailability(userPub: string): Promise<{ available: boolean; epub?: string; error?: string }>`

Checks if a user's encryption public key is available.

**Parameters:**

- `userPub` (string): The user's public key

**Returns:** Promise<{ available: boolean; epub?: string; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.checkUserEpubAvailability("user_public_key");
if (result.available) {
  console.log("User epub available:", result.epub);
} else {
  console.log("User epub not available");
}
```

#### `getCurrentUserEpub(): string | null`

Gets the current user's encryption public key.

**Returns:** string | null

**Example:**

```typescript
const epub = messagingPlugin.getCurrentUserEpub();
if (epub) {
  console.log("Current user epub:", epub);
} else {
  console.log("No epub available for current user");
}
```

#### `joinTokenRoom(roomId: string, token: string): Promise<{ success: boolean; error?: string }>`

Joins a token room with the provided token.

**Parameters:**

- `roomId` (string): The token room identifier
- `token` (string): The token required for room access

**Returns:** Promise<{ success: boolean; error?: string }>

**Example:**

```typescript
const result = await messagingPlugin.joinTokenRoom("room_456", "access_token");
if (result.success) {
  console.log("Joined token room successfully");
} else {
  console.error("Failed to join token room:", result.error);
}
```

### Debug and Development

#### `debugGunDBStructure(recipientPub: string): Promise<any>`

Debug utility to inspect GunDB structure for a recipient.

**Parameters:**

- `recipientPub` (string): The recipient's public key

**Returns:** Promise<any>

**Example:**

```typescript
const structure = await messagingPlugin.debugGunDBStructure("recipient_public_key");
console.log("GunDB structure:", structure);
```

#### `debugMessagePaths(contactPub: string): Promise<void>`

Debug utility to inspect message paths for a contact.

**Parameters:**

- `contactPub` (string): The contact's public key

**Returns:** Promise<void>

**Example:**

```typescript
await messagingPlugin.debugMessagePaths("contact_public_key");
```

#### `registerConversationPathListener(conversationPath: string): void`

Registers a listener for a specific conversation path.

**Parameters:**

- `conversationPath` (string): The conversation path to listen to

**Example:**

```typescript
messagingPlugin.registerConversationPathListener("conversation_path_here");
```

### Listener Status and Management

#### `getListenerStatus(): { isListening: boolean; messageListenersCount: number; processedMessagesCount: number; hasActiveListener: boolean }`

Gets the current status of all listeners.

**Returns:** Object with listener status information

**Example:**

```typescript
const status = messagingPlugin.getListenerStatus();
console.log("Listener status:", {
  isListening: status.isListening,
  messageListenersCount: status.messageListenersCount,
  processedMessagesCount: status.processedMessagesCount,
  hasActiveListener: status.hasActiveListener
});
```

### Cleanup and Resource Management

#### `cleanup(): void`

Performs cleanup operations and resource management.

**Example:**

```typescript
messagingPlugin.cleanup();
```

### Testing and Development

#### `groupManagerForTesting: GroupManager`

Getter for accessing the group manager for testing purposes.

**Example:**

```typescript
const groupManager = messagingPlugin.groupManagerForTesting;
```

#### `encryptionManagerForTesting: EncryptionManager`

Getter for accessing the encryption manager for testing purposes.

**Example:**

```typescript
const encryptionManager = messagingPlugin.encryptionManagerForTesting;
```

#### `tokenRoomManagerForTesting: TokenRoomManager`

Getter for accessing the token room manager for testing purposes.

**Example:**

```typescript
const tokenRoomManager = messagingPlugin.tokenRoomManagerForTesting;
```

#### `publicRoomManagerForTesting: PublicRoomManager`

Getter for accessing the public room manager for testing purposes.

**Example:**

```typescript
const publicRoomManager = messagingPlugin.publicRoomManagerForTesting;
```

## Types and Interfaces

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

### HealthStatus

```typescript
interface HealthStatus {
  isHealthy: boolean;
  issues: string[];
  components: {
    core: boolean;
    encryption: boolean;
    messageProcessor: boolean;
    groupManager: boolean;
    publicRoomManager: boolean;
    tokenRoomManager: boolean;
  };
  performance: PerformanceMetrics;
}
```

### PerformanceMetrics

```typescript
interface PerformanceMetrics {
  messagesSent: number;
  messagesReceived: number;
  encryptionOperations: number;
  averageResponseTime: number;
  totalResponseTime: number;
  responseCount: number;
}
```

### PluginStats

```typescript
interface PluginStats {
  isListening: boolean;
  messageListenersCount: number;
  processedMessagesCount: number;
  hasActiveListener: boolean;
  performanceMetrics: PerformanceMetrics;
}
```

### JoinChatResult

```typescript
interface JoinChatResult {
  success: boolean;
  chatData?: any;
  error?: string;
}
```

### MessageData

```typescript
interface MessageData {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  signature?: string;
  roomId?: string; // For public room messages
  isPublic?: boolean; // Flag to distinguish public from private messages
  groupId?: string; // For group messages
  isGroup?: boolean; // Flag to distinguish group messages
  isEncrypted?: boolean; // Flag to indicate if the message was encrypted
}
```

## Error Handling

The plugin uses a centralized error handling system with production-ready features:

### Error Handling Features

- **Input validation** with detailed error messages
- **Automatic retry** with exponential backoff
- **Operation tracking** for debugging
- **Safe operation wrappers** with error boundaries
- **Performance monitoring** for error correlation

### Error Handling Example

```typescript
try {
  const result = await messagingPlugin.sendMessage(recipient, message);
  if (!result.success) {
    throw new Error(result.error);
  }
} catch (error) {
  console.error("Failed to send message:", error);
  // Implement retry logic or user notification
}
```

## Performance Monitoring

The plugin includes comprehensive performance monitoring capabilities.

### Performance Metrics

```typescript
interface PerformanceMetrics {
  messagesSent: number;
  messagesReceived: number;
  encryptionOperations: number;
  averageResponseTime: number;
  totalResponseTime: number;
  responseCount: number;
}
```

### Performance Monitoring Example

```typescript
// Monitor encryption performance
const startTime = performance.now();
const result = await messagingPlugin.sendMessage(recipient, message);
const encryptionTime = performance.now() - startTime;

console.log(`Encryption took ${encryptionTime}ms`);

// Get comprehensive stats
const stats = messagingPlugin.getStats();
console.log("Performance metrics:", stats.performanceMetrics);
```

## Production Best Practices

### 1. Health Monitoring

Always implement health checks in production:

```typescript
// Regular health checks
setInterval(async () => {
  const health = await messagingPlugin.getHealthStatus();
  if (!health.isHealthy) {
    console.warn("Plugin health issues detected:", health.issues);
    // Implement alerting or recovery logic
  }
}, 30000); // Check every 30 seconds
```

### 2. Error Handling

Implement comprehensive error handling:

```typescript
try {
  const result = await messagingPlugin.sendMessage(recipient, message);
  if (!result.success) {
    throw new Error(result.error);
  }
} catch (error) {
  console.error("Failed to send message:", error);
  // Implement user notification or retry logic
}
```

### 3. Message Size Limits

Keep messages reasonably sized for better performance:

```typescript
const MAX_MESSAGE_SIZE = 10000; // characters

if (message.length > MAX_MESSAGE_SIZE) {
  throw new Error("Message too large");
}
```

### 4. Connection Management

Properly manage listening state:

```typescript
// Start listening when app becomes active
useEffect(() => {
  messagingPlugin.startListening();

  return () => {
    messagingPlugin.stopListening();
  };
}, []);
```

### 5. Memory Management

Clear old messages to prevent memory issues:

```typescript
// Implement message cleanup
const cleanupOldMessages = () => {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000; // 30 days
  // Remove messages older than cutoff
};
```

### 6. Performance Monitoring

Monitor performance in production:

```typescript
// Log performance metrics
setInterval(() => {
  const stats = messagingPlugin.getStats();
  console.log("Performance metrics:", {
    messagesSent: stats.performanceMetrics.messagesSent,
    averageResponseTime: stats.performanceMetrics.averageResponseTime,
  });
}, 60000); // Log every minute
```

## Migration Guide

### From Version 3.x to 4.x

1. Update import statements to use the new plugin structure
2. Replace direct GunDB calls with plugin methods
3. Update error handling to use the new error system
4. Implement performance monitoring for better insights
5. Add health checks for production readiness

### Breaking Changes

- Plugin initialization now requires explicit call to `initialize()`
- Error handling has been centralized with enhanced features
- Message listening must be explicitly started/stopped
- Input validation is now enforced with size limits
- Performance monitoring is now built-in

## Troubleshooting

### Common Issues

1. **Plugin not initialized**: Ensure `initialize()` is called before using any methods
2. **Network timeouts**: Check peer connectivity and implement retry logic
3. **Encryption failures**: Verify public keys are valid and properly formatted
4. **Memory leaks**: Implement proper cleanup for message listeners
5. **Performance issues**: Monitor metrics and implement optimization

### Debug Mode

Enable debug logging for troubleshooting:

```typescript
// Debug logs are automatically included in development mode
console.log("Plugin stats:", messagingPlugin.getStats());
```

### Health Check Debugging

Use health checks to identify issues:

```typescript
const health = await messagingPlugin.getHealthStatus();

if (!health.isHealthy) {
  console.error("Health issues:", health.issues);
  console.error("Component status:", health.components);
  console.error("Performance issues:", health.performance);
}
```

## Support

For issues and questions:

1. Check the troubleshooting section
2. Review error logs with debug mode enabled
3. Consult the performance monitoring metrics
4. Use health checks to identify component issues
5. Open an issue in the repository with detailed error information

## Production Checklist

Before deploying to production:

- [ ] Implement health monitoring
- [ ] Set up performance monitoring
- [ ] Configure error handling and alerting
- [ ] Test retry mechanisms
- [ ] Validate input sanitization
- [ ] Monitor memory usage
- [ ] Set up logging and debugging
- [ ] Test all message types (private, group, public, token)
- [ ] Verify encryption and security
- [ ] Test network resilience
