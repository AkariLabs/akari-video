export const cuts = [0, 12, 144].map((at, track) => ({
  src: "src-1", in: 0, out: 37.6, at: at / 30, track,
}));

// Synthetic timings reproduce the 14 cues / 111.1s serial-projection regression.
export const captions = [
  [0.59, 2.1], [3, 5], [6, 7.5], [8, 9.5], [10, 11.5],
  [12, 13.5], [14, 15.5], [16, 17.5], [18, 19.5], [20, 21.5],
  [23, 24.5], [26, 27.5], [30, 31.5], [34, 35.9],
].map(([start, end], index) => ({
  id: `c-${String(index + 1).padStart(4, "0")}`,
  src: "src-1", start, end, text: `Caption ${index + 1}`, time_domain: "source",
}));

export const serialCuts = [
  { src: "src-1", in: 0, out: 12, transition_out: { type: "dissolve", duration: 0.5 } },
  { src: "src-1", in: 12, out: 24, speed: 2 },
  { src: "src-1", in: 24, out: 37.6, speed: 0.5 },
];
