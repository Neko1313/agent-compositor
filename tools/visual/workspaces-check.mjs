import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.env.VISUAL_OUTPUT ?? "dist/visual-web-workspaces");
await mkdir(output, { recursive: true });
let server, browser, page;
const report = {
  checks: [],
  screenshots: [],
  errors: [],
  mode: process.env.VISUAL_EXECUTABLE ? "binary" : "source",
  scenario:"Internet and multiple projects",
};
try {
  server = spawn("bun", ["tools/visual/server.mjs"], {
    env: { ...process.env, VISUAL_OUTPUT: output, VISUAL_WORKSPACES: "1" },
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
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
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
  const send=async text=>{await page.keyboard.type(text);await wait(text);await page.keyboard.press('Enter');};
  await wait('Describe your task');await click('Describe your task');
  await page.keyboard.type('Inspect @~/proj');await wait('@~/proj-api/');await capture('01-home-directory-completion.png');
  await page.keyboard.press('Tab');await wait('Inspect @~/proj-api/');await page.keyboard.press('Enter');
  await wait('Directory reference verified');report.checks.push('home directory completion and Enter attaches the selected directory rather than choosing a child file');
  await send('Read @"~/other project/notes.txt"');await wait('Quoted home file reference verified');await capture('02-quoted-external-file.png');
  await send('Read attached project using tools');await wait('Attached project tool read verified');
  await send('/workspace');await wait('Attached paths:');await capture('03-attached-projects.png');
  report.checks.push('quoted external file, read tool across projects and workspace command');
  await send('Find internet proof');await wait('Internet source verified:');await capture('04-internet-search-and-fetch.png');
  report.checks.push('real tool chain searches and reads a source through isolated loopback HTTP');
  const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();
  await page.waitForFunction(g=>visual.generation>g,generation);await wait('Describe your task');await click('Describe your task');
  await send('/history');await wait('History ·');await click('Inspect @~/proj-api/');await wait('You: Inspect @~/proj-api/');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!visual.text().includes('Chat history'));await wait('Describe your task');await click('Describe your task');
  await send('Read attached project after restart');await wait('Restored attached project verified');
  const frames=await page.evaluate(()=>visual.frames);await page.evaluate(()=>visual.terminal.resize(60,30));
  await page.waitForFunction(frames=>visual.frames>frames&&visual.terminal.buffer.active.getLine(29)?.translateToString(true).includes('commands'),frames);
  await capture('05-restored-multi-project-session.png');
  report.checks.push('resume restores grants and external tool access after restart, including a 60-column viewport');
  await writeFile(resolve(output,'screen.txt'),await page.evaluate(()=>visual.text()));
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
