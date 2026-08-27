import fs from 'node:fs';
import path from 'node:path';
import { transformSoloAppV420 } from './solo-v420.js';

const MARKER='/* QGT SOLO STATIC PATCH v4.1.21 */';

export function applySoloStaticV421(publicDir){
  const appPath=path.join(publicDir,'solo','app.js');
  if(!fs.existsSync(appPath)){
    throw new Error(`solo-v421: missing ${appPath}`);
  }
  const current=fs.readFileSync(appPath,'utf8');
  if(current.startsWith(MARKER)){
    console.log(JSON.stringify({level:'info',event:'solo_v421_static_patch',status:'already_applied'}));
    return {changed:false,appPath};
  }
  const transformed=transformSoloAppV420(current);
  const tmp=`${appPath}.v421.tmp`;
  fs.writeFileSync(tmp,`${MARKER}\n${transformed}`,'utf8');
  fs.renameSync(tmp,appPath);
  console.log(JSON.stringify({level:'info',event:'solo_v421_static_patch',status:'applied',appPath}));
  return {changed:true,appPath};
}
