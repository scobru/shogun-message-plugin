import { sendToGunDB } from "../utils";

type Ack = { err?: string };

describe("sendToGunDB", () => {
  const makeCore = () => {
    const acks: Ack[] = [];
    const put = jest.fn((_data: any, cb: (ack: Ack) => void) => {
      const ack = acks.shift() ?? {};
      cb(ack);
    });
    const get = jest.fn(() => ({ get: jest.fn(() => ({ put })) }));
    const core: any = {
      db: {
        gun: {
          get,
        },
      },
      isLoggedIn: () => true,
    };
    return { core, get, put, acks };
  };

  test("resolves on success and uses safe path for private", async () => {
    const { core, get, put } = makeCore();
    await expect(
      sendToGunDB(core, "recipientPubKey", "msg1", { a: 1 }, "private"),
    ).resolves.toBeUndefined();
    expect(get).toHaveBeenCalled();
    expect(put).toHaveBeenCalled();
  });

  test("resolves on success and prefixes public rooms with room_", async () => {
    const { core, get } = makeCore();
    await expect(
      sendToGunDB(core, "lobby", "msg2", { a: 1 }, "public"),
    ).resolves.toBeUndefined();
    // first call path starts with room_
    const pathArg = (get.mock.calls[0] && get.mock.calls[0][0]) as string;
    expect(pathArg).toMatch(/^room_/);
  });

  test("rejects when ack.err present", async () => {
    const { core, acks } = makeCore();
    acks.push({ err: "boom" });
    await expect(
      sendToGunDB(core, "recipient", "msg3", { a: 1 }, "private"),
    ).rejects.toThrow(/boom/);
  });

  test("throws when core/gun not initialized", async () => {
    await expect(
      // @ts-expect-error
      sendToGunDB({}, "x", "y", {}, "private"),
    ).rejects.toThrow(/not initialized/);
  });
});
