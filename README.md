# Shogun Message Plugin

## Introduction

This document captures the CURRENT STATE of the Shogun Message Plugin codebase, including technical debt, workarounds, and real-world patterns. It serves as a reference for AI agents working on enhancements to this encrypted messaging plugin.

### Document Scope

Comprehensive documentation of the entire messaging plugin system, focusing on the protocol layer implementation for end-to-end encrypted messaging.

### Change Log

| Date       | Version | Description                 | Author   |
| ---------- | ------- | --------------------------- | -------- |
| 2024-12-19 | 1.0     | Initial brownfield analysis | AI Agent |

## Quick Reference - Key Files and Entry Points

### Critical Files for Understanding the System

- **Main Entry**: `src/messagingPlugin.ts` - Main plugin class and public API
- **Core Managers**:
  - `src/encryption.ts` - Encryption/decryption logic
  - `src/messageProcessor.ts` - Message handling and routing
  - `src/groupManager.ts` - Group messaging functionality
  - `src/publicRoomManager.ts` - Public room messaging
  - `src/tokenRoomManager.ts` - Token-based encrypted rooms
- **Base Classes**: `src/base.ts` - Base plugin interface
- **Types**: `src/types.ts` - TypeScript interfaces and types
- **Utilities**: `src/utils.ts` - Shared utility functions
- **Configuration**: `package.json` - Dependencies and build scripts

### Test Coverage and Quality

- **Test Files**: `src/__tests__/` - Comprehensive test suite
- **Coverage**: High test coverage with integration and unit tests
- **Build System**: Multiple output formats (CJS, ESM, Browser)

## High Level Architecture

### Technical Summary

The Shogun Message Plugin is a protocol-only messaging system built on GunDB that provides four types of messaging:

1. **Private Messages** - End-to-end encrypted 1-to-1 communication
2. **Public Room Messages** - Unencrypted but signed public discussions
3. **Group Messages** - Multiple People Encryption (MPE) for group chats
4. **Token Room Messages** - Shared token encryption for invitation-based rooms

### Actual Tech Stack (from package.json)

| Category | Technology  | Version     | Notes                       |
| -------- | ----------- | ----------- | --------------------------- |
| Runtime  | Node.js     | >=16.0.0    | Browser and Node.js support |
| Language | TypeScript  | 5.2.2       | Full type safety            |
| Database | GunDB       | 0.2020.1235 | P2P graph database          |
| Core     | Shogun Core | 1.7.1       | Main SDK dependency         |
| Testing  | Jest        | 29.7.0      | Test framework              |
| Build    | Webpack     | 5.88.2      | Browser bundle generation   |
| Plugin   | Version     | 4.7.0       | Current plugin version      |

### Repository Structure Reality Check

- Type: **Monorepo Component** (part of larger Shogun ecosystem)
- Package Manager: **npm** (with yarn as dependency)
- Notable: **Protocol-only design** - UI logic moved to consuming applications

## Source Tree and Module Organization

### Project Structure (Actual)

```text
shogun-message-plugin/
├── src/
│   ├── messagingPlugin.ts     # Main plugin class and public API
│   ├── base.ts               # Base plugin interface
│   ├── encryption.ts         # E2E encryption/decryption logic
│   ├── messageProcessor.ts   # Message handling and routing
│   ├── groupManager.ts       # Group messaging with MPE
│   ├── publicRoomManager.ts  # Public room messaging
│   ├── tokenRoomManager.ts   # Token-based encrypted rooms
│   ├── types.ts             # TypeScript interfaces
│   ├── utils.ts             # Shared utility functions
│   └── __tests__/           # Comprehensive test suite
├── dist/                    # Build outputs (CJS, ESM, Browser)
├── coverage/                # Test coverage reports
├── docs/                    # Documentation
└── package.json            # Dependencies and scripts
```

### Key Modules and Their Purpose

- **MessagingPlugin**: `src/messagingPlugin.ts` - Main plugin class, orchestrates all messaging types
- **EncryptionManager**: `src/encryption.ts` - Handles E2E encryption using GunDB SEA
- **MessageProcessor**: `src/messageProcessor.ts` - Processes incoming messages and manages listeners
- **GroupManager**: `src/groupManager.ts` - Manages group creation and MPE encryption
- **PublicRoomManager**: `src/publicRoomManager.ts` - Handles public room messaging
- **TokenRoomManager**: `src/tokenRoomManager.ts` - Manages token-based encrypted rooms
- **BasePlugin**: `src/base.ts` - Abstract base class for all Shogun plugins

## Data Models and APIs

### Core Data Models

Instead of duplicating, reference actual model files:

- **Message Types**: See `src/types.ts` lines 30-266
- **Plugin Interface**: See `src/types.ts` lines 207-265
- **Event Types**: See `src/types.ts` lines 1-29

### API Specifications

The plugin exposes a clean protocol-only API with 4 core send functions:

```typescript
// Core messaging functions
sendMessage(recipientPub: string, content: string): Promise<MessageResponse>
sendGroupMessage(groupId: string, content: string): Promise<MessageResponse>
sendTokenRoomMessage(roomId: string, content: string, token: string): Promise<MessageResponse>
sendPublicMessage(roomId: string, content: string): Promise<MessageResponse>

// Protocol support functions
createGroup(name: string, memberPubs: string[]): Promise<GroupResponse>
createTokenRoom(name: string, description?: string): Promise<TokenRoomResponse>
joinTokenRoom(roomId: string, token: string): Promise<TokenRoomResponse>
getRecipientEpub(userPub: string): Promise<string>
publishUserEpub(): Promise<boolean>

// Raw message listeners
onRawMessage(callback: MessageListener): void
onRawPublicMessage(callback: PublicMessageListener): void
onRawGroupMessage(callback: GroupMessageListener): void
onRawTokenRoomMessage(callback: TokenRoomMessageListener): void
```

## Technical Debt and Known Issues

### Critical Technical Debt

1. **Protocol-Only Transition**: Recent refactor moved UI logic to consuming apps, but some legacy UI methods may still exist
2. **Epub Fallback Strategies**: 7 different methods to find recipient encryption keys (complex but necessary)
3. **Message Deduplication**: Complex logic to prevent duplicate messages across different message types
4. **GunDB Integration**: Tight coupling to GunDB's specific API patterns and quirks

### Workarounds and Gotchas

- **Epub Publishing**: Must manually publish encryption keys to network for E2E messaging to work
- **Message TTL**: 24-hour TTL for processed messages to prevent memory leaks
- **Duplicate Prevention**: Uses multiple strategies (message IDs, timestamps, cleanup) to prevent duplicates
- **GunDB Paths**: Specific path structures required for different message types:
  - Private: `msg_{senderPub}_{recipientPub}`
  - Public: `room_{roomId}`
  - Group: `group_{groupId}`
  - Token: `token_room_{roomId}`

### Performance Considerations

- **Message Processing**: Limits processed messages to 1000 per type to prevent memory leaks
- **Listener Management**: Single listener per message type with internal routing
- **Cleanup Strategies**: Automatic cleanup of expired message IDs and processed messages

## Integration Points and External Dependencies

### External Services

| Service     | Purpose      | Integration Type | Key Files                               |
| ----------- | ------------ | ---------------- | --------------------------------------- |
| GunDB       | P2P Database | Direct API       | All manager classes                     |
| Shogun Core | SDK Core     | Plugin Interface | `src/base.ts`, `src/messagingPlugin.ts` |
| SEA         | Encryption   | GunDB SEA        | `src/encryption.ts`                     |

### Internal Integration Points

- **Plugin Registration**: Must be registered with Shogun Core via `sdk.register()`
- **Authentication**: Requires user to be logged in via Shogun Core
- **Database Access**: Uses `core.db` for all GunDB operations
- **Event System**: Uses GunDB's event system for real-time message delivery

## Development and Deployment

### Local Development Setup

1. Install dependencies: `npm install` or `yarn install`
2. Build TypeScript: `npm run build`
3. Run tests: `yarn test` (preferred) or `npm test`
4. Development mode: `npm run dev` (watch mode)

### Build and Deployment Process

- **Build Command**: `npm run build` (generates CJS, ESM, and Browser bundles)
- **Test Command**: `yarn test` (preferred) or `npm test` (Jest with coverage)
- **Linting**: `npm run lint` (Prettier check)
- **Formatting**: `npm run format` (Prettier write)

### Build Outputs

- **CJS**: `dist/cjs/` - CommonJS for Node.js
- **ESM**: `dist/esm/` - ES Modules for modern environments
- **Browser**: `dist/browser/` - Webpack bundle for browsers
- **Types**: `dist/types/` - TypeScript declaration files

## Testing Reality

### Current Test Coverage

- **Unit Tests**: Comprehensive coverage of all manager classes
- **Integration Tests**: `messagingPlugin.integration.test.ts` - Full plugin integration
- **Type Tests**: `types.test.ts` - TypeScript interface validation
- **Coverage**: High coverage with detailed reports in `coverage/`

### Running Tests

```bash
yarn test          # Runs all tests with coverage (preferred)
npm test           # Runs all tests with coverage (alternative)
npm run test:watch # Watch mode for development
```

### Test Structure

- **Base Tests**: `base.test.ts` - Base plugin functionality
- **Encryption Tests**: `encryption.test.ts` - E2E encryption/decryption
- **Manager Tests**: Individual tests for each manager class
- **Integration Tests**: Full plugin workflow testing
- **Utility Tests**: `utils.test.ts` - Shared utility functions

## Encryption Architecture

### E2E Encryption (Private Messages)

- **Algorithm**: GunDB SEA (Security, Encryption, Authorization)
- **Key Management**: epub (encryption public key) published to network
- **Fallback Strategies**: 7 different methods to find recipient epub
- **Path Structure**: `msg_{senderPub}_{recipientPub}` in GunDB

### Multiple People Encryption (Group Messages)

- **Group Key**: Shared encryption key for all group members
- **Individual Encryption**: Group key encrypted for each member's epub
- **Member Management**: Automatic key distribution to new members
- **Path Structure**: `group_{groupId}` in GunDB

### Token-Based Encryption (Token Rooms)

- **Shared Token**: Single encryption token for all participants
- **Simple Access**: Anyone with token can join and decrypt
- **No Member Management**: Token-based access control
- **Path Structure**: `token_room_{roomId}` in GunDB

### Public Messages (Unencrypted)

- **No Encryption**: Messages are unencrypted for public access
- **Signature Verification**: Optional digital signatures for authenticity
- **Path Structure**: `room_{roomId}` in GunDB

## Message Processing Architecture

### Message Flow

1. **Send**: Message encrypted and sent to GunDB
2. **Receive**: GunDB listener captures incoming messages
3. **Process**: MessageProcessor decrypts and validates
4. **Route**: Message routed to appropriate listener based on type
5. **Cleanup**: Duplicate prevention and TTL cleanup

### Listener Management

- **Single Listener Per Type**: One GunDB listener per message type
- **Internal Routing**: MessageProcessor routes to multiple callbacks
- **Callback Registration**: Apps register callbacks for specific message types
- **Listener Lifecycle**: Start/stop listening for each message type

### Duplicate Prevention

- **Message IDs**: Unique IDs for each message
- **Processed Tracking**: Map of processed message IDs
- **TTL Cleanup**: Automatic cleanup of old message IDs
- **Size Limiting**: Prevents memory leaks by limiting tracked messages

## Error Handling and Recovery

### Common Error Scenarios

1. **Epub Not Found**: Recipient's encryption key unavailable
2. **Invalid Token**: Wrong token for token room access
3. **Group Not Found**: Group doesn't exist or access denied
4. **Network Issues**: GunDB connectivity problems
5. **Authentication**: User not logged in

### Recovery Strategies

- **Epub Fallbacks**: 7 different methods to find encryption keys
- **Retry Logic**: Automatic retries for network operations
- **Graceful Degradation**: Continue operation when possible
- **Error Reporting**: Detailed error messages for debugging

## Performance Optimizations

### Memory Management

- **Message TTL**: 24-hour expiration for processed messages
- **Size Limits**: Maximum 1000 processed messages per type
- **Cleanup Strategies**: Automatic cleanup of expired entries
- **Listener Optimization**: Single listener with internal routing

### Network Efficiency

- **GunDB Optimization**: Efficient GunDB path structures
- **Batch Operations**: Grouped operations where possible
- **Caching**: Local caching of frequently accessed data
- **Connection Management**: Efficient GunDB connection handling

## Security Considerations

### Encryption Security

- **E2E Encryption**: End-to-end encryption for private messages
- **Key Management**: Secure epub publishing and retrieval
- **Signature Verification**: Digital signatures for message authenticity
- **Token Security**: Secure token generation and validation

### Access Control

- **Authentication Required**: Must be logged in to send messages
- **Group Membership**: Only group members can decrypt group messages
- **Token Validation**: Token required for token room access
- **Public Access**: Public rooms accessible to anyone

## Appendix - Useful Commands and Scripts

### Frequently Used Commands

```bash
# Build and Development
npm run build       # Build all output formats
yarn test          # Run tests with coverage (preferred)
npm test           # Run tests with coverage (alternative)
npm run dev        # Development mode (watch)
npm run lint       # Check code formatting
npm run format     # Format code with Prettier
npm run clean      # Clean build outputs
```

### Debugging and Troubleshooting

- **Logs**: Check browser console for plugin logs
- **Test Coverage**: Review `coverage/` for test coverage details
- **Type Checking**: TypeScript compilation for type errors
- **Common Issues**: See README.md troubleshooting section

### Development Workflow

1. **Feature Development**: Create feature branch
2. **Implementation**: Add code with tests
3. **Testing**: Run full test suite
4. **Build**: Ensure all builds work
5. **Documentation**: Update README if needed
6. **Review**: Code review and testing
7. **Merge**: Merge to main branch

## Future Considerations

### Potential Enhancements

- **Message Persistence**: Better message history management
- **File Sharing**: Support for encrypted file sharing
- **Message Search**: Search functionality for messages
- **Advanced Groups**: More sophisticated group management
- **Mobile Optimization**: Better mobile performance
- **Offline Support**: Offline message queuing and sync

### Technical Debt Reduction

- **Code Consolidation**: Reduce duplication between managers
- **Error Handling**: More comprehensive error handling
- **Performance**: Further optimization of message processing
- **Testing**: Additional edge case testing
- **Documentation**: More detailed API documentation

This document provides a comprehensive view of the current state of the Shogun Message Plugin, enabling AI agents to understand the system architecture, constraints, and patterns for effective development and enhancement.
