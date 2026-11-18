import { homedir, tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

/** Documents use per-user application data; this does not relocate the existing SQLite DB. */
export function documentDataDirectory(options:{
  platform?:NodeJS.Platform;env?:NodeJS.ProcessEnv;home?:string;repositoryRoot?:string;temporaryRoot?:string;
}={}):string {
  const platform=options.platform ?? process.platform, env=options.env ?? process.env, home=options.home ?? homedir();
  const configured=env.JOB_NEARBY_DOCUMENT_DATA_DIR;
  const base=platform==="win32" ? (env.LOCALAPPDATA || join(home,"AppData","Local"))
    : platform==="darwin" ? join(home,"Library","Application Support") : (env.XDG_DATA_HOME || join(home,".local","share"));
  const root=configured || join(base,"JobNearby");
  if(!isAbsolute(root)) throw Error("Document data directory must be absolute.");
  const result=resolve(root);
  for(const forbidden of [options.repositoryRoot ?? resolve(__dirname,"../../.."),options.temporaryRoot ?? tmpdir()]) {
    const child=relative(resolve(forbidden),result);
    if(child==="" || (child!==".." && !child.startsWith(".."+sep) && !isAbsolute(child))) throw Error("Document data must be outside the repository and temporary directories.");
  }
  return result;
}
