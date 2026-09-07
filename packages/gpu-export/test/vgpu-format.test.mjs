import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { evaluateGpuEligibility } from '../src/eligibility.mjs';

const runtimeSource = readFileSync(new URL('../../overlay-runtime/src/vgpu-runtime.js', import.meta.url), 'utf8');
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const hdr = () => JSON.parse(fixture('vgpu-hdr.html').match(/data-akari-vgpu-scene>([\s\S]*?)<\/script>/)[1]);
const plain = value => JSON.parse(JSON.stringify(value));
const htmlFor = value => `<canvas></canvas><script type="application/json" data-akari-vgpu-scene>${JSON.stringify(value)}</script>`;
const eligibility = value => evaluateGpuEligibility({ edit: { overlays: [{ id: 'format', html: htmlFor(value) }] } });

function harness() {
  const calls = { targets: [], surfaces: [], draws: [] };
  const gpu = { gpu: { lost: new Promise(() => {}), adapterInfo: {}, queue: { onSubmittedWorkDone: async () => {} } },
    onError() {}, settled: async () => {} };
  const output = options => ({ options: plain(options), size: options.size, color: {},
    resize(size) { this.size = size; this.color = {}; }, dispose() {} });
  const canvas = () => ({ style: {} });
  const window = { AkariVgpu: {
    init: async () => gpu, sampler: () => ({}),
    surface(_, canvas, options) { const value = output(options); calls.surfaces.push(value); return value; },
    target(_, options) { const value = output(options); calls.targets.push(value); return value; },
    effect: (_, source) => ({ source, set(bag) { this.bag = bag; } }),
    frame: (_, cb) => cb({ pass(output, effect) { calls.draws.push({ output, effect }); } }),
  } };
  runInNewContext(runtimeSource, { window, navigator: { gpu: {} }, document: { createElement: canvas },
    performance, console, getComputedStyle: () => ({ getPropertyValue: () => '' }) });
  const container = value => ({ clientWidth: 1920, clientHeight: 1080,
    querySelectorAll: () => [{ textContent: JSON.stringify(value) }],
    querySelector: selector => selector === 'canvas' ? canvas() : null });
  return { runtime: window.akari.vgpuRuntime, calls, container };
}

for (const format of [undefined, 'rgba8unorm', 'rgba16float']) {
  test(`pure pass format ${format ?? '(omitted)'} is accepted and explicitly passed to intermediate targets`, async () => {
    const h = harness(); const d = hdr();
    for (const pass of d.passes) { delete pass.format; if (format !== undefined) pass.format = format; }
    const c = h.container(d);
    assert.doesNotThrow(() => h.runtime.readDescriptor(c));
    assert.equal(eligibility(d).entries[0].classification, 'vgpu');
    await h.runtime.probe(); h.runtime.render(c, 0);
    assert.deepEqual(h.calls.targets.map(value => value.options), Array.from({ length: 2 }, () => ({ size: [1, 1], format: format ?? 'rgba8unorm' })));
    assert.equal(h.calls.draws.at(-1).output, h.calls.surfaces.at(-1));
    assert.ok(h.calls.surfaces.every(value => !Object.hasOwn(value.options, 'format')));
    const targets = [...h.calls.targets];
    h.runtime.render(c, 1, { previewScale: 0.5 });
    assert.deepEqual(h.calls.targets, targets);
    assert.deepEqual(plain(targets.map(value => value.size)), [[960, 540], [960, 540]]);
    assert.equal(h.calls.draws.at(-1).effect.bag.input_1, targets[1].color);
  });
}

for (const format of ['rgba32float', 'float', 1, null, false, {}, []]) {
  for (const index of [0, 2]) {
    test(`runtime and eligibility reject format ${JSON.stringify(format)} on pass ${index}`, () => {
      const h = harness(); const d = hdr(); d.passes[index].format = format;
      assert.throws(() => h.runtime.readDescriptor(h.container(d)), { name: 'TypeError' });
      assert.equal(eligibility(d).entries[0].reason, 'vgpu-invalid-declaration');
    });
  }
}

for (const format of ['rgba8unorm', 'rgba16float']) {
  test(`single surface pass ignores valid format ${format} without creating a target`, async () => {
    const h = harness(); const d = hdr(); d.passes = [{ ...d.passes[0], format }];
    await h.runtime.probe(); h.runtime.render(h.container(d), 0);
    assert.equal(h.calls.targets.length, 0);
    assert.ok(h.calls.surfaces.every(value => !Object.hasOwn(value.options, 'format')));
  });
}

test('HDR fixture uses two float targets and composites the bright input', async () => {
  const h = harness(); const d = hdr();
  assert.equal(eligibility(d).entries[0].classification, 'vgpu');
  await h.runtime.probe(); h.runtime.render(h.container(d), 0);
  assert.deepEqual(h.calls.targets.map(value => value.options.format), ['rgba16float', 'rgba16float']);
  assert.equal(h.calls.draws.at(-2).effect.bag.input_0, h.calls.targets[0].color);
  assert.equal(h.calls.draws.at(-1).effect.bag.input_1, h.calls.targets[1].color);
});

// Frozen before the format change, from the starting HEAD; includes forceDegraded both ways.
const baselineGroups = [
  {
    "fixtures": [
      "css-3d/a-perspective-rotatey.html"
    ],
    "expected": [
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "degraded",
            "reason": "css-3d-transform, css-3d-backface-hidden, animation-timing",
            "conditions": [
              "css-3d-transform",
              "css-3d-backface-hidden",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 1,
          "unsupported": 0
        }
      },
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "forced-dom:css-3d-transform, css-3d-backface-hidden, animation-timing",
            "conditions": [
              "css-3d-transform",
              "css-3d-backface-hidden",
              "animation-timing"
            ],
            "forced": true
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 1,
          "unsupported": 0,
          "forced": 1
        }
      }
    ]
  },
  {
    "fixtures": [
      "css-3d/b-preserve-3d-cloud.html",
      "css-3d/c-pillar-forest.html",
      "css-3d/e-translatez-only.html",
      "css-3d/f-perspective-only-2d.html",
      "css-3d/h-backface-control.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "dom-layer-draw-element",
            "conditions": [
              "css-3d-transform",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "dom-layer-draw-element",
            "conditions": [
              "css-3d-transform",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "css-3d/d-translatez-telop.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "dom-layer-draw-element",
            "conditions": [
              "css-3d-transform",
              "animation-timing",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "dom-layer-draw-element",
            "conditions": [
              "css-3d-transform",
              "animation-timing",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "css-3d/g-2d-baseline.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "dom-layer-draw-element",
            "conditions": [
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "dom-layer-draw-element",
            "conditions": [
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-backface-hidden.html"
    ],
    "expected": [
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "degraded",
            "reason": "css-3d-backface-hidden",
            "conditions": [
              "css-3d-transform",
              "css-3d-backface-hidden",
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 1,
          "unsupported": 0
        }
      },
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "forced-dom:css-3d-backface-hidden",
            "conditions": [
              "css-3d-transform",
              "css-3d-backface-hidden",
              "three-or-canvas-runtime",
              "animation-timing"
            ],
            "forced": true
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 1,
          "unsupported": 0,
          "forced": 1
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-preserve-3d-siblings.html"
    ],
    "expected": [
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "degraded",
            "reason": "three-composite-preserve-3d-siblings",
            "conditions": [
              "css-3d-transform",
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 1,
          "unsupported": 0
        }
      },
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "forced-dom:three-composite-preserve-3d-siblings",
            "conditions": [
              "css-3d-transform",
              "three-or-canvas-runtime",
              "animation-timing"
            ],
            "forced": true
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 1,
          "unsupported": 0,
          "forced": 1
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-s1-title.html",
      "three-sampled-animated-descendant.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-s2-panel.html",
      "three-composite-s6-scatter.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "css-3d-transform",
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "css-3d-transform",
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-static-blocked-by-script.html"
    ],
    "expected": [
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "degraded",
            "reason": "three-sampled-condition:script-runtime",
            "conditions": [
              "three-or-canvas-runtime",
              "script-runtime",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 1,
          "unsupported": 0
        }
      },
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "forced-dom:three-sampled-condition:script-runtime",
            "conditions": [
              "three-or-canvas-runtime",
              "script-runtime",
              "advanced-css"
            ],
            "forced": true
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 1,
          "unsupported": 0,
          "forced": 1
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-static-glow.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "three-or-canvas-runtime",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "three-or-canvas-runtime",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-composite-static-perspective.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "css-3d-transform",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "css-3d-transform",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-curve-classic.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-entrance-curve",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-entrance-curve",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-sampled-advanced-css-on-chain.html",
      "three-sampled-advanced-css-outside-chain.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-sampled-composite",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-sampled-chain-wrapper.html",
      "three-sampled-middle-keyframe.html",
      "three-sampled-multiple-animation.html",
      "three-sampled-property.html",
      "three-sampled-root-without-class.html",
      "three-sampled-transition.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-entrance-sampled",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "three",
            "reason": "three-scene-entrance-sampled",
            "conditions": [
              "three-or-canvas-runtime",
              "animation-timing"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 1,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "three-sampled-no-css3d-blocked-by-script.html"
    ],
    "expected": [
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "degraded",
            "reason": "three-sampled-condition:script-runtime",
            "conditions": [
              "three-or-canvas-runtime",
              "script-runtime",
              "animation-timing",
              "advanced-css"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 1,
          "unsupported": 0
        }
      },
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "forced-dom:three-sampled-condition:script-runtime",
            "conditions": [
              "three-or-canvas-runtime",
              "script-runtime",
              "animation-timing",
              "advanced-css"
            ],
            "forced": true
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 1,
          "unsupported": 0,
          "forced": 1
        }
      }
    ]
  },
  {
    "fixtures": [
      "vgpu-fluid.html",
      "vgpu-stateful-limit.html",
      "vgpu-stateful.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "vgpu",
            "reason": "vgpu-scene-stateful-direct",
            "conditions": [
              "vgpu-runtime",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "vgpu": 1
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "vgpu",
            "reason": "vgpu-scene-stateful-direct",
            "conditions": [
              "vgpu-runtime",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "vgpu": 1,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "vgpu-gradient.html",
      "vgpu-neon.html"
    ],
    "expected": [
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "vgpu",
            "reason": "vgpu-scene-canvas-direct",
            "conditions": [
              "vgpu-runtime",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "vgpu": 1
        }
      },
      {
        "eligible": true,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "vgpu",
            "reason": "vgpu-scene-canvas-direct",
            "conditions": [
              "vgpu-runtime",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 0,
          "unsupported": 0,
          "vgpu": 1,
          "forced": 0
        }
      }
    ]
  },
  {
    "fixtures": [
      "vgpu-with-three.html"
    ],
    "expected": [
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "degraded",
            "reason": "vgpu-condition:three-or-canvas-runtime(data-akari-3d-scene)",
            "conditions": [
              "vgpu-runtime",
              "three-or-canvas-runtime"
            ]
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 0,
          "degraded": 1,
          "unsupported": 0
        }
      },
      {
        "eligible": false,
        "entries": [
          {
            "kind": "overlay",
            "id": "fixture",
            "classification": "dom",
            "reason": "forced-dom:vgpu-condition:three-or-canvas-runtime(data-akari-3d-scene)",
            "conditions": [
              "vgpu-runtime",
              "three-or-canvas-runtime"
            ],
            "forced": true
          }
        ],
        "summary": {
          "same": 0,
          "three": 0,
          "dom": 1,
          "degraded": 1,
          "unsupported": 0,
          "forced": 1
        }
      }
    ]
  }
];

for (const { fixtures, expected } of baselineGroups) {
  for (const name of fixtures) {
    test(`existing fixture eligibility remains deep-equal: ${name}`, () => {
      const html = fixture(name);
      const actual = [false, true].map(forceDegraded => evaluateGpuEligibility({
        edit: { overlays: [{ id: 'fixture', html }] }, forceDegraded,
      }));
      assert.deepEqual(actual, expected);
    });
  }
}
