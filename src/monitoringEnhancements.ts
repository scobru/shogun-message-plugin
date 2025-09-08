/**
 * Monitoring and Observability Enhancements for GunDB Messaging Protocol
 * 
 * This file contains monitoring, metrics, and health check improvements
 */

import { MessageData } from './types';

export interface ProtocolMetrics {
  // Message metrics
  messagesSent: number;
  messagesReceived: number;
  messagesFailed: number;
  messagesDropped: number;
  
  // Performance metrics
  averageEncryptionTime: number;
  averageDecryptionTime: number;
  averageNetworkLatency: number;
  averageProcessingTime: number;
  
  // Error metrics
  encryptionErrors: number;
  decryptionErrors: number;
  networkErrors: number;
  validationErrors: number;
  
  // Resource metrics
  memoryUsage: number;
  cacheHitRate: number;
  duplicateRate: number;
  
  // Timestamps
  lastMessageSent: number;
  lastMessageReceived: number;
  lastError: number;
  uptime: number;
}

export interface HealthStatus {
  isHealthy: boolean;
  status: 'healthy' | 'degraded' | 'unhealthy';
  issues: string[];
  components: {
    encryption: boolean;
    network: boolean;
    storage: boolean;
    processing: boolean;
  };
  metrics: ProtocolMetrics;
  timestamp: number;
}

/**
 * Advanced Metrics Collector
 */
export class MetricsCollector {
  private metrics: ProtocolMetrics;
  private startTime: number;
  private encryptionTimes: number[] = [];
  private decryptionTimes: number[] = [];
  private networkLatencies: number[] = [];
  private processingTimes: number[] = [];
  private maxSamples: number = 100;
  
  constructor() {
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();
  }
  
  private initializeMetrics(): ProtocolMetrics {
    return {
      messagesSent: 0,
      messagesReceived: 0,
      messagesFailed: 0,
      messagesDropped: 0,
      averageEncryptionTime: 0,
      averageDecryptionTime: 0,
      averageNetworkLatency: 0,
      averageProcessingTime: 0,
      encryptionErrors: 0,
      decryptionErrors: 0,
      networkErrors: 0,
      validationErrors: 0,
      memoryUsage: 0,
      cacheHitRate: 0,
      duplicateRate: 0,
      lastMessageSent: 0,
      lastMessageReceived: 0,
      lastError: 0,
      uptime: 0,
    };
  }
  
  /**
   * Record message sent
   */
  recordMessageSent(): void {
    this.metrics.messagesSent++;
    this.metrics.lastMessageSent = Date.now();
  }
  
  /**
   * Record message received
   */
  recordMessageReceived(): void {
    this.metrics.messagesReceived++;
    this.metrics.lastMessageReceived = Date.now();
  }
  
  /**
   * Record message failed
   */
  recordMessageFailed(): void {
    this.metrics.messagesFailed++;
    this.metrics.lastError = Date.now();
  }
  
  /**
   * Record message dropped
   */
  recordMessageDropped(): void {
    this.metrics.messagesDropped++;
  }
  
  /**
   * Record encryption time
   */
  recordEncryptionTime(time: number): void {
    this.encryptionTimes.push(time);
    if (this.encryptionTimes.length > this.maxSamples) {
      this.encryptionTimes.shift();
    }
    this.metrics.averageEncryptionTime = this.calculateAverage(this.encryptionTimes);
  }
  
  /**
   * Record decryption time
   */
  recordDecryptionTime(time: number): void {
    this.decryptionTimes.push(time);
    if (this.decryptionTimes.length > this.maxSamples) {
      this.decryptionTimes.shift();
    }
    this.metrics.averageDecryptionTime = this.calculateAverage(this.decryptionTimes);
  }
  
  /**
   * Record network latency
   */
  recordNetworkLatency(latency: number): void {
    this.networkLatencies.push(latency);
    if (this.networkLatencies.length > this.maxSamples) {
      this.networkLatencies.shift();
    }
    this.metrics.averageNetworkLatency = this.calculateAverage(this.networkLatencies);
  }
  
  /**
   * Record processing time
   */
  recordProcessingTime(time: number): void {
    this.processingTimes.push(time);
    if (this.processingTimes.length > this.maxSamples) {
      this.processingTimes.shift();
    }
    this.metrics.averageProcessingTime = this.calculateAverage(this.processingTimes);
  }
  
  /**
   * Record encryption error
   */
  recordEncryptionError(): void {
    this.metrics.encryptionErrors++;
    this.metrics.lastError = Date.now();
  }
  
  /**
   * Record decryption error
   */
  recordDecryptionError(): void {
    this.metrics.decryptionErrors++;
    this.metrics.lastError = Date.now();
  }
  
  /**
   * Record network error
   */
  recordNetworkError(): void {
    this.metrics.networkErrors++;
    this.metrics.lastError = Date.now();
  }
  
  /**
   * Record validation error
   */
  recordValidationError(): void {
    this.metrics.validationErrors++;
    this.metrics.lastError = Date.now();
  }
  
  /**
   * Update memory usage
   */
  updateMemoryUsage(): void {
    if (typeof performance !== 'undefined' && (performance as any).memory) {
      this.metrics.memoryUsage = (performance as any).memory.usedJSHeapSize;
    }
  }
  
  /**
   * Update cache hit rate
   */
  updateCacheHitRate(hits: number, total: number): void {
    this.metrics.cacheHitRate = total > 0 ? (hits / total) * 100 : 0;
  }
  
  /**
   * Update duplicate rate
   */
  updateDuplicateRate(duplicates: number, total: number): void {
    this.metrics.duplicateRate = total > 0 ? (duplicates / total) * 100 : 0;
  }
  
  /**
   * Get current metrics
   */
  getMetrics(): ProtocolMetrics {
    this.metrics.uptime = Date.now() - this.startTime;
    this.updateMemoryUsage();
    return { ...this.metrics };
  }
  
  /**
   * Reset metrics
   */
  reset(): void {
    this.startTime = Date.now();
    this.metrics = this.initializeMetrics();
    this.encryptionTimes = [];
    this.decryptionTimes = [];
    this.networkLatencies = [];
    this.processingTimes = [];
  }
  
  private calculateAverage(times: number[]): number {
    if (times.length === 0) return 0;
    return times.reduce((sum, time) => sum + time, 0) / times.length;
  }
}

/**
 * Health Check System
 */
export class HealthChecker {
  private metricsCollector: MetricsCollector;
  private lastHealthCheck: number = 0;
  private healthCheckInterval: number = 30000; // 30 seconds
  
  constructor(metricsCollector: MetricsCollector) {
    this.metricsCollector = metricsCollector;
  }
  
  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<HealthStatus> {
    const now = Date.now();
    const metrics = this.metricsCollector.getMetrics();
    
    const issues: string[] = [];
    const components = {
      encryption: true,
      network: true,
      storage: true,
      processing: true,
    };
    
    // Check encryption health
    if (metrics.encryptionErrors > 0) {
      const errorRate = (metrics.encryptionErrors / (metrics.messagesSent + metrics.messagesReceived)) * 100;
      if (errorRate > 5) { // More than 5% error rate
        issues.push(`High encryption error rate: ${errorRate.toFixed(2)}%`);
        components.encryption = false;
      }
    }
    
    // Check network health
    if (metrics.networkErrors > 0) {
      const errorRate = (metrics.networkErrors / (metrics.messagesSent + metrics.messagesReceived)) * 100;
      if (errorRate > 10) { // More than 10% error rate
        issues.push(`High network error rate: ${errorRate.toFixed(2)}%`);
        components.network = false;
      }
    }
    
    // Check processing health
    if (metrics.averageProcessingTime > 5000) { // More than 5 seconds
      issues.push(`High average processing time: ${metrics.averageProcessingTime.toFixed(2)}ms`);
      components.processing = false;
    }
    
    // Check memory usage
    if (metrics.memoryUsage > 100 * 1024 * 1024) { // More than 100MB
      issues.push(`High memory usage: ${(metrics.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
    }
    
    // Check duplicate rate
    if (metrics.duplicateRate > 20) { // More than 20% duplicates
      issues.push(`High duplicate rate: ${metrics.duplicateRate.toFixed(2)}%`);
    }
    
    // Check if system is responsive
    const timeSinceLastMessage = now - Math.max(metrics.lastMessageSent, metrics.lastMessageReceived);
    if (timeSinceLastMessage > 300000 && (metrics.messagesSent + metrics.messagesReceived) > 0) { // 5 minutes
      issues.push('System appears unresponsive - no messages in 5 minutes');
    }
    
    // Determine overall health status
    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (issues.length === 0) {
      status = 'healthy';
    } else if (issues.length <= 2 && components.encryption && components.network) {
      status = 'degraded';
    } else {
      status = 'unhealthy';
    }
    
    return {
      isHealthy: status === 'healthy',
      status,
      issues,
      components,
      metrics,
      timestamp: now,
    };
  }
  
  /**
   * Start periodic health checks
   */
  startPeriodicHealthChecks(callback: (status: HealthStatus) => void): void {
    setInterval(async () => {
      const status = await this.performHealthCheck();
      callback(status);
    }, this.healthCheckInterval);
  }
}

/**
 * Performance Profiler
 */
export class PerformanceProfiler {
  private profiles = new Map<string, {
    startTime: number;
    endTime?: number;
    duration?: number;
    metadata?: any;
  }>();
  
  /**
   * Start profiling an operation
   */
  startProfile(operationId: string, metadata?: any): void {
    this.profiles.set(operationId, {
      startTime: performance.now(),
      metadata,
    });
  }
  
  /**
   * End profiling an operation
   */
  endProfile(operationId: string): number | null {
    const profile = this.profiles.get(operationId);
    if (!profile) return null;
    
    const endTime = performance.now();
    const duration = endTime - profile.startTime;
    
    profile.endTime = endTime;
    profile.duration = duration;
    
    return duration;
  }
  
  /**
   * Get profile results
   */
  getProfile(operationId: string): {
    duration: number;
    metadata?: any;
  } | null {
    const profile = this.profiles.get(operationId);
    if (!profile || !profile.duration) return null;
    
    return {
      duration: profile.duration,
      metadata: profile.metadata,
    };
  }
  
  /**
   * Get all profiles
   */
  getAllProfiles(): Array<{
    operationId: string;
    duration: number;
    metadata?: any;
  }> {
    return Array.from(this.profiles.entries())
      .filter(([_, profile]) => profile.duration !== undefined)
      .map(([operationId, profile]) => ({
        operationId,
        duration: profile.duration!,
        metadata: profile.metadata,
      }));
  }
  
  /**
   * Clear profiles
   */
  clearProfiles(): void {
    this.profiles.clear();
  }
}
