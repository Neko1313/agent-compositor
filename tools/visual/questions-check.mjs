import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.env.VISUAL_OUTPUT ?? "dist/visual-questions");
await mkdir(output, { recursive: true });
let server, browser, page;
const report = {
  checks: [],
  screenshots: [],
  errors: [],
  mode: process.env.VISUAL_EXECUTABLE ? "binary" : "source",
};
try {
  server = spawn("bun", ["tools/visual/server.mjs"], {
    env: { ...process.env, VISUAL_OUTPUT: output, VISUAL_QUESTIONS: "1" },
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
      const row = visual
        .text()
        .split("\n")
        .findIndex((s) => s.includes(text));
      const r = document.querySelector(".xterm-screen").getBoundingClientRect();
      return {
        x: r.x + (6.5 * r.width) / visual.terminal.cols,
        y: r.y + ((row + 0.5) * r.height) / visual.terminal.rows,
      };
    }, text);
    await page.mouse.click(p.x, p.y);
  };
  await wait("What would you like");
  await click("Describe your task");
  await page.keyboard.type("Configure project");
  await wait("Configure project");
  await page.keyboard.press("Enter");
  await wait("Where should the application run?");
  await wait("Preview changes before publishing.");
  await capture("01-single-choice.png");
  await click("2) Production");
  await wait("● 2) Production");
  await click("[ Next ]");
  await wait("Which checks should run?");
  await click("1) Unit tests");
  await click("2) Browser tests");
  await wait("[✓] 2) Browser tests");
  await click("Other /");
  await page.keyboard.type("Load tests");
  await wait("Your answer: Load tests");
  await click("[ Back ]");
  await wait("● 2) Production");
  await click("[ Next ]");
  await wait("Your answer: Load tests");
  report.checks.push(
    "mouse radio/checkbox choices, custom answer and Back retain drafts",
  );
  const before = await page.evaluate(() => visual.frames);
  await page.evaluate(() => visual.terminal.resize(60, 32));
  await page.waitForFunction(
    (before) =>
      visual.frames > before &&
      visual.text().includes("Which checks should run?") &&
      visual.text().includes("Your answer: Load tests"),
    before,
  );
  await capture("02-narrow-multiple-choice.png");
  await click("[ Next ]");
  await wait("Any additional instructions?");
  await page.keyboard.type("Keep public API stable");
  await wait("Your answer: Keep public API stable");
  await page.keyboard.press("Enter");
  await wait("Review 3 answers");
  await capture("03-review.png");
  report.checks.push("narrow reflow, free text and explicit review");
  // Edit an earlier answer through the real terminal mouse, then return to review.
  await click("1. Deploy target");
  await wait("Where should the application run?");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  await wait("Which checks should run?");
  await click("[ Next ]");
  await wait("Any additional instructions?");
  await page.keyboard.press("Enter");
  await wait("Review 3 answers");
  const wideFrame = await page.evaluate(() => visual.frames);
  await page.evaluate(() => visual.terminal.resize(120, 40));
  await page.waitForFunction(
    (before) =>
      visual.frames > before &&
      visual.terminal.buffer.active
        .getLine(39)
        ?.translateToString(true)
        .includes("Esc cancel") &&
      visual.text().includes("Review 3 answers"),
    wideFrame,
  );
  await click("[ Submit answers ]");
  await wait("Questionnaire received");
  await wait("Keep public API stable");
  await wait("notify-done: turn complete");
  const screen = await page.evaluate(() => visual.text());
  await writeFile(resolve(output, "screen.txt"), screen);
  for (const label of [
    "Staging",
    "Unit tests",
    "Browser tests",
    "Load tests",
    "Keep public API stable",
  ])
    if (!screen.includes(label))
      throw Error("Missing returned answer " + label);
  report.checks.push(
    "edit earlier answer, submit one structured result to model",
  );
  await capture("04-result.png");
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
