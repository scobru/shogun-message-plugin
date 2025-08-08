# Shogun Messaging Plugin

A comprehensive end-to-end encrypted messaging plugin for the Shogun protocol, built on GunDB. This plugin provides private encrypted messaging, public room messaging, group messaging, and token-based encrypted rooms.

## Features

- **End-to-End Encryption**: Secure private messaging using GunDB's SEA encryption
- **Public Room Messaging**: Unencrypted messages to public rooms with signature verification
- **Group Messaging**: Encrypted group chats with Multiple People Encryption (MPE)
- **Token-Based Encrypted Rooms**: Shared token encryption for multi-user rooms
- **Automatic epub Publishing**: Ensures your encryption key is available on the network
- **Multiple Fallback Strategies**: 7 different methods to find recipient encryption keys
- **MetaMask Support**: Full compatibility with MetaMask authentication
- **Duplicate Prevention**: Intelligent message deduplication
- **Conversation Management**: Clear conversations and track cleared chats
- **Performance Optimized**: Efficient message processing and cleanup
- **DRY Code Design**: Shared utilities for all messaging types

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

// Listen for group messages
messagingPlugin.onGroupMessage((message) => {
  console.log("Group message received:", message);
});

// Listen for token room messages
messagingPlugin.onTokenRoomMessage((message) => {
  console.log("Token room message received:", message);
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

### Group Messaging

#### `createGroup(groupName: string, memberPubs: string[]): Promise<GroupResponse>`

Creates a new encrypted group with specified members.

```typescript
const result = await messagingPlugin.createGroup("My Team", [
  "member1_pub",
  "member2_pub",
  "member3_pub",
]);

if (result.success) {
  console.log("Group created:", result.groupData);
} else {
  console.error("Failed to create group:", result.error);
}
```

#### `sendGroupMessage(groupId: string, content: string): Promise<MessageResponse>`

Sends an encrypted message to a group using Multiple People Encryption.

```typescript
const result = await messagingPlugin.sendGroupMessage(
  "group_id",
  "Hello team members!"
);

if (result.success) {
  console.log("Group message sent with ID:", result.messageId);
} else {
  console.error("Failed to send group message:", result.error);
}
```

#### `onGroupMessage(callback: GroupMessageListener): void`

Registers a callback for incoming group messages.

```typescript
messagingPlugin.onGroupMessage((message) => {
  console.log(`Group: ${message.groupId}`);
  console.log(`From: ${message.username || message.from}`);
  console.log(`Content: ${message.content}`);
  console.log(`Timestamp: ${message.timestamp}`);
});
```

#### `joinGroup(groupId: string): Promise<GroupResponse>`

Joins an existing group using an invitation link.

```typescript
const result = await messagingPlugin.joinGroup("group_id");
if (result.success) {
  console.log("Successfully joined group:", result.groupData);
} else {
  console.error("Failed to join group:", result.error);
}
```

### Token-Based Encrypted Rooms

#### `createTokenRoom(roomName: string, description?: string, maxParticipants?: number): Promise<TokenRoomResponse>`

Creates a new token-based encrypted room. Anyone with the token can join and decrypt messages.

```typescript
const result = await messagingPlugin.createTokenRoom(
  "Secret Discussion",
  "Private room for sensitive topics",
  50
);

if (result.success) {
  console.log("Token room created:", result.roomData);
  console.log("Share this token:", result.roomData.token);
} else {
  console.error("Failed to create token room:", result.error);
}
```

#### `sendTokenRoomMessage(roomId: string, content: string, token: string): Promise<MessageResponse>`

Sends an encrypted message to a token-based room using the shared token.

```typescript
const result = await messagingPlugin.sendTokenRoomMessage(
  "room_id",
  "Secret message for token holders",
  "shared_token_here"
);

if (result.success) {
  console.log("Token room message sent with ID:", result.messageId);
} else {
  console.error("Failed to send token room message:", result.error);
}
```

#### `onTokenRoomMessage(callback: TokenRoomMessageListener): void`

Registers a callback for incoming token room messages.

```typescript
messagingPlugin.onTokenRoomMessage((message) => {
  console.log(`Token Room: ${message.roomId}`);
  console.log(`From: ${message.username || message.from}`);
  console.log(`Content: ${message.content}`);
  console.log(`Timestamp: ${message.timestamp}`);
});
```

#### `joinTokenRoom(roomId: string, token: string): Promise<TokenRoomResponse>`

Joins a token-based encrypted room using the provided token.

```typescript
const result = await messagingPlugin.joinTokenRoom(
  "room_id",
  "shared_token_here"
);

if (result.success) {
  console.log("Successfully joined token room:", result.roomData);
} else {
  console.error("Failed to join token room:", result.error);
}
```

#### `getTokenRoomData(roomId: string): Promise<TokenRoomData | null>`

Retrieves data for a token-based room (without the token for security).

```typescript
const roomData = await messagingPlugin.getTokenRoomData("room_id");
if (roomData) {
  console.log("Room name:", roomData.name);
  console.log("Created by:", roomData.createdBy);
  console.log("Description:", roomData.description);
} else {
  console.log("Room not found");
}
```

### Chat Management

#### `joinChat(chatType: "private" | "public" | "group" | "token", chatId: string, token?: string): Promise<ChatResponse>`

Universal method to join any type of chat.

```typescript
// Join a private chat
await messagingPlugin.joinChat("private", "user_pub_key");

// Join a public room
await messagingPlugin.joinChat("public", "room_id");

// Join a group
await messagingPlugin.joinChat("group", "group_id");

// Join a token room
await messagingPlugin.joinChat("token", "room_id", "shared_token");
```

#### `getMyChats(): Promise<ChatsResponse>`

Gets all chats the current user has access to.

```typescript
const result = await messagingPlugin.getMyChats();
if (result.success) {
  console.log("Your chats:", result.chats);
  result.chats.forEach((chat) => {
    console.log(`${chat.type}: ${chat.name} (${chat.id})`);
  });
} else {
  console.error("Failed to get chats:", result.error);
}
```

#### `generateInviteLink(chatType: "private" | "public" | "group" | "token", chatId: string, chatName?: string, token?: string): string`

Generates an invitation link for any chat type.

```typescript
// Generate private chat link
const privateLink = messagingPlugin.generateInviteLink(
  "private",
  "user_pub",
  "John Doe"
);

// Generate public room link
const publicLink = messagingPlugin.generateInviteLink(
  "public",
  "general",
  "General Room"
);

// Generate group link
const groupLink = messagingPlugin.generateInviteLink(
  "group",
  "team_id",
  "Team Chat"
);

// Generate token room link (includes token)
const tokenLink = messagingPlugin.generateInviteLink(
  "token",
  "room_id",
  "Secret Room",
  "shared_token"
);
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

### GroupMessage (Group Messages)

```typescript
interface GroupMessage {
  from: string; // Sender's public key
  content: string; // Decrypted message content
  timestamp: number; // Unix timestamp
  id: string; // Unique message ID
  groupId: string; // Group identifier
  username?: string; // Optional display name
  encryptedContent: string; // Encrypted content with group key
  encryptedKeys: { [recipientPub: string]: string }; // Encrypted keys for each member
  signature?: string; // Message signature
}
```

### TokenRoomMessage (Token Room Messages)

```typescript
interface TokenRoomMessage {
  from: string; // Sender's public key
  content: string; // Decrypted message content
  timestamp: number; // Unix timestamp
  id: string; // Unique message ID
  roomId: string; // Room identifier
  username?: string; // Optional display name
  encryptedContent: string; // Content encrypted with shared token
  signature?: string; // Message signature
}
```

### GroupData

```typescript
interface GroupData {
  id: string; // Group identifier
  name: string; // Group name
  members: string[]; // Array of member public keys
  createdBy: string; // Creator's public key
  createdAt: number; // Creation timestamp
  encryptionKey: string; // Group encryption key
}
```

### TokenRoomData

```typescript
interface TokenRoomData {
  id: string; // Room identifier
  name: string; // Room name
  token: string; // Shared encryption token
  createdBy: string; // Creator's public key
  createdAt: number; // Creation timestamp
  description?: string; // Optional room description
  maxParticipants?: number; // Optional participant limit
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
  isListeningGroups: boolean; // Group listener status
  isListeningTokenRooms: boolean; // Token room listener status
  messageListenersCount: number; // Private listeners count
  publicMessageListenersCount: number; // Public listeners count
  groupMessageListenersCount: number; // Group listeners count
  tokenRoomMessageListenersCount: number; // Token room listeners count
  processedMessagesCount: number; // Private messages processed
  processedPublicMessagesCount: number; // Public messages processed
  processedGroupMessagesCount: number; // Group messages processed
  processedTokenMessagesCount: number; // Token room messages processed
  clearedConversationsCount: number; // Cleared conversations
  activeTokenRoomsCount: number; // Active token rooms
  version: string; // Plugin version
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

// Set up group message handling
messagingPlugin.onGroupMessage((message) => {
  console.log(
    `👥 [${message.groupId}] ${message.username}: ${message.content}`
  );
});

// Set up token room message handling
messagingPlugin.onTokenRoomMessage((message) => {
  console.log(`🔑 [${message.roomId}] ${message.username}: ${message.content}`);
});

// Start listening to public room
messagingPlugin.startListeningPublic("general");

// Create a token room
const roomResult = await messagingPlugin.createTokenRoom(
  "Secret Discussion",
  "Private room for sensitive topics"
);

if (roomResult.success) {
  console.log("Token room created:", roomResult.roomData.name);
  console.log("Share this token:", roomResult.roomData.token);

  // Join the token room
  await messagingPlugin.joinTokenRoom(
    roomResult.roomData.id,
    roomResult.roomData.token
  );

  // Send a message to the token room
  await messagingPlugin.sendTokenRoomMessage(
    roomResult.roomData.id,
    "Welcome to our secret discussion!",
    roomResult.roomData.token
  );
}

// Create a group
const groupResult = await messagingPlugin.createGroup("My Team", [
  "member1",
  "member2",
]);
if (groupResult.success) {
  console.log("Group created:", groupResult.groupData.name);

  // Send a message to the group
  await messagingPlugin.sendGroupMessage(
    groupResult.groupData.id,
    "Hello team!"
  );
}

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

## Encryption Types

### 1. Private Messages (E2E)

- **Encryption**: End-to-end using recipient's epub
- **Access**: Only sender and recipient can decrypt
- **Use Case**: Secure 1-to-1 communication

### 2. Public Rooms (Unencrypted)

- **Encryption**: None (but signed for authenticity)
- **Access**: Anyone can read
- **Use Case**: Public discussions, announcements

### 3. Group Messages (MPE)

- **Encryption**: Multiple People Encryption with group key
- **Access**: Only group members can decrypt
- **Use Case**: Team collaboration, private groups

### 4. Token Rooms (Shared Token)

- **Encryption**: Shared token encryption
- **Access**: Anyone with the token can decrypt
- **Use Case**: Invitation-based rooms, temporary discussions

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

## Group Architecture

Group messaging uses Multiple People Encryption (MPE):

- **Path Structure**: `group_{groupId}` in GunDB
- **Group Key**: Shared encryption key for the group
- **Individual Encryption**: Group key encrypted for each member
- **Member Management**: Automatic key distribution to new members
- **Signature Verification**: Messages are signed for authenticity

## Token Room Architecture

Token-based rooms use shared token encryption:

- **Path Structure**: `token_room_{roomId}` in GunDB
- **Shared Token**: Single encryption token for all participants
- **Simple Access**: Anyone with the token can join and decrypt
- **No Member Management**: Token-based access control
- **Signature Verification**: Messages are signed for authenticity

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
| "Invalid token for this room"         | Wrong token provided for token room      | Check the token in the invitation link                     |
| "Group not found"                     | Group doesn't exist or access denied     | Verify group ID and membership                             |

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

### Token Room Issues

**Solutions:**

1. Verify the token is correct and complete
2. Check if the room still exists
3. Ensure you're using the latest token if it was regenerated
4. Try joining with the invitation link instead of manual token entry

## Versions

| Version | Features                                                |
| ------- | ------------------------------------------------------- |
| 4.7.0   | Added token-based encrypted rooms, group messaging      |
| 4.6.0   | Added public room messaging, DRY optimization           |
| 4.5.0   | Enhanced epub fallback strategies, automatic publishing |
| 4.4.0   | MetaMask support, conversation management               |
| 4.3.0   | Duplicate prevention, performance improvements          |
| 4.2.0   | Basic E2E messaging with GunDB                          |

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
