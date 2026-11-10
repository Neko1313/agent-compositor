import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';

const url=process.argv[2]??'http://127.0.0.1:3180/agent-compositor/';
const output=resolve('dist/docs-browser');
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{})});
const errors=[];
const results=[];
let lastPage;
try {
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});
    const page=await context.newPage();
    lastPage=page;
    page.on('pageerror',error=>errors.push(String(error)));
    await page.goto(url,{waitUntil:'networkidle'});
    await page.getByRole('heading',{level:1,name:'Build an agent that works your way'}).waitFor();
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Home page overflows the viewport');
    await page.screenshot({path:resolve(output,`home-${viewport.width}.png`),fullPage:true,animations:'disabled'});
    if(viewport.width<996) {
      await page.getByRole('button',{name:'Toggle navigation bar'}).click();
      const sidebar=page.locator('.navbar-sidebar');
      const start=sidebar.getByRole('button',{name:'Start here',exact:true});
      if(await start.getAttribute('aria-expanded')!=='true')await start.click();
      await sidebar.getByRole('link',{name:'Get started',exact:true}).last().click();
    } else await page.locator('.navbar').getByRole('link',{name:'Get started',exact:true}).click();
    await page.getByRole('heading',{level:1,name:'Get started',exact:true}).waitFor();
    await page.locator('.navbar-sidebar--show').waitFor({state:'hidden'});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Guide overflows the viewport');
    await page.screenshot({path:resolve(output,`guide-${viewport.width}.png`),fullPage:true,animations:'disabled'});
    if(viewport.width>=996) {
      const search=page.locator('input[aria-label="Search"]');
      await search.focus();
      await page.locator('[class*="dropdownMenu_"]').waitFor({state:'attached'});
      await search.fill('Callix');
      const suggestion=page.locator('[class*="suggestion_"]').first();
      await suggestion.waitFor({state:'visible'});
      await page.screenshot({path:resolve(output,'search.png')});
      await search.press('ArrowDown');
      await search.press('Enter');
      await page.waitForURL(target=>target.pathname!=='/agent-compositor/getting-started/');
      assert(!page.url().includes('undefined'),'Search result must have a real target');
      const toggle=page.getByRole('button',{name:/Switch between dark and light mode|Switch between dark and light mode|Switch between light and dark mode/i});
      for(let attempt=0;attempt<3&&await page.locator('html').getAttribute('data-theme')!=='dark';attempt++)await toggle.click();
      assert.equal(await page.locator('html').getAttribute('data-theme'),'dark','Theme control must select dark mode');
      await page.screenshot({path:resolve(output,'dark.png'),animations:'disabled'});
    }
    results.push({viewport,passed:true});
    await context.close();
  }
  assert.deepEqual(errors,[],'Documentation must not throw client-side errors');
  await writeFile(resolve(output,'report.json'),JSON.stringify({url,results,errors,ok:true},null,2)+'\n');
  console.log(JSON.stringify({ok:true,results,output}));
}catch(error) {
  if(lastPage&&!lastPage.isClosed()) {
    await lastPage.screenshot({path:resolve(output,'failure.png')});
    await writeFile(resolve(output,'failure.json'),JSON.stringify({errors,url:lastPage.url(),search:await lastPage.locator('input[aria-label="Search"]').evaluate(element=>element.parentElement.outerHTML)},null,2));
  }
  console.error(JSON.stringify({errors}));
  throw error;
}finally {await browser.close();}
