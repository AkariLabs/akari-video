// TS の DOM lib は WebCodecs の型の大半を含むが、HardwarePreference は
// 環境（TS/electron 型パッケージ）によって欠けることがあるため最小限を補う。
// 既に lib.dom.d.ts 側に存在する場合は型の互換上問題にならない範囲の union のみ宣言する。
type HardwarePreference = 'no-preference' | 'prefer-hardware' | 'prefer-software';
