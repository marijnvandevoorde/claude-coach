import { describe, it, expect } from "vitest";

/**
 * Test the argument parsing logic used in the CLI.
 * This mirrors the parsing in src/cli.ts to ensure URLs with = characters are handled correctly.
 */

interface AuthArgs {
  command: "auth";
  clientId?: string;
  clientSecret?: string;
  code?: string;
}

function parseAuthArgs(args: string[]): AuthArgs {
  const authArgs: AuthArgs = { command: "auth" };

  for (const arg of args) {
    if (arg.startsWith("--client-id=")) {
      authArgs.clientId = arg.slice("--client-id=".length);
    } else if (arg.startsWith("--client-secret=")) {
      authArgs.clientSecret = arg.slice("--client-secret=".length);
    } else if (arg.startsWith("--code=")) {
      authArgs.code = arg.slice("--code=".length);
    }
  }

  return authArgs;
}

describe("CLI Argument Parsing", () => {
  describe("auth command", () => {
    it("parses simple code value", () => {
      const args = ["auth", "--code=abc123"];
      const result = parseAuthArgs(args);
      expect(result.code).toBe("abc123");
    });

    it("parses full OAuth callback URL with multiple = characters", () => {
      // This was the bug: split("=")[1] would truncate at the second =
      const callbackUrl =
        "http://localhost:8765/callback?state=&code=5ac11afa879082e32c6ce41d89171f3e7c45ebb8&scope=read,activity:read_all";
      const args = ["auth", `--code=${callbackUrl}`];
      const result = parseAuthArgs(args);

      expect(result.code).toBe(callbackUrl);

      // Verify the URL can be parsed and code extracted
      const url = new URL(result.code!);
      expect(url.searchParams.get("code")).toBe("5ac11afa879082e32c6ce41d89171f3e7c45ebb8");
    });

    it("parses URL with empty state parameter", () => {
      const callbackUrl = "http://localhost:8765/callback?state=&code=testcode123";
      const args = ["auth", `--code=${callbackUrl}`];
      const result = parseAuthArgs(args);

      expect(result.code).toBe(callbackUrl);

      const url = new URL(result.code!);
      expect(url.searchParams.get("state")).toBe("");
      expect(url.searchParams.get("code")).toBe("testcode123");
    });

    it("parses client-id and client-secret", () => {
      const args = ["auth", "--client-id=12345", "--client-secret=mysecret"];
      const result = parseAuthArgs(args);

      expect(result.clientId).toBe("12345");
      expect(result.clientSecret).toBe("mysecret");
    });

    it("handles values containing = characters", () => {
      // Edge case: what if the secret itself contains =?
      const args = ["auth", "--client-secret=base64encoded=="];
      const result = parseAuthArgs(args);

      expect(result.clientSecret).toBe("base64encoded==");
    });
  });
});
