import { describe, it, expect } from "vitest";
import { generateRetryToken, getRetryDelay } from "@/lib/retry-utils";

describe("generateRetryToken", () => {
  it("returns a 64-character hex string", () => {
    const token = generateRetryToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("returns a different token each call", () => {
    expect(generateRetryToken()).not.toBe(generateRetryToken());
  });
});

describe("getRetryDelay", () => {
  it("backs off 30s, then 2min", () => {
    expect(getRetryDelay(0)).toBe(30_000);
    expect(getRetryDelay(1)).toBe(120_000);
  });

  it("exhausts after two failures", () => {
    expect(getRetryDelay(2)).toBe(-1);
    expect(getRetryDelay(10)).toBe(-1);
  });
});
