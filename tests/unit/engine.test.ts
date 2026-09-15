import { describe,it,expect,beforeEach,afterEach,vi } from 'vitest';
import { D,floorToStep } from '../../src/lib/decimal';
import { ema,atr,marginEstimate,newAccount,accountSummary,evaluateBaseline,DEFAULT_SETTINGS,revalidatePlan } from '../../src/lib/engine';
import { openPosition,closePosition,applyFunding } from '../../src/lib/portfolio/ledger';
import { snapshot,accountingSignal } from '../../fixtures/market';
import type { FundingEvent,Side } from '../../src/lib/domain';
const now=Date.UTC(2026,8,10,13,5);
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(now);});afterEach(()=>vi.useRealTimers());
function opened(side:Side='LONG'){const signal=accountingSignal(side),s=snapshot(side);s.quote.bid=s.quote.ask=s.derivatives.markPrice='100';return {s,...openPosition({account:newAccount(),positions:[],signal,plan:signal.plan!,positionId:`position-${side}`,snapshot:s,now})};}
function event(side:Side='LONG',rate='.001',at=now+1000):FundingEvent{return {id:`event-${rate}-${at}`,provider:'binance-usdm-public',instrumentKey:accountingSignal(side).instrumentKey,symbol:'BTCUSDT',fundingTime:at,fundingRate:rate,markPrice:'100',rateType:'SETTLED'};}
describe('PRD deterministic futures accounting',()=>{
  it.each([['LONG','110','19.548','1019.548'],['SHORT','90','19.972','1019.972']] as const)('AT11-16 %s accounting reconciles exactly', (side,exit,net,equity)=>{const o=opened(side);expect(o.account.availableCollateral).toBe('959.88');const f=applyFunding({account:o.account,position:o.position,event:event(side),postedAt:now+1000});o.s.quote.bid=o.s.quote.ask=exit;const c=closePosition({...f,snapshot:o.s,now:now+2000});expect(c.position.netPnl).toBe(net);expect(accountSummary(c.account,[c.position]).paperEquity).toBe(equity);expect(c.position.grossPnl).toBe('20');});
  it.each(['LONG','SHORT'] as const)('AT15 funding sign reverses for negative rate %s',side=>{const o=opened(side);const f=applyFunding({...o,event:event(side,'-.001'),postedAt:now+1});expect(f.position.fundingNet).toBe(side==='LONG'?'0.2':'-0.2');});
  it('AT16 funding retries post once',()=>{const o=opened(),e=event();const f=applyFunding({...o,event:e,postedAt:now+1000});const retry=applyFunding({...f,event:e,postedAt:now+2000});expect(retry.ledger).toHaveLength(0);expect(retry.account).toEqual(f.account);expect(retry.position.fundingNet).toBe('-.2'.replace('-.','-0.'));});
  it('AT18 event exactly at open is eligible',()=>{const o=opened();expect(applyFunding({...o,event:event('LONG','.001',now),postedAt:now}).ledger.length).toBe(1);});
  it('AT18 event exactly at close excluded',()=>{const o=opened();const c=closePosition({...o,snapshot:o.s,now:now+1000});expect(applyFunding({...c,event:event(),postedAt:now+2000}).ledger).toHaveLength(0);});
  it('AT19 late funding settles closed available only',()=>{const o=opened();o.position.fundingComplete=false;const c=closePosition({...o,snapshot:o.s,now:now+2000});expect(c.position.status).toBe('CLOSED_PENDING_FUNDING');const f=applyFunding({...c,event:event(),postedAt:now+3000});expect(f.position.collateral).toBe('0');expect(D(f.account.availableCollateral).sub(c.account.availableCollateral).toFixed()).toBe('-0.2');});
  it('AT20 close uses executable side and adverse slippage',()=>{const o=opened('SHORT');o.s.quote.bid='89';o.s.quote.ask='90';o.position.slippageRate='.0005';const c=closePosition({...o,snapshot:o.s,now});expect(c.position.exit).toBe('90.045');});
  it('AT26 margin equation and LONG 1x exception',()=>{for(const side of ['LONG','SHORT'] as const){const m=marginEstimate(side,'1','100','20','100');const at=marginEstimate(side,'1','100','20',m.liqApprox!);expect(D(at.marginBalance).sub(D(at.maintenance).add(at.closeFeeReserve)).abs().lt('0.000001')).toBe(true);}expect(marginEstimate('LONG','1','100','100','100')).toMatchObject({liqApprox:null,status:'NO_POSITIVE_THRESHOLD_IN_MODEL'});});
  it('AT28/29 observed breach records raw loss and deficit',()=>{const o=opened();o.s.derivatives.markPrice='1';const c=closePosition({...o,snapshot:o.s,now,modelBreach:true});expect(c.position.status).toBe('LIQUIDATED_SIM');expect(c.position.exit).toBe('1');expect(D(c.account.modelDeficit).gt(0)).toBe(true);expect(c.account.status).toBe('REVIEW_REQUIRED');expect(D(c.position.netPnl).lt(-190)).toBe(true);});
  it('AT31 consumed signal rejected',()=>{const o=opened();expect(()=>openPosition({...o,positions:[],signal:{...o.signal,consumedPositionId:'old'},plan:o.signal.plan!,positionId:'new',snapshot:o.s,now})).toThrow('SIGNAL_EXPIRED');});
  it('AT12 changing margin does not multiply price PNL',()=>{const a=opened();a.position.leverage=3;a.position.initialMargin=D(200).div(3).toFixed();a.position.collateral=a.position.initialMargin;a.s.quote.bid='110';a.s.quote.ask='110';expect(closePosition({...a,snapshot:a.s,now}).position.grossPnl).toBe('20');});
});
describe('strategy, indicator and rejection gates',()=>{
  it.each(['LONG','SHORT'] as const)('net target covers costs at 2R: %s',side=>{
    const result=evaluateBaseline(snapshot(side),DEFAULT_SETTINGS,{account:newAccount(),positions:[]});
    expect(result.decision).toBe(`${side}_CANDIDATE`);
    expect(D(result.plan!.netRR).gte(2)).toBe(true);
  });
  it('rejects a cost-adjusted target beyond the volatility limit',()=>{
    const result=evaluateBaseline(snapshot(),{...DEFAULT_SETTINGS,feeRate:'0.03'},{account:newAccount(),positions:[]});
    expect(result.reasons).toContain('TARGET_TOO_DISTANT');
    expect(result.plan).toBeNull();
    expect(result.decision).toBe('WAIT');
  });
  it.each(['LONG','SHORT'] as const)('active breakout accepts average volume and ignores older extremes: %s',side=>{
    const s=snapshot(side);
    s.candles15m.at(-1)!.volume='100';
    s.candles15m.at(-15)![side==='LONG'?'high':'low']=side==='LONG'?'110':'90';
    const r=evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]});
    expect(r.decision).toBe(`${side}_CANDIDATE`);
    expect(D(r.plan!.plannedRisk).lte(5)).toBe(true);
  });
  it('active breakout still rejects below-average volume',()=>{
    const s=snapshot();s.candles15m.at(-1)!.volume='99';
    expect(evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]}).reasons).toContain('VOLUME_FILTER');
  });
  it('EMA uses SMA seed',()=>expect(ema(['1','2','3','4'],3)).toBe('3'));
  it('ATR fixture uses positive Wilder values',()=>expect(D(atr(snapshot().candles15m)).gt(0)).toBe(true));
  it('AT10 floors quantity',()=>expect(floorToStep('1.2349','.001').toFixed()).toBe('1.234'));
  it.each(['LONG','SHORT'] as const)('AT04 two-direction valid %s candidate',side=>{const result=evaluateBaseline(snapshot(side),DEFAULT_SETTINGS,{account:newAccount(),positions:[]});expect(result.reasons).toEqual([]);expect(result.decision).toBe(`${side}_CANDIDATE`);expect(D(result.plan!.plannedRisk).lte(5)).toBe(true);expect(D(result.plan!.initialMargin).lte(100)).toBe(true);});
  it('AT03 open candle and gaps reject',()=>{const s=snapshot();s.candles15m[2]!.endAt+=1;expect(evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]}).decision).toBe('WAIT');});
  it('AT05 stale quote rejects',()=>{const s=snapshot();s.quote.providerAt-=30000;expect(evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]}).reasons).toContain('DATA_STALE');});
  it('AT09 expiry and shifted quote rejected',()=>{const s=snapshot(),ctx={account:newAccount(),positions:[]},baseline=evaluateBaseline(s,DEFAULT_SETTINGS,ctx);const signal={...accountingSignal(),plan:baseline.plan};signal.expiresAt=now-1;expect(()=>revalidatePlan(signal,s,DEFAULT_SETTINGS,ctx,3)).toThrow('SIGNAL_EXPIRED');});
  it('AT24 invalid leverage rejected',()=>{expect(evaluateBaseline(snapshot(),{...DEFAULT_SETTINGS,defaultLeverage:10 as 3},{account:newAccount(),positions:[]}).reasons).toContain('INVALID_LEVERAGE');});
  it('AT22 zero equity rejected',()=>{const account={...newAccount(),availableCollateral:'0'};expect(evaluateBaseline(snapshot(),DEFAULT_SETTINGS,{account,positions:[]}).decision).toBe('WAIT');});
  it('AT27 insufficient margin model buffer rejected',()=>{const s=snapshot();s.derivatives.markPrice='1';expect(evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]}).reasons).toContain('MARGIN_BUFFER_REJECTED');});
  it('funding cutoff blocks entry',()=>{const s=snapshot();s.derivatives.nextFundingTime=now+100000;expect(evaluateBaseline(s,DEFAULT_SETTINGS,{account:newAccount(),positions:[]}).reasons).toContain('FUNDING_COST_RISK');});
});
