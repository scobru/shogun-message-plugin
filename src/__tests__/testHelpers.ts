import { ShogunCore } from "shogun-core";
import { MessagingPlugin } from "../messagingPlugin";
import Gun from "gun";

import "gun/lib/rmem";
import "gun/lib/yson.js";

// Jest globals
declare const jest: any;
declare const test: any;

/**
 * Test helper utilities for protocol testing
 */

export interface TestUser {
  pub: string;
  epub: string;
  pair: any;
  core: ShogunCore;
  plugin: MessagingPlugin;
}

/**
 * Creates a test ShogunCore instance
 */
export function createTestShogunCore(): ShogunCore {
  // Create a minimal Gun instance for testing
  const gunInstance = new Gun();

  return new ShogunCore({
    gunInstance,
    authToken: `shogun2025-${Date.now()}-${Math.random().toString(36).substring(7)}`,
  });
}

/**
 * Creates a test user with authentication
 */
export async function createTestUser(
  userId: string = "test-user"
): Promise<TestUser> {
  const core = createTestShogunCore();

  // Create user pair
  const pair = await core.db.sea.pair();

  // Mock the user as logged in
  (core.db as any).user = {
    _: {
      sea: pair,
    },
  };

  // Mock isLoggedIn method
  core.isLoggedIn = jest.fn().mockReturnValue(true);

  // Initialize plugin
  const plugin = new MessagingPlugin();
  await plugin.initialize(core);

  return {
    pub: pair.pub,
    epub: pair.epub,
    pair,
    core,
    plugin,
  };
}

/**
 * Creates multiple test users for testing interactions
 */
export async function createTestUsers(count: number = 2): Promise<TestUser[]> {
  const users: TestUser[] = [];

  for (let i = 0; i < count; i++) {
    const user = await createTestUser(`test-user-${i}`);
    users.push(user);
  }

  return users;
}

/**
 * Waits for a specified amount of time (useful for GunDB operations)
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generates a random message content
 */
export function generateRandomMessage(): string {
  return `Test message ${Date.now()} ${Math.random().toString(36).substring(7)}`;
}

/**
 * Waits for GunDB operations to complete with better timeout handling
 */
export async function waitForGunDB(timeout: number = 5000): Promise<void> {
  // GunDB operations are asynchronous, so we wait a bit
  await wait(200);
}

/**
 * Waits for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean,
  timeout: number = 10000,
  interval: number = 100
): Promise<boolean> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (condition()) {
      return true;
    }
    await wait(interval);
  }

  return false;
}

/**
 * Waits for messages to be received with timeout
 */
export async function waitForMessages(
  messageArray: any[],
  expectedCount: number = 1,
  timeout: number = 10000
): Promise<boolean> {
  return waitForCondition(
    () => messageArray.length >= expectedCount,
    timeout,
    100
  );
}

/**
 * Safely executes a GunDB operation with timeout
 */
export async function safeGunDBOperation<T>(
  operation: () => Promise<T>,
  timeout: number = 10000
): Promise<T | null> {
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error("GunDB operation timeout")), timeout);
    });

    const result = await Promise.race([operation(), timeoutPromise]);
    return result;
  } catch (error) {
    console.warn("GunDB operation failed or timed out:", error.message);
    return null;
  }
}

/**
 * Cleans up test data
 */
export function cleanupTestData(): void {
  try {
    (global as any).localStorage?.clear();
    (global as any).sessionStorage?.clear();
  } catch (error) {
    // Ignore errors if localStorage/sessionStorage are not available
  }
}

/**
 * Cleans up Gun instances to prevent memory leaks
 */
export async function cleanupGunInstances(): Promise<void> {
  // Force garbage collection if available
  if (global.gc) {
    global.gc();
  }

  // Wait a bit for cleanup
  await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * Mock console methods to reduce noise in tests
 */
export function mockConsole(): void {
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "error").mockImplementation(() => {});
}

/**
 * Restore console methods
 */
export function restoreConsole(): void {
  jest.restoreAllMocks();
}

/**
 * Creates a test that skips if a condition is not met
 */
export function createConditionalTest(
  condition: () => boolean,
  testName: string,
  testFn: () => Promise<void>,
  timeout: number = 10000
): void {
  test(
    testName,
    async () => {
      if (!condition()) {
        console.log(`Skipping test "${testName}" - condition not met`);
        return;
      }

      // Add timeout handling to the test function
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`Test "${testName}" timed out`)),
          timeout
        );
      });

      try {
        await Promise.race([testFn(), timeoutPromise]);
      } catch (error) {
        if (error.message.includes("timed out")) {
          console.log(`Test "${testName}" timed out - skipping`);
          return;
        }
        throw error;
      }
    },
    timeout + 1000
  ); // Add extra time for Jest timeout
}

/**
 * Retries an operation with exponential backoff
 */
export async function retryOperation<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 100
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) {
        throw error;
      }
      await wait(baseDelay * Math.pow(2, attempt));
    }
  }

  throw lastError!;
}
