import { loadEnvironment } from './private-cli';
import { reviewCandidate } from '../src/lib/agent';
import { evaluateBaseline, DEFAULT_SETTINGS, newAccount } from '../src/lib/engine';
import { snapshot } from '../fixtures/market';
async function main(){
  loadEnvironment();
  if (!process.env.OAO_API_KEY?.trim()) {console.log('LOCAL_OAO_KEY_MISSING');return;}
  process.env.AI_PROVIDER='oao'; process.env.AI_ENABLED='true';
  const original=globalThis.fetch;
  globalThis.fetch=async (...args:Parameters<typeof fetch>)=>{
    const response=await original(...args);
    const data=await response.clone().json().catch(()=>null);
    const content=data?.choices?.[0]?.message?.content;
    console.log(JSON.stringify({httpStatus:response.status,finishReason:data?.choices?.[0]?.finish_reason,contentType:typeof content,contentLength:typeof content==='string'?content.length:null,markdown:typeof content==='string'&&content.trim().startsWith('```'),errorType:typeof data?.error?.type==='string'?data.error.type:undefined}));
    return response;
  };
  const s=snapshot(),b=evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]});
  const r=await reviewCandidate(b,s,Date.now()+45000);
  console.log(JSON.stringify({reviewStatus:r.reviewStatus,verdict:r.review?.verdict}));
}
main().catch(()=>{console.error('REVIEW_CHECK_UNAVAILABLE');process.exitCode=1;});
