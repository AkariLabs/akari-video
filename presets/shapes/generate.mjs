import { writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import catalog from './shape-catalog.mjs';
import { bubblePath } from './bubble-path.mjs';

const rounded = {
  'basic-rounded-square': ['basic-square', 36],
  'basic-pill': ['basic-square', 100],
  'flow-alt-process': ['flow-process', 36],
  'flow-terminator': ['flow-process', 100],
  'polygon-hexagon-rounded': ['polygon-hexagon', 28],
  'polygon-octagon-rounded': ['polygon-octagon', 30],
  'star-5-rounded': ['star-5', 18],
  'abstract-plus-rounded': ['basic-cross-thick', 20],
  'abstract-rounded-triangle': ['basic-triangle', 28],
};
const shapeDefaults = { fill: '#a6a6a6', stroke: 'none', strokeWidth: 0 };
const lineDefaults = {
  fill: 'none',
  stroke: '#000000',
  strokeWidth: 10,
  dash: 'solid',
  startCap: 'none',
  endCap: 'none',
  lineCap: 'butt',
};
const bubbleDefaults = { fill: '#ffffff', stroke: '#000000', strokeWidth: 5 };
const shapeEnglishNames = {
  // basic
  'basic-square': 'Square',
  'basic-rounded-square': 'Rounded Square',
  'basic-circle': 'Circle',
  'basic-triangle': 'Triangle',
  'basic-triangle-down': 'Inverted Triangle',
  'basic-right-triangle': 'Right Triangle',
  'basic-diamond': 'Diamond',
  'basic-cross': 'Cross',
  'basic-cross-thick': 'Thick Cross',
  'basic-trapezoid': 'Trapezoid',
  'basic-parallelogram': 'Parallelogram',
  'basic-semicircle': 'Semicircle',
  'basic-quarter-circle': 'Quarter Circle',
  'basic-ring': 'Ring / Doughnut',
  'basic-pill': 'Pill',
  // polygon
  'polygon-pentagon': 'Pentagon',
  'polygon-hexagon': 'Vertical Hexagon',
  'polygon-hexagon-flat': 'Horizontal Hexagon',
  'polygon-heptagon': 'Heptagon',
  'polygon-octagon': 'Octagon',
  'polygon-decagon': 'Decagon',
  'polygon-dodecagon': 'Dodecagon',
  'polygon-hexagon-rounded': 'Rounded Hexagon',
  'polygon-octagon-rounded': 'Rounded Octagon',
  // star
  'star-4': '4-Point Star',
  'star-5': '5-Point Star',
  'star-6': '6-Point Star',
  'star-7': '7-Point Star',
  'star-8': '8-Point Star',
  'star-10': '10-Point Star',
  'star-12': '12-Point Star',
  'star-16': '16-Point Star',
  'star-burst-24': 'Starburst Price Seal',
  'star-5-rounded': 'Rounded 5-Point Star',
  'star-explosion': 'Explosion',
  'star-square-12': '12-Point Square Star',
  // arrow
  'arrow-right': 'Right Arrow',
  'arrow-left': 'Left Arrow',
  'arrow-up': 'Up Arrow',
  'arrow-down': 'Down Arrow',
  'arrow-left-right': 'Left–Right Arrow',
  'arrow-up-down': 'Up–Down Arrow',
  'arrow-four-way': '4-Way Arrow',
  'arrow-chevron': 'Chevron',
  'arrow-chevron-double': 'Double Chevron',
  'arrow-notched': 'Notched Right Arrow',
  'arrow-pentagon': 'Home Plate Arrow',
  'arrow-u-turn': 'U-Turn Arrow',
  'arrow-circular': 'Circular Arrow',
  'arrow-curved': 'Curved Arrow',
  'arrow-bent': 'Bent Arrow',
  'arrow-thin': 'Thin Right Arrow',
  'arrow-diagonal': 'Diagonal Arrow',
  // flow
  'flow-process': 'Process',
  'flow-alt-process': 'Alternate Process',
  'flow-decision': 'Decision',
  'flow-data': 'Data',
  'flow-predefined': 'Predefined Process',
  'flow-document': 'Document',
  'flow-multi-document': 'Multiple Documents',
  'flow-terminator': 'Terminator',
  'flow-preparation': 'Preparation',
  'flow-manual-input': 'Manual Input',
  'flow-manual-operation': 'Manual Operation',
  'flow-connector': 'Connector',
  'flow-off-page': 'Off-Page Connector',
  'flow-database': 'Database',
  'flow-delay': 'Delay',
  'flow-display': 'Display',
  // bubble
  'bubble-rect': 'Rectangular Speech Bubble',
  'bubble-rounded': 'Rounded Speech Bubble',
  'bubble-oval': 'Oval Speech Bubble',
  'bubble-thought': 'Thought Bubble',
  'bubble-shout': 'Shout Bubble',
  'bubble-tail-right': 'Right-Tail Speech Bubble',
  'bubble-tail-top': 'Top-Tail Speech Bubble',
  'bubble-square-center': 'Centered-Tail Square Speech Bubble',
  'bubble-round-right': 'Right-Tail Round Speech Bubble',
  'bubble-curved-tail': 'Curved Tail Speech Bubble',
  // cloud
  'cloud-classic': 'Cloud',
  'cloud-flat': 'Flat-Bottom Cloud',
  'cloud-long': 'Wide Cloud',
  'cloud-puffy': 'Puffy Cloud',
  'cloud-icon': 'Cloud Icon',
  'cloud-tall': 'Billowing Cloud',
  // heart
  'heart-heart': 'Heart',
  'heart-fat': 'Plump Heart',
  'heart-tilted': 'Tilted Heart',
  'heart-ring': 'Heart Ring',
  'heart-slim': 'Slim Heart',
  'heart-wide': 'Wide Heart',
  'heart-card': 'Playing Card Heart',
  'heart-card-slim': 'Slender Heart',
  'heart-curl-tip': 'Curled-Tip Heart',
  'heart-lean-right': 'Right-Leaning Heart',
  'heart-lean-left': 'Left-Leaning Hand-Drawn Heart',
  'heart-soft-wide': 'Soft Wide Heart',
  // banner
  'banner-ribbon': 'Ribbon Banner',
  'banner-flag': 'Notched Flag',
  'banner-ribbon-curved': 'Curved Ribbon',
  'banner-hanging': 'Hanging Banner',
  'banner-hanging-swallowtail': 'Swallowtail Hanging Banner',
  'banner-tag': 'Tag',
  'banner-badge': 'Ribbon Badge',
  'banner-scroll': 'Scroll',
  'banner-pennant': 'Pennant',
  // drop
  'drop-teardrop': 'Teardrop',
  'drop-teardrop-down': 'Inverted Teardrop',
  'drop-pin': 'Map Pin',
  'drop-tilted': 'Tilted Teardrop',
  // gear
  'gear-8': '8-Tooth Gear',
  'gear-12': '12-Tooth Gear',
  'gear-16': 'Fine-Tooth Gear',
  'gear-solid': 'Solid Gear',
  'gear-round-teeth': 'Round-Tooth Gear',
  'gear-long-6spoke': 'Long-Tooth 6-Spoke Gear',
  'gear-long-4spoke': 'Long-Tooth 4-Spoke Gear',
  'gear-sprocket': 'Sprocket',
  // asterisk
  'asterisk-6': '6-Arm Asterisk',
  'asterisk-8': '8-Arm Asterisk',
  'asterisk-4-round': 'Rounded Cross',
  'asterisk-5-round': 'Rounded 5-Arm Asterisk',
  'asterisk-sparkle': 'Sparkle',
  'asterisk-sparkle-thin': 'Thin Sparkle',
  'asterisk-twinkle': '8-Ray Twinkle',
  'asterisk-square-star': '8-Point Square Star',
  // organic
  'organic-flower-4': '4-Petal Flower',
  'organic-flower-5': '5-Petal Flower',
  'organic-flower-6': '6-Petal Flower',
  'organic-daisy': 'Daisy',
  'organic-clover-4': 'Four-Leaf Clover',
  'organic-clover-3': 'Three-Leaf Clover',
  'organic-leaf': 'Leaf',
  'organic-willow': 'Willow Leaf',
  'organic-blob-1': 'Blob 1',
  'organic-blob-2': 'Blob 2',
  'organic-blob-3': 'Blob 3',
  'organic-pebble': 'Pebble',
  'organic-monstera': 'Monstera',
  'organic-ginkgo': 'Ginkgo Leaf',
  'organic-maple': 'Maple Leaf',
  'organic-heart-leaf': 'Heart Leaf',
  'organic-fern': 'Fern',
  'organic-tulip': 'Tulip',
  'organic-sakura': 'Cherry Blossom',
  'organic-lotus': 'Lotus',
  'organic-splash': 'Splash',
  'organic-puddle': 'Puddle',
  'organic-drip': 'Drip',
  'organic-flame': 'Flame',
  'organic-feather': 'Feather',
  'organic-shell': 'Scallop Shell',
  'organic-apple': 'Apple',
  'organic-lemon': 'Lemon',
  'organic-cherries': 'Cherries',
  'organic-pebbles': 'Pebble Cluster',
  'organic-stone': 'Stone',
  'organic-blob-long': 'Long Blob',
  'organic-blob-triangle': 'Triangular Blob',
  'organic-bean': 'Bean',
  'organic-amoeba': 'Amoeba',
  'organic-coral': 'Coral',
  'organic-cactus': 'Cactus',
  // wave
  'wave-sine': 'Gentle Wavy Line',
  'wave-tight': 'Fine Wavy Line',
  'wave-zigzag': 'Zigzag Line',
  'wave-square': 'Square Wave',
  'wave-coil': 'Spring Loop',
  'wave-scribble': 'Hand-Drawn Underline',
  // abstract
  'abstract-blob-cutout': 'Blob with Hole',
  'abstract-half-circles': 'Overlapping Semicircles',
  'abstract-quarter-deco': 'Quarter-Circle Ornament',
  'abstract-arch': 'Window Arch',
  'abstract-arc-band': 'Arc Band',
  'abstract-squiggle-band': 'Squiggle Band',
  'abstract-zigzag-band': 'Zigzag Band',
  'abstract-pills': 'Pill Cluster',
  'abstract-seal': 'Scalloped Seal',
  'abstract-swoosh': 'Swoosh',
  'abstract-triforce': 'Triangle Cluster',
  'abstract-lens': 'Lens',
  'abstract-crescent': 'Crescent',
  'abstract-squiggle': 'Squiggly Line',
  'abstract-confetti': 'Confetti',
  'abstract-split-circle': 'Split Circle',
  'abstract-pie-3q': 'Three-Quarter Circle',
  'abstract-pie-slice': 'Pie Slice',
  'abstract-c-ring': 'C-Shaped Ring',
  'abstract-concentric': 'Concentric Circles',
  'abstract-bolt': 'Lightning Bolt',
  'abstract-torn-strip': 'Torn Paper Strip',
  'abstract-brush': 'Brush Stroke',
  'abstract-wave-band': 'Wave Band',
  'abstract-blob-ring': 'Blob Ring',
  'abstract-corner-brackets': 'Corner Brackets',
  'abstract-leaf-corner': 'Leaf-Corner Square',
  'abstract-stripes': 'Diagonal Stripes',
  'abstract-dot-grid': 'Dot Grid',
  'abstract-tri-cutout': 'Circle with Triangle Cutout',
  'abstract-sticker': 'Round Starburst Sticker',
  'abstract-tapered': 'Tapered Line',
  'abstract-pill-dot': 'Pill and Dot',
  'abstract-stairs': 'Stairs',
  'abstract-chevron-stack': 'Chevron Stack',
  'abstract-diamonds': 'Diamond Cluster',
  'abstract-leaf-split': 'Split Leaf',
  'abstract-arch-frame': 'Arch Frame',
  'abstract-capsule-ring': 'Pill Ring',
  'abstract-venn-3': '3 Overlapping Circles',
  'abstract-venn-2': '2 Overlapping Circles',
  'abstract-plus-rounded': 'Rounded Plus',
  'abstract-shards': 'Shards',
  'abstract-spiral': 'Spiral',
  'abstract-sunburst': 'Sunburst',
  'abstract-crescent-pair': 'Facing Crescents',
  'abstract-scallop-band': 'Scalloped Band',
  'abstract-rounded-triangle': 'Rounded Triangle',
  'abstract-squircle': 'Squircle',
  'abstract-rainbow': 'Rainbow Band',
  // manga
  'manga-ellipse': 'Manga Oval Bubble',
  'manga-round': 'Manga Rounded Bubble',
  'manga-narration': 'Manga Narration Box',
  'manga-shout': 'Manga Shout Bubble',
  'manga-burst': 'Manga Burst',
  'manga-cloud': 'Manga Cloud Bubble',
  'manga-tremble': 'Manga Tremble Bubble',
  'manga-whisper': 'Manga Whisper Bubble',
  'manga-upright': 'Manga Bubble with Upper-Right Tail',
  'manga-spiky-soft': 'Manga Soft-Spike Bubble',
  'manga-thought': 'Manga Thought Bubble',
  'manga-rect-tail': 'Manga Rectangular Bubble with Tail',
};
export function shapeEnglishName(id) {
  const name = shapeEnglishNames[id];
  if (!name) throw new Error(`missing English shape name: ${id}`);
  return name;
}
export function generateIndexText() {
  const records = [];
  for (const category of catalog.categories) {
    for (const item of category.items) {
      const alias = rounded[item.id];
      const row = {
        id: item.id,
        category: category.key,
        name: item.name,
        vb: item.vb,
        d: item.d,
        kind: item.kind,
      };
      if (item.rule) row.rule = item.rule;
      if (alias) row.rounded_from = { base: alias[0], radius: alias[1] };
      row.defaults = {
        ...(item.kind === 'stroke' ? { fill: 'none', stroke: '#a6a6a6', strokeWidth: 4 } : shapeDefaults),
        ...(alias ? { cornerRadius: alias[1] } : {}),
      };
      row.i18n = { en: { name: shapeEnglishName(item.id), category: category.key } };
      records.push(row);
    }
  }

  const caps = [
    ['none', 'なし', true],
    ['triangle', '三角', true],
    ['chevron', '矢印', false],
    ['bar', '止め', false],
    ['square', '四角', true],
    ['circle', '丸', true],
    ['diamond', 'ひし形', true],
    ['square', '中抜き四角', false],
    ['circle', '中抜き丸', false],
    ['diamond', '中抜きひし形', false],
  ];
  const capCodes = ['none', 'tri', 'open', 'bar', 'sq', 'circ', 'dia', 'sqo', 'circo', 'diao'];
  const pairs = [
    ['none', 'none'],
    ['none', 'tri'],
    ['none', 'open'],
    ['tri', 'tri'],
    ['open', 'open'],
    ['bar', 'bar'],
    ['sq', 'sq'],
    ['circ', 'circ'],
    ['dia', 'dia'],
    ['sqo', 'sqo'],
    ['circo', 'circo'],
    ['diao', 'diao'],
    ['none', 'circ'],
    ['circ', 'tri'],
    ['bar', 'open'],
  ];
  for (const dash of ['solid', 'dash', 'dot']) {
    for (const [start, end] of pairs) {
      const a = caps[capCodes.indexOf(start)];
      const b = caps[capCodes.indexOf(end)];
      records.push({
        id: `line-${dash}-${start}-${end}`,
        category: 'line',
        name: `${{ solid: '実線', dash: '破線', dot: '点線' }[dash]}・${a[1]}・${b[1]}`,
        vb: [100, 20],
        d: 'M0 10L100 10',
        kind: 'line',
        defaults: {
          ...lineDefaults,
          dash,
          startCap: a[0],
          endCap: b[0],
          startCapFilled: a[2],
          endCapFilled: b[2],
        },
        i18n: { en: { name: `${{ solid: 'Solid', dash: 'Dashed', dot: 'Dotted' }[dash]} Line · ${{
          none: 'None', tri: 'Triangle', open: 'Arrow', bar: 'Bar', sq: 'Square', circ: 'Circle',
          dia: 'Diamond', sqo: 'Hollow Square', circo: 'Hollow Circle', diao: 'Hollow Diamond'
        }[start]} · ${{
          none: 'None', tri: 'Triangle', open: 'Arrow', bar: 'Bar', sq: 'Square', circ: 'Circle',
          dia: 'Diamond', sqo: 'Hollow Square', circo: 'Hollow Circle', diao: 'Hollow Diamond'
        }[end]}`, category: 'line' } },
      });
    }
  }

  const bubble = (id, name, change) => {
    const params = {
      style: 'ellipse',
      count: 16,
      depth: 40,
      jitter: 25,
      seed: 1,
      tail: 'point',
      tailAngle: 210,
      tailLength: 45,
      tailWidth: 30,
      tailCurve: 0,
      dash: 'solid',
      ...change,
    };
    records.push({
      id: `manga-${id}`,
      category: 'manga',
      name,
      vb: [100, 100],
      d: bubblePath(100, 100, params),
      kind: 'bubble',
      defaults: { ...bubbleDefaults, ...params },
      i18n: { en: { name: shapeEnglishName(`manga-${id}`), category: 'manga' } },
    });
  };
  bubble('ellipse', '楕円', {});
  bubble('round', '角丸', { style: 'rounded', tailAngle: 200, tailLength: 40, tailWidth: 28 });
  bubble('narration', 'ナレーション', { style: 'rect', tail: 'none' });
  bubble('shout', '叫び', {
    style: 'jagged',
    count: 22,
    depth: 42,
    jitter: 25,
    seed: 3,
    tailAngle: 215,
    tailLength: 40,
    tailWidth: 26,
  });
  bubble('burst', '爆発', { style: 'burst', count: 15, depth: 62, jitter: 70, seed: 7, tail: 'none' });
  bubble('cloud', 'もくもく', {
    style: 'cloud',
    count: 11,
    depth: 45,
    jitter: 30,
    seed: 5,
    tail: 'dots',
    tailAngle: 215,
    tailLength: 50,
    tailWidth: 40,
  });
  bubble('tremble', '震え', {
    style: 'wobble',
    count: 36,
    depth: 35,
    jitter: 20,
    seed: 2,
    tailAngle: 200,
    tailLength: 40,
    tailWidth: 28,
    tailCurve: -30,
  });
  bubble('whisper', 'ひそひそ', {
    dash: 'dash',
    tailAngle: 150,
    tailLength: 40,
    tailWidth: 22,
    tailCurve: 30,
  });
  bubble('upright', 'しっぽ右上', { tailAngle: 45, tailLength: 45, tailWidth: 30, tailCurve: 20 });
  bubble('spiky-soft', 'ギザ少なめ', {
    style: 'jagged',
    count: 13,
    depth: 30,
    jitter: 12,
    seed: 4,
    tailAngle: 200,
    tailLength: 40,
    tailWidth: 28,
  });
  bubble('thought', '考え中', { tail: 'dots', tailAngle: 200, tailLength: 50, tailWidth: 35 });
  bubble('rect-tail', '四角としっぽ', { style: 'rect', tailAngle: 195, tailLength: 42, tailWidth: 26 });

  if (new Set(records.map((r) => r.id)).size !== records.length) throw new Error('duplicate shape ID');
  return records.map((row) => JSON.stringify(row)).join('\n') + '\n';
}

export const indexText = generateIndexText();
if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  await writeFile(new URL('./index.jsonl', import.meta.url), indexText);
}
