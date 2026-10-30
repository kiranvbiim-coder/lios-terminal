import path from "node:path";
import {createRequire} from "node:module";
import fs from "node:fs";

type WindowsRuntimeFs={
 pinDirectories:(directory:string)=>unknown;
 releasePin:(pin:unknown)=>void;
 openFile:(filename:string,create:boolean)=>number;
 makeDirectory:(directory:string)=>void;
};
let loaded:WindowsRuntimeFs|undefined;
/** Fixed app-owned addon only. Never load a module from the requested runtime or a request path. */
export function windowsRuntimeFs():WindowsRuntimeFs {
 if(process.platform!=="win32"||process.arch!=="x64")throw new Error("Windows x64 handle custody is unavailable on this host.");
 if(loaded)return loaded;
 const resources=(process as NodeJS.Process&{resourcesPath?:string}).resourcesPath||process.env.ELECTRON_RESOURCES_PATH;
 const addon=resources?path.join(resources,"native-runtime-fs","lios_native_runtime_fs.node"):
  path.resolve(typeof __dirname!=="undefined"?__dirname:path.dirname(process.argv[1]||process.cwd()),"../native-runtime-fs/build/Release/lios_native_runtime_fs.node");
 const stat=fs.lstatSync(addon);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error("App-owned Windows runtime custody binding is unavailable.");
 const value=createRequire(addon)(addon) as WindowsRuntimeFs;
 if([value.pinDirectories,value.releasePin,value.openFile,value.makeDirectory].some(member=>typeof member!=="function"))throw new Error("Windows runtime custody binding contract is invalid.");
 loaded=value;return value;
}
