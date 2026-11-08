import { describe, expect, it } from "vitest";
import { ApprovalSession, compileRules, decide, evaluate, globToRegExp, urlMatches, type ToolCallDescriptor } from "../src/index.js";

const rules = compileRules(
  [
    { decision: "allow", command: "git status" },
    { decision: "allow", command: "git *" },
    { decision: "deny", command: "git push --force*" },
    { decision: "ask", executable: "curl" },
    { decision: "deny", path: "/etc/**" },
    { decision: "allow", url: "api.github.com" },
    { decision: "ask", tool: "web_search" },
    { decision: "allow", tool: "read" },
  ],
  "config",
);

describe("glob", () => {
  it("basic globs", () => {
    expect(globToRegExp("git *").test("git push origin main")).toBe(true);
    expect(globToRegExp("git *").test("rm -rf /")).toBe(false);
    expect(globToRegExp("*.ts").test("a/b.ts")).toBe(false);
    expect(globToRegExp("**/*.ts").test("a/b/c.ts")).toBe(true);
  });

  it("url allowlist semantics", () => {
    expect(urlMatches("api.github.com", "https://api.github.com/repos/x")).toBe(true);
    expect(urlMatches("github.com", "https://sub.github.com/x")).toBe(true);
    expect(urlMatches("github.com", "https://evilgithub.com/x")).toBe(false);
    expect(urlMatches("github.com/repos", "https://github.com/repos/x")).toBe(true);
    expect(urlMatches("github.com/repos", "https://github.com/gists/x")).toBe(false);
  });
});

describe("decide", () => {
  const call = (partial: Partial<ToolCallDescriptor> & { tool: string }) => partial as ToolCallDescriptor;

  it("exact command match", () => {
    expect(decide(call({ tool: "exec", command: ["git", "status"] }), rules).decision).toBe("allow");
  });

  it("worst wins: deny beats a broader allow", () => {
    const r = decide(call({ tool: "exec", command: ["git", "push", "--force", "main"] }), rules);
    expect(r.decision).toBe("deny");
    expect(r.rule?.command).toContain("force");
  });

  it("executable name matching", () => {
    expect(decide(call({ tool: "exec", command: ["curl", "https://x"] }), rules).decision).toBe("ask");
  });

  it("path globs", () => {
    expect(decide(call({ tool: "write", path: "/etc/passwd" }), rules).decision).toBe("deny");
    expect(decide(call({ tool: "write", path: "/home/user/f.txt" }), rules).decision).toBe("ask");
  });

  it("tool-wide rules", () => {
    expect(decide(call({ tool: "web_search" }), rules).decision).toBe("ask");
    expect(decide(call({ tool: "read" }), rules).decision).toBe("allow");
  });

  it("nothing matched fails closed → ask", () => {
    const r = decide(call({ tool: "exec", command: ["rm", "-rf", "/"] }), []);
    expect(r.decision).toBe("ask");
    expect(r.matched).toBe(false);
  });

  it("later rule breaks ties within a source", () => {
    const custom = compileRules(
      [
        { decision: "allow", tool: "deploy" },
        { decision: "ask", tool: "deploy", reason: "second thought" },
      ],
      "config",
    );
    expect(decide(call({ tool: "deploy" }), custom).decision).toBe("ask");
  });

  it("higher source breaks ties (cli over config)", () => {
    const config = compileRules([{ decision: "allow", tool: "deploy" }], "config");
    const cli = compileRules([{ decision: "deny", tool: "deploy" }], "cli", 100);
    expect(decide(call({ tool: "deploy" }), [...config, ...cli]).decision).toBe("deny");
  });
});

describe("approval session", () => {
  it("approved exact command auto-allows; others still ask", () => {
    const approvals = new ApprovalSession();
    approvals.approve({ tool: "exec", command: ["npm", "install"] });
    expect(evaluate({ tool: "exec", command: ["npm", "install"] }, [], approvals).via).toBe("approval");
    expect(evaluate({ tool: "exec", command: ["npm", "publish"] }, [], approvals).decision).toBe("ask");
  });

  it("pattern approvals cover repeated work", () => {
    const approvals = new ApprovalSession();
    approvals.approvePattern("exec", "npm run *");
    expect(evaluate({ tool: "exec", command: ["npm", "run", "test"] }, [], approvals).via).toBe("approval");
    expect(evaluate({ tool: "exec", command: ["npm", "init"] }, [], approvals).decision).toBe("ask");
  });

  it("path prefix approvals cover writes under a directory", () => {
    const approvals = new ApprovalSession();
    approvals.approvePathPrefix("/home/user/project");
    expect(evaluate({ tool: "write", path: "/home/user/project/a.ts" }, [], approvals).via).toBe("approval");
    expect(evaluate({ tool: "write", path: "/home/user/other/a.ts" }, [], approvals).decision).toBe("ask");
  });

  it("deny rules are absolute — approvals cannot override", () => {
    const approvals = new ApprovalSession();
    approvals.approve({ tool: "exec", command: ["git", "push", "--force"] });
    const r = evaluate({ tool: "exec", command: ["git", "push", "--force"] }, rules, approvals);
    expect(r.decision).toBe("deny");
  });
});
