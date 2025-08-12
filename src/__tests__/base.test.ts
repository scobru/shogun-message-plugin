import { BasePlugin } from "../base";

// Test implementation of BasePlugin
class TestPlugin extends BasePlugin {
  name = "test-plugin";
  version = "1.0.0";
  description = "Test plugin for testing BasePlugin functionality";
  _category = "test";
}

describe("BasePlugin", () => {
  let plugin: TestPlugin;
  let mockCore: any;

  beforeEach(() => {
    plugin = new TestPlugin();
    mockCore = {
      db: { gun: {} },
      isLoggedIn: () => true,
    };
  });

  describe("Initialization", () => {
    test("should initialize plugin successfully", () => {
      plugin.initialize(mockCore);

      expect(plugin.isInitialized()).toBe(true);
    });

    test("should store core reference", () => {
      plugin.initialize(mockCore);

      expect((plugin as any).core).toBe(mockCore);
    });

    test("should set initialized flag", () => {
      plugin.initialize(mockCore);

      expect((plugin as any).initialized).toBe(true);
    });
  });

  describe("Destroy", () => {
    test("should destroy plugin successfully", () => {
      plugin.initialize(mockCore);
      plugin.destroy();

      expect(plugin.isInitialized()).toBe(false);
      expect((plugin as any).core).toBeNull();
      expect((plugin as any).initialized).toBe(false);
    });

    test("should handle destroy when not initialized", () => {
      plugin.destroy();

      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe("isInitialized", () => {
    test("should return false when not initialized", () => {
      expect(plugin.isInitialized()).toBe(false);
    });

    test("should return true when initialized", () => {
      plugin.initialize(mockCore);

      expect(plugin.isInitialized()).toBe(true);
    });

    test("should return false after destroy", () => {
      plugin.initialize(mockCore);
      plugin.destroy();

      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe("assertInitialized", () => {
    test("should not throw when initialized", () => {
      plugin.initialize(mockCore);

      expect(() => (plugin as any).assertInitialized()).not.toThrow();
    });

    test("should throw when not initialized", () => {
      expect(() => (plugin as any).assertInitialized()).toThrow(
        "Plugin test-plugin is not initialized"
      );
    });

    test("should throw when destroyed", () => {
      plugin.initialize(mockCore);
      plugin.destroy();

      expect(() => (plugin as any).assertInitialized()).toThrow(
        "Plugin test-plugin is not initialized"
      );
    });
  });

  describe("Plugin Properties", () => {
    test("should have correct name", () => {
      expect(plugin.name).toBe("test-plugin");
    });

    test("should have correct version", () => {
      expect(plugin.version).toBe("1.0.0");
    });

    test("should have correct description", () => {
      expect(plugin.description).toBe(
        "Test plugin for testing BasePlugin functionality"
      );
    });

    test("should have correct category", () => {
      expect(plugin._category).toBe("test");
    });
  });

  describe("Multiple Initialization", () => {
    test("should handle multiple initialize calls", () => {
      const core1 = { db: { gun: {} }, isLoggedIn: () => true };
      const core2 = { db: { gun: {} }, isLoggedIn: () => false };

      plugin.initialize(core1);
      expect(plugin.isInitialized()).toBe(true);
      expect((plugin as any).core).toBe(core1);

      plugin.initialize(core2);
      expect(plugin.isInitialized()).toBe(true);
      expect((plugin as any).core).toBe(core2);
    });
  });

  describe("Multiple Destroy", () => {
    test("should handle multiple destroy calls", () => {
      plugin.initialize(mockCore);
      plugin.destroy();
      expect(plugin.isInitialized()).toBe(false);

      plugin.destroy();
      expect(plugin.isInitialized()).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    test("should handle null core", () => {
      plugin.initialize(null as any);

      expect(plugin.isInitialized()).toBe(true);
      expect((plugin as any).core).toBeNull();
    });

    test("should handle undefined core", () => {
      plugin.initialize(undefined as any);

      expect(plugin.isInitialized()).toBe(true);
      expect((plugin as any).core).toBeUndefined();
    });

    test("should handle empty object core", () => {
      const emptyCore = {};
      plugin.initialize(emptyCore as any);

      expect(plugin.isInitialized()).toBe(true);
      expect((plugin as any).core).toBe(emptyCore);
    });
  });
});
