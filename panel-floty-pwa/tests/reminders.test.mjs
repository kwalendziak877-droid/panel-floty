import test from 'node:test';
import assert from 'node:assert/strict';
import { dateDifference, remindersForVehicle, warsawDate } from '../src/worker.js';

test('oblicza liczbę dni między datami', () => {
  assert.equal(dateDifference('2026-08-10', '2026-07-11'), 30);
  assert.equal(dateDifference('2026-07-11', '2026-07-11'), 0);
  assert.equal(dateDifference('2026-07-10', '2026-07-11'), -1);
});

test('wybiera tylko terminy wymagające przypomnienia', () => {
  const vehicle = { registration:'WMA 12345', inspection:'2026-08-10', tachograph:'2026-07-25', oc:'2026-07-18', ac:'2027-01-01' };
  const result = remindersForVehicle(vehicle, '2026-07-11', [30, 14, 7]);
  assert.deepEqual(result.map(x => x.key), ['inspection', 'tachograph', 'oc']);
});

test('formatuje bieżący dzień w strefie Warszawy', () => {
  assert.equal(warsawDate(Date.parse('2026-07-10T22:30:00Z')), '2026-07-11');
});
