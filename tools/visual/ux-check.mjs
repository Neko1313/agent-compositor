import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.env.VISUAL_OUTPUT ?? "dist/visual-ux");
await mkdir(output, { recursive: true });
const report = {
  checks: [],
  screenshots: [],
  viewports: [],
  errors: [],
  mode: process.env.VISUAL_EXECUTABLE ? "binary" : "source",
};
let server, browser, page;
try {
  server = spawn("bun", ["tools/visual/server.mjs"], {
    env: { ...process.env, VISUAL_OUTPUT: output, VISUAL_UX: "1" },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const url = await new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(
      () => fail(Error("UX visual server timeout")),
      15000,
    );
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
      fail(Error(`UX visual server exit ${code}`));
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
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(url);
  const wait = (text) =>
    page.waitForFunction((text) => window.visual?.text().includes(text), text, {
      timeout: 15000,
    });
  const absent = (text) =>
    page.waitForFunction((text) => !visual.text().includes(text), text, {
      timeout: 15000,
    });
  const screen = () => page.evaluate(() => visual.text());
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const capture = async (name) => {
    await page.screenshot({ path: resolve(output, name) });
    report.screenshots.push(name);
    report.viewports.push(
      await page.evaluate(() => ({
        cols: visual.terminal.cols,
        rows: visual.terminal.rows,
      })),
    );
    await writeFile(
      resolve(output, name.replace(".png", ".txt")),
      await screen(),
    );
  };
  const resize = async (cols, rows) => {
    const before = await page.evaluate(() => visual.frames);
    await page.evaluate(
      ({ cols, rows }) => visual.terminal.resize(cols, rows),
      { cols, rows },
    );
    await page.waitForFunction(
      ({ before, cols, rows }) =>
        visual.frames > before &&
        visual.terminal.cols === cols &&
        visual.terminal.rows === rows &&
        visual.terminal.buffer.active
          .getLine(rows - 1)
          ?.translateToString(true)
          .trim(),
      { before, cols, rows },
      { timeout: 15000 },
    );
  };
  const click = async (text) => {
    await wait(text);
    const point = await page.evaluate((text) => {
      const lines = visual.text().split("\n"),
        row = lines.findIndex((line) => line.includes(text));
      const col = lines[row].indexOf(text) + Math.min(2, text.length - 1);
      const rect = document
        .querySelector(".xterm-screen")
        .getBoundingClientRect();
      return {
        x: rect.x + ((col + 0.5) * rect.width) / visual.terminal.cols,
        y: rect.y + ((row + 0.5) * rect.height) / visual.terminal.rows,
      };
    }, text);
    await page.mouse.click(point.x, point.y);
  };
  const submit = async (text) => {
    await page.keyboard.press("Alt+i");
    await page.keyboard.type(text);
    await wait(`› ${text}`);
    await page.keyboard.press("Enter");
  };
  const approvalChrome = async () => {
    for (const text of [
      "Approval required",
      "Approval needed",
      "Tool: exec",
      "Y allow once",
      "A allow for session",
      "P allow for project",
      "N deny",
    ])
      await wait(text);
  };

  await wait("What would you like");
  await wait("Todos");
  await wait("Ghost");
  await capture("01-wide.png");
  await resize(80, 24);
  await wait("Ghost");
  await wait("Todos");
  await capture("02-compact.png");
  await resize(60, 24);
  await wait("hidden");
  await capture("03-narrow.png");
  const titles = ["Conversation", "Ghost", "Todos"];
  const initial = await screen();
  const hidden = titles.filter((title) => !initial.includes(title));
  check(
    hidden.length > 0,
    "Narrow layout must hide a pane instead of fragmenting every pane",
  );
  await click("Conversation");
  // Wait for the actual focus result; animation frames are not input acknowledgments.
  await page.keyboard.press("Alt+ArrowRight");
  await wait("Ghost");
  const afterFocus = await screen();
  const reached = hidden.find((title) => afterFocus.includes(title));
  check(reached, "Alt+direction must reveal a previously hidden pane");
  await capture("04-hidden-pane-focused.png");
  await page.keyboard.press("Alt+f");
  await wait("FULLSCREEN");
  const fullscreenTitles = titles.filter(
    (title) => initial.includes(title) || hidden.includes(title),
  );
  const full = await screen();
  check(
    fullscreenTitles.filter((title) => full.includes(title)).length === 1,
    "Fullscreen must show one content pane",
  );
  await page.keyboard.press("Alt+i");
  await wait("FULLSCREEN");
  check(
    (await screen()).includes(reached),
    "Focusing the composer must retain fullscreen content",
  );
  await capture("05-fullscreen-composer.png");
  await page.keyboard.press("Alt+f");
  await absent("FULLSCREEN");
  await resize(100, 30);
  await wait("Todos");
  await wait("Ghost");
  report.checks.push(
    "100x30, 80x24 and 60x24 readable projection, hidden-pane directional focus, fullscreen composer focus and wide restoration",
  );

  await click("[Settings]");
  await wait("Models & providers");
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  await wait("Edit connection");
  await capture("06-provider-action.png");
  await page.keyboard.press("Enter");
  await wait("Edit provider");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Enter");
  await absent("Settings form active");
  await wait("Models & providers");
  await page.keyboard.press("Alt+q");
  await absent("Models & providers");
  report.checks.push(
    "Five unique provider actions are navigable; offscreen Edit connection opens a native form and Shift+Tab/Enter cancels",
  );

  await submit("Preview a long action");
  await approvalChrome();
  await wait("PREFIX_REVIEW");
  await capture("07-approval-prefix.png");
  await page.keyboard.press("End");
  await approvalChrome();
  await wait("SUFFIX_REVIEW");
  await capture("08-approval-suffix.png");
  await page.keyboard.press("Home");
  await approvalChrome();
  await wait("PREFIX_REVIEW");
  // Always deny; even this print-only fixture command never runs.
  await page.keyboard.type("n");
  await wait("Permission review complete.");
  await absent("Approval required");
  report.checks.push(
    "Long exec approval retains tool identity and every scope at both scroll ends; n denies without executing the shell",
  );

  await submit("/theme mono");
  await wait("mono");
  await submit("/history");
  await wait("Chat history");
  await wait("current");
  await page.waitForFunction(()=>visual.text().split('\n')[visual.terminal.rows-2]?.includes('Ready'));
  const selected=await page.evaluate(()=>{const b=visual.terminal.buffer.active;for(let y=0;y<visual.terminal.rows;y++){const line=b.getLine(y);for(let x=0;x<visual.terminal.cols;x++){const c=line?.getCell(x);if(c?.isBgRGB()&&c.getBgColor()===0xb8b8b8&&c.getChars().trim())return {fg:c.getFgColor(),bg:c.getBgColor(),rgb:c.isFgRGB()};}}});
  check(selected?.rgb&&selected.fg===0x101010&&selected.bg===0xb8b8b8,'Mono selection must use explicit readable RGB, independent of bold ANSI palette');
  await capture("09-mono-history.png");
  check(
    (await screen()).includes("Preview a long action"),
    "History must retain a readable current-chat preview",
  );
  report.checks.push(
    "Monochrome theme preserves readable selected current history and its preview",
  );
} catch (error) {
  report.errors.push(String(error));
  if (page) {
    await page
      .screenshot({ path: resolve(output, "failure.png") })
      .catch(() => {});
    await writeFile(
      resolve(output, "failure.txt"),
      await page.evaluate(() => window.visual?.text() ?? ""),
    ).catch(() => {});
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exited = new Promise((done) => server.once("exit", done));
    server.kill("SIGTERM");
    await exited;
  }
  report.ok = !report.errors.length;
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode = 1;
}
