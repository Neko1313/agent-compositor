import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.env.VISUAL_OUTPUT ?? "dist/visual-history");
await mkdir(output, { recursive: true });
let server, browser, page;
const report = {
  checks: [],
  screenshots: [],
  errors: [],
  mode: process.env.VISUAL_EXECUTABLE ? "binary" : "source",
  startup: process.env.VISUAL_START_HISTORY ? "--resume" : "/history",
};
try {
  server = spawn("bun", ["tools/visual/server.mjs"], {
    env: { ...process.env, VISUAL_OUTPUT: output, VISUAL_HISTORY: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(Error("Server timeout")), 15000);
    server.stdout.on("data", (chunk) => {
      text += chunk;
      const match = text.match(/VISUAL_URL=(http[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        done(match[1]);
      }
    });
    server.once("exit", (code) => {
      clearTimeout(timer);
      fail(Error("Server exit " + code));
    });
  });
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(url);
  const wait = (text) =>
    page.waitForFunction((text) => window.visual?.text().includes(text), text, {
      timeout: 15000,
    });
  const capture = async (name) => {
    await page.screenshot({ path: resolve(output, name) });
    report.screenshots.push(name);
  };
  const click = async (text) => {
    await wait(text);
    const p = await page.evaluate((text) => {
      const lines = visual.text().split("\n");
      const row = lines.findIndex((s) => s.includes(text));
      const col = lines[row].indexOf(text) + Math.min(3, text.length - 1);
      const r = document.querySelector(".xterm-screen").getBoundingClientRect();
      return {
        x: r.x + ((col + 0.5) * r.width) / visual.terminal.cols,
        y: r.y + ((row + 0.5) * r.height) / visual.terminal.rows,
      };
    }, text);
    await page.mouse.click(p.x, p.y);
  };
  if (!process.env.VISUAL_START_HISTORY) {
    await wait("What would you like");
    await click("Describe your task");
    await page.keyboard.type("/history");
    await wait("/history");
    await page.keyboard.press("Enter");
  }
  await wait("History · 11 chats");
  await wait("Search: Title, ID");
  await capture("01-history.png");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("PageDown");
  await wait("Preview · history-");
  report.checks.push("keyboard selection and paging through persisted chats");
  await page.keyboard.type("legacy callback marker");
  await wait("History · 1 chats");
  await wait("Authentication repair");
  await wait("Login behavior verified");
  await capture("02-content-search.png");
  report.checks.push(
    "live search matches an earlier conversation body without a model request",
  );
  const before = await page.evaluate(() => visual.frames);
  await page.evaluate(() => visual.terminal.resize(60, 34));
  await page.waitForFunction(
    (before) =>
      visual.frames > before &&
      visual.terminal.buffer.active
        .getLine(33)
        ?.translateToString(true)
        .includes("Type search"),
    before,
  );
  await wait("Login behavior verified");
  await capture("03-narrow.png");
  await click("[ Rename selected chat ]");
  await wait("Rename chat");
  await page.keyboard.press("Control+u");
  await page.keyboard.type("Login regression fix");
  await wait("Login regression fix");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await wait("Search: legacy callback marker");
  await wait("Login regression fix");
  report.checks.push("native rename form preserves the active filter");
  await page.keyboard.press("Control+u");
  await wait("Search: Title, ID");
  await wait("History · 11 chats");
  await click("[ Archived: hidden ]");
  await wait("Archived experiment");
  await wait("History · 12 chats");
  report.checks.push("archived filter is available by mouse");
  await page.keyboard.type("legacy callback marker");
  await wait("Search: legacy callback marker");
  await wait("History · 1 chats");
  await click("[ Resume selected chat ]");
  await wait("Inspect login regression");
  await wait("Login behavior verified");
  await page.waitForFunction(() => !visual.text().includes("Chat history"));
  await click("Describe your task");
  await page.keyboard.type("Continue the saved chat");
  await wait("Continue the saved chat");
  await page.keyboard.press("Enter");
  await wait("History continued:");
  await wait("notify-done: turn complete");
  report.checks.push(
    "resume restores saved transcript and the next request uses that history",
  );
  await page.keyboard.type("/resume");
  await wait("/resume");
  await page.keyboard.press("Enter");
  await wait("Chat history");
  await wait("Login regression fix");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !visual.text().includes("Chat history"));
  report.checks.push(
    "bare /resume opens history; Escape returns to the prompt",
  );
  await capture("04-resumed.png");
  await writeFile(
    resolve(output, "screen.txt"),
    await page.evaluate(() => visual.text()),
  );
} catch (error) {
  report.errors.push(String(error));
  if (page)
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
} finally {
  await browser?.close();
  if (server) {
    server.kill("SIGTERM");
    await new Promise((r) => server.once("exit", r));
  }
  report.ok = !report.errors.length;
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
