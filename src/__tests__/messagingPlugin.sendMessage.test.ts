import { MessagingPlugin } from "../messagingPlugin";

// Minimal ShogunCore mock shape for sendMessage flow
function makeCoreMock() {
  const currentUserPair = { pub: "sender_pub", epub: "sender_epub" };

  const put = jest.fn((_data: any, cb: (ack: any) => void) => cb({}));
  const get = jest.fn(() => ({ get: jest.fn(() => ({ put })) }));

  const user = { _?: { sea: currentUserPair } } as any;

  const sea = {
    sign: jest.fn(async (_data: string, _pair: any) => "signed"),
    secret: jest.fn(async (_epub: string, _pair: any) => "shared_secret"),
    encrypt: jest.fn(async (_msg: any, _secret: string) => "enc"),
    verify: jest.fn(async () => true),
  };

  const crypto = {
    secret: jest.fn(async () => "shared_secret"),
    encrypt: jest.fn(async () => "enc"),
    decrypt: jest.fn(async () => JSON.stringify({})),
  };

  const gun = {
    get,
    user: jest.fn(() => ({ get: jest.fn(() => ({ once: jest.fn() })) })),
  } as any;

  const core: any = {
    db: { gun, user, sea, crypto },
    isLoggedIn: () => true,
  };

  return { core, get, put, sea, crypto };
}

// Crypto.getRandomValues polyfill for Node if needed by other utils during runtime
if (!(global as any).crypto?.getRandomValues) {
  const nodeCrypto = require("node:crypto");
  (global as any).crypto = {
    getRandomValues: (arr: Uint8Array) => {
      const buf = nodeCrypto.randomBytes(arr.length);
      arr.set(buf);
      return arr;
    },
  };
}

// window.origin usage by some utils
if (!(global as any).window) {
  (global as any).window = { location: { origin: "http://localhost" } };
}

describe("MessagingPlugin.sendMessage", () => {
  test("fails when not logged in or missing inputs", async () => {
    const { core } = makeCoreMock();
    core.isLoggedIn = () => false;
    const plugin = new MessagingPlugin();
    plugin.initialize(core as any);

    // not logged in
    let res = await plugin.sendMessage("recipient_pub", "hi");
    expect(res.success).toBe(false);

    // logged in but missing inputs
    core.isLoggedIn = () => true;
    // @ts-expect-error
    res = await plugin.sendMessage(undefined, "");
    expect(res.success).toBe(false);
  });

  test("succeeds and calls GunDB put once happy path", async () => {
    const { core, put, sea } = makeCoreMock();

    // Stub encryptionManager.getRecipientEpub via class prototype
    // We intercept after initialize has created the instance
    const plugin = new MessagingPlugin();
    plugin.initialize(core as any);
    // Override private method dependency by monkey patching instance
    // @ts-ignore
    plugin["encryptionManager"].getRecipientEpub = jest
      .fn()
      .mockResolvedValue("recipient_epub");

    const res = await plugin.sendMessage("recipient_pub", "hello");
    expect(res.success).toBe(true);
    expect(typeof res.messageId).toBe("string");

    expect(sea.sign).toHaveBeenCalled();
    expect(sea.secret).toHaveBeenCalled();
    expect(sea.encrypt).toHaveBeenCalled();
    expect(put).toHaveBeenCalled();
  });
});
