/**
 * Schema for the Shogun messaging plugin
 * Centralizes all GunDB paths for consistency
 */

export const MessagingSchema = {
  // Main collections
  root: 'shogun',
  collections: {
    messages: 'messages',
    groups: 'groups',
    tokenRooms: 'tokenRooms',
    publicRooms: 'publicRooms',
    users: 'users',
    conversations: 'conversations',
    usernames: 'usernames' // **NEW: Username mapping collection**
  },

  // Private message paths
  privateMessages: {
    // Path for messages sent to a specific recipient
    recipient: (recipientPub: string) => {
      const safe = recipientPub.replace(/[^a-zA-Z0-9_-]/g, "_");
      return `msg_${safe}`;
    },
    
    // Path for messages received by the current user
    currentUser: (currentUserPub: string) => `msg_${currentUserPub}`,
    
    // Bidirectional conversation path
    conversation: (user1Pub: string, user2Pub: string) => {
      const sanitize = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, "_");
      const sorted = [sanitize(user1Pub), sanitize(user2Pub)].sort();
      return `conversation_${sorted[0]}_${sorted[1]}`;
    },
    
    // Legacy path for compatibility
    legacy: {
      userMessages: (userPub: string) => `${userPub}/messages`,
      userMessagesByDate: (userPub: string, date: string) => `${userPub}/messages/${date}`,
      messageById: (userPub: string, date: string, messageId: string) => 
        `${userPub}/messages/${date}/${messageId}`
    }
  },

  // Group paths
  groups: {
    // Group data
    data: (groupId: string) => `group_${groupId}`,
    
    // Group messages
    messages: (groupId: string) => `group-messages/${groupId}`,
    
    // Group members
    members: (groupId: string) => `group_${groupId}/members`,
    
    // Encrypted group keys
    encryptedKeys: (groupId: string) => `group_${groupId}/encryptedKeys`,
    
    // **NEW: localStorage keys for groups**
    localStorage: (groupId: string) => `group_messages_${groupId}`
  },

  // Token room paths
  tokenRooms: {
    // Room data
    data: (roomId: string) => `token_room_${roomId}`,
    
    // Room messages
    messages: (roomId: string) => `token-messages/${roomId}`,
    
    // Room members
    members: (roomId: string) => `token_room_${roomId}/members`,
    
    // Access token path
    access: (roomId: string) => `token_room_${roomId}/access`,
    
    // **NEW: localStorage keys for token rooms**
    localStorage: (roomId: string) => `tokenRoom_messages_${roomId}`
  },

  // Public room paths
  publicRooms: {
    // Room data
    data: (roomId: string) => `public_room_${roomId}`,
    
    // Room messages
    messages: (roomId: string) => `public-messages/${roomId}`,
    
    // Room metadata
    metadata: (roomId: string) => `public_room_${roomId}/metadata`,
    
    // **NEW: localStorage keys for public rooms**
    localStorage: (roomId: string) => `publicRoom_messages_${roomId}`
  },

  // User paths
  users: {
    // User profile
    profile: (userPub: string) => `~${userPub}`,
    
    // User data
    data: (userPub: string) => `users/${userPub}`,
    
    // Encryption keys
    epub: (userPub: string) => `~${userPub}/epub`,
    
    // User's groups
    groups: (userPub: string) => `users/${userPub}/groups`,
    
    // User's token rooms
    tokenRooms: (userPub: string) => `users/${userPub}/tokenRooms`,
    
    // **NEW: Username mapping for user search**
    usernames: () => `usernames`,
    
    // **NEW: Mapping username -> user data**
    usernameMapping: (username: string) => `usernames/${username}`,
    
    // **NEW: Test path for GunDB connection**
    test: () => `test`
  },

  // Conversation paths
  conversations: {
    // Specific conversation
    conversation: (conversationId: string) => `conversations/${conversationId}`,
    
    // Conversation messages
    messages: (conversationId: string) => `conversations/${conversationId}/messages`,
    
    // Conversation metadata
    metadata: (conversationId: string) => `conversations/${conversationId}/metadata`
  },

  // Utilities to generate IDs and paths
  utils: {
    // Generate unique message ID
    generateMessageId: () => `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Generate unique group ID
    generateGroupId: () => `group_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Generate unique token room ID
    generateTokenRoomId: () => `token_room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Generate unique public room ID
    generatePublicRoomId: () => `public_room_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
    
    // Date format for message organization (YYYY-MM-DD)
    formatDate: (date: Date = new Date()) => date.toLocaleDateString("en-CA"),
    
    // Date format for timestamp
    formatTimestamp: (timestamp: number) => new Date(timestamp).toLocaleDateString("en-CA"),
    
    // Create a consistent conversation ID
    createConversationId: (user1Pub: string, user2Pub: string) => {
      const sanitize = (k: string) => k.replace(/[^a-zA-Z0-9_-]/g, "_");
      const sorted = [sanitize(user1Pub), sanitize(user2Pub)].sort();
      return `conversation_${sorted[0]}_${sorted[1]}`;
    }
  },

  // Debug and development paths
  debug: {
    // GunDB structure for debug
    structure: (path: string) => `debug/${path}`,
    
    // Operation logs
    logs: (operation: string) => `debug/logs/${operation}`,
    
    // Performance metrics
    metrics: (component: string) => `debug/metrics/${component}`
  }
};

/**
 * Helper to create safe paths
 */
export function createSafePath(pubKey: string, prefix: string = "msg"): string {
  if (!pubKey || typeof pubKey !== "string") {
    throw new Error("Public key must be a valid string");
  }
  
  // Remove dangerous characters and normalize
  const safeKey = pubKey.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${prefix}_${safeKey}`;
}

/**
 * Helper to create conversation paths
 */
export function createConversationPath(user1Pub: string, user2Pub: string): string {
  if (!user1Pub || !user2Pub) {
    throw new Error("Both public keys are required");
  }
  
  return MessagingSchema.utils.createConversationId(user1Pub, user2Pub);
}

/**
 * Helper to validate paths
 */
export function validatePath(path: string): boolean {
  if (!path || typeof path !== "string") {
    return false;
  }
  
  // Check for dangerous characters
  const dangerousChars = /[<>:"|?*]/;
  return !dangerousChars.test(path);
}

/**
 * Helper to normalize paths
 */
export function normalizePath(path: string): string {
  if (!path) return "";
  
  // Remove dangerous characters and normalize separators
  return path
    .replace(/[<>:"|?*]/g, "_")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}
