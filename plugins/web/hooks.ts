export default {
  'prompt.submit':async(event:any,$:any)=>{
    if(event.text.trim()!=='/web')return;
    const config=await $.storage.config('web.json');
    const provider=config.provider??(config.searchUrl?'searxng':process.env.BRAVE_SEARCH_API_KEY?'brave':'duckduckgo');
    await $.ui.notify(`Internet tools: web_search + web_fetch. Search provider: ${provider}. DuckDuckGo needs no API key. Configure provider/searchUrl in web.json; Brave uses BRAVE_SEARCH_API_KEY. Network permissions still apply.`);
    return{drop:'web status'};
  },
};
