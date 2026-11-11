/** Minimal process settings shared by fixture commands and trusted graders. */
export function evaluationEnvironment(home:string,temp:string):Record<string,string>{
 const env:Record<string,string>={HOME:home,USERPROFILE:home,XDG_CONFIG_HOME:home+'/.config',TMPDIR:temp,TMP:temp,TEMP:temp};
 for(const key of ['PATH','LANG','LC_ALL','SYSTEMROOT'])if(process.env[key])env[key]=process.env[key]!;
 return env;
}
/** Default shell services inherit process.env, so clear inherited values explicitly. */
export function evaluationEnvironmentOverlay(home:string,temp:string):Record<string,string>{
 return{...Object.fromEntries(Object.keys(process.env).map(key=>[key,''])),...evaluationEnvironment(home,temp)};
}
