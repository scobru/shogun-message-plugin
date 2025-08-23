module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.ts", "**/?(*.)+(spec|test).ts"],
  // Ignore non-test helpers and TypeScript declaration files being picked up as tests
  testPathIgnorePatterns: [
    "/node_modules/",
    "\\.d\\.ts$",
    "/__tests__/setup\\.jest\\.ts$",
    "/__tests__/testHelpers\\.ts$",
  ],
  transform: {
    "^.+\\.ts$": "ts-jest",
  },
  setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.jest.ts"],
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/*.d.ts",
    "!src/**/*.test.ts",
    "!src/**/*.spec.ts",
  ],
};
