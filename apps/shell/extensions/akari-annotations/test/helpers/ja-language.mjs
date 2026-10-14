// 日本語の表示を期待するテストの先頭で読み込む。モジュールの読み込み時に辞書から文言を引く定数
// （行の名前など）があるため、言語の固定は対象のモジュールより前に済ませる（静的 import は記述順に評価される）。
import { after } from 'node:test';
import { setLanguage } from '@akari-video/i18n';

setLanguage('ja');
after(() => setLanguage(undefined));
