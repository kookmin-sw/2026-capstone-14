const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const controllerSource = fs.readFileSync(
  path.resolve(__dirname, '../../public/js/workout/session-controller.js'),
  'utf8',
);

function extractFunctionBody(source, functionName) {
  const signature = `function ${functionName}`;
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `${functionName} should exist`);

  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) return source.slice(bodyStart + 1, index);
  }

  throw new Error(`${functionName} body was not closed`);
}

test('connectCameraSource only connects media and does not warm up the AI model', () => {
  const body = extractFunctionBody(controllerSource, 'connectCameraSource');

  assert.doesNotMatch(body, /prepareAI\s*\(/);
  assert.doesNotMatch(body, /warmUpGeneration\s*\+\+/);
  assert.match(body, /sessionCamera\.getStream\s*\(/);
  assert.match(body, /sessionCamera\.applyStream\s*\(/);
});

test('startWorkout shows model loading before countdown and starts AI from the click path', () => {
  const body = extractFunctionBody(controllerSource, 'startWorkout');

  const loadingIndex = body.indexOf('showModelLoadingOverlay');
  const prepareIndex = body.indexOf('prepareAI');
  const countdownIndex = body.indexOf('runStartCountdown');

  assert.ok(loadingIndex >= 0, 'startWorkout should show model loading overlay');
  assert.ok(prepareIndex > loadingIndex, 'prepareAI should run after loading UI appears');
  assert.ok(countdownIndex > prepareIndex, 'countdown should run after model preparation');
  assert.doesNotMatch(body, /AI 모델이 아직 준비 중입니다/);
});
