// Polyfills for tests running in Node
if (!(global as any).crypto?.getRandomValues) {
  const nodeCrypto = require("crypto");
  (global as any).crypto = {
    getRandomValues: (arr: Uint8Array) => {
      const buf = nodeCrypto.randomBytes(arr.length);
      arr.set(buf);
      return arr;
    },
  };
}

if (!(global as any).window) {
  (global as any).window = { location: { origin: "http://localhost" } };
}
