// 証跡の入力（evidence/ には JSON を置かない規律のため .mjs に持つ）
export const scriptFixture = {
  "version": 0,
  "kind": "akari-script",
  "lines": [
    {
      "id": "p-hook",
      "kind": "plan",
      "at": 1,
      "duration": 5,
      "text": "つかみ: 結論を先に言う"
    },
    {
      "id": "p-body",
      "kind": "plan",
      "at": 8,
      "duration": 5,
      "text": "本題: 3 つのポイント",
      "done": true
    },
    {
      "id": "m-01",
      "kind": "memo",
      "at": 15,
      "text": "ここで図解を差し込む"
    }
  ]
};
