import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve(process.env.VISUAL_OUTPUT ?? "dist/visual-controllers");
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
    env: { ...process.env, VISUAL_OUTPUT: output, VISUAL_CONTROLLERS: "1" },
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
  const send=async text=>{await page.keyboard.type(text);await wait(text);await page.keyboard.press('F2');};
  await wait('CUSTOM INPUT');await wait('F2 sends');
  await capture('01-custom-editor.png');
  await send('Remember custom storage');await wait('CUSTOM RESPONSE');
  report.checks.push('external editor sends through F2 and selected repository journals the turn');
  await send('/private-approval');await wait('CUSTOM APPROVAL');await capture('02-custom-approval.png');
  await page.keyboard.press('F3');await wait('Custom tool denied');
  await send('/private-question');await wait('CUSTOM QUESTION');await page.keyboard.press('F4');await wait('Answer: custom response');
  report.checks.push('replacement approval and question controllers receive real terminal keys');
  await send('/private-form');await wait('CUSTOM PRIVATE FORM');await page.keyboard.type('fake-private-key');
  await wait('••••');
  if((await page.evaluate(()=>visual.text())).includes('fake-private-key'))throw Error('Private form exposed a secret');
  await capture('03-custom-private-form.png');await page.keyboard.press('F5');await wait('Custom form saved');
  await send('/placement');await wait('CUSTOM PLACEMENT');await page.keyboard.press('Escape');await page.waitForFunction(()=>!visual.text().includes('CUSTOM PLACEMENT'));await wait('CUSTOM INPUT');
  report.checks.push('replacement masked form and placement panel');
  await send('/rename Saved custom workspace');await wait('CUSTOM HISTORY');await wait('Saved custom workspace');
  await capture('04-custom-history.png');await page.keyboard.press('Escape');
  await page.waitForFunction(()=>!visual.text().includes('CUSTOM HISTORY'));
  const generation=await page.evaluate(()=>visual.generation);await page.getByRole('button',{name:'Restart session'}).click();
  await page.waitForFunction(g=>visual.generation>g,generation);await wait('CUSTOM INPUT');
  await send('/history');await wait('CUSTOM HISTORY');await wait('Saved custom workspace');
  await page.keyboard.type('Remember custom storage');await wait('Saved custom workspace');await page.keyboard.press('Enter');
  await page.waitForFunction(()=>!visual.text().includes('CUSTOM HISTORY'));await wait('Remember custom storage');
  await send('Continue custom session');await page.waitForFunction(()=>visual.text().split('CUSTOM RESPONSE').length>=3&&visual.text().includes('Ready'));
  const frames=await page.evaluate(()=>visual.frames);await page.evaluate(()=>visual.terminal.resize(60,30));
  await page.waitForFunction(frames=>visual.frames>frames&&visual.terminal.buffer.active.getLine(29)?.translateToString(true).includes('F2 sends'),frames);
  await capture('05-restored-custom-session.png');
  report.checks.push('repository persists across process restart, custom history searches and resumes the saved transcript at 60 columns');
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
