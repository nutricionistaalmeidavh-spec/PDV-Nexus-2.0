import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {businessDay,sqlBusinessDay,sqlBusinessHour} from '../src/business-day.mjs';

test('P0: hora após 21h no Brasil permanece no dia operacional local',()=>{
  assert.equal(businessDay('2026-11-23T00:30:00.000Z'),'2026-11-22');
  assert.equal(businessDay('2026-11-23T02:59:59.999Z'),'2026-11-22');
  assert.equal(businessDay('2026-11-23T03:00:00.000Z'),'2026-11-23');
  const db=new DatabaseSync(':memory:');
  try{
    const sql=`SELECT ${sqlBusinessDay('?')} AS day, ${sqlBusinessHour('?')} AS hour`;
    const r=db.prepare(sql).get('2026-11-23T00:30:00.000Z','2026-11-23T00:30:00.000Z');
    assert.equal(r.day,'2026-11-22');
    assert.equal(r.hour,'21');
  }finally{db.close();}
});
