/** Glob → RegExp. Supports `*` (within segment), `?`, and `**` (any depth). */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**/` or bare `**` crosses path separators
        if (glob[i + 2] === "/") {
          re += "(?:[^/]+/)*";
          i += 3;
          continue;
        }
        re += ".*";
        i += 2;
        continue;
      }
      re += "[^/]*";
      i += 1;
      continue;
    }
    if (c === "?") {
      re += "[^/]";
      i += 1;
      continue;
    }
    if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
      i += 1;
      continue;
    }
    re += c;
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

/** URL allowlist semantics (opencode webfetch): bare domain matches the domain
 *  and any of its subdomains; a path prefix narrows the match. */
export function urlMatches(rule: string, url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const ruleHasPath = rule.includes("/");
  const host = ruleHasPath ? rule.slice(0, rule.indexOf("/")) : rule;
  const pathPrefix = ruleHasPath ? rule.slice(rule.indexOf("/")) : "/";
  const hostOk = parsed.host === host || parsed.host.endsWith("." + host);
  if (!hostOk) return false;
  if (pathPrefix === "/") return true;
  return parsed.pathname.startsWith(pathPrefix);
}
