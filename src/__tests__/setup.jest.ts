// Jest setup file for protocol tests

// Mock global objects that might not be available in test environment
if (!global.gc) {
  global.gc = async () => {};
}

// Mock crypto if not available
if (!global.crypto) {
  global.crypto = {
    getRandomValues: (array: Uint8Array) => {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
      return array;
    },
  } as any;
}

// Mock localStorage if not available
if (typeof localStorage === "undefined") {
  const localStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };
  global.localStorage = localStorageMock as any;
}

// Mock sessionStorage if not available
if (typeof sessionStorage === "undefined") {
  const sessionStorageMock = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
  };
  global.sessionStorage = sessionStorageMock as any;
}

// Increase timeout for all tests
jest.setTimeout(30000);

// Suppress console output during tests unless there's an error
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeAll(() => {
  // Suppress console output during tests
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  // Restore console output
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});
