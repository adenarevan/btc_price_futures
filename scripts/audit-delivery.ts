import { loadEnvironment } from './private-cli';
import { getConfig } from '../src/lib/config';
import { getDb } from '../src/lib/firebase/admin';
import { decode } from '../src/lib/repository';
async function main() {
  loadEnvironment(); const uid=getConfig().OWNER_UID, db=getDb();
  for(const [collection,field] of [['signals','createdAt'],['emailAlerts','attemptedAt'],['positions','openedAt'],['journal','createdAt']] as const){
    const rows=await db.collection(`users/${uid}/${collection}`).orderBy(field,'desc').limit(collection==='signals'?150:15).get();
    const safe=rows.docs.map(doc=>{const d=decode<Record<string,unknown>>(doc.data()); const b=d.baseline as {decision?:string}|undefined; return {id:doc.id,symbol:d.symbol,decision:d.decision,baseline:b?.decision,reviewStatus:d.reviewStatus,consumedPositionId:d.consumedPositionId,status:d.status,httpStatus:d.httpStatus,providerId:d.providerId,signalId:d.signalId,createdAt:d[field],action:d.action,error:d.error};});
    console.log(JSON.stringify({collection,count:rows.size,rows:collection==='signals'?safe.filter(s=>s.decision!=='WAIT'||s.baseline!=='WAIT'):safe}));
  }
}
main().catch(()=>{console.error('AUDIT_UNAVAILABLE');process.exitCode=1;});
