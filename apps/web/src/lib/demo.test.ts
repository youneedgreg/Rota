import { encodeInvite, newCircleSecret, newMemberSecret, publicKeyOf } from "@rota/records";
import { bytesToHex } from "@noble/hashes/utils.js";
import { describe, expect, it } from "vitest";
import { parseDemoLogin } from "./demo";

const member = newMemberSecret();
const invite = encodeInvite(newCircleSecret(), "ab".repeat(32));

describe("parseDemoLogin", () => {
  it("reads the member key and the circle's invite", () => {
    const login = parseDemoLogin(`#${bytesToHex(member)}.${invite}`);
    expect(login).toEqual({ secret: bytesToHex(member), pubkey: publicKeyOf(member), invite });
  });

  it("refuses broken links", () => {
    for (const bad of ["", invite, `${bytesToHex(member)}.`, `${bytesToHex(member)}.${invite}.extra`, `zz${bytesToHex(member).slice(2)}.${invite}`]) {
      expect(parseDemoLogin(bad), bad).toBeNull();
    }
    // Zero isn't a valid secp256k1 key.
    expect(parseDemoLogin(`${"0".repeat(64)}.${invite}`)).toBeNull();
  });
});
