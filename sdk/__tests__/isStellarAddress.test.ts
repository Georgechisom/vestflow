import { describe, it, expect } from "vitest";
import { isStellarAddress } from "../src/utils";

describe("isStellarAddress (#1088, #1107)", () => {
  it("returns true for a valid Stellar public key address", () => {
    const valid = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    expect(isStellarAddress(valid)).toBe(true);
  });

  it("returns false for an address with wrong prefix", () => {
    // Contract (C) prefix instead of Account (G) prefix
    const wrongPrefix = "CA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ";
    expect(isStellarAddress(wrongPrefix)).toBe(false);
  });

  it("returns false for an address that is too short", () => {
    const tooShort = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSG"; // 55 characters
    expect(isStellarAddress(tooShort)).toBe(false);
  });

  it("returns false for an address that is too long", () => {
    const tooLong = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZZ"; // 57 characters
    expect(isStellarAddress(tooLong)).toBe(false);
  });

  it("returns false for an address with invalid base32 characters", () => {
    // '1' and '8' are not part of RFC4648 base32
    const invalidBase32 = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVS18";
    expect(isStellarAddress(invalidBase32)).toBe(false);
  });

  it("returns false for an address with a bad checksum", () => {
    // Mutate the checksum while keeping length and valid base32 characters
    const badChecksum = "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGA";
    expect(isStellarAddress(badChecksum)).toBe(false);
  });

  it("returns false for non-string inputs", () => {
    expect(isStellarAddress(null)).toBe(false);
    expect(isStellarAddress(undefined)).toBe(false);
    expect(isStellarAddress(12345)).toBe(false);
    expect(isStellarAddress({})).toBe(false);
  });
});
