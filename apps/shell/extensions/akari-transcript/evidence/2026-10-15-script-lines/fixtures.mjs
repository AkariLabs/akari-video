// 証跡の入力（evidence/ には JSON を置かない規律のため .mjs に持つ）
export const scriptFixture = {
  "version": 0,
  "kind": "akari-script",
  "lines": [
    {
      "id": "p-hook",
      "kind": "plan",
      "at": 0,
      "duration": 3,
      "text": "つかみ: 結論を先に言う",
      "done": false
    },
    {
      "id": "p-body",
      "kind": "plan",
      "at": 3,
      "duration": 40,
      "text": "本題: 3 つのポイント",
      "done": true
    },
    {
      "id": "m-01",
      "kind": "memo",
      "at": 12.5,
      "text": "ここで図解を差し込む"
    }
  ]
};
export const captionsFixture = [
  {
    "id": "c-0003",
    "start": 15,
    "end": 18,
    "text": "次に画面を見てください。"
  },
  {
    "id": "c-0001",
    "start": 1,
    "end": 3,
    "text": "結論からお話しします。"
  },
  {
    "id": "c-0002",
    "start": 7,
    "end": 10,
    "text": "まず最初のポイントです。"
  }
];
