/**
 * Security Enhancements for GunDB Messaging Protocol
 * 
 * This file contains security improvements and input validation
 */

import { MessageData } from './types';

export interface SecurityConfig {
  maxMessageLength: number;
  maxUsernameLength: number;
  allowedCharacters: RegExp;
  enableRateLimiting: boolean;
  maxMessagesPerMinute: number;
  enableContentFiltering: boolean;
  blockedPatterns: RegExp[];
}

export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  maxMessageLength: 10000,
  maxUsernameLength: 50,
  allowedCharacters: /^[a-zA-Z0-9\s\-_.,!?@#$%^&*()+={}[\]|\\:";'<>?\/~`]*$/,
  enableRateLimiting: true,
  maxMessagesPerMinute: 60,
  enableContentFiltering: true,
  blockedPatterns: [
    /<script[^>]*>.*?<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi,
    /data:text\/html/gi,
  ],
};

/**
 * Input Validator with comprehensive security checks
 */
export class InputValidator {
  private config: SecurityConfig;
  
  constructor(config: SecurityConfig = DEFAULT_SECURITY_CONFIG) {
    this.config = config;
  }
  
  /**
   * Validate message content
   */
  validateMessageContent(content: string): {
    isValid: boolean;
    error?: string;
    sanitized?: string;
  } {
    if (!content || typeof content !== 'string') {
      return { isValid: false, error: 'Message content is required' };
    }
    
    if (content.length > this.config.maxMessageLength) {
      return { 
        isValid: false, 
        error: `Message too long. Max length: ${this.config.maxMessageLength}` 
      };
    }
    
    if (content.length === 0) {
      return { isValid: false, error: 'Message cannot be empty' };
    }
    
    // Check for blocked patterns
    if (this.config.enableContentFiltering) {
      for (const pattern of this.config.blockedPatterns) {
        if (pattern.test(content)) {
          return { 
            isValid: false, 
            error: 'Message contains blocked content' 
          };
        }
      }
    }
    
    // Sanitize content
    const sanitized = this.sanitizeContent(content);
    
    return { isValid: true, sanitized };
  }
  
  /**
   * Validate public key format
   */
  validatePublicKey(pubKey: string): {
    isValid: boolean;
    error?: string;
  } {
    if (!pubKey || typeof pubKey !== 'string') {
      return { isValid: false, error: 'Public key is required' };
    }
    
    // More flexible validation for GunDB public keys and epub keys
    // GunDB keys can be various lengths and formats
    if (pubKey.length < 20 || pubKey.length > 200) {
      return { isValid: false, error: 'Public key length invalid' };
    }
    
    // Allow more characters for epub keys (can include special characters)
    const flexibleKeyPattern = /^[A-Za-z0-9+/=_.-]+$/;
    if (!flexibleKeyPattern.test(pubKey)) {
      return { isValid: false, error: 'Invalid public key format' };
    }
    
    return { isValid: true };
  }
  
  /**
   * Validate username
   */
  validateUsername(username: string): {
    isValid: boolean;
    error?: string;
    sanitized?: string;
  } {
    if (!username || typeof username !== 'string') {
      return { isValid: false, error: 'Username is required' };
    }
    
    if (username.length > this.config.maxUsernameLength) {
      return { 
        isValid: false, 
        error: `Username too long. Max length: ${this.config.maxUsernameLength}` 
      };
    }
    
    if (username.length < 3) {
      return { isValid: false, error: 'Username too short. Min length: 3' };
    }
    
    // Username should only contain alphanumeric and basic symbols
    const usernamePattern = /^[a-zA-Z0-9_-]+$/;
    if (!usernamePattern.test(username)) {
      return { 
        isValid: false, 
        error: 'Username can only contain letters, numbers, underscores, and hyphens' 
      };
    }
    
    const sanitized = username.toLowerCase().trim();
    return { isValid: true, sanitized };
  }
  
  /**
   * Validate message data structure
   */
  validateMessageData(messageData: any): {
    isValid: boolean;
    error?: string;
    sanitized?: MessageData;
  } {
    if (!messageData || typeof messageData !== 'object') {
      return { isValid: false, error: 'Message data must be an object' };
    }
    
    // Validate required fields - be flexible for encrypted messages
    const requiredFields = ['from', 'timestamp', 'id'];
    for (const field of requiredFields) {
      if (!(field in messageData)) {
        return { isValid: false, error: `Missing required field: ${field}` };
      }
    }
    
    // For encrypted messages, content is in 'data' field, for unencrypted it's in 'content' field
    const hasContent = !!(messageData.content || messageData.data);
    if (!hasContent) {
      return { isValid: false, error: 'Missing required field: content or data' };
    }
    
    // Validate field types
    if (typeof messageData.from !== 'string') {
      return { isValid: false, error: 'Field "from" must be a string' };
    }
    
    // Validate content field - can be either 'content' (unencrypted) or 'data' (encrypted)
    if (messageData.content && typeof messageData.content !== 'string') {
      return { isValid: false, error: 'Field "content" must be a string' };
    }
    
    if (messageData.data && typeof messageData.data !== 'string') {
      return { isValid: false, error: 'Field "data" must be a string' };
    }
    
    if (typeof messageData.timestamp !== 'number') {
      return { isValid: false, error: 'Field "timestamp" must be a number' };
    }
    
    if (typeof messageData.id !== 'string') {
      return { isValid: false, error: 'Field "id" must be a string' };
    }
    
    // Validate public key
    const pubKeyValidation = this.validatePublicKey(messageData.from);
    if (!pubKeyValidation.isValid) {
      return { isValid: false, error: pubKeyValidation.error };
    }
    
    // Validate content - check both 'content' and 'data' fields
    const contentToValidate = messageData.content || messageData.data;
    let contentValidation: any = null;
    if (contentToValidate) {
      contentValidation = this.validateMessageContent(contentToValidate);
      if (!contentValidation.isValid) {
        return { isValid: false, error: contentValidation.error };
      }
    }
    
    // Create sanitized message
    const sanitized: MessageData = {
      from: messageData.from,
      content: contentValidation?.sanitized || messageData.content || messageData.data,
      timestamp: messageData.timestamp,
      id: messageData.id,
      signature: messageData.signature,
      roomId: messageData.roomId,
      isPublic: messageData.isPublic,
      groupId: messageData.groupId,
      isGroup: messageData.isGroup,
      isEncrypted: messageData.isEncrypted,
    };
    
    return { isValid: true, sanitized };
  }
  
  /**
   * Sanitize content by removing potentially dangerous characters
   */
  private sanitizeContent(content: string): string {
    return content
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
  }
}

/**
 * Rate Limiter to prevent spam and DoS attacks
 */
export class RateLimiter {
  private requests = new Map<string, number[]>();
  private config: SecurityConfig;
  
  constructor(config: SecurityConfig = DEFAULT_SECURITY_CONFIG) {
    this.config = config;
  }
  
  /**
   * Check if request is allowed
   */
  isAllowed(identifier: string): boolean {
    if (!this.config.enableRateLimiting) {
      return true;
    }
    
    const now = Date.now();
    const minuteAgo = now - 60000; // 1 minute ago
    
    // Get existing requests for this identifier
    const userRequests = this.requests.get(identifier) || [];
    
    // Remove old requests (older than 1 minute)
    const recentRequests = userRequests.filter(time => time > minuteAgo);
    
    // Check if under limit
    if (recentRequests.length >= this.config.maxMessagesPerMinute) {
      return false;
    }
    
    // Add current request
    recentRequests.push(now);
    this.requests.set(identifier, recentRequests);
    
    return true;
  }
  
  /**
   * Get remaining requests for identifier
   */
  getRemainingRequests(identifier: string): number {
    const now = Date.now();
    const minuteAgo = now - 60000;
    
    const userRequests = this.requests.get(identifier) || [];
    const recentRequests = userRequests.filter(time => time > minuteAgo);
    
    return Math.max(0, this.config.maxMessagesPerMinute - recentRequests.length);
  }
  
  /**
   * Clean up old entries
   */
  cleanup(): void {
    const now = Date.now();
    const minuteAgo = now - 60000;
    
    for (const [identifier, requests] of this.requests.entries()) {
      const recentRequests = requests.filter(time => time > minuteAgo);
      if (recentRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, recentRequests);
      }
    }
  }
}
