import {
  generateMessageId,
  generateGroupId,
  createSafePath,
  simpleHash,
  createConversationId,
  limitMapSize,
  cleanupExpiredEntries,
  generateInviteLink,
  generateSecureToken,
} from "../utils";

describe("utils", () => {
  test("generateMessageId returns unique ids with expected format", () => {
    const id1 = generateMessageId();
    const id2 = generateMessageId();
    expect(id1).toMatch(/^msg_\d+_[a-z0-9]+$/);
    expect(id2).toMatch(/^msg_\d+_[a-z0-9]+$/);
    expect(id1).not.toEqual(id2);
  });

  test("generateGroupId returns timestamp_random format", () => {
    const id = generateGroupId();
    expect(id).toMatch(/^\d+_[a-z0-9]+$/);
  });

  test("simpleHash is deterministic and returns base36 string", () => {
    const input = "some-public-key";
    const h1 = simpleHash(input);
    const h2 = simpleHash(input);
    expect(h1).toEqual(h2);
    expect(h1).toMatch(/^[a-z0-9]+$/);
  });

  test("createSafePath builds prefix_hash and validates input", () => {
    const pub = "pub_123456";
    const expected = `msg_${simpleHash(pub)}`;
    expect(createSafePath(pub)).toEqual(expected);
    const custom = `room_${simpleHash(pub)}`;
    expect(createSafePath(pub, "room")).toEqual(custom);
    // invalid input
    // @ts-expect-error
    expect(() => createSafePath(undefined)).toThrow(/Invalid public key/);
  });

  test("createConversationId sorts inputs for stable id", () => {
    const a = "alice_pub";
    const b = "bob_pub";
    expect(createConversationId(a, b)).toEqual("alice_pub_bob_pub");
    expect(createConversationId(b, a)).toEqual("alice_pub_bob_pub");
  });

  test("limitMapSize trims oldest entries to max size", () => {
    const m = new Map<string, number>();
    for (let i = 0; i < 10; i++) m.set(String(i), i);
    limitMapSize(m, 5);
    expect(m.size).toBe(5);
    // Oldest keys removed first (0..4 removed)
    for (let i = 0; i < 5; i++) expect(m.has(String(i))).toBe(false);
    for (let i = 5; i < 10; i++) expect(m.has(String(i))).toBe(true);
  });

  test("cleanupExpiredEntries removes entries older than ttl", () => {
    const now = Date.now();
    const m = new Map<string, number>([
      ["fresh", now - 100],
      ["old", now - 10_000],
    ]);
    cleanupExpiredEntries(m, 1_000);
    expect(m.has("fresh")).toBe(true);
    expect(m.has("old")).toBe(false);
  });

  test("generateInviteLink builds URL with params", () => {
    (global as any).window = { location: { origin: "http://localhost" } };
    const url = generateInviteLink("public", "room-1", "Lobby", "tok123");
    expect(url).toBe(
      "http://localhost/chat-invite/public/room-1?name=Lobby&token=tok123"
    );
  });

  test("generateSecureToken returns 64 hex chars", () => {
    // Ensure crypto.getRandomValues is available in Node
    expect(typeof crypto.getRandomValues).toBe("function");
    const token = generateSecureToken();
    expect(token).toMatch(/^[a-f0-9]{64}$/);
  });
});
