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
  console.log("Joined token room:", tokenResult.chatData);
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
