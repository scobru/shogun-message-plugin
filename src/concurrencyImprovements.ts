/**
 * Concurrency Improvements for GunDB Messaging Protocol
 * 
 * This file contains improvements to handle race conditions and concurrent operations
 */

import { MessageData } from './types';

/**
 * Async Lock implementation to prevent race conditions
 */
export class AsyncLock {
  private locks = new Map<string, Promise<void>>();
  
  async acquire(key: string): Promise<() => void> {
    // Wait for existing lock to be released
    while (this.locks.has(key)) {
      await this.locks.get(key);
    }
    
    // Create new lock
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    
    this.locks.set(key, lockPromise);
    
    return () => {
      this.locks.delete(key);
      release();
    };
  }
  
  async withLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(key);
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

/**
 * Message Deduplication with atomic operations
 */
export class AtomicMessageDeduplicator {
  private processedMessages = new Map<string, number>();
  private duplicateCache = new Map<string, boolean>();
  private lock = new AsyncLock();
  private maxSize: number;
  private ttl: number;
  
  constructor(maxSize: number = 1000, ttl: number = 300000) { // 5 minutes TTL
    this.maxSize = maxSize;
    this.ttl = ttl;
  }
  
  /**
   * Atomically check and mark message as processed
   */
  async isDuplicate(messageId: string): Promise<boolean> {
    return this.lock.withLock(`dedup_${messageId}`, async () => {
      const now = Date.now();
      
      // Check cache first
      if (this.duplicateCache.has(messageId)) {
        return this.duplicateCache.get(messageId) || false;
      }
      
      // Check processed messages
      const processedTime = this.processedMessages.get(messageId);
      if (processedTime && (now - processedTime) < this.ttl) {
        this.duplicateCache.set(messageId, true);
        return true;
      }
      
      // Mark as processed
      this.processedMessages.set(messageId, now);
      this.duplicateCache.set(messageId, false);
      
      // Cleanup if needed
      this.cleanupIfNeeded();
      
      return false;
    });
  }
  
  /**
   * Remove message from processed list (for retry scenarios)
   */
  async removeProcessed(messageId: string): Promise<void> {
    return this.lock.withLock(`dedup_${messageId}`, async () => {
      this.processedMessages.delete(messageId);
      this.duplicateCache.delete(messageId);
    });
  }
  
  /**
   * Cleanup expired entries
   */
  private cleanupIfNeeded(): void {
    const now = Date.now();
    
    // Cleanup processed messages
    for (const [messageId, timestamp] of this.processedMessages.entries()) {
      if (now - timestamp > this.ttl) {
        this.processedMessages.delete(messageId);
      }
    }
    
    // Cleanup cache
    for (const [messageId, isDuplicate] of this.duplicateCache.entries()) {
      if (!this.processedMessages.has(messageId)) {
        this.duplicateCache.delete(messageId);
      }
    }
    
    // Limit size
    if (this.processedMessages.size > this.maxSize) {
      const entries = Array.from(this.processedMessages.entries())
        .sort((a, b) => a[1] - b[1]); // Sort by timestamp
      
      const toRemove = entries.slice(0, entries.length - this.maxSize);
      for (const [messageId] of toRemove) {
        this.processedMessages.delete(messageId);
        this.duplicateCache.delete(messageId);
      }
    }
  }
  
  /**
   * Get statistics
   */
  getStats(): {
    processedCount: number;
    cacheSize: number;
    duplicatesCount: number;
  } {
    const duplicatesCount = Array.from(this.duplicateCache.values())
      .filter(Boolean).length;
    
    return {
      processedCount: this.processedMessages.size,
      cacheSize: this.duplicateCache.size,
      duplicatesCount,
    };
  }
}

/**
 * Concurrent Operation Manager
 */
export class ConcurrentOperationManager {
  private activeOperations = new Map<string, Promise<any>>();
  private maxConcurrent: number;
  private lock = new AsyncLock();
  
  constructor(maxConcurrent: number = 10) {
    this.maxConcurrent = maxConcurrent;
  }
  
  /**
   * Execute operation with concurrency control
   */
  async execute<T>(
    key: string,
    operation: () => Promise<T>,
    timeout: number = 30000
  ): Promise<T> {
    return this.lock.withLock(`concurrent_${key}`, async () => {
      // Check if operation is already running
      if (this.activeOperations.has(key)) {
        return this.activeOperations.get(key);
      }
      
      // Check concurrency limit
      if (this.activeOperations.size >= this.maxConcurrent) {
        throw new Error('Maximum concurrent operations reached');
      }
      
      // Create operation promise with timeout
      const operationPromise = Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Operation timeout')), timeout);
        }),
      ]);
      
      // Store operation
      this.activeOperations.set(key, operationPromise);
      
      try {
        const result = await operationPromise;
        return result;
      } finally {
        this.activeOperations.delete(key);
      }
    });
  }
  
  /**
   * Get active operations count
   */
  getActiveOperationsCount(): number {
    return this.activeOperations.size;
  }
  
  /**
   * Get active operation keys
   */
  getActiveOperationKeys(): string[] {
    return Array.from(this.activeOperations.keys());
  }
}

/**
 * Message Queue with priority and batching
 */
export class MessageQueue {
  private queue: Array<{
    message: MessageData;
    priority: number;
    timestamp: number;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];
  
  private processing = false;
  private batchSize: number;
  private batchTimeout: number;
  private batchTimer: NodeJS.Timeout | null = null;
  
  constructor(batchSize: number = 5, batchTimeout: number = 100) {
    this.batchSize = batchSize;
    this.batchTimeout = batchTimeout;
  }
  
  /**
   * Add message to queue
   */
  async enqueue(
    message: MessageData,
    priority: number = 0
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      this.queue.push({
        message,
        priority,
        timestamp: Date.now(),
        resolve,
        reject,
      });
      
      // Sort by priority (higher priority first)
      this.queue.sort((a, b) => b.priority - a.priority);
      
      this.scheduleProcessing();
    });
  }
  
  /**
   * Schedule batch processing
   */
  private scheduleProcessing(): void {
    if (this.processing) return;
    
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }
    
    this.batchTimer = setTimeout(() => {
      this.processBatch();
    }, this.batchTimeout);
  }
  
  /**
   * Process batch of messages
   */
  private async processBatch(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    
    this.processing = true;
    
    try {
      const batch = this.queue.splice(0, this.batchSize);
      
      // Process batch concurrently
      const promises = batch.map(async (item) => {
        try {
          const result = await this.processMessage(item.message);
          item.resolve(result);
        } catch (error) {
          item.reject(error);
        }
      });
      
      await Promise.allSettled(promises);
      
      // Schedule next batch if there are more messages
      if (this.queue.length > 0) {
        this.scheduleProcessing();
      }
    } finally {
      this.processing = false;
    }
  }
  
  /**
   * Process individual message (to be implemented by consumer)
   */
  private async processMessage(message: MessageData): Promise<any> {
    // This should be implemented by the consumer
    throw new Error('processMessage not implemented');
  }
  
  /**
   * Get queue statistics
   */
  getStats(): {
    queueLength: number;
    isProcessing: boolean;
    averagePriority: number;
  } {
    const averagePriority = this.queue.length > 0
      ? this.queue.reduce((sum, item) => sum + item.priority, 0) / this.queue.length
      : 0;
    
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      averagePriority,
    };
  }
}
