import fs from 'node:fs/promises';
import path from 'node:path';
export async function importPortablePython(source,destination){
 try{await fs.access(path.join(destination,'bin','python3'));}
 catch(e){if(e.code!=='ENOENT')throw e;await fs.cp(source,destination,{recursive:true,verbatimSymlinks:true});}
 async function rebase(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
   const file=path.join(directory,entry.name);
   if(entry.isDirectory())await rebase(file);
   else if(entry.isSymbolicLink()){
    const target=await fs.readlink(file);
    if(path.isAbsolute(target)&&target.startsWith(source+path.sep)){
     const local=path.join(destination,path.relative(source,target));
     await fs.unlink(file);await fs.symlink(path.relative(path.dirname(file),local),file);
    }
   }
  }
 }
 await rebase(destination);
 return path.join(destination,'bin','python3');
}
