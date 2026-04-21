const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyRepOutcome,
} = require('../../public/js/workout/scoring-engine.js');

test('applyRepOutcome discards an active rep when gate flips to withheld', () => {
  const result = applyRepOutcome({
    gateResult: 'withhold',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: null,
  });

  assert.equal(result.repResult, 'withheld');
  assert.equal(result.incrementRepCount, false);
  assert.equal(result.discardActiveRep, true);
});

test('applyRepOutcome withholds even when no active rep', () => {
  const result = applyRepOutcome({
    gateResult: 'withhold',
    repState: { active: false, repIndex: 3 },
    exerciseEvaluation: null,
  });

  assert.equal(result.repResult, 'withheld');
  assert.equal(result.incrementRepCount, false);
  assert.equal(result.discardActiveRep, false);
});

test('applyRepOutcome withholds when repState is null', () => {
  const result = applyRepOutcome({
    gateResult: 'withhold',
    repState: null,
    exerciseEvaluation: null,
  });

  assert.equal(result.repResult, 'withheld');
  assert.equal(result.incrementRepCount, false);
  assert.equal(result.discardActiveRep, false);
});

test('applyRepOutcome returns hard_fail when exercise evaluation has hardFailReason', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: {
      hardFailReason: 'depth_not_reached',
      softFailReasons: [],
    },
  });

  assert.equal(result.repResult, 'hard_fail');
  assert.equal(result.incrementRepCount, false);
  assert.equal(result.discardActiveRep, true);
  assert.equal(result.scoreCapApplied, 0);
});

test('applyRepOutcome returns soft_fail when exercise evaluation has softFailReasons', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: {
      hardFailReason: null,
      softFailReasons: ['depth_not_reached'],
      scoreCap: 0.70,
    },
  });

  assert.equal(result.repResult, 'soft_fail');
  assert.equal(result.incrementRepCount, true);
  assert.equal(result.discardActiveRep, false);
  assert.equal(result.scoreCapApplied, 0.70);
});

test('applyRepOutcome returns scored when gate passes and exercise has no failures', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: {
      hardFailReason: null,
      softFailReasons: [],
    },
  });

  assert.equal(result.repResult, 'scored');
  assert.equal(result.incrementRepCount, true);
  assert.equal(result.discardActiveRep, false);
  assert.equal(result.scoreCapApplied, null);
});

test('applyRepOutcome returns scored when gate passes and exerciseEvaluation is null', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: null,
  });

  assert.equal(result.repResult, 'scored');
  assert.equal(result.incrementRepCount, true);
  assert.equal(result.discardActiveRep, false);
  assert.equal(result.scoreCapApplied, null);
});

test('applyRepOutcome soft_fail with multiple soft failures', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true, repIndex: 5 },
    exerciseEvaluation: {
      hardFailReason: null,
      softFailReasons: ['depth_not_reached', 'torso_unstable'],
      scoreCap: 0.50,
    },
  });

  assert.equal(result.repResult, 'soft_fail');
  assert.equal(result.incrementRepCount, true);
  assert.equal(result.discardActiveRep, false);
  assert.equal(result.scoreCapApplied, 0.50);
});

test('applyRepOutcome hard_fail takes precedence over soft_fail', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true, repIndex: 3 },
    exerciseEvaluation: {
      hardFailReason: 'depth_not_reached',
      softFailReasons: ['torso_unstable'],
      scoreCap: 0.70,
    },
  });

  assert.equal(result.repResult, 'hard_fail');
  assert.equal(result.incrementRepCount, false);
  assert.equal(result.discardActiveRep, true);
  assert.equal(result.scoreCapApplied, 0);
});
