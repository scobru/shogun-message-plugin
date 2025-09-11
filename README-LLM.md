# Shogun Message Plugin - LLM Technical Documentation

## System Overview

The Shogun Message Plugin is a sophisticated end-to-end encrypted messaging system built on GunDB, implementing Signal-inspired security protocols with advanced features like forward secrecy, message chaining, and decentralized group encryption.

## Architecture

### Core Components

```
shogun-message-plugin/
├── src/
│   ├── base.ts          # BasePlugin abstract class with metrics and health checks
│   ├── lib.ts           # LindaLib main implementation (1179 lines)
│   ├── schema.ts        # Centralized path management system
│   ├── types.ts         # TypeScript interfaces and type definitions
│   └── index.ts         # Public API exports
├── dist/                # Compiled outputs (CJS, ESM, Browser, Types)
├── package.json         # Dependencies and build configuration
└── webpack.config.js    # Browser build configuration
```

### Dependencies

**Core Dependencies:**
- `gun: ^0.2020.1241` - Decentralized database
- `shogun-core: ^1.10.4` - Shogun SDK core
- `ts-node: ^10.9.2` - TypeScript execution
- `yarn: ^1.22.22` - Package manager

**Development Dependencies:**
- TypeScript 5.2.2 with strict mode
- Jest 29.7.0 for testing
- Webpack 5.88.2 for browser builds
- Prettier 3.0.3 for code formatting

## Technical Implementation

### Encryption Model

The plugin uses GunDB's SEA (Security, Encryption, Authorization) for encryption:

```typescript
// ECDH key exchange
const sharedSecret = await this.core!.db.sea.secret(recipientKeys.epub, senderPair);

// Message encryption
const encryptedData = await this.core!.db.sea.encrypt(JSON.stringify(messageData), sharedSecret);

// Message decryption
const decryptedData = await this.core!.db.sea.decrypt(message.data, sharedSecret);
```

### Message Chaining System

Implements sequential message verification for enhanced security:

```typescript
private async verifyMessageChain(messageData: any): Promise<boolean> {
  const chainKey = `${messageData.from}_${this.userPubKey}`;
  const currentChain = this.messageChains.get(chainKey) || { lastIndex: -1 };
  
  if (messageData.messageIndex === currentChain.lastIndex + 1) {
    currentChain.lastIndex = messageData.messageIndex;
    this.messageChains.set(chainKey, currentChain);
    return true;
  }
  
  return false;
}
```

### Path Management Schema

Centralized schema system for consistent GunDB path management:

```typescript
export const MessagingSchema = {
  privateMessages: {
    recipient: (recipientPub: string) => `msg_${safe}`,
    conversation: (user1Pub: string, user2Pub: string) => `conversation_${sorted[0]}_${sorted[1]}`,
    legacy: { /* backward compatibility paths */ }
  },
  groups: {
    data: (groupId: string) => `group_${groupId}`,
    messages: (groupId: string) => `group-messages/${groupId}`,
    members: (groupId: string) => `group_${groupId}/members`
  },
  users: {
    profile: (userPub: string) => `~${userPub}`,
    epub: (userPub: string) => `~${userPub}/epub`,
    usernames: () => `usernames`
  }
};
```

## API Reference

### LindaLib Class

**Constructor:**
```typescript
constructor(peers?: string[], core?: ShogunCore)
```

**Key Properties:**
- `userPubKey: string | null` - Current user's public key
- `processedMessages: Set<string>` - Prevents duplicate message processing
- `messageChains: Map<string, any>` - Message chain state management
- `groupKeys: Map<string, any>` - Cached group encryption keys

### Core Methods

#### Authentication & Key Management

```typescript
// User authentication
async login(alias: string, pass: string): Promise<void>

// Publish user encryption keys to network
async publishUserKeys(): Promise<void>

// Retrieve user keys with timeout
async waitForUserKeys(userPub: string, timeoutMs: number = 10000): Promise<any>

// Check if user keys are published
async areUserKeysPublished(): Promise<boolean>
```

#### Private Messaging

```typescript
// Send encrypted message with chaining
async sendMessage(recipientPub: string, content: string): Promise<MessageSendResult>

// Listen for messages from specific sender
listenForMessages(senderPub: string, callback: (message: any) => void): void

// Process advanced messages with chain verification
private async processAdvancedMessage(message: any, callback: (message: any) => void): Promise<void>
```

#### Group Messaging

```typescript
// Create encrypted group with shared keys
async createGroup(groupName: string, memberPubs: string[]): Promise<string>

// Send message to group
async sendGroupMessage(groupId: string, content: string): Promise<void>

// Listen for group messages
listenForGroupMessages(groupId: string, callback: (message: any) => void): void

// Share group key with all members
private async shareGroupKey(groupId: string, groupKey: any, memberPubs: string[]): Promise<void>
```

#### Inbox System

```typescript
// Send message via inbox system
async sendMessageInbox(recipientPub: string, recipientEpub: string, messageContent: string, options?: object): Promise<MessageSendResult>

// Retrieve inbox messages
async receiveMessageInbox(options?: object): Promise<{ success: boolean; messages?: any[]; error?: string }>

// Start/stop inbox listening
startInboxListening(callback: (message: any) => void): void
stopInboxListening(): void
```

### Type Definitions

#### Core Types

```typescript
interface MessageSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

interface DecryptedMessage {
  from: string;
  to: string;
  content: string;
  timestamp: number;
  id: string;
}

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

#### Advanced Types

```typescript
interface MessageData {
  from: string;
  content: string;
  timestamp: number;
  id: string;
  signature?: string;
  roomId?: string;
  isPublic?: boolean;
  groupId?: string;
  isGroup?: boolean;
  isEncrypted?: boolean;
}

interface MessagingPluginInterface {
  sendMessage(recipientPub: string, messageContent: string): Promise<MessageSendResult>;
  onMessage(callback: (message: DecryptedMessage) => void): void;
  startListening(): void;
  stopListening(): void;
  isListening(): boolean;
  getConfig(): MessagingConfig;
  updateConfig(config: Partial<MessagingConfig>): void;
}
```

## Security Implementation

### Forward Secrecy

- Group keys are rotated periodically
- Individual message keys for sensitive conversations
- Automatic key cleanup for deleted messages
- ECDH key exchange for each conversation

### Message Integrity

- Sequential message indexing
- Chain verification prevents message tampering
- Digital signatures for message authenticity
- Replay attack protection through chain validation

### Encryption Flow

1. **Key Exchange**: ECDH shared secret derivation
2. **Message Encryption**: AES encryption with shared secret
3. **Chain Management**: Sequential indexing and verification
4. **Group Encryption**: Shared group keys with member-specific encryption

## Performance Optimizations

### Memory Management

```typescript
// Automatic cleanup of processed messages
private processedMessages: Set<string> = new Set();

// Efficient key caching
private groupKeys: Map<string, any> = new Map();

// Chain state management
private messageChains: Map<string, any> = new Map();
```

### Network Efficiency

- Smart path management reduces network calls
- Message deduplication prevents redundant processing
- Efficient key caching minimizes key retrieval
- Batch operations for group management

### Browser Compatibility

```javascript
// Webpack configuration for browser builds
module.exports = {
  resolve: {
    fallback: {
      crypto: require.resolve("crypto-browserify"),
      stream: require.resolve("stream-browserify"),
      buffer: require.resolve("buffer"),
      util: require.resolve("util"),
      // ... other polyfills
    }
  }
};
```

## Build System

### Multi-Format Output

```json
{
  "main": "dist/cjs/index.js",           // CommonJS
  "module": "dist/esm/index.js",         // ES Modules
  "types": "dist/types/index.d.ts",      // TypeScript definitions
  "browser": "dist/browser/index.js",    // Browser UMD
  "exports": {
    ".": {
      "types": "./dist/types/index.d.ts",
      "import": "./dist/esm/index.js",
      "require": "./dist/cjs/index.js",
      "browser": "./dist/browser/index.js"
    }
  }
}
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM"],
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## Testing Framework

### Jest Configuration

```javascript
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.jest.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts"
  ]
};
```

## Error Handling Patterns

### Comprehensive Error Management

```typescript
// Safe operation wrapper with metrics
protected async safeOperation<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  this.trackOperation();
  
  try {
    return await operation();
  } catch (error) {
    this.trackError(error as Error);
    console.error(`[${this.name}] Error in ${operationName}:`, error);
    throw error;
  }
}

// Retry with exponential backoff
protected async retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T>
```

### Health Monitoring

```typescript
public async healthCheck(): Promise<{
  isHealthy: boolean;
  issues: string[];
  uptime: number;
  metrics: any;
}> {
  const issues: string[] = [];
  
  if (!this.initialized) issues.push("Plugin not initialized");
  if (!this.core) issues.push("Core instance not available");
  if (this.core && !this.core.isLoggedIn()) issues.push("User not logged in");
  
  return {
    isHealthy: issues.length === 0,
    issues,
    uptime: Date.now() - this.metrics.startTime,
    metrics: this.metrics
  };
}
```

## Integration Patterns

### React Hook Integration

```typescript
// Example useMessaging hook
export function useMessaging() {
  const [messaging, setMessaging] = useState<LindaLib | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  
  useEffect(() => {
    const msg = new LindaLib(peers, core);
    setMessaging(msg);
    
    return () => msg.destroy();
  }, []);
  
  const sendMessage = useCallback(async (recipient: string, content: string) => {
    if (!messaging) return;
    return await messaging.sendMessage(recipient, content);
  }, [messaging]);
  
  return { messaging, messages, sendMessage };
}
```

### Node.js Integration

```typescript
// Server-side integration
import { LindaLib } from 'shogun-message-plugin';
import { ShogunCore } from 'shogun-core';

const core = new ShogunCore({
  peers: ['https://peer.wallie.io/gun'],
  scope: 'linda',
  radisk: true
});

const messaging = new LindaLib([], core);
await messaging.login('server-alias', 'server-password');
await messaging.publishUserKeys();
```

## Advanced Features

### Message Chain Statistics

```typescript
getChainStats(recipientPub: string): {
  messageCount: number;
  lastIndex: number;
  chainId: string | null;
}
```

### Plugin Status Monitoring

```typescript
getPluginStatus(): {
  isInitialized: boolean;
  userLoggedIn: boolean;
  publicKey: string | null;
  messageChains: number;
  groupKeys: number;
  processedMessages: number;
  inboxListening: boolean;
  inboxListeners: number;
}
```

### Debug Utilities

```typescript
// Debug user keys
async debugUserKeys(userPub: string): Promise<{
  userPub: string;
  keysFound: boolean;
  keys?: any;
  error?: string;
}>

// Enable debug mode
setInboxDebugMode(enabled: boolean): void

// Get listener count
getInboxListenersCount(): number
```

## Deployment Considerations

### Production Build

```bash
npm run build
# Generates: dist/cjs/, dist/esm/, dist/browser/, dist/types/
```

### Browser Deployment

```html
<script src="https://unpkg.com/gun/gun.js"></script>
<script src="https://unpkg.com/shogun-message-plugin/dist/browser/index.js"></script>
```

### Node.js Deployment

```typescript
import { LindaLib } from 'shogun-message-plugin';
// or
const { LindaLib } = require('shogun-message-plugin');
```

## Security Considerations

### Key Management

- User keys are automatically published on login
- Group keys are encrypted for each member
- Forward secrecy through key rotation
- Secure key storage in GunDB

### Network Security

- All communication encrypted end-to-end
- No central authority required
- Peer-to-peer message delivery
- Automatic retry and error recovery

### Privacy Features

- Anonymous communication possible
- No message content stored unencrypted
- Automatic message cleanup
- Protection against metadata analysis

## Performance Metrics

### Memory Usage

- Efficient Set/Map usage for state management
- Automatic cleanup of processed messages
- Minimal memory footprint per conversation
- Garbage collection friendly

### Network Performance

- Minimal bandwidth usage
- Smart caching reduces network calls
- Efficient message batching
- Real-time message delivery

### CPU Performance

- Asynchronous operations throughout
- Efficient encryption/decryption
- Minimal blocking operations
- Optimized for real-time communication

## Troubleshooting Guide

### Common Issues

1. **"User not logged in"**
   - Ensure `login()` is called before messaging operations
   - Verify credentials are correct

2. **"Core not initialized"**
   - Call `initialize(core)` before use
   - Ensure ShogunCore is properly configured

3. **"Keys not found"**
   - Call `publishUserKeys()` after login
   - Check network connectivity to peers

4. **"Network connection failed"**
   - Verify peer URLs are accessible
   - Check firewall/proxy settings
   - Try different peer endpoints

### Debug Mode

```typescript
// Enable comprehensive debugging
messaging.setInboxDebugMode(true);

// Check plugin health
const health = await messaging.healthCheck();
console.log('Health status:', health);

// Monitor plugin metrics
const metrics = messaging.getMetrics();
console.log('Performance metrics:', metrics);
```

## Future Enhancements

### Planned Features

- Voice message support
- File sharing capabilities
- Message reactions and threading
- Advanced group management
- Cross-platform synchronization
- Message search and indexing

### Technical Improvements

- WebRTC integration for direct peer connections
- Advanced caching strategies
- Performance optimizations
- Enhanced error recovery
- Better browser compatibility

---

This technical documentation provides comprehensive information for LLMs and developers working with the Shogun Message Plugin. For user-facing documentation, see the main README.md file.
