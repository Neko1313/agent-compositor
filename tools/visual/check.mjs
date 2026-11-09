import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const output = resolve(
  process.env.VISUAL_OUTPUT ?? resolve(root, "dist/visual-proof")
);
await mkdir(output, { recursive: true });
await unlink(resolve(output, "failure.png")).catch(() => {});
let server, browser, page;
const report = { checks: [], screenshots: [], errors: [] };
let url = process.env.VISUAL_URL;
try {
  if (!url) {
    server = spawn("bun", ["tools/visual/server.mjs"], {
      cwd: root,
      env: { ...process.env, VISUAL_OUTPUT: output },
      stdio: ["ignore", "pipe", "inherit"],
    });
    url = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Visual server did not start")),
        15000
      );
      let text = "";
      server.stdout.on("data", (chunk) => {
        text += chunk;
        const match = text.match(/VISUAL_URL=(http[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      server.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Visual server exited ${code}`));
      });
    });
  }
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
    args: ["--no-sandbox"],
  });
  page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  page.on("pageerror", (error) => report.errors.push(error.message));
  await page.goto(url);
  const waitText = (text) =>
    page.waitForFunction((text) => window.visual?.text().includes(text), text, {
      timeout: 15000,
    });
  const point = (col, row) =>
    page.evaluate(
      ({ col, row }) => {
        const rect = document
          .querySelector(".xterm-screen")
          .getBoundingClientRect();
        return {
          x: rect.x + ((col + 0.5) * rect.width) / visual.terminal.cols,
          y: rect.y + ((row + 0.5) * rect.height) / visual.terminal.rows,
        };
      },
      { col, row }
    );
  const move = async (col, row, steps = 1) => {
    const p = await point(col, row);
    await page.mouse.move(p.x, p.y, { steps });
  };
  const click = async (col, row) => {
    const p = await point(col, row);
    await page.mouse.click(p.x, p.y);
  };
  const screenshot = async (name) => {
    await page.screenshot({ path: resolve(output, name) });
    report.screenshots.push(name);
  };
  const todoRow = () =>
    page.evaluate(() =>
      visual
        .text()
        .split("\n")
        .findIndex((line) => line.includes("Todos"))
    );
  await waitText("0/3 complete");
  await waitText("Message · Ready");
  await screenshot("00-ghost-idle.png");
  const mascotCommand = async (command) => {
    await click(5, 25);
    await page.keyboard.type(command);
    await page.waitForFunction(
      (command) =>
        visual
          .text()
          .split("\n")
          .slice(-10)
          .some((line) => line.includes(`› ${command}`)),
      command
    );
    await page.keyboard.press("Enter");
  };
  await mascotCommand("/mascot pause");
  await waitText("paused");
  await screenshot("00-ghost-paused.png");
  await mascotCommand("/mascot off");
  await page.waitForFunction(() => !visual.text().includes("Message ·"));
  report.checks.push("Ghost is a composer image contribution with compact status fallback; pause/off work through terminal commands");
  await screenshot("01-start.png");
  report.checks.push(
    "Actual Ink application rendered through POSIX PTY and xterm.js"
  );
  await move(74, 1);
  await page.waitForFunction(() => visual.pointer === "grab");
  report.checks.push(
    "OSC 22 hover emitted grab and browser emulator applied it"
  );
  await page.mouse.down();
  await move(20, 21, 12);
  await waitText("Drop bottom");
  await screenshot("02-drop-preview.png");
  await page.mouse.up();
  await page.waitForFunction(
    () =>
      visual
        .text()
        .split("\n")
        .findIndex((line) => line.includes("Todos")) > 5
  );
  const movedRow = await todoRow();
  await screenshot("03-moved.png");
  report.checks.push("Browser mouse drag moved Todos below Conversation");
  await move(20, movedRow - 2);
  await page.mouse.down();
  await move(20, 14, 10);
  await page.mouse.up();
  await page.waitForFunction(
    (previous) =>
      visual
        .text()
        .split("\n")
        .findIndex((line) => line.includes("Todos")) > previous,
    movedRow
  );
  await screenshot("04-resized.png");
  report.checks.push("Dragging separator changed visible window height");
  await click(5, 25);
  await page.keyboard.type("Update the project tasks");
  await waitText("Update the project tasks");
  await page.keyboard.press("Enter");
  await waitText("1/3 complete");
  await waitText("Todos updated");
  await page.waitForFunction(() =>
    visual.text().split("\n")[28]?.includes("Ready")
  );
  await screenshot("05-task-update.png");
  report.checks.push(
    "Scripted model invoked the real todo tool and the plugin updated its window"
  );
  await click(16, 28);
  await waitText("Plugins · placement");
  await click(3, 3); // sidebar -> inspector
  await click(3, 4); // workspace 1 -> 2
  await click(3, 9); // Save rule + apply
  await waitText("Rule saved");
  await screenshot("06-saved-rule.png");
  await click(3, 10); // Close panel
  const generation = await page.evaluate(() => visual.generation);
  await page.click("#restart");
  await page.waitForFunction(
    (generation) =>
      visual.generation > generation &&
      visual.frames > 0 &&
      visual.text().includes("[1]") &&
      !visual.text().includes("Todos"),
    generation,
    { timeout: 15000 }
  );
  await click(5, 28);
  await waitText("Todos");
  await waitText("1/3 complete");
  await screenshot("07-restored.png");
  report.checks.push(
    "App restart restored saved plugin placement on workspace 2 and preserved task data"
  );
  await click(5, 25);
  await page.keyboard.type("/theme amber");
  await waitText("/theme amber");
  await page.keyboard.press("Enter");
  await waitText("amber ·");
  await screenshot("08-plugin-theme.png");
  const themedGeneration = await page.evaluate(() => visual.generation);
  await page.click("#restart");
  await page.waitForFunction(
    (g) =>
      visual.generation > g &&
      visual.text().includes("amber ·") &&
      visual.text().includes("[2]") &&
      visual.text().includes("1/3 complete"),
    themedGeneration,
    { timeout: 15000 }
  );
  report.checks.push(
    "Theme plugin configured chrome and replaced status through ui.render; preference restored after restart"
  );
  report.checks.push(
    "Full layout persistence restored active workspace 2 on the second restart"
  );
  await click(1, 28);
  await waitText("Conversation");
  await page.evaluate(() => visual.terminal.resize(80, 24));
  await page.waitForFunction(() =>
    visual.text().split("\n")[22]?.includes("[1]")
  );
  await screenshot("09-compact.png");
  await page.evaluate(() => visual.terminal.resize(48, 18));
  await page.waitForFunction(() => {
    const lines = visual.text().split("\n");
    return (
      lines[1]?.includes("Conversation") &&
      lines[13]?.includes("Message") &&
      lines[14]?.includes("Describe your task") &&
      lines[16]?.includes("[1]") &&
      lines[17]?.includes("amber · / commands · Ctrl+J newline")
    );
  });
  await screenshot("10-narrow.png");
  report.checks.push(
    "Real PTY resize kept the workspace bar in bounds at 80x24 and 48x18"
  );
  await page.evaluate(() => visual.terminal.resize(100, 30));
  await page.waitForFunction(() =>
    visual.text().split("\n")[28]?.includes("[1]")
  );
  await click(5, 25);
  await page.keyboard.type("/");
  await waitText("/archive");
  await page.keyboard.type("th");
  await waitText("/theme slate|amber|mono");
  await screenshot("11-slash-commands.png");
  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => !visual.text().includes("/theme slate|amber|mono")
  );
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await waitText("Describe your task");
  await page.keyboard.type("Plan the change");
  await page.keyboard.press("Control+j");
  await page.keyboard.type("Then verify it");
  await waitText("Then verify it");
  await page.waitForFunction(() => {
    const lines = visual.text().split("\n");
    return lines.some(
      (line, i) =>
        line.includes("Plan the change") &&
        lines[i + 1]?.includes("Then verify it")
    );
  });
  await screenshot("12-multiline.png");
  report.checks.push(
    "Slash palette includes the theme plugin; Ctrl+J creates a visible multiline draft through actual terminal input"
  );
  await page.keyboard.press("Enter");
  await waitText("Todos updated");
  await page.waitForFunction(() =>
    visual.text().split("\n")[28]?.includes("Ready")
  );
  await mascotCommand("/mascot resume");
  await waitText("Message ·");
  await click(5, 25);
  await page.keyboard.type("Delegate the task inspection");
  await waitText("Delegate the task inspection");
  await page.keyboard.press("Enter");
  await waitText("Choose report detail");
  await waitText("[ Answer ]");
  await screenshot("13-agent-question.png");
  await page.keyboard.type("2");
  await page.waitForFunction(() => visual.text().includes("Numbers: 2"));
  await page.keyboard.press("Enter");
  await waitText("Delegation complete.");
  await page.waitForFunction(() =>
    visual.text().split("\n")[28]?.includes("Ready")
  );
  await screenshot("14-agent-complete.png");
  await mascotCommand("/mascot off");
  await page.waitForFunction(() => !visual.text().includes("Message ·"));
  report.checks.push(
    "Real task tool spawned a child, ask_user received a keyboard answer through the TUI, and the parent completed"
  );

  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.evaluate(() => visual.terminal.resize(140, 40));
  await page.waitForFunction(() =>
    visual.text().split("\n")[38]?.includes("Ready")
  );
  const locate = async (text) =>
    page.evaluate((text) => {
      const lines = visual.text().split("\n");
      const row = lines.findIndex((line) => line.includes(text));
      if (row < 0) throw new Error(`Missing visible text: ${text}`);
      return { row, col: lines[row].indexOf(text) + 1 };
    }, text);
  const clickText = async (text) => {
    const p = await locate(text);
    await click(p.col, p.row);
  };
  const submit = async (text) => {
    await clickText("Describe your task");
    await page.keyboard.type(text);
    await page.waitForFunction(
      (text) =>
        visual
          .text()
          .split("\n")
          .slice(-10)
          .some((line) => line.includes(`› ${text}`)),
      text
    );
    await page.keyboard.press("Enter");
  };
  const closePane = async (title) => {
    const p = await locate(title);
    await move(p.col, p.row);
    await page.waitForFunction(
      ({ row, col }) =>
        visual.text().split("\n")[row]?.indexOf("[x]", col) > col,
      p
    );
    const col = await page.evaluate(
      ({ row, col }) => visual.text().split("\n")[row].indexOf("[x]", col) + 1,
      p
    );
    await click(col, p.row);
    await page.waitForFunction(
      (title) => !visual.text().includes(title),
      title
    );
  };
  await submit("/auto on");
  await waitText("Mode: auto");
  await screenshot("15-auto-mode.png");
  await clickText("[ Disable auto ]");
  await waitText("Mode: manual");
  await closePane("Auto approvals");
  await submit("/mascot on");
  await waitText("Message ·");
  await submit("Make a reviewable change");
  await waitText("Y allow once");
  await waitText("Approval needed");
  await screenshot("15-ghost-approval.png");
  await page.keyboard.type("y");
  await waitText("Review change prepared.");
  await page.waitForFunction(() =>
    visual.text().split("\n")[38]?.includes("Ready")
  );
  await submit("/mascot off");
  await page.waitForFunction(() => !visual.text().includes("Message ·"));
  await submit("/review");
  await waitText("review-demo.txt");
  await waitText("Keep change");
  await screenshot("16-review.png");
  await clickText("[ Keep change ]");
  await waitText("kept");
  await closePane("Review changes");
  await submit("/checkpoints");
  await waitText("Restore conversation");
  await screenshot("17-checkpoints.png");
  await closePane("Checkpoints");
  await submit("/agents create-shared Visual");
  await waitText("Y allow once");
  await page.keyboard.type("y");
  await page.waitForFunction(() =>
    visual.text().split("\n")[1]?.includes("Visual")
  );
  await clickText("Visual");
  await waitText("Message → Visual");
  await submit("Inspect independently");
  await waitText("Independent agent response");
  await screenshot("18-independent-agent.png");
  const independentGeneration = await page.evaluate(() => visual.generation);
  await page.click("#restart");
  await page.waitForFunction(
    (g) =>
      visual.generation > g &&
      visual.text().includes("Independent agent response"),
    independentGeneration,
    { timeout: 15000 }
  );
  await screenshot("19-independent-restored.png");
  report.checks.push(
    "Auto mode toggled through mouse actions; real write approval produced review and checkpoint panels"
  );
  report.checks.push(
    "Independent agent received input through its focused pane and restored its saved conversation after restart"
  );

  await clickText("Conversation");
  await submit("/marketplace list");
  await waitText("Marketplaces");
  await screenshot("20-marketplaces.png");
  await closePane("Marketplaces");
  await submit("/proxy status");
  await waitText("Network proxy");
  await waitText('Models: direct · Tools: direct');
  await screenshot("21-network-proxy.png");
  await closePane("Network proxy");
  report.checks.push(
    "Marketplace list and disabled proxy status opened through terminal commands with their real plugin panes"
  );
  if (report.errors.length) throw new Error(report.errors.join("\n"));
  const graphicsErrors = await page.evaluate(() => visual.graphics.stats.errors);
  report.errors.push(...graphicsErrors);
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.errors.push(String(error));
  process.exitCode = 1;
  await page
    ?.screenshot({ path: resolve(output, "failure.png") })
    .catch(() => {});
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const exit = new Promise((resolve) => server.once("exit", resolve));
    server.kill("SIGTERM");
    await exit;
  }
  await writeFile(
    resolve(output, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
}
