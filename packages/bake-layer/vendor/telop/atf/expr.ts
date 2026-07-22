// 安全な式評価器（非チューリング完全）
// eval/Function を使わず、自前トークナイザ + 再帰下降パーサで実装する

/** 式評価: scope に変数を渡して数値を返す */
export function evalExpr(src: string, scope: Record<string, number>): number {
  const tokens = tokenize(src)
  const parser = new Parser(tokens, scope)
  const result = parser.parseExpr()
  if (parser.pos < tokens.length) {
    throw new Error(`式の解析エラー: 残余トークン "${tokens[parser.pos].value}" at pos ${parser.pos}`)
  }
  return result
}

// === トークナイザ ===

type TokenKind = 'num' | 'ident' | 'op' | 'lparen' | 'rparen' | 'comma'

interface Token {
  kind: TokenKind
  value: string
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    // 空白スキップ
    if (/\s/.test(ch)) { i++; continue }
    // 数値（小数対応）
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let num = ''
      while (i < src.length && /[0-9.]/.test(src[i])) { num += src[i++] }
      tokens.push({ kind: 'num', value: num })
      continue
    }
    // 識別子（@id.prop や通常変数名を含む）
    // @から始まるか英数字/アンダーバーから始まる識別子
    if (ch === '@' || /[a-zA-Z_]/.test(ch)) {
      let ident = ''
      // @ で始まる場合は @ も含め、ドット込みで読む
      if (ch === '@') {
        ident += src[i++]
        // id.prop 形式: 英数字とアンダーバーとドットを読む
        while (i < src.length && /[a-zA-Z0-9_.]/.test(src[i])) { ident += src[i++] }
      } else {
        while (i < src.length && /[a-zA-Z0-9_]/.test(src[i])) { ident += src[i++] }
      }
      tokens.push({ kind: 'ident', value: ident })
      continue
    }
    // 演算子
    if ('+-*/'.includes(ch)) {
      tokens.push({ kind: 'op', value: ch })
      i++
      continue
    }
    if (ch === '(') { tokens.push({ kind: 'lparen', value: '(' }); i++; continue }
    if (ch === ')') { tokens.push({ kind: 'rparen', value: ')' }); i++; continue }
    if (ch === ',') { tokens.push({ kind: 'comma', value: ',' }); i++; continue }
    throw new Error(`不明なトークン: "${ch}" at position ${i}`)
  }
  return tokens
}

// === 再帰下降パーサ ===

class Parser {
  public pos = 0
  constructor(
    private readonly tokens: Token[],
    private readonly scope: Record<string, number>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private consume(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new Error('トークン不足')
    this.pos++
    return t
  }

  // 加減算（最低優先度）
  parseExpr(): number {
    let left = this.parseTerm()
    while (this.peek()?.kind === 'op' && (this.peek()?.value === '+' || this.peek()?.value === '-')) {
      const op = this.consume().value
      const right = this.parseTerm()
      left = op === '+' ? left + right : left - right
    }
    return left
  }

  // 乗除算
  private parseTerm(): number {
    let left = this.parseUnary()
    while (this.peek()?.kind === 'op' && (this.peek()?.value === '*' || this.peek()?.value === '/')) {
      const op = this.consume().value
      const right = this.parseUnary()
      if (op === '/' && right === 0) throw new Error('ゼロ除算')
      left = op === '*' ? left * right : left / right
    }
    return left
  }

  // 単項マイナス
  private parseUnary(): number {
    if (this.peek()?.kind === 'op' && this.peek()?.value === '-') {
      this.consume()
      return -this.parsePrimary()
    }
    return this.parsePrimary()
  }

  // 基本要素: 数値 / 括弧 / 関数呼び出し / 識別子
  private parsePrimary(): number {
    const t = this.peek()
    if (!t) throw new Error('式の終端が早すぎます')

    // 数値リテラル
    if (t.kind === 'num') {
      this.consume()
      return parseFloat(t.value)
    }

    // 括弧式
    if (t.kind === 'lparen') {
      this.consume()
      const val = this.parseExpr()
      if (this.peek()?.kind !== 'rparen') throw new Error('")" が必要')
      this.consume()
      return val
    }

    // 識別子（関数呼び出し or 変数参照）
    if (t.kind === 'ident') {
      this.consume()
      // 関数呼び出し
      if (this.peek()?.kind === 'lparen') {
        this.consume() // '('
        const args = this.parseArgList()
        if (this.peek()?.kind !== 'rparen') throw new Error('")" が必要')
        this.consume() // ')'
        return this.callFn(t.value, args)
      }
      // 変数参照（@id.prop 形式も通常変数名もここ）
      return this.lookupVar(t.value)
    }

    throw new Error(`予期しないトークン: "${t.value}" (kind=${t.kind})`)
  }

  // 引数リストのパース
  private parseArgList(): number[] {
    const args: number[] = []
    if (this.peek()?.kind === 'rparen') return args
    args.push(this.parseExpr())
    while (this.peek()?.kind === 'comma') {
      this.consume()
      args.push(this.parseExpr())
    }
    return args
  }

  // 組み込み関数
  private callFn(name: string, args: number[]): number {
    switch (name) {
      case 'min':
        if (args.length !== 2) throw new Error('min(a, b) は引数2個')
        return Math.min(args[0], args[1])
      case 'max':
        if (args.length !== 2) throw new Error('max(a, b) は引数2個')
        return Math.max(args[0], args[1])
      case 'clamp':
        if (args.length !== 3) throw new Error('clamp(x, lo, hi) は引数3個')
        return Math.min(Math.max(args[0], args[1]), args[2])
      case 'has':
        // has(varName): scope に varName が存在すれば 1、なければ 0
        // 引数は識別子として渡されるが数値評価された後なので、
        // has は特殊扱い: 引数を文字列として取り出す必要がある
        // → has は parseArgList の前に特別処理する必要があるため、
        //   ここでは args[0] が 0 以外 = 定義あり、0 = 定義なし で扱う
        // ※ has() は専用パスで処理済み（下記 lookupVarSafe + 特殊構文）
        return args.length > 0 && args[0] !== 0 ? 1 : 0
      default:
        throw new Error(`不明な関数: "${name}"`)
    }
  }

  // 変数・@ 参照の lookup
  private lookupVar(name: string): number {
    if (name in this.scope) return this.scope[name]
    throw new Error(`未定義の参照: "${name}"`)
  }
}

/**
 * has(varKey) 専用: scope に key が含まれているかを 0/1 で返す
 * 式中では has を直接使わず、evalExprWithHas 経由で使う
 */
export function evalExprWithHas(src: string, scope: Record<string, number>, hasKeys: Set<string>): number {
  // has(key) を 0 or 1 に事前置換
  const expanded = src.replace(/has\(([^)]+)\)/g, (_, key) => hasKeys.has(key.trim()) ? '1' : '0')
  return evalExpr(expanded, scope)
}
