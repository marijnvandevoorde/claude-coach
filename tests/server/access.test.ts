import { describe, it, expect } from "vitest";
import { emailAllowed, allowedEmails } from "../../src/server/access.js";

describe("coach-app access allowlist", () => {
  it("allows any authenticated email when no allowlist is set", () => {
    delete process.env.COACH_OAUTH_ALLOWED_EMAILS;
    expect(emailAllowed("anyone@example.com")).toBe(true);
  });

  it("enforces the allowlist case-insensitively", () => {
    process.env.COACH_OAUTH_ALLOWED_EMAILS = "Me@Example.com, other@x.com";
    expect(emailAllowed("me@example.com")).toBe(true);
    expect(emailAllowed("  OTHER@x.com ")).toBe(true);
    expect(emailAllowed("nope@x.com")).toBe(false);
    expect(allowedEmails()).toEqual(["me@example.com", "other@x.com"]);
    delete process.env.COACH_OAUTH_ALLOWED_EMAILS;
  });
});
