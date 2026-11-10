/** Stable plugin versions are independent of the host release version. */
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
export function compareVersions(a:string,b:string):number {
  const left=SEMVER.exec(a),right=SEMVER.exec(b);
  if(!left||!right)throw Error('Plugin versions must use SemVer');
  for(let i=1;i<=3;i++){const x=BigInt(left[i]),y=BigInt(right[i]);if(x!==y)return x<y?-1:1;}
  if(left[4]===right[4])return 0;
  if(!left[4])return 1;if(!right[4])return -1;
  const x=left[4].split('.'),y=right[4].split('.');
  for(let i=0;i<Math.max(x.length,y.length);i++){
    if(x[i]===undefined)return -1;if(y[i]===undefined)return 1;if(x[i]===y[i])continue;
    const nx=/^\d+$/.test(x[i]),ny=/^\d+$/.test(y[i]);
    if(nx&&ny)return BigInt(x[i])<BigInt(y[i])?-1:1;
    if(nx!==ny)return nx?-1:1;return x[i]<y[i]?-1:1;
  }
  return 0;
}
