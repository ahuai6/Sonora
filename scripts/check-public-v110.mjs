import path from 'node:path';
import {Store} from '../main/core/store.mjs';
import {ProviderRegistry} from '../main/providers/registry.mjs';
const r=new ProviderRegistry(new Store(path.resolve('test-artifacts/v110-live')),path.resolve('profiles/providers.json'));
for(const source of ['injahow','mxin','sakurink']) {
  r.store.data.settings.preferredResolver=source;
  try {const a=await r.resolve({platform:'netease',id:'33894312',title:'海阔天空',artist:'BEYOND'},'high');
    const res=await fetch(a.url,{headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(8000)});const reader=res.body.getReader();const data=await reader.read();await reader.cancel();const bytes=Buffer.from(data.value||[]);console.log(source,{http:res.status,audioMagic:bytes.subarray(0,3).toString()==='ID3'||bytes.subarray(0,4).toString()==='fLaC'||bytes.subarray(0,4).toString()==='OggS'||bytes[0]===255});
  }catch(e){console.log(source,e.message);}
}
