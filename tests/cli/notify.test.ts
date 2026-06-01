import { describe, it, expect } from "vitest";
import { resolveNotify } from "../../src/lib/notify.js";

describe("resolveNotify", () => {
  it("auto picks webhook when a URL is configured", () => {
    const r = resolveNotify({ channel: "auto", webhookUrl: "https://ha/x" }, "linux");
    expect(r.channel).toBe("webhook");
    expect(r.webhookUrl).toBe("https://ha/x");
  });

  it("auto falls back to macOS on darwin without a webhook", () => {
    const r = resolveNotify({ channel: "auto", webhookUrl: null }, "darwin");
    expect(r.channel).toBe("macos");
    expect(r.webhookUrl).toBeNull();
  });

  it("auto falls back to stdout off-darwin without a webhook", () => {
    const r = resolveNotify({ channel: "auto", webhookUrl: null }, "linux");
    expect(r.channel).toBe("stdout");
  });

  it("honors an explicit webhook channel", () => {
    const r = resolveNotify({ channel: "webhook", webhookUrl: "https://ha/x" }, "darwin");
    expect(r.channel).toBe("webhook");
  });

  it("explicit macOS ignores any webhook URL", () => {
    const r = resolveNotify({ channel: "macos", webhookUrl: "https://ha/x" }, "darwin");
    expect(r.channel).toBe("macos");
    expect(r.webhookUrl).toBeNull();
  });

  it("honors an explicit stdout channel", () => {
    const r = resolveNotify({ channel: "stdout", webhookUrl: "https://ha/x" }, "darwin");
    expect(r.channel).toBe("stdout");
  });

  it("is case-insensitive and treats unknown/empty channels as auto", () => {
    expect(resolveNotify({ channel: "WEBHOOK", webhookUrl: "u" }, "linux").channel).toBe("webhook");
    expect(resolveNotify({ channel: "bogus", webhookUrl: "u" }, "linux").channel).toBe("webhook");
    expect(resolveNotify({ channel: null, webhookUrl: null }, "darwin").channel).toBe("macos");
  });
});
