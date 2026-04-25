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

test('session-controller has a CommonJS-first voice factory loader', () => {
  const body = extractFunctionBody(controllerSource, 'loadSessionVoiceFactory');

  assert.match(body, /require\('\.\/session-voice\.js'\)\.createSessionVoice/);
  assert.match(body, /window\.createSessionVoice/);
});

test('checkFeedback routes low-score feedback through structured delivery', () => {
  const body = extractFunctionBody(controllerSource, 'checkFeedback');

  assert.match(body, /createFeedbackEvent\s*\(/);
  assert.match(body, /type:\s*["']LOW_SCORE_HINT["']/);
  assert.match(body, /deliverFeedbackEvent\s*\(/);
  assert.doesNotMatch(body, /showAlert\("자세 교정 필요",\s*lowScoreItem\.feedback\)/);
});

test('showRepFeedback routes rep completion feedback through structured delivery', () => {
  const body = extractFunctionBody(controllerSource, 'showRepFeedback');

  assert.match(body, /createFeedbackEvent\s*\(/);
  assert.match(body, /type:\s*["']REP_COMPLETE_FEEDBACK["']/);
  assert.match(body, /deliverFeedbackEvent\s*\(/);
  assert.doesNotMatch(body, /ui\.showToast\(`\$\{repRecord\.repNumber\}회 \$\{msg\}`\)/);
});

test('handlePoseDetected records quality-gate feedback events before returning', () => {
  const body = extractFunctionBody(controllerSource, 'handlePoseDetected');

  assert.match(body, /type:\s*["']QUALITY_GATE_WITHHOLD["']/);
  assert.match(body, /deliverFeedbackEvent\s*\(/);
});
