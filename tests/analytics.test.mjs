import test from 'node:test';
import assert from 'node:assert/strict';
import {observations,summarize,median} from '../docs/analytics.mjs';
import {parseSeoCsv,summarizeSeo} from '../docs/seo.mjs';

test('site analytics use observed checks only',()=>{
  const checks=[{ok:true,latency_ms:100},{ok:false,latency_ms:800},{ok:false,latency_ms:800},{ok:true,latency_ms:200}];
  assert.deepEqual(summarize(checks),{count:4,successes:2,share:.5,medianMs:150,incidents:1});
  assert.equal(median([]),null);
});

test('period filters historical snapshots',()=>{
  const now=Date.parse('2026-01-08T12:00:00Z');
  const history={checks:[{checked_at:'2026-01-07T10:00:00Z',targets:[{id:'a',ok:true}]},{checked_at:'2026-01-08T11:00:00Z',targets:[{id:'a',ok:false}]}]};
  assert.equal(observations(history,'a',24,now).length,1);
});

test('imports English and Russian search exports',()=>{
  const english=parseSeoCsv('Top queries,Clicks,Impressions,CTR,Position\n"desk, repair",12,100,12%,4.5');
  assert.equal(english[0].query,'desk, repair');
  assert.deepEqual(summarizeSeo(english),{clicks:12,impressions:100,ctr:.12,position:4.5});
  const russian=parseSeoCsv('Запрос;Клики;Показы;Средняя позиция\nремонт ноутбука;4;80;7,2');
  assert.equal(russian[0].position,7.2);
});
