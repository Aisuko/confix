'use strict';

const $ = (selector) => document.querySelector(selector);
let model = 'Gemma-2-9B';

function renderResults() {
  const dataset = $('#dataset').value;
  const rows = RESULTS[dataset][model];
  const best = Array.from({ length: 4 }, (_, i) => (i === 0 ? Math.max : Math.min)(...rows.map(r => r.values[i][0])));
  $('#results-body').replaceChildren(...rows.map(row => {
    const tr = document.createElement('tr');
    if (row.method === 'CoCHI') tr.className = 'cochi-row';
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = row.method === 'Therm.' ? 'Thermometer' : row.method;
    tr.append(name);
    row.values.forEach(([mean, std], i) => {
      const td = document.createElement('td');
      td.textContent = mean.toFixed(4);
      if (mean === best[i]) td.className = 'best';
      const small = document.createElement('small');
      small.textContent = ` ± ${std.toFixed(4)}`;
      td.append(small);
      tr.append(td);
    });
    return tr;
  }));
  $('#table-caption').textContent = `${model} / ${dataset}`;
  const cochi = rows.find(r => r.method === 'CoCHI');
  const ts = rows.find(r => r.method === 'TS');
  const reduction = (1 - cochi.values[1][0] / ts.values[1][0]) * 100;
  const difference = (cochi.values[0][0] - ts.values[0][0]) * 100;
  $('#result-summary').innerHTML = `<div class="summary-item"><span>ECE REDUCTION VS. TS</span><strong>${reduction.toFixed(1)}<em>% ↓</em></strong><p>${ts.values[1][0].toFixed(4)} → ${cochi.values[1][0].toFixed(4)}</p></div><div class="summary-item"><span>ACCURACY VS. TS</span><strong>${difference >= 0 ? '+' : ''}${difference.toFixed(2)}<em> pp</em></strong><p>${(cochi.values[0][0] * 100).toFixed(2)}% CoCHI accuracy</p></div><div class="summary-item"><span>SELECTED HEADS</span><strong>${model === 'LLaMA-3.1-8B' ? '10' : '8'}</strong><p>Model-level top-k selection</p></div>`;
}
document.querySelectorAll('[data-model]').forEach(button => button.addEventListener('click', () => {
  model = button.dataset.model;
  document.querySelectorAll('[data-model]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  renderResults();
}));
$('#dataset').addEventListener('change', renderResults);

let toastTimer;
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2500);
}
document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
  const target = document.getElementById(button.dataset.copy);
  try {
    if (!navigator.clipboard) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(target.textContent);
    toast('Copied to clipboard');
  } catch {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(target);
    selection.removeAllRanges();
    selection.addRange(range);
    toast('Text selected — press Ctrl+C or ⌘C to copy');
  }
}));

// A schematic attention network, not an actual model attribution map.
const canvas = $('#network');
const ctx = canvas.getContext('2d');
let width = 0, height = 0, angle = 0, intervention = false, visibility = true, animation;
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
let reducedMotion = motionPreference.matches;
const points = Array.from({ length: 150 }, (_, i) => {
  const y = 1 - (i / 149) * 2;
  const radius = Math.sqrt(1 - y * y);
  const phi = Math.PI * (3 - Math.sqrt(5)) * i;
  return { x: Math.cos(phi) * radius, y, z: Math.sin(phi) * radius, error: i % 13 === 0 || i % 17 === 0 };
});
const edges = [];
points.forEach((p, i) => points.forEach((q, j) => {
  if (j > i && Math.hypot(p.x-q.x, p.y-q.y, p.z-q.z) < .39) edges.push([i,j]);
}));
function resize() {
  const rect = canvas.getBoundingClientRect();
  width = rect.width; height = rect.height;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = width * dpr; canvas.height = height * dpr;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  draw();
}
function draw() {
  ctx.clearRect(0, 0, width, height);
  const radius = Math.min(width * .37, height * .34);
  const cx = width * .5, cy = height * .46;
  // Fine orbital traces give the network a technical, spatial frame.
  for (let i = 0; i < 3; i++) {
    ctx.save();ctx.translate(cx,cy);ctx.rotate(-.35 + i * 1.08);
    ctx.beginPath();ctx.ellipse(0,0,radius*1.29,radius*.42,0,0,Math.PI*2);
    ctx.strokeStyle = '#b5c59a18';ctx.lineWidth=.6;ctx.stroke();ctx.restore();
  }
  const projected = points.map(p => {
    const x = p.x * Math.cos(angle) + p.z * Math.sin(angle);
    const z = -p.x * Math.sin(angle) + p.z * Math.cos(angle);
    const y = p.y * Math.cos(.22) - z * Math.sin(.22);
    const depth = p.y * Math.sin(.22) + z * Math.cos(.22);
    const scale = 2.8 / (2.8 - depth * .5);
    return { x:cx+x*radius*scale, y:cy+y*radius*scale, depth, error:p.error };
  });
  edges.forEach(([i,j]) => {
    const p = projected[i], q = projected[j];
    const error = p.error || q.error;
    const alpha = (.1 + ((p.depth + q.depth + 2) / 4) * .27) * (intervention && error ? .1 : 1);
    ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);
    ctx.strokeStyle = error ? `rgba(239,163,127,${alpha})` : `rgba(174,194,151,${alpha})`;
    ctx.lineWidth = error ? .8 : .55;ctx.stroke();
  });
  projected.sort((a,b) => a.depth-b.depth).forEach(p => {
    const alpha = .3 + (p.depth+1)*.33;
    const r = (p.error ? 3 : 1.9) * (1 + p.depth*.2);
    if (p.error && intervention) {
      ctx.strokeStyle = `rgba(239,163,127,${alpha*.38})`;ctx.lineWidth=.8;
      ctx.beginPath();ctx.moveTo(p.x-2,p.y-2);ctx.lineTo(p.x+2,p.y+2);ctx.moveTo(p.x+2,p.y-2);ctx.lineTo(p.x-2,p.y+2);ctx.stroke();
    } else {
      if(p.error){ctx.beginPath();ctx.arc(p.x,p.y,r*2.8,0,Math.PI*2);ctx.fillStyle=`rgba(239,163,127,${alpha*.08})`;ctx.fill();}
      ctx.beginPath();ctx.arc(p.x,p.y,r,0,Math.PI*2);
      ctx.fillStyle=p.error?`rgba(239,163,127,${alpha})`:`rgba(178,201,170,${alpha})`;ctx.fill();
    }
  });
  ctx.font = '8px monospace';ctx.fillStyle='#7e8f6b';
  ctx.fillText(intervention ? 'gₕ = 0  /  SELECTED HEADS' : 'gₕ = 1  /  UNMASKED',14,height-76);
}
let lastFrame = 0;
function frame(time) {
  if (time - lastFrame > 30) { angle += .0027; draw(); lastFrame = time; }
  if (!reducedMotion && visibility && !document.hidden) animation = requestAnimationFrame(frame);
}
function updateAnimation() {
  cancelAnimationFrame(animation);
  if (!reducedMotion && visibility && !document.hidden) animation = requestAnimationFrame(frame);
  else draw();
}
$('#intervention').addEventListener('click', () => {
  intervention = !intervention;
  $('#intervention').setAttribute('aria-pressed', String(intervention));
  $('#network-status').textContent = intervention ? 'Selected error pathways suppressed. Useful pathways preserved.' : 'Trace the mechanisms behind model confidence.';
  draw();
});
motionPreference.addEventListener('change', event => {reducedMotion=event.matches;updateAnimation();});
new ResizeObserver(resize).observe(canvas);
new IntersectionObserver(entries => { visibility=entries[0].isIntersecting;updateAnimation(); }).observe(canvas);
document.addEventListener('visibilitychange', updateAnimation);

const sections = [...document.querySelectorAll('main section[id]')];
const sectionObserver = new IntersectionObserver(entries => entries.forEach(entry => {
  if (entry.isIntersecting) document.querySelectorAll('.nav-links a').forEach(a => a.classList.toggle('active', a.hash === '#' + entry.target.id));
}), {rootMargin:'-15% 0px -60% 0px'});
sections.forEach(section => sectionObserver.observe(section));

// Transcribed from Tables 1 and 7 of the supplied paper.
const RESULTS = {
  "MMLU": {
    "Gemma-2-9B": [
      {
        "method": "TS",
        "values": [
          [
            0.6653,
            0.005
          ],
          [
            0.066,
            0.0173
          ],
          [
            0.506,
            0.0335
          ],
          [
            0.1683,
            0.0125
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.6693,
            0.006
          ],
          [
            0.0605,
            0.0062
          ],
          [
            0.5029,
            0.0233
          ],
          [
            0.1675,
            0.0105
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.6653,
            0.005
          ],
          [
            0.1831,
            0.0567
          ],
          [
            1.8729,
            1.1455
          ],
          [
            0.2302,
            0.0429
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.6653,
            0.005
          ],
          [
            0.3784,
            0.0052
          ],
          [
            0.9191,
            0.0066
          ],
          [
            0.3553,
            0.003
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.673,
            0.0023
          ],
          [
            0.0601,
            0.0011
          ],
          [
            0.4982,
            0.0141
          ],
          [
            0.1654,
            0.0056
          ]
        ]
      }
    ],
    "LLaMA-3.1-8B": [
      {
        "method": "TS",
        "values": [
          [
            0.6007,
            0.0061
          ],
          [
            0.0569,
            0.004
          ],
          [
            0.5205,
            0.0138
          ],
          [
            0.1936,
            0.0065
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.5853,
            0.0685
          ],
          [
            0.2014,
            0.1191
          ],
          [
            0.7161,
            0.159
          ],
          [
            0.258,
            0.0643
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.6007,
            0.0061
          ],
          [
            0.1717,
            0.0778
          ],
          [
            1.9024,
            0.7247
          ],
          [
            0.2415,
            0.0354
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.6007,
            0.0061
          ],
          [
            0.3265,
            0.0257
          ],
          [
            1.7325,
            1.5251
          ],
          [
            0.333,
            0.0157
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.612,
            0.0626
          ],
          [
            0.049,
            0.0089
          ],
          [
            0.5168,
            0.0236
          ],
          [
            0.1743,
            0.0008
          ]
        ]
      }
    ],
    "Mistral-7B": [
      {
        "method": "TS",
        "values": [
          [
            0.5987,
            0.0121
          ],
          [
            0.0902,
            0.0182
          ],
          [
            0.5754,
            0.013
          ],
          [
            0.1974,
            0.0037
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.398,
            0.1152
          ],
          [
            0.3693,
            0.2666
          ],
          [
            1.2168,
            0.8397
          ],
          [
            0.3845,
            0.2056
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.5987,
            0.0121
          ],
          [
            0.2988,
            0.0449
          ],
          [
            1.4277,
            0.9584
          ],
          [
            0.3177,
            0.0274
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.5987,
            0.0121
          ],
          [
            0.3379,
            0.029
          ],
          [
            2.5765,
            1.4883
          ],
          [
            0.3462,
            0.0184
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.61,
            0.004
          ],
          [
            0.0854,
            0.0015
          ],
          [
            0.5649,
            0.0008
          ],
          [
            0.1941,
            0.0005
          ]
        ]
      }
    ]
  },
  "MedMCQA": {
    "Gemma-2-9B": [
      {
        "method": "TS",
        "values": [
          [
            0.5607,
            0.0186
          ],
          [
            0.0556,
            0.0261
          ],
          [
            0.6114,
            0.0151
          ],
          [
            0.2122,
            0.0066
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.5673,
            0.02
          ],
          [
            0.0451,
            0.014
          ],
          [
            0.6085,
            0.0154
          ],
          [
            0.2122,
            0.007
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.5607,
            0.0186
          ],
          [
            0.2849,
            0.0106
          ],
          [
            2.9242,
            0.4188
          ],
          [
            0.3293,
            0.0165
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.5607,
            0.0186
          ],
          [
            0.3534,
            0.0783
          ],
          [
            4.1559,
            1.3606
          ],
          [
            0.3702,
            0.0396
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.5873,
            0.0023
          ],
          [
            0.038,
            0.0263
          ],
          [
            0.5983,
            0.0064
          ],
          [
            0.207,
            0.0027
          ]
        ]
      }
    ],
    "LLaMA-3.1-8B": [
      {
        "method": "TS",
        "values": [
          [
            0.5753,
            0.0297
          ],
          [
            0.0557,
            0.0124
          ],
          [
            0.6173,
            0.0142
          ],
          [
            0.2144,
            0.0052
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.3747,
            0.0893
          ],
          [
            0.3766,
            0.2287
          ],
          [
            1.2043,
            0.7682
          ],
          [
            0.3831,
            0.187
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.5753,
            0.0297
          ],
          [
            0.2327,
            0.0356
          ],
          [
            1.8116,
            0.8973
          ],
          [
            0.2907,
            0.0208
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.5753,
            0.0301
          ],
          [
            0.3307,
            0.0727
          ],
          [
            2.5476,
            2.9442
          ],
          [
            0.3495,
            0.0501
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.5773,
            0.0081
          ],
          [
            0.0365,
            0.009
          ],
          [
            0.6064,
            0.0032
          ],
          [
            0.2114,
            0.0012
          ]
        ]
      }
    ],
    "Mistral-7B": [
      {
        "method": "TS",
        "values": [
          [
            0.4867,
            0.0081
          ],
          [
            0.0604,
            0.0308
          ],
          [
            0.6424,
            0.0339
          ],
          [
            0.2249,
            0.0133
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.3293,
            0.0939
          ],
          [
            0.3985,
            0.328
          ],
          [
            1.4918,
            1.2039
          ],
          [
            0.4317,
            0.2469
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.4867,
            0.0081
          ],
          [
            0.2668,
            0.0776
          ],
          [
            2.6632,
            0.6919
          ],
          [
            0.3385,
            0.0372
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.4867,
            0.0081
          ],
          [
            0.3817,
            0.1376
          ],
          [
            3.6701,
            2.495
          ],
          [
            0.4032,
            0.0945
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.4847,
            0.0023
          ],
          [
            0.0383,
            0.0035
          ],
          [
            0.6168,
            0.0012
          ],
          [
            0.2146,
            0.0006
          ]
        ]
      }
    ]
  },
  "OpenBookQA": {
    "Gemma-2-9B": [
      {
        "method": "TS",
        "values": [
          [
            0.608,
            0.0087
          ],
          [
            0.0686,
            0.0119
          ],
          [
            0.541,
            0.0076
          ],
          [
            0.1848,
            0.0054
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.61,
            0.0111
          ],
          [
            0.0682,
            0.0064
          ],
          [
            0.5438,
            0.007
          ],
          [
            0.1848,
            0.0043
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.608,
            0.0087
          ],
          [
            0.2635,
            0.0266
          ],
          [
            2.4829,
            0.5178
          ],
          [
            0.293,
            0.0223
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.608,
            0.0087
          ],
          [
            0.335,
            0.0165
          ],
          [
            1.9401,
            1.8405
          ],
          [
            0.3399,
            0.009
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.609,
            0.0766
          ],
          [
            0.0434,
            0.0116
          ],
          [
            0.5353,
            0.0268
          ],
          [
            0.184,
            0.0092
          ]
        ]
      }
    ],
    "LLaMA-3.1-8B": [
      {
        "method": "TS",
        "values": [
          [
            0.6827,
            0.017
          ],
          [
            0.0618,
            0.0106
          ],
          [
            0.5776,
            0.0125
          ],
          [
            0.1853,
            0.0066
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.52,
            0.1618
          ],
          [
            0.2272,
            0.2848
          ],
          [
            0.9131,
            0.6744
          ],
          [
            0.2952,
            0.2009
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.6827,
            0.017
          ],
          [
            0.1654,
            0.0405
          ],
          [
            1.5188,
            0.591
          ],
          [
            0.218,
            0.0302
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.6827,
            0.017
          ],
          [
            0.3346,
            0.0658
          ],
          [
            2.6951,
            1.5194
          ],
          [
            0.3195,
            0.0403
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.67,
            0.004
          ],
          [
            0.0523,
            0.0193
          ],
          [
            0.5069,
            0.009
          ],
          [
            0.173,
            0.0035
          ]
        ]
      }
    ],
    "Mistral-7B": [
      {
        "method": "TS",
        "values": [
          [
            0.51,
            0.01
          ],
          [
            0.0673,
            0.0383
          ],
          [
            0.6016,
            0.013
          ],
          [
            0.2076,
            0.0033
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.3567,
            0.0996
          ],
          [
            0.3583,
            0.2315
          ],
          [
            1.0117,
            0.3433
          ],
          [
            0.3684,
            0.1309
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.51,
            0.01
          ],
          [
            0.2388,
            0.0647
          ],
          [
            2.0444,
            0.3463
          ],
          [
            0.3042,
            0.036
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.51,
            0.01
          ],
          [
            0.4317,
            0.004
          ],
          [
            4.2157,
            0.0519
          ],
          [
            0.4266,
            0.0012
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.512,
            0.004
          ],
          [
            0.0316,
            0.0073
          ],
          [
            0.5912,
            0.0029
          ],
          [
            0.2047,
            0.0014
          ]
        ]
      }
    ]
  },
  "MedQA-USMLE": {
    "Gemma-2-9B": [
      {
        "method": "TS",
        "values": [
          [
            0.7714,
            0.0124
          ],
          [
            0.1782,
            0.0188
          ],
          [
            0.5109,
            0.0377
          ],
          [
            0.1829,
            0.0118
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.7927,
            0.0151
          ],
          [
            0.1725,
            0.0143
          ],
          [
            0.5091,
            0.0163
          ],
          [
            0.1708,
            0.0072
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.781,
            0.0114
          ],
          [
            0.1767,
            0.0298
          ],
          [
            1.7598,
            0.2096
          ],
          [
            0.1757,
            0.0205
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.774,
            0.0164
          ],
          [
            0.1863,
            0.0131
          ],
          [
            2.2281,
            0.2476
          ],
          [
            0.1866,
            0.0141
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.7893,
            0.0223
          ],
          [
            0.1723,
            0.007
          ],
          [
            0.5081,
            0.0046
          ],
          [
            0.1694,
            0.0019
          ]
        ]
      }
    ],
    "LLaMA-3.1-8B": [
      {
        "method": "TS",
        "values": [
          [
            0.736,
            0.0087
          ],
          [
            0.1198,
            0.02
          ],
          [
            0.5603,
            0.0394
          ],
          [
            0.175,
            0.0123
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.5387,
            0.0908
          ],
          [
            0.1611,
            0.0761
          ],
          [
            0.6333,
            0.0739
          ],
          [
            0.2226,
            0.0332
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.736,
            0.0087
          ],
          [
            0.1954,
            0.0372
          ],
          [
            1.968,
            0.4174
          ],
          [
            0.2124,
            0.0213
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.736,
            0.0087
          ],
          [
            0.2432,
            0.0119
          ],
          [
            3.129,
            0.1205
          ],
          [
            0.243,
            0.0082
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.7307,
            0.0186
          ],
          [
            0.0961,
            0.0169
          ],
          [
            0.5066,
            0.0121
          ],
          [
            0.17,
            0.0048
          ]
        ]
      }
    ],
    "Mistral-7B": [
      {
        "method": "TS",
        "values": [
          [
            0.6707,
            0.0064
          ],
          [
            0.1489,
            0.0077
          ],
          [
            0.572,
            0.0115
          ],
          [
            0.1987,
            0.0089
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.5193,
            0.0574
          ],
          [
            0.1522,
            0.0597
          ],
          [
            0.6011,
            0.0402
          ],
          [
            0.2089,
            0.0195
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.6707,
            0.0064
          ],
          [
            0.2214,
            0.0398
          ],
          [
            2.0876,
            0.3632
          ],
          [
            0.2511,
            0.0222
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.6707,
            0.0064
          ],
          [
            0.2904,
            0.0064
          ],
          [
            3.0443,
            0.028
          ],
          [
            0.2896,
            0.0046
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.67,
            0.0139
          ],
          [
            0.1432,
            0.0108
          ],
          [
            0.5634,
            0.0068
          ],
          [
            0.2028,
            0.0035
          ]
        ]
      }
    ]
  },
  "SciQ": {
    "Gemma-2-9B": [
      {
        "method": "TS",
        "values": [
          [
            0.9173,
            0.0012
          ],
          [
            0.0579,
            0.0184
          ],
          [
            0.4699,
            0.4226
          ],
          [
            0.0641,
            0.0094
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.9253,
            0.0083
          ],
          [
            0.1027,
            0.0091
          ],
          [
            0.2337,
            0.0076
          ],
          [
            0.0617,
            0.0025
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.9223,
            0.0021
          ],
          [
            0.0609,
            0.0066
          ],
          [
            1.0836,
            0.1824
          ],
          [
            0.0599,
            0.0068
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.9173,
            0.0012
          ],
          [
            0.0607,
            0.0067
          ],
          [
            1.1578,
            0.1183
          ],
          [
            0.0602,
            0.0065
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.9353,
            0.1069
          ],
          [
            0.0563,
            0.0199
          ],
          [
            0.2309,
            0.1276
          ],
          [
            0.0548,
            0.0472
          ]
        ]
      }
    ],
    "LLaMA-3.1-8B": [
      {
        "method": "TS",
        "values": [
          [
            0.879,
            0.021
          ],
          [
            0.0354,
            0.0109
          ],
          [
            0.2377,
            0.0145
          ],
          [
            0.0721,
            0.0045
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.8647,
            0.0311
          ],
          [
            0.0359,
            0.0176
          ],
          [
            0.3032,
            0.0329
          ],
          [
            0.0921,
            0.0139
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.892,
            0.0131
          ],
          [
            0.0738,
            0.0112
          ],
          [
            0.9514,
            0.2711
          ],
          [
            0.0807,
            0.0065
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.879,
            0.021
          ],
          [
            0.0932,
            0.0219
          ],
          [
            1.497,
            0.2712
          ],
          [
            0.0928,
            0.0195
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.902,
            0.002
          ],
          [
            0.033,
            0.001
          ],
          [
            0.2266,
            0.0012
          ],
          [
            0.0676,
            0.0004
          ]
        ]
      }
    ],
    "Mistral-7B": [
      {
        "method": "TS",
        "values": [
          [
            0.8667,
            0.015
          ],
          [
            0.0764,
            0.0048
          ],
          [
            0.3057,
            0.0402
          ],
          [
            0.0944,
            0.0045
          ]
        ]
      },
      {
        "method": "ITI",
        "values": [
          [
            0.572,
            0.1512
          ],
          [
            0.2095,
            0.1429
          ],
          [
            0.6363,
            0.1672
          ],
          [
            0.2249,
            0.068
          ]
        ]
      },
      {
        "method": "Therm.",
        "values": [
          [
            0.8467,
            0.031
          ],
          [
            0.0986,
            0.0084
          ],
          [
            1.4162,
            0.0701
          ],
          [
            0.0978,
            0.0073
          ]
        ]
      },
      {
        "method": "ATS",
        "values": [
          [
            0.8667,
            0.015
          ],
          [
            0.1056,
            0.0139
          ],
          [
            1.692,
            0.2413
          ],
          [
            0.1049,
            0.0134
          ]
        ]
      },
      {
        "method": "CoCHI",
        "values": [
          [
            0.8773,
            0.0046
          ],
          [
            0.073,
            0.0116
          ],
          [
            0.303,
            0.0144
          ],
          [
            0.0903,
            0.0046
          ]
        ]
      }
    ]
  }
};
renderResults();
