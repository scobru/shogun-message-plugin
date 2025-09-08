/**
 * Performance Optimizations for GunDB Messaging Protocol
 * 
 * This file contains recommended optimizations to improve the protocol's performance
 */

// Define MessageData interface for the pool
interface MessageData {
  id: string;
  from: string;
  content: string;
  timestamp: number;
}

export interface PerformanceOptimizations {
  // Memory Management
  enableMemoryPooling: boolean;
  maxCacheSize: number;
  cacheCleanupInterval: number;
  
  // Message Processing
  enableRxJS: boolean;
  batchSize: number;
  processingChunkSize: number;
  
  // Network Optimization
  enableCompression: boolean;
  maxConcurrentOperations: number;
  requestTimeout: number;
}

export const RECOMMENDED_PERFORMANCE_CONFIG: PerformanceOptimizations = {
  // Memory Management
  enableMemoryPooling: true,
  maxCacheSize: 500, // Reduced from 1000
  cacheCleanupInterval: 15000, // 15 seconds instead of 30
  
  // Message Processing
  enableRxJS: true, // Re-enable RxJS
  batchSize: 5, // Process 5 messages at once
  processingChunkSize: 3, // Keep current chunk size
  
  // Network Optimization
  enableCompression: true,
  maxConcurrentOperations: 5, // Reduced from 10
  requestTimeout: 8000, // 8 seconds
};

/**
 * Memory Pool for Message Objects
 * Reduces GC pressure by reusing objects
 */
export class MessageObjectPool {
  private pool: MessageData[] = [];
  private maxSize: number;
  
  constructor(maxSize: number = 100) {
    this.maxSize = maxSize;
  }
  
  acquire(): MessageData {
    return this.pool.pop() || this.createNew();
  }
  
  release(message: MessageData): void {
    if (this.pool.length < this.maxSize) {
      this.resetMessage(message);
      this.pool.push(message);
    }
  }
  
  private createNew(): MessageData {
    return {
      from: '',
      content: '',
      timestamp: 0,
      id: '',
    };
  }
  
  private resetMessage(message: MessageData): void {
    message.from = '';
    message.content = '';
    message.timestamp = 0;
    message.id = '';
  }
}

/**
 * Optimized Cache with LRU eviction
 */
export class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }
  
  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxSize) {
      // Remove least recently used (first item)
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }
  
  has(key: K): boolean {
    return this.cache.has(key);
  }
  
  delete(key: K): boolean {
    return this.cache.delete(key);
  }
  
  clear(): void {
    this.cache.clear();
  }
  
  size(): number {
    return this.cache.size;
  }
}

/**
 * Message Compression Utility
 */
export class MessageCompressor {
  private static readonly COMPRESSION_THRESHOLD = 1024; // 1KB
  
  static shouldCompress(message: string): boolean {
    return message.length > this.COMPRESSION_THRESHOLD;
  }
  
  static compress(message: string): string {
    // Simple compression - in production use proper compression library
    if (!this.shouldCompress(message)) {
      return message;
    }
    
    // For now, return as-is. In production, implement actual compression
    return `COMPRESSED:${message}`;
  }
  
  static decompress(compressedMessage: string): string {
    if (compressedMessage.startsWith('COMPRESSED:')) {
      return compressedMessage.substring(11);
    }
    return compressedMessage;
  }
}
