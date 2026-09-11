import { describe,it,expect,vi,afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { csrfToken,verifyMutation,passwordPolicy } from '../../src/lib/auth';
import { csvCell,settingsSchema } from '../../src/lib/services';
import { validateReview } from '../../src/lib/agent';
import { evaluateBaseline,DEFAULT_SETTINGS,newAccount } from '../../src/lib/engine';
import { snapshot } from '../../fixtures/market';
import { evaluateReport,metrics,type EvaluationArm } from '../../src/lib/evaluation';
afterEach(()=>vi.unstubAllEnvs());
describe('security and schema contracts',()=>{
  it('AT46 signed token binds session and exact Origin',()=>{vi.stubEnv('CSRF_SIGNING_SECRET','s'.repeat(40));vi.stubEnv('APP_ORIGIN','http://localhost:3000');const token=csrfToken('nonce','session');const req=(origin:string,session:string)=>new NextRequest('http://localhost:3000/api/positions',{method:'POST',headers:{origin,'x-csrf-token':token,cookie:`sinyallab_dev_nonce=nonce; sinyallab_dev_session=${session}`}});expect(()=>verifyMutation(req('http://localhost:3000','session'))).not.toThrow();expect(()=>verifyMutation(req('http://localhost:3000.evil.com','session'))).toThrow('CSRF_INVALID');expect(()=>verifyMutation(req('http://localhost:3000','changed-session'))).toThrow('CSRF_INVALID');});
  it('AT44 rejects short, equal and mismatched passwords',()=>{expect(()=>passwordPolicy('old','short','short')).toThrow();expect(()=>passwordPolicy('long-sample-password','long-sample-password','long-sample-password')).toThrow();expect(()=>passwordPolicy('old','rain on 7 quiet rooftops','rain on 7 quiet rooftops')).not.toThrow();});
  it('AT39 CSV formula neutralization',()=>{expect(csvCell('=HYPERLINK("url")')).toMatch(/^"'/);expect(csvCell('-3.1')).toBe('"-3.1"');expect(csvCell('\t=SUM(1)')).toMatch(/^"'/);});
  it('AT24 rejects injected modes and secrets in settings',()=>{expect(settingsSchema.safeParse({marginMode:'CROSS'}).success).toBe(false);expect(settingsSchema.safeParse({defaultLeverage:20}).success).toBe(false);expect(settingsSchema.safeParse({feeRate:'NaN'}).success).toBe(false);});
  it('AT06/08 agent cannot add side, quantity or unknown fact',()=>{const b=evaluateBaseline(snapshot(),DEFAULT_SETTINGS,{account:newAccount(),positions:[]});const r={verdict:'CONFIRM',summary:'Review',supporting:[{factId:'nonexistent',observation:'Fake'}],opposing:[],missingEvidence:[],riskFlags:[],nextCheck:'NEXT_CLOSED_CANDLE'};expect(()=>validateReview(r,b)).toThrow();expect(()=>validateReview({...r,side:'SHORT'},b)).toThrow();});
  it('AT49 no evidence gives NOT_TESTED',()=>expect(evaluateReport({id:'test',arms:[]}).status).toBe('NOT_TESTED'));
  it('AT48 missing conversion is unknown, not zero',()=>{const arm={trades:[{qty:'1',entry:'100',exit:'110',side:'LONG',entryFee:'1',exitFee:'1',funding:'-1'}],equity:[{at:1,value:'100'},{at:2,value:'90'}],costs:[{kind:'AI',amount:'1',currency:'USD',rateToUsdt:null}],from:0,to:86400000} as EvaluationArm;const m=metrics(arm);expect(m.netTradingPnl).toBe('7');expect(m.netEconomicPnl).toBeNull();expect(m.maxDrawdown).toBe('0.1');expect(m.profitFactor).toBeNull();});
});
