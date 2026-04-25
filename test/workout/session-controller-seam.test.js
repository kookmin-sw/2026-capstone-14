const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const controllerPath = require.resolve('../../public/js/workout/session-controller.js');
const helperPath = require.resolve('../../public/js/workout/quality-gate-session.js');
const uiPath = require.resolve('../../public/js/workout/session-ui.js');
const routineManagerPath = require.resolve('../../public/js/workout/routine-session-manager.js');

test('session-controller loads the adjacent quality-gate module without ambient globals', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'SessionQualityGate');

  delete require.cache[controllerPath];
  delete require.cache[helperPath];
  delete require.cache[uiPath];
  delete require.cache[routineManagerPath];

  Object.defineProperty(globalThis, 'SessionQualityGate', {
    configurable: true,
    get() {
      throw new Error('ambient global should not be read');
    },
  });

  try {
    const controller = require('../../public/js/workout/session-controller.js');

    assert.deepEqual(Object.keys(controller), ['initSession']);
    assert.equal(typeof controller.initSession, 'function');
    assert.equal(typeof require('../../public/js/workout/quality-gate-session.js').mapWithholdReasonToMessage, 'function');
  } finally {
    delete require.cache[controllerPath];
    delete require.cache[helperPath];
    delete require.cache[uiPath];
    delete require.cache[routineManagerPath];

    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'SessionQualityGate', originalDescriptor);
    } else {
      delete globalThis.SessionQualityGate;
    }
  }
});

test('session-controller falls back to the adjacent quality-gate module when window exists in Node-like envs', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');

  delete require.cache[controllerPath];
  delete require.cache[helperPath];
  delete require.cache[uiPath];
  delete require.cache[routineManagerPath];

  const fakeWindow = {};
  Object.defineProperty(fakeWindow, 'SessionQualityGate', {
    configurable: true,
    get() {
      throw new Error('window.SessionQualityGate should not be read in CommonJS');
    },
  });
  Object.defineProperty(fakeWindow, 'createSessionUi', {
    configurable: true,
    get() {
      throw new Error('window.createSessionUi should not be read in CommonJS');
    },
  });
  Object.defineProperty(fakeWindow, 'createRoutineSessionManager', {
    configurable: true,
    get() {
      throw new Error(
        'window.createRoutineSessionManager should not be read in CommonJS',
      );
    },
  });

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: fakeWindow,
  });

  try {
    const controller = require('../../public/js/workout/session-controller.js');

    assert.equal(typeof controller.initSession, 'function');
    assert.equal(fakeWindow.initSession, controller.initSession);
  } finally {
    delete require.cache[controllerPath];
    delete require.cache[helperPath];
    delete require.cache[uiPath];
    delete require.cache[routineManagerPath];

    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }
  }
});

test('browser script loading does not throw when helper scripts load first', () => {
  const scriptDir = path.resolve(__dirname, '../../public/js/workout');
  const browserLikeGlobal = {
    console,
    clearTimeout,
    setTimeout,
    document: {},
    window: null,
  };
  browserLikeGlobal.window = browserLikeGlobal;

  const context = vm.createContext(browserLikeGlobal);
  const files = [
    'quality-gate-session.js',
    'session-ui.js',
    'routine-session-manager.js',
    'onboarding-guide.js',
    'session-controller.js',
  ];

  for (const file of files) {
    const source = fs.readFileSync(`${scriptDir}/${file}`, 'utf8');
    vm.runInContext(source, context, { filename: file });
  }

  assert.equal(typeof context.initSession, 'function');
  assert.equal(typeof context.createSessionUi, 'function');
  assert.equal(typeof context.createRoutineSessionManager, 'function');
  assert.equal(typeof context.SessionQualityGate, 'object');
});
