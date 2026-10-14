/**
 * Spreadsheet Studio -- formula engine.
 *
 * A real tokenizer/parser/dependency-graph/evaluator, written from scratch
 * rather than pulling in an existing spreadsheet library: the mature options
 * (HyperFormula and similar) ship under GPLv3, which is a real problem for
 * an app that gets bundled and distributed to clients as a proprietary
 * product. Scoping our own grammar tightly --
 * arithmetic, cell/range refs, comparisons, a curated function set -- is
 * both safer and, for what a financial model actually needs, not that much
 * smaller than Excel's.
 *
 * Runs entirely client-side and synchronously: a model can have hundreds of
 * formula cells and every keystroke in an assumption cell should feel
 * instant, so recalculation is a plain topological walk over an
 * adjacency-list dependency graph, not anything async or server-round-tripped.
 *
 * Cell references use standard A1 notation (column letters, 1-based row).
 */

// ─── Cell reference parsing ─────────────────────────────────────────────

export function colLettersToIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1; // 0-based
}

export function colIndexToLetters(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const CELL_REF_RE = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;

export function parseCellRef(ref: string): { col: number; row: number } | null {
  const m = CELL_REF_RE.exec(ref.trim());
  if (!m) return null;
  return { col: colLettersToIndex(m[1]), row: parseInt(m[2], 10) - 1 };
}

export function cellRefToString(col: number, row: number): string {
  return `${colIndexToLetters(col)}${row + 1}`;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────

type TokenType = "number" | "string" | "ref" | "range" | "ident" | "op" | "lparen" | "rparen" | "comma" | "eof";
interface Token { type: TokenType; value: string }

const OPERATORS = ["<=", ">=", "<>", "+", "-", "*", "/", "^", "=", "<", ">", "%", "&"];

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];
    if (ch === " " || ch === "\t") { i++; continue; }

    if (ch === "(") { tokens.push({ type: "lparen", value: ch }); i++; continue; }
    if (ch === ")") { tokens.push({ type: "rparen", value: ch }); i++; continue; }
    if (ch === ",") { tokens.push({ type: "comma", value: ch }); i++; continue; }

    if (ch === '"') {
      let j = i + 1;
      let s = "";
      while (j < n && input[j] !== '"') { s += input[j]; j++; }
      tokens.push({ type: "string", value: s });
      i = j + 1;
      continue;
    }

    if (/[0-9.]/.test(ch)) {
      let j = i;
      while (j < n && /[0-9.]/.test(input[j])) j++;
      tokens.push({ type: "number", value: input.slice(i, j) });
      i = j;
      continue;
    }

    // Cell ref, range, or function/identifier name -- all start with a
    // letter or $. Disambiguated after reading the full alnum run: a
    // trailing digit run makes it a ref candidate, otherwise it's an ident.
    if (/[A-Za-z$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9$]/.test(input[j])) j++;
      let word = input.slice(i, j);
      i = j;
      // Range: WORD immediately followed by ':' and another ref-shaped word.
      if (input[i] === ":" && CELL_REF_RE.test(word)) {
        let k = i + 1;
        while (k < n && /[A-Za-z0-9$]/.test(input[k])) k++;
        const second = input.slice(i + 1, k);
        if (CELL_REF_RE.test(second)) {
          tokens.push({ type: "range", value: `${word}:${second}` });
          i = k;
          continue;
        }
      }
      if (CELL_REF_RE.test(word)) {
        tokens.push({ type: "ref", value: word });
      } else {
        tokens.push({ type: "ident", value: word });
      }
      continue;
    }

    // Multi-char operators before single-char ones.
    const two = input.slice(i, i + 2);
    if (OPERATORS.includes(two)) { tokens.push({ type: "op", value: two }); i += 2; continue; }
    if (OPERATORS.includes(ch)) { tokens.push({ type: "op", value: ch }); i++; continue; }

    throw new FormulaError(`#ERROR! Unexpected character '${ch}'`);
  }

  tokens.push({ type: "eof", value: "" });
  return tokens;
}

// ─── AST ─────────────────────────────────────────────────────────────────

export type AstNode =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "ref"; col: number; row: number }
  | { kind: "range"; fromCol: number; fromRow: number; toCol: number; toRow: number }
  | { kind: "unary"; op: string; arg: AstNode }
  | { kind: "binary"; op: string; left: AstNode; right: AstNode }
  | { kind: "call"; name: string; args: AstNode[] };

export class FormulaError extends Error {}

// Recursive-descent parser, standard precedence (low to high):
// comparison  <  concat(&)  <  add/sub  <  mul/div  <  unary  <  power  <  postfix(%)
class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) { this.tokens = tokens; }

  private peek(): Token { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }
  private expect(type: TokenType): Token {
    const t = this.next();
    if (t.type !== type) throw new FormulaError(`#ERROR! Expected ${type}, got ${t.type}`);
    return t;
  }

  parse(): AstNode {
    const node = this.parseComparison();
    this.expect("eof");
    return node;
  }

  private parseComparison(): AstNode {
    let left = this.parseConcat();
    while (this.peek().type === "op" && ["=", "<", ">", "<=", ">=", "<>"].includes(this.peek().value)) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseConcat() };
    }
    return left;
  }

  private parseConcat(): AstNode {
    let left = this.parseAddSub();
    while (this.peek().type === "op" && this.peek().value === "&") {
      this.next();
      left = { kind: "binary", op: "&", left, right: this.parseAddSub() };
    }
    return left;
  }

  private parseAddSub(): AstNode {
    let left = this.parseMulDiv();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseMulDiv() };
    }
    return left;
  }

  private parseMulDiv(): AstNode {
    let left = this.parseUnary();
    while (this.peek().type === "op" && (this.peek().value === "*" || this.peek().value === "/")) {
      const op = this.next().value;
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): AstNode {
    if (this.peek().type === "op" && (this.peek().value === "-" || this.peek().value === "+")) {
      const op = this.next().value;
      return { kind: "unary", op, arg: this.parseUnary() };
    }
    return this.parsePower();
  }

  private parsePower(): AstNode {
    const base = this.parsePostfix();
    if (this.peek().type === "op" && this.peek().value === "^") {
      this.next();
      // Right-associative.
      const exp = this.parseUnary();
      return { kind: "binary", op: "^", left: base, right: exp };
    }
    return base;
  }

  private parsePostfix(): AstNode {
    let node = this.parsePrimary();
    if (this.peek().type === "op" && this.peek().value === "%") {
      this.next();
      node = { kind: "binary", op: "/", left: node, right: { kind: "number", value: 100 } };
    }
    return node;
  }

  private parsePrimary(): AstNode {
    const t = this.peek();

    if (t.type === "number") { this.next(); return { kind: "number", value: parseFloat(t.value) }; }
    if (t.type === "string") { this.next(); return { kind: "string", value: t.value }; }

    if (t.type === "ref") {
      this.next();
      const r = parseCellRef(t.value)!;
      return { kind: "ref", col: r.col, row: r.row };
    }

    if (t.type === "range") {
      this.next();
      const [a, b] = t.value.split(":");
      const ra = parseCellRef(a)!;
      const rb = parseCellRef(b)!;
      return {
        kind: "range",
        fromCol: Math.min(ra.col, rb.col), fromRow: Math.min(ra.row, rb.row),
        toCol: Math.max(ra.col, rb.col), toRow: Math.max(ra.row, rb.row),
      };
    }

    if (t.type === "lparen") {
      this.next();
      const inner = this.parseComparison();
      this.expect("rparen");
      return inner;
    }

    if (t.type === "ident") {
      this.next();
      if (this.peek().type === "lparen") {
        this.next();
        const args: AstNode[] = [];
        if (this.peek().type !== "rparen") {
          args.push(this.parseComparison());
          while (this.peek().type === "comma") {
            this.next();
            args.push(this.parseComparison());
          }
        }
        this.expect("rparen");
        return { kind: "call", name: t.value.toUpperCase(), args };
      }
      // Bare identifier with no call -- e.g. TRUE/FALSE.
      const upper = t.value.toUpperCase();
      if (upper === "TRUE") return { kind: "number", value: 1 };
      if (upper === "FALSE") return { kind: "number", value: 0 };
      throw new FormulaError(`#NAME? Unknown identifier '${t.value}'`);
    }

    throw new FormulaError(`#ERROR! Unexpected token '${t.value}'`);
  }
}

export function parseFormula(input: string): AstNode {
  return new Parser(tokenize(input)).parse();
}

// ─── Dependency extraction ──────────────────────────────────────────────

export function extractDependencies(node: AstNode): string[] {
  const deps = new Set<string>();
  function walk(n: AstNode) {
    switch (n.kind) {
      case "ref":
        deps.add(cellRefToString(n.col, n.row));
        break;
      case "range":
        for (let c = n.fromCol; c <= n.toCol; c++) {
          for (let r = n.fromRow; r <= n.toRow; r++) deps.add(cellRefToString(c, r));
        }
        break;
      case "unary":
        walk(n.arg);
        break;
      case "binary":
        walk(n.left); walk(n.right);
        break;
      case "call":
        n.args.forEach(walk);
        break;
    }
  }
  walk(node);
  return Array.from(deps);
}

// ─── Fill / relative-reference translation ──────────────────────────────
//
// "Fill down/right" -- a core spreadsheet expectation, and the reason
// template builders (modelTemplates.ts) previously had to hand-write one
// formula string per projection column instead of writing it once. Operates
// on the token stream rather than the AST: since tokenize() already
// succeeded on the source formula, the token sequence is guaranteed to
// alternate validly, so translating each ref/range token in place and
// rejoining is enough to produce an equivalent, shifted formula -- no need
// to re-derive precedence or re-walk a tree just to move some references.

function translateRefPart(ref: string, dCol: number, dRow: number): string {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref);
  if (!m) return ref;
  const [, colAbs, colLetters, rowAbs, rowDigits] = m;
  const col = colAbs ? colLettersToIndex(colLetters) : colLettersToIndex(colLetters) + dCol;
  const row = rowAbs ? parseInt(rowDigits, 10) - 1 : parseInt(rowDigits, 10) - 1 + dRow;
  if (col < 0 || row < 0) throw new FormulaError("#REF!");
  return `${colAbs}${colIndexToLetters(col)}${rowAbs}${row + 1}`;
}

/**
 * Shifts every relative reference in a formula by (dCol, dRow), leaving
 * absolute ($-prefixed) parts untouched -- the same semantics as dragging a
 * fill handle or copy/pasting a formula in Excel/Sheets. Non-formula cells
 * (literals) are returned unchanged; a plain copy is the correct fill
 * behavior for those.
 */
export function translateFormula(raw: string, dCol: number, dRow: number): string {
  if (!isFormulaCell(raw)) return raw;
  if (dCol === 0 && dRow === 0) return raw;
  const tokens = tokenize(raw.slice(1));
  const out: string[] = [];
  for (const t of tokens) {
    if (t.type === "eof") break;
    if (t.type === "ref") {
      out.push(translateRefPart(t.value, dCol, dRow));
    } else if (t.type === "range") {
      const [from, to] = t.value.split(":");
      out.push(`${translateRefPart(from, dCol, dRow)}:${translateRefPart(to, dCol, dRow)}`);
    } else if (t.type === "string") {
      out.push(`"${t.value}"`);
    } else {
      out.push(t.value);
    }
  }
  return `=${out.join("")}`;
}

// ─── Structural edits: insert/delete row or column ──────────────────────
//
// A different kind of reference shift from fill/copy's translateFormula
// above: this one is CONDITIONAL (only refs at-or-past the edit point
// move) and applies to EVERY reference regardless of $ -- a structural
// sheet edit moves the actual cell, so anything pointing at it has to
// follow, unlike a fill/copy where $ means "stay put on purpose". A
// reference that lands inside a just-deleted band has genuinely lost its
// target, same as Excel's #REF!.

function shiftRefForStructuralChange(ref: string, kind: "row" | "col", at: number, count: number, isInsert: boolean): string {
  const m = /^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$/.exec(ref);
  if (!m) return ref;
  const [, colAbs, colLetters, rowAbs, rowDigits] = m;
  let col = colLettersToIndex(colLetters);
  let row = parseInt(rowDigits, 10) - 1;
  const idx = kind === "row" ? row : col;
  if (isInsert) {
    if (idx >= at) { if (kind === "row") row += count; else col += count; }
  } else {
    if (idx >= at && idx < at + count) throw new FormulaError("#REF!");
    if (idx >= at + count) { if (kind === "row") row -= count; else col -= count; }
  }
  if (row < 0 || col < 0) throw new FormulaError("#REF!");
  return `${colAbs}${colIndexToLetters(col)}${rowAbs}${row + 1}`;
}

/**
 * Shifts every reference in a formula for a structural row/column
 * insert-or-delete. Throws (rather than partially rewriting) if any single
 * reference inside the formula would land inside a deleted band -- the
 * caller decides how to represent that (this engine represents it as the
 * whole cell becoming a "#REF!" text value, simpler and just as visible in
 * the flagged-cells audit as Excel's inline #REF! token, without needing a
 * new AST node type just to embed an error literal mid-formula).
 */
function shiftFormulaForStructuralChange(raw: string, kind: "row" | "col", at: number, count: number, isInsert: boolean): string {
  if (!isFormulaCell(raw)) return raw;
  const tokens = tokenize(raw.slice(1));
  const out: string[] = [];
  for (const t of tokens) {
    if (t.type === "eof") break;
    if (t.type === "ref") {
      out.push(shiftRefForStructuralChange(t.value, kind, at, count, isInsert));
    } else if (t.type === "range") {
      const [from, to] = t.value.split(":");
      out.push(`${shiftRefForStructuralChange(from, kind, at, count, isInsert)}:${shiftRefForStructuralChange(to, kind, at, count, isInsert)}`);
    } else if (t.type === "string") {
      out.push(`"${t.value}"`);
    } else {
      out.push(t.value);
    }
  }
  return `=${out.join("")}`;
}

/** Same shift, applied to a named range's target text ("C8" or "A1:A3") -- so a name follows the cell it points at when rows/columns move around it. */
function shiftNameTarget(target: string, kind: "row" | "col", at: number, count: number, isInsert: boolean): string {
  const parts = target.split(":");
  try {
    return parts.map((p) => shiftRefForStructuralChange(p.trim(), kind, at, count, isInsert)).join(":");
  } catch {
    return target; // the name's target fell into a deleted band -- leave it pointing at its old (now-gone) address rather than silently mis-repointing it
  }
}

// ─── Named ranges ────────────────────────────────────────────────────────
//
// "=Revenue*TaxRate" instead of "=C13*$C$8" -- self-documenting formulas at
// the cost of one indirection. Implemented as a text-substitution pre-pass
// rather than a new AST node kind: resolveNamedRanges() expands each bare
// identifier that matches a defined name into its target ref/range text
// BEFORE the string reaches parseFormula(), so the AST, dependency
// extraction, evaluator, and circular-reference detection all stay exactly
// as they were -- they only ever see plain refs/ranges, never a name. The
// cost is that CellState.raw (what's shown in the formula bar, and what
// round-trips through .xlsx) must keep the ORIGINAL name-using text; only
// the parsed/evaluated copy goes through resolution. A function-call
// identifier (immediately followed by "(") is never treated as a name, so a
// name can't accidentally shadow SUM/IF/etc.

function resolveNamedRanges(raw: string, names: ReadonlyMap<string, string>): string {
  if (!isFormulaCell(raw)) return raw;
  if (names.size === 0) return raw;
  const tokens = tokenize(raw.slice(1));
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.type === "eof") break;
    if (t.type === "ident") {
      const target = names.get(t.value.toUpperCase());
      const nextIsCall = tokens[i + 1]?.type === "lparen";
      if (target && !nextIsCall) { out.push(target); continue; }
    }
    if (t.type === "string") out.push(`"${t.value}"`);
    else out.push(t.value);
  }
  return `=${out.join("")}`;
}

/** True if `raw` (as a formula) references `name` as a bare identifier -- used to know which cells need re-resolving when a name is redefined. */
function formulaUsesName(raw: string, name: string): boolean {
  if (!isFormulaCell(raw)) return false;
  const upper = name.toUpperCase();
  const tokens = tokenize(raw.slice(1));
  return tokens.some((t, i) => t.type === "ident" && t.value.toUpperCase() === upper && tokens[i + 1]?.type !== "lparen");
}

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  if (!NAME_RE.test(trimmed)) return false;
  if (CELL_REF_RE.test(trimmed)) return false; // can't shadow a real cell ref like "AB12"
  if (trimmed.toUpperCase() === "TRUE" || trimmed.toUpperCase() === "FALSE") return false;
  return true;
}

// ─── Function library ───────────────────────────────────────────────────

type CellValue = number | string | null;

function toNumber(v: CellValue): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  const n = parseFloat(v);
  return Number.isNaN(n) ? 0 : n;
}

// Every function argument arrives as an FnArg: a flat, row-major .values
// array plus its original shape. A single scalar argument (not a range)
// becomes {values:[v], numRows:1, numCols:1}. Flat access (SUM, AVERAGE,
// ...) only ever needs .values; 2D-aware functions (INDEX, VLOOKUP's table
// argument, ...) need numRows/numCols to reshape the flat array back into
// a grid, since Excel's row/column addressing has no other way to know
// where one row ends and the next begins.
interface FnArg { values: CellValue[]; numRows: number; numCols: number }

function scalarArg(v: CellValue): FnArg {
  return { values: [v], numRows: 1, numCols: 1 };
}

function flatten(args: FnArg[]): number[] {
  return args.flatMap((a) => a.values).filter((v) => v !== null && v !== "").map(toNumber);
}

// ─── Lookup helpers ──────────────────────────────────────────────────────

function looseEquals(a: CellValue, b: CellValue): boolean {
  if (a === null || b === null) return a === b;
  if (typeof a === "number" && typeof b === "number") return a === b;
  return String(a).toLowerCase() === String(b).toLowerCase();
}

function compareForLookup(a: CellValue, b: CellValue): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const as = String(a ?? ""), bs = String(b ?? "");
  return as < bs ? -1 : as > bs ? 1 : 0;
}

// ─── SUMIF/COUNTIF-family criteria ──────────────────────────────────────
// A criteria argument is either a bare value (implicit "=") or a string
// starting with a comparison operator, e.g. ">100", "<>0", "Technology".

function parseCriteria(criteria: CellValue): { op: string; operand: number | string } {
  const s = String(criteria ?? "").trim();
  const m = /^(<=|>=|<>|<|>|=)(.*)$/.exec(s);
  const opAndRest = m ? { op: m[1], rest: m[2] } : { op: "=", rest: s };
  const n = Number(opAndRest.rest);
  const operand = opAndRest.rest !== "" && !Number.isNaN(n) ? n : opAndRest.rest;
  return { op: opAndRest.op, operand };
}

function matchesCriteria(value: CellValue, criteria: CellValue): boolean {
  const { op, operand } = parseCriteria(criteria);
  if (typeof operand === "number") {
    const v = typeof value === "number" ? value : Number(value);
    if (Number.isNaN(v)) return op === "<>";
    switch (op) {
      case "=": return v === operand;
      case "<>": return v !== operand;
      case "<": return v < operand;
      case ">": return v > operand;
      case "<=": return v <= operand;
      case ">=": return v >= operand;
      default: return false;
    }
  }
  const v = value === null ? "" : String(value);
  switch (op) {
    case "=": return v.toLowerCase() === operand.toLowerCase();
    case "<>": return v.toLowerCase() !== operand.toLowerCase();
    default: return false; // <,>,<=,>= against a text criteria isn't meaningful
  }
}

// ─── Dates ───────────────────────────────────────────────────────────────
// Serial = whole days since the Unix epoch (1970-01-01), NOT Excel's native
// 1900-based serial (which also carries Excel's well-known intentional 1900
// leap-year bug). Chosen deliberately: internal date arithmetic (DATE,
// EDATE, DATEDIF, ...) only needs to be self-consistent, not byte-identical
// to Excel's serial number -- replicating the 1900 quirk would be pure
// compatibility debt with no benefit, since nothing here writes an xlsx
// date-formatted cell that Excel would need to reinterpret as a native date
// serial.

const MS_PER_DAY = 86400000;

function serialToDate(serial: number): Date {
  return new Date(serial * MS_PER_DAY);
}

function dateToSerial(d: Date): number {
  return Math.floor(d.getTime() / MS_PER_DAY);
}

// ─── TEXT() number formatting ────────────────────────────────────────────
// Supports the common patterns actually used in financial models -- percent,
// currency, thousands separator, fixed decimals -- not the full Excel
// custom-format mini-language (date tokens, conditional color sections,
// [Red] etc.). Covers "0.0%", "$#,##0.00", "#,##0", "0.00" and similar.

export function formatNumberPattern(value: number, pattern: string): string {
  const isPercent = pattern.includes("%");
  const v = isPercent ? value * 100 : value;
  const decimalMatch = /\.(0+)/.exec(pattern);
  const decimals = decimalMatch ? decimalMatch[1].length : 0;
  const hasThousands = pattern.includes(",");
  const prefixMatch = /^([^\d#.,%]*)/.exec(pattern);
  const prefix = prefixMatch ? prefixMatch[1] : "";
  let numStr = Math.abs(v).toFixed(decimals);
  if (hasThousands) {
    const [intPart, decPart] = numStr.split(".");
    numStr = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (decPart ? `.${decPart}` : "");
  }
  const sign = v < 0 ? "-" : "";
  return `${sign}${prefix}${numStr}${isPercent ? "%" : ""}`;
}

// ─── Statistics ──────────────────────────────────────────────────────────

function stdev(values: number[], sample: boolean): number {
  if (values.length < (sample ? 2 : 1)) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSq = values.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(sumSq / (sample ? values.length - 1 : values.length));
}

function linearRegression(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return { slope: 0, intercept: ys[0] ?? 0 };
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den === 0 ? 0 : num / den;
  return { slope, intercept: my - slope * mx };
}

/** Standard Excel NPV convention: the first value is discounted one period (not period 0). */
function npv(rate: number, values: number[]): number {
  return values.reduce((sum, v, i) => sum + v / Math.pow(1 + rate, i + 1), 0);
}

/** Newton-Raphson with a bisection fallback -- IRR has no closed form. */
function irr(values: number[], guess = 0.1): number {
  let rate = guess;
  for (let iter = 0; iter < 100; iter++) {
    let f = 0;
    let fPrime = 0;
    for (let t = 0; t < values.length; t++) {
      f += values[t] / Math.pow(1 + rate, t);
      fPrime += (-t * values[t]) / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(f) < 1e-9) return rate;
    if (fPrime === 0) break;
    const next = rate - f / fPrime;
    if (!Number.isFinite(next)) break;
    rate = next;
  }
  // Newton diverged (common for pathological cash flow sequences) -- bisect
  // over a wide, still-sane rate range rather than returning a garbage
  // number silently.
  let lo = -0.99, hi = 10;
  const npvAt = (r: number) => values.reduce((s, v, t) => s + v / Math.pow(1 + r, t), 0);
  let fLo = npvAt(lo), fHi = npvAt(hi);
  if (Math.sign(fLo) === Math.sign(fHi)) throw new FormulaError("#NUM! IRR did not converge");
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npvAt(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

function pmt(rate: number, nper: number, pv: number): number {
  if (rate === 0) return -pv / nper;
  return (-pv * rate * Math.pow(1 + rate, nper)) / (Math.pow(1 + rate, nper) - 1);
}

function fv(rate: number, nper: number, pmtAmt: number, pv: number): number {
  if (rate === 0) return -(pv + pmtAmt * nper);
  return -(pv * Math.pow(1 + rate, nper) + pmtAmt * (Math.pow(1 + rate, nper) - 1) / rate);
}

function pv(rate: number, nper: number, pmtAmt: number, fvAmt: number): number {
  if (rate === 0) return -(fvAmt + pmtAmt * nper);
  return -(fvAmt + pmtAmt * (Math.pow(1 + rate, nper) - 1) / rate) / Math.pow(1 + rate, nper);
}

function nper(rate: number, pmtAmt: number, pvAmt: number, fvAmt: number): number {
  if (rate === 0) return -(pvAmt + fvAmt) / pmtAmt;
  const numerator = pmtAmt * (1 + rate) - fvAmt * rate;
  const denominator = pvAmt * rate + pmtAmt * (1 + rate);
  return Math.log(numerator / denominator) / Math.log(1 + rate);
}

/** Newton-Raphson (bisection fallback) solving for the periodic rate given nper/pmt/pv/fv -- no closed form, same reasoning as IRR. */
function rate(nperAmt: number, pmtAmt: number, pvAmt: number, fvAmt: number, guess = 0.1): number {
  const f = (r: number) => (r === 0 ? pvAmt + pmtAmt * nperAmt + fvAmt : pvAmt * Math.pow(1 + r, nperAmt) + pmtAmt * ((Math.pow(1 + r, nperAmt) - 1) / r) + fvAmt);
  let r = guess;
  for (let iter = 0; iter < 100; iter++) {
    const h = 1e-6;
    const fr = f(r);
    const fPrime = (f(r + h) - f(r - h)) / (2 * h);
    if (Math.abs(fr) < 1e-9) return r;
    if (fPrime === 0) break;
    const next = r - fr / fPrime;
    if (!Number.isFinite(next) || next <= -1) break;
    r = next;
  }
  let lo = -0.99, hi = 10;
  let fLo = f(lo), fHi = f(hi);
  if (Math.sign(fLo) === Math.sign(fHi)) throw new FormulaError("#NUM! RATE did not converge");
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = f(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

/** XNPV: irregular-date NPV, discounting each flow by its actual days-from-first-flow / 365 rather than assuming evenly-spaced periods -- the version every PE/credit desk actually uses (see the Spreadsheet Studio research doc). */
function xnpv(rate: number, values: number[], dateSerials: number[]): number {
  if (values.length === 0) return 0;
  const t0 = dateSerials[0];
  return values.reduce((sum, v, i) => sum + v / Math.pow(1 + rate, (dateSerials[i] - t0) / 365), 0);
}

/** XIRR: the rate that zeroes XNPV. Same Newton-with-bisection-fallback shape as IRR. */
function xirr(values: number[], dateSerials: number[], guess = 0.1): number {
  let r = guess;
  for (let iter = 0; iter < 100; iter++) {
    const t0 = dateSerials[0];
    let f = 0, fPrime = 0;
    for (let i = 0; i < values.length; i++) {
      const t = (dateSerials[i] - t0) / 365;
      f += values[i] / Math.pow(1 + r, t);
      fPrime += (-t * values[i]) / Math.pow(1 + r, t + 1);
    }
    if (Math.abs(f) < 1e-9) return r;
    if (fPrime === 0) break;
    const next = r - f / fPrime;
    if (!Number.isFinite(next) || next <= -1) break;
    r = next;
  }
  let lo = -0.99, hi = 10;
  const xnpvAt = (r: number) => xnpv(r, values, dateSerials);
  let fLo = xnpvAt(lo), fHi = xnpvAt(hi);
  if (Math.sign(fLo) === Math.sign(fHi)) throw new FormulaError("#NUM! XIRR did not converge");
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = xnpvAt(mid);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

/** MIRR: like IRR, but reinvests positive flows at finance_rate and discounts negative flows at reinvest_rate -- avoids IRR's unrealistic "reinvested at IRR itself" assumption. */
function mirr(values: number[], financeRate: number, reinvestRate: number): number {
  const n = values.length - 1;
  let pvNeg = 0, fvPos = 0;
  values.forEach((v, t) => {
    if (v < 0) pvNeg += v / Math.pow(1 + financeRate, t);
    else if (v > 0) fvPos += v * Math.pow(1 + reinvestRate, n - t);
  });
  if (pvNeg === 0 || n <= 0) return 0;
  return Math.pow(-fvPos / pvNeg, 1 / n) - 1;
}

function sln(cost: number, salvage: number, life: number): number {
  return life === 0 ? 0 : (cost - salvage) / life;
}

/** Double-declining-balance depreciation for a given period (1-indexed). */
function ddb(cost: number, salvage: number, life: number, period: number): number {
  const rate = 2 / life;
  let bookValue = cost;
  let depreciation = 0;
  for (let p = 1; p <= period; p++) {
    depreciation = Math.min(bookValue * rate, bookValue - salvage);
    bookValue -= depreciation;
  }
  return Math.max(0, depreciation);
}

/** Sum-of-years-digits depreciation for a given period (1-indexed). */
function syd(cost: number, salvage: number, life: number, period: number): number {
  const sumOfYears = (life * (life + 1)) / 2;
  return ((cost - salvage) * (life - period + 1)) / sumOfYears;
}

// IF/AND/OR/IFERROR/IFNA/ISERROR/ISNA/ISBLANK/ISNUMBER/ISTEXT are NOT in
// this table -- they're special-cased in evalNode's "call" branch instead,
// since they need access to the unevaluated argument ASTs (to short-circuit
// which branch actually gets evaluated, or to catch an error thrown by
// evaluating one branch) rather than a pre-computed value. Every other
// function is a pure function of its already-evaluated arguments, which is
// what this table is for.
const FUNCTIONS: Record<string, (args: FnArg[]) => CellValue> = {
  // ── Aggregation ──────────────────────────────────────────────────────
  SUM: (args) => flatten(args).reduce((a, b) => a + b, 0),
  AVERAGE: (args) => { const v = flatten(args); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; },
  MIN: (args) => { const v = flatten(args); return v.length ? Math.min(...v) : 0; },
  MAX: (args) => { const v = flatten(args); return v.length ? Math.max(...v) : 0; },
  COUNT: (args) => flatten(args).length,
  COUNTA: (args) => args.flatMap((a) => a.values).filter((v) => v !== null && v !== "").length,
  MEDIAN: (args) => { const v = flatten(args).slice().sort((a, b) => a - b); if (!v.length) return 0; const mid = Math.floor(v.length / 2); return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2; },
  LARGE: (args) => { const v = flatten([args[0] ?? scalarArg(null)]).slice().sort((a, b) => b - a); const k = Math.trunc(toNumber(args[1]?.values[0] ?? 1)); return v[k - 1] ?? 0; },
  SMALL: (args) => { const v = flatten([args[0] ?? scalarArg(null)]).slice().sort((a, b) => a - b); const k = Math.trunc(toNumber(args[1]?.values[0] ?? 1)); return v[k - 1] ?? 0; },
  PERCENTILE: (args) => {
    const v = flatten([args[0] ?? scalarArg(null)]).slice().sort((a, b) => a - b);
    if (!v.length) return 0;
    const k = Math.min(1, Math.max(0, toNumber(args[1]?.values[0] ?? 0)));
    const idx = k * (v.length - 1);
    const lo = Math.floor(idx), hi = Math.ceil(idx);
    return lo === hi ? v[lo] : v[lo] + (v[hi] - v[lo]) * (idx - lo);
  },

  // ── Conditional aggregation ──────────────────────────────────────────
  SUMIF: (args) => {
    const range = args[0]?.values ?? [];
    const criteria = args[1]?.values[0] ?? null;
    const sumRange = args[2]?.values ?? range;
    let total = 0;
    range.forEach((v, i) => { if (matchesCriteria(v, criteria)) total += toNumber(sumRange[i] ?? 0); });
    return total;
  },
  COUNTIF: (args) => (args[0]?.values ?? []).filter((v) => matchesCriteria(v, args[1]?.values[0] ?? null)).length,
  AVERAGEIF: (args) => {
    const range = args[0]?.values ?? [];
    const criteria = args[1]?.values[0] ?? null;
    const avgRange = args[2]?.values ?? range;
    const matched: number[] = [];
    range.forEach((v, i) => { if (matchesCriteria(v, criteria)) matched.push(toNumber(avgRange[i] ?? 0)); });
    return matched.length ? matched.reduce((a, b) => a + b, 0) / matched.length : 0;
  },
  SUMIFS: (args) => {
    const sumRange = args[0]?.values ?? [];
    let total = 0;
    sumRange.forEach((v, i) => {
      let allMatch = true;
      for (let k = 1; k < args.length; k += 2) {
        if (!matchesCriteria(args[k]?.values[i] ?? null, args[k + 1]?.values[0] ?? null)) { allMatch = false; break; }
      }
      if (allMatch) total += toNumber(v);
    });
    return total;
  },
  COUNTIFS: (args) => {
    const firstRange = args[0]?.values ?? [];
    let count = 0;
    firstRange.forEach((_, i) => {
      let allMatch = true;
      for (let k = 0; k < args.length; k += 2) {
        if (!matchesCriteria(args[k]?.values[i] ?? null, args[k + 1]?.values[0] ?? null)) { allMatch = false; break; }
      }
      if (allMatch) count++;
    });
    return count;
  },
  MAXIFS: (args) => {
    const maxRange = args[0]?.values ?? [];
    const matched: number[] = [];
    maxRange.forEach((v, i) => {
      let allMatch = true;
      for (let k = 1; k < args.length; k += 2) {
        if (!matchesCriteria(args[k]?.values[i] ?? null, args[k + 1]?.values[0] ?? null)) { allMatch = false; break; }
      }
      if (allMatch) matched.push(toNumber(v));
    });
    return matched.length ? Math.max(...matched) : 0;
  },
  MINIFS: (args) => {
    const minRange = args[0]?.values ?? [];
    const matched: number[] = [];
    minRange.forEach((v, i) => {
      let allMatch = true;
      for (let k = 1; k < args.length; k += 2) {
        if (!matchesCriteria(args[k]?.values[i] ?? null, args[k + 1]?.values[0] ?? null)) { allMatch = false; break; }
      }
      if (allMatch) matched.push(toNumber(v));
    });
    return matched.length ? Math.min(...matched) : 0;
  },

  // ── Lookup & reference ───────────────────────────────────────────────
  VLOOKUP: (args) => {
    const lookupValue = args[0]?.values[0] ?? null;
    const table = args[1];
    if (!table || table.numCols === 0) throw new FormulaError("#N/A");
    const colIndex = Math.trunc(toNumber(args[2]?.values[0] ?? 1)) - 1;
    const approximate = args[3] ? toNumber(args[3].values[0] ?? 1) !== 0 : true; // Excel's own default
    if (colIndex < 0 || colIndex >= table.numCols) throw new FormulaError("#REF!");
    let bestRow = -1;
    for (let r = 0; r < table.numRows; r++) {
      const cellVal = table.values[r * table.numCols];
      if (approximate) {
        if (compareForLookup(cellVal, lookupValue) <= 0) bestRow = r; else if (bestRow >= 0) break;
      } else if (looseEquals(cellVal, lookupValue)) { bestRow = r; break; }
    }
    if (bestRow < 0) throw new FormulaError("#N/A");
    return table.values[bestRow * table.numCols + colIndex];
  },
  HLOOKUP: (args) => {
    const lookupValue = args[0]?.values[0] ?? null;
    const table = args[1];
    if (!table || table.numRows === 0) throw new FormulaError("#N/A");
    const rowIndex = Math.trunc(toNumber(args[2]?.values[0] ?? 1)) - 1;
    const approximate = args[3] ? toNumber(args[3].values[0] ?? 1) !== 0 : true;
    if (rowIndex < 0 || rowIndex >= table.numRows) throw new FormulaError("#REF!");
    let bestCol = -1;
    for (let c = 0; c < table.numCols; c++) {
      const cellVal = table.values[c];
      if (approximate) {
        if (compareForLookup(cellVal, lookupValue) <= 0) bestCol = c; else if (bestCol >= 0) break;
      } else if (looseEquals(cellVal, lookupValue)) { bestCol = c; break; }
    }
    if (bestCol < 0) throw new FormulaError("#N/A");
    return table.values[rowIndex * table.numCols + bestCol];
  },
  INDEX: (args) => {
    const range = args[0];
    if (!range) throw new FormulaError("#REF!");
    const rowNum = Math.trunc(toNumber(args[1]?.values[0] ?? 0));
    // INDEX on a single-row range with no col_num arg indexes ACROSS that row (Excel convention).
    if (range.numRows === 1 && range.numCols > 1 && args[2] === undefined) {
      const c = rowNum - 1;
      if (c < 0 || c >= range.numCols) throw new FormulaError("#REF!");
      return range.values[c];
    }
    const colNum = args[2] ? Math.trunc(toNumber(args[2].values[0] ?? 1)) : 1;
    const r = rowNum - 1, c = colNum - 1;
    if (r < 0 || r >= range.numRows || c < 0 || c >= range.numCols) throw new FormulaError("#REF!");
    return range.values[r * range.numCols + c];
  },
  MATCH: (args) => {
    const lookupValue = args[0]?.values[0] ?? null;
    const range = args[1];
    if (!range) throw new FormulaError("#N/A");
    const matchType = args[2] ? Math.trunc(toNumber(args[2].values[0] ?? 1)) : 1;
    const vals = range.values;
    if (matchType === 0) {
      const idx = vals.findIndex((v) => looseEquals(v, lookupValue));
      if (idx < 0) throw new FormulaError("#N/A");
      return idx + 1;
    }
    let best = -1;
    for (let i = 0; i < vals.length; i++) {
      const cmp = compareForLookup(vals[i], lookupValue);
      if (matchType === 1 ? cmp <= 0 : cmp >= 0) best = i; else if (best >= 0) break;
    }
    if (best < 0) throw new FormulaError("#N/A");
    return best + 1;
  },
  XLOOKUP: (args) => {
    const lookupValue = args[0]?.values[0] ?? null;
    const lookupRange = args[1];
    const returnRange = args[2];
    if (!lookupRange || !returnRange) throw new FormulaError("#N/A");
    const idx = lookupRange.values.findIndex((v) => looseEquals(v, lookupValue));
    if (idx < 0) {
      if (args[3]) return args[3].values[0] ?? null;
      throw new FormulaError("#N/A");
    }
    return returnRange.values[idx] ?? null;
  },
  CHOOSE: (args) => {
    const idx = Math.trunc(toNumber(args[0]?.values[0] ?? 1));
    const choice = args[idx];
    if (!choice) throw new FormulaError("#VALUE! CHOOSE index out of range");
    return choice.values[0] ?? null;
  },

  // ── Math ──────────────────────────────────────────────────────────────
  ABS: (args) => Math.abs(toNumber(args[0]?.values[0] ?? 0)),
  ROUND: (args) => {
    const n = toNumber(args[0]?.values[0] ?? 0);
    const digits = toNumber(args[1]?.values[0] ?? 0);
    const f = Math.pow(10, digits);
    return Math.round(n * f) / f;
  },
  POWER: (args) => Math.pow(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0)),
  SQRT: (args) => Math.sqrt(toNumber(args[0]?.values[0] ?? 0)),
  NOT: (args) => (toNumber(args[0]?.values[0] ?? 0) === 0 ? 1 : 0),
  CONCAT: (args) => args.flatMap((a) => a.values).map((v) => (v === null ? "" : String(v))).join(""),

  // ── Statistics ────────────────────────────────────────────────────────
  // Named STDEV/STDEVP/VAR/VARP (the classic pre-2010 Excel names), not
  // Excel 2010+'s dotted STDEV.S/STDEV.P/VAR.S/VAR.P -- fully equivalent
  // functions, but the tokenizer doesn't parse a "." inside an identifier
  // (it would collide with number literals like "1.5"), so a dotted name
  // would tokenize as two separate tokens and never actually be callable.
  STDEV: (args) => stdev(flatten(args), true),
  STDEVP: (args) => stdev(flatten(args), false),
  VAR: (args) => { const s = stdev(flatten(args), true); return s * s; },
  VARP: (args) => { const s = stdev(flatten(args), false); return s * s; },
  CORREL: (args) => {
    const x = (args[0]?.values ?? []).map(toNumber);
    const y = (args[1]?.values ?? []).map(toNumber);
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    const mx = x.slice(0, n).reduce((a, b) => a + b, 0) / n;
    const my = y.slice(0, n).reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) { num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; }
    return dx === 0 || dy === 0 ? 0 : num / Math.sqrt(dx * dy);
  },
  TREND: (args) => {
    const ys = (args[0]?.values ?? []).map(toNumber);
    const xs = args[1] ? args[1].values.map(toNumber) : ys.map((_, i) => i + 1);
    const { slope, intercept } = linearRegression(xs, ys);
    const newX = args[2] ? toNumber(args[2].values[0] ?? 0) : xs[xs.length - 1] ?? 0;
    return intercept + slope * newX;
  },
  // Named FORECAST (not Excel 2016+'s FORECAST.LINEAR) -- the tokenizer
  // doesn't parse dots inside identifiers (see the STDEV/VAR naming note
  // above), so a dotted function name would be unreachable from any
  // formula a user could actually type.
  FORECAST: (args) => {
    const x = toNumber(args[0]?.values[0] ?? 0);
    const ys = (args[1]?.values ?? []).map(toNumber);
    const xs = (args[2]?.values ?? []).map(toNumber);
    const { slope, intercept } = linearRegression(xs, ys);
    return intercept + slope * x;
  },

  // ── Logic / error-checking that DOESN'T need short-circuit AST access ──
  // (ISNUMBER/ISTEXT/ISBLANK/ISERROR/ISNA/IFERROR/IFNA/IF/AND/OR are
  // special-cased in evalNode instead -- see the comment above this table.)

  // ── Financial ─────────────────────────────────────────────────────────
  NPV: (args) => npv(toNumber(args[0]?.values[0] ?? 0), flatten(args.slice(1))),
  IRR: (args) => irr(flatten([args[0] ?? scalarArg(null)]), args[1] ? toNumber(args[1].values[0] ?? 0.1) : 0.1),
  PMT: (args) => pmt(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0)),
  FV: (args) => fv(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0), toNumber(args[3]?.values[0] ?? 0)),
  PV: (args) => pv(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0), toNumber(args[3]?.values[0] ?? 0)),
  NPER: (args) => nper(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0), toNumber(args[3]?.values[0] ?? 0)),
  RATE: (args) => rate(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0), toNumber(args[3]?.values[0] ?? 0), args[4] ? toNumber(args[4].values[0] ?? 0.1) : 0.1),
  XNPV: (args) => xnpv(toNumber(args[0]?.values[0] ?? 0), (args[1]?.values ?? []).map(toNumber), (args[2]?.values ?? []).map(toNumber)),
  XIRR: (args) => xirr((args[0]?.values ?? []).map(toNumber), (args[1]?.values ?? []).map(toNumber), args[2] ? toNumber(args[2].values[0] ?? 0.1) : 0.1),
  MIRR: (args) => mirr((args[0]?.values ?? []).map(toNumber), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0)),
  SLN: (args) => sln(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0)),
  DDB: (args) => ddb(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0), toNumber(args[3]?.values[0] ?? 0)),
  SYD: (args) => syd(toNumber(args[0]?.values[0] ?? 0), toNumber(args[1]?.values[0] ?? 0), toNumber(args[2]?.values[0] ?? 0), toNumber(args[3]?.values[0] ?? 0)),

  // ── Dates ─────────────────────────────────────────────────────────────
  DATE: (args) => dateToSerial(new Date(Date.UTC(Math.trunc(toNumber(args[0]?.values[0] ?? 1970)), Math.trunc(toNumber(args[1]?.values[0] ?? 1)) - 1, Math.trunc(toNumber(args[2]?.values[0] ?? 1))))),
  YEAR: (args) => serialToDate(toNumber(args[0]?.values[0] ?? 0)).getUTCFullYear(),
  MONTH: (args) => serialToDate(toNumber(args[0]?.values[0] ?? 0)).getUTCMonth() + 1,
  DAY: (args) => serialToDate(toNumber(args[0]?.values[0] ?? 0)).getUTCDate(),
  EDATE: (args) => {
    const d = serialToDate(toNumber(args[0]?.values[0] ?? 0));
    const months = Math.trunc(toNumber(args[1]?.values[0] ?? 0));
    return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate())));
  },
  EOMONTH: (args) => {
    const d = serialToDate(toNumber(args[0]?.values[0] ?? 0));
    const months = Math.trunc(toNumber(args[1]?.values[0] ?? 0));
    return dateToSerial(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months + 1, 0)));
  },
  DATEDIF: (args) => {
    const d1 = serialToDate(toNumber(args[0]?.values[0] ?? 0));
    const d2 = serialToDate(toNumber(args[1]?.values[0] ?? 0));
    const unit = String(args[2]?.values[0] ?? "D").toUpperCase();
    if (unit === "D") return Math.round((d2.getTime() - d1.getTime()) / MS_PER_DAY);
    if (unit === "M") return (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth()) - (d2.getUTCDate() < d1.getUTCDate() ? 1 : 0);
    if (unit === "Y") {
      let y = d2.getUTCFullYear() - d1.getUTCFullYear();
      if (d2.getUTCMonth() < d1.getUTCMonth() || (d2.getUTCMonth() === d1.getUTCMonth() && d2.getUTCDate() < d1.getUTCDate())) y--;
      return y;
    }
    throw new FormulaError(`#VALUE! Unknown DATEDIF unit '${unit}'`);
  },
  NETWORKDAYS: (args) => {
    const startSerial = toNumber(args[0]?.values[0] ?? 0);
    const endSerial = toNumber(args[1]?.values[0] ?? 0);
    const holidays = new Set((args[2]?.values ?? []).map(toNumber));
    const [fromSerial, toSerial] = startSerial <= endSerial ? [startSerial, endSerial] : [endSerial, startSerial];
    let count = 0;
    for (let s = fromSerial; s <= toSerial; s++) {
      const day = serialToDate(s).getUTCDay();
      if (day !== 0 && day !== 6 && !holidays.has(s)) count++;
    }
    return startSerial <= endSerial ? count : -count;
  },

  // ── Text ──────────────────────────────────────────────────────────────
  LEFT: (args) => String(args[0]?.values[0] ?? "").slice(0, Math.max(0, Math.trunc(toNumber(args[1]?.values[0] ?? 1)))),
  RIGHT: (args) => {
    const s = String(args[0]?.values[0] ?? "");
    const n = Math.max(0, Math.trunc(toNumber(args[1]?.values[0] ?? 1)));
    return n === 0 ? "" : s.slice(-n);
  },
  MID: (args) => {
    const s = String(args[0]?.values[0] ?? "");
    const start = Math.max(1, Math.trunc(toNumber(args[1]?.values[0] ?? 1)));
    const len = Math.max(0, Math.trunc(toNumber(args[2]?.values[0] ?? 0)));
    return s.slice(start - 1, start - 1 + len);
  },
  LEN: (args) => String(args[0]?.values[0] ?? "").length,
  TRIM: (args) => String(args[0]?.values[0] ?? "").trim().replace(/\s+/g, " "),
  UPPER: (args) => String(args[0]?.values[0] ?? "").toUpperCase(),
  LOWER: (args) => String(args[0]?.values[0] ?? "").toLowerCase(),
  PROPER: (args) => String(args[0]?.values[0] ?? "").replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
  SUBSTITUTE: (args) => {
    const s = String(args[0]?.values[0] ?? "");
    const oldT = String(args[1]?.values[0] ?? "");
    const newT = String(args[2]?.values[0] ?? "");
    return oldT === "" ? s : s.split(oldT).join(newT);
  },
  TEXT: (args) => formatNumberPattern(toNumber(args[0]?.values[0] ?? 0), String(args[1]?.values[0] ?? "")),
};

// ─── Grid: dependency graph + recalculation ─────────────────────────────

export interface CellState {
  raw: string; // exact user input, e.g. "=SUM(A1:A3)" or "42" or "Revenue"
  value: CellValue;
  error: string | null;
  ast: AstNode | null;
  deps: string[];
}

/**
 * Holds one spreadsheet's worth of cells and keeps them consistent:
 * setCell parses the new formula, rebuilds that cell's dependency edges,
 * topologically re-evaluates everything downstream of it (not the whole
 * sheet -- only what could have changed), and reports circular references
 * as a value-level error on every cell in the cycle rather than throwing,
 * so one bad formula never takes down the rest of the model.
 */
export class SpreadsheetGrid {
  private cells = new Map<string, CellState>();
  // reverse edges: cell -> set of cells that depend on it
  private dependents = new Map<string, Set<string>>();
  // NAME (uppercase) -> target ref/range text, e.g. "TAXRATE" -> "$C$8".
  private names = new Map<string, string>();
  // ref -> display format pattern (e.g. "0.0%", "$#,##0.00") -- kept
  // separate from CellState rather than a field on it, since format is a
  // display property independent of content: clearing a cell's value
  // (Delete) doesn't clear its format, same as Excel.
  private formats = new Map<string, string>();
  // Off by default -- an accidental circular reference should still fail
  // loudly as #CIRCULAR!, which is correct for every model that ISN'T
  // deliberately using an averaging debt schedule. Turning this on is an
  // explicit per-model choice (same as Excel's File > Options > Formulas >
  // "Enable iterative calculation").
  private iterativeMode = false;
  private maxIterations = 100;
  private convergenceTolerance = 0.001;

  getNames(): Map<string, string> {
    return this.names;
  }

  /** Enables/disables iterative calculation (see runIterativeConvergence) and re-runs recalculation over every currently-circular cell so the effect is immediate, not just on the next edit. */
  setIterativeMode(enabled: boolean, maxIterations = 100, tolerance = 0.001): void {
    this.iterativeMode = enabled;
    this.maxIterations = maxIterations;
    this.convergenceTolerance = tolerance;
    const circularRefs: string[] = [];
    this.cells.forEach((cell, ref) => { if (cell.error === "#CIRCULAR!" || (cell.error?.startsWith("#DIVERGED!"))) circularRefs.push(ref); });
    circularRefs.forEach((ref) => this.recalculateFrom(ref));
  }

  getIterativeMode(): boolean {
    return this.iterativeMode;
  }

  setFormat(ref: string, format: string | null): void {
    if (!format) this.formats.delete(ref);
    else this.formats.set(ref, format);
  }

  getFormat(ref: string): string | null {
    return this.formats.get(ref) ?? null;
  }

  getAllFormats(): Map<string, string> {
    return this.formats;
  }

  /** Cells `ref`'s own formula references (its precedents) -- already tracked as CellState.deps, exposed here under the audit-facing name. */
  getPrecedents(ref: string): string[] {
    return this.getCell(ref).deps;
  }

  /** Cells that reference `ref` in their own formula (its dependents) -- the reverse-edge map this class already maintains internally for recalculation, surfaced for formula auditing. */
  getDependents(ref: string): string[] {
    return Array.from(this.dependents.get(ref) ?? []);
  }

  /** Every cell currently showing an error (#REF!, #VALUE!, #CIRCULAR!, ...), for a flagged-cells audit view. */
  getErrorCells(): { ref: string; error: string }[] {
    const flagged: { ref: string; error: string }[] = [];
    this.cells.forEach((cell, ref) => {
      if (cell.error) flagged.push({ ref, error: cell.error });
    });
    return flagged;
  }

  /**
   * Defines (or redefines) a named range. Every already-entered formula that
   * references this name gets re-resolved and recalculated against the new
   * target -- a name is meant to be a live indirection, not a one-time
   * text substitution frozen at the moment each formula was typed.
   */
  defineName(name: string, target: string): void {
    if (!isValidName(name)) throw new FormulaError(`#NAME? '${name}' is not a valid name`);
    const key = name.trim().toUpperCase();
    this.names.set(key, target.trim());
    this.reresolveFormulasUsing(key);
  }

  deleteName(name: string): void {
    const key = name.trim().toUpperCase();
    if (!this.names.delete(key)) return;
    this.reresolveFormulasUsing(key);
  }

  private reresolveFormulasUsing(nameKey: string): void {
    for (const [ref, cell] of Array.from(this.cells.entries())) {
      if (formulaUsesName(cell.raw, nameKey)) this.setCell(ref, cell.raw);
    }
  }

  getCell(ref: string): CellState {
    return this.cells.get(ref) ?? { raw: "", value: null, error: null, ast: null, deps: [] };
  }

  getAllCells(): Map<string, CellState> {
    return this.cells;
  }

  /**
   * Fills sourceRef's content into every cell in targetRefs, translating
   * relative references by each target's offset from the source (same
   * semantics as Excel/Sheets fill-down or fill-right). Literal values are
   * copied as-is. The source cell's format (if any) is copied along with
   * it, same as Excel. Each target is set independently so recalculation
   * stays correct even if targets depend on each other.
   */
  fillFormula(sourceRef: string, targetRefs: string[]): void {
    const source = this.getCell(sourceRef);
    const sourceFormat = this.getFormat(sourceRef);
    const from = parseCellRef(sourceRef);
    if (!from) return;
    for (const targetRef of targetRefs) {
      const to = parseCellRef(targetRef);
      if (!to) continue;
      this.setCell(targetRef, translateFormula(source.raw, to.col - from.col, to.row - from.row));
      this.setFormat(targetRef, sourceFormat);
    }
  }

  insertRows(atRow: number, count = 1): void { this.shiftStructural("row", atRow, count, true); }
  deleteRows(atRow: number, count = 1): void { this.shiftStructural("row", atRow, count, false); }
  insertCols(atCol: number, count = 1): void { this.shiftStructural("col", atCol, count, true); }
  deleteCols(atCol: number, count = 1): void { this.shiftStructural("col", atCol, count, false); }

  /**
   * The engine underneath insert/delete row/column: every cell (and every
   * name) in the sheet is re-derived from scratch against its new position
   * and reference text, rather than patching cells in place -- an insert or
   * delete can move ANY cell on the sheet (not just ones "near" the edit),
   * so there's no smaller set of cells that's safe to leave untouched. At
   * this grid's scale (documented at the top of the panel this backs) a
   * full O(cells) rebuild is cheap; it's also the only way to guarantee
   * every cross-reference ends up consistent instead of hand-patching a
   * subset and hoping nothing was missed.
   */
  private shiftStructural(kind: "row" | "col", at: number, count: number, isInsert: boolean): void {
    if (count <= 0) return;
    const oldCells = new Map(this.cells);
    const oldFormats = new Map(this.formats);
    const oldNames = new Map(this.names);

    this.cells.clear();
    this.dependents.clear();
    this.formats.clear();

    const rebuilt: { newRef: string; raw: string; format: string | null }[] = [];
    oldCells.forEach((cell, ref) => {
      const parsed = parseCellRef(ref)!;
      const idx = kind === "row" ? parsed.row : parsed.col;
      if (!isInsert && idx >= at && idx < at + count) return; // this cell's own position is being deleted -- its content goes with it

      let newRow = parsed.row, newCol = parsed.col;
      if (isInsert) {
        if (idx >= at) { if (kind === "row") newRow += count; else newCol += count; }
      } else if (idx >= at + count) {
        if (kind === "row") newRow -= count; else newCol -= count;
      }
      const newRef = cellRefToString(newCol, newRow);

      let newRaw: string;
      try {
        newRaw = shiftFormulaForStructuralChange(cell.raw, kind, at, count, isInsert);
      } catch {
        newRaw = "#REF!"; // a reference inside this formula fell into the deleted band
      }
      rebuilt.push({ newRef, raw: newRaw, format: oldFormats.get(ref) ?? null });
    });

    // Names next, before re-inserting cells, so a formula referencing a
    // name resolves correctly against the name's ALREADY-shifted target
    // the moment that cell is set.
    this.names.clear();
    oldNames.forEach((target, name) => {
      this.names.set(name, shiftNameTarget(target, kind, at, count, isInsert));
    });

    for (const { newRef, raw, format } of rebuilt) {
      this.setCell(newRef, raw);
      if (format) this.setFormat(newRef, format);
    }
  }

  setCell(ref: string, raw: string): void {
    // Remove this cell's old outgoing dependency edges before recomputing.
    const old = this.cells.get(ref);
    if (old) {
      for (const dep of old.deps) this.dependents.get(dep)?.delete(ref);
    }

    if (raw.trim() === "") {
      this.cells.delete(ref);
      this.recalculateFrom(ref);
      return;
    }

    let ast: AstNode | null = null;
    let deps: string[] = [];
    let value: CellValue = null;
    let error: string | null = null;

    if (raw.startsWith("=")) {
      try {
        const resolved = resolveNamedRanges(raw, this.names);
        ast = parseFormula(resolved.slice(1));
        deps = extractDependencies(ast);
      } catch (e: any) {
        error = e instanceof FormulaError ? e.message : "#ERROR!";
      }
    } else {
      const n = Number(raw);
      value = raw !== "" && !Number.isNaN(n) ? n : raw;
    }

    this.cells.set(ref, { raw, value, error, ast, deps });
    for (const dep of deps) {
      if (!this.dependents.has(dep)) this.dependents.set(dep, new Set());
      this.dependents.get(dep)!.add(ref);
    }

    this.recalculateFrom(ref);
  }

  /** Re-evaluates `ref` and everything transitively downstream of it, in dependency order. */
  private recalculateFrom(ref: string): void {
    const affected = new Set<string>();
    const stack = [ref];
    while (stack.length) {
      const cur = stack.pop()!;
      if (affected.has(cur)) continue;
      affected.add(cur);
      const deps = this.dependents.get(cur);
      if (deps) Array.from(deps).forEach((d) => stack.push(d));
    }

    const { order, cyclic } = this.topoSort(affected);
    order.forEach((cellRef) => this.evaluateCell(cellRef));

    // Cyclic cells are handled AFTER the acyclic ones above have their
    // final values -- a cyclic cell can perfectly validly reference a
    // non-cyclic cell that's also being recalculated this same pass, and
    // that reference needs the fresh value, not whatever was there before
    // this edit.
    if (cyclic.length === 0) return;
    if (this.iterativeMode) {
      this.runIterativeConvergence(cyclic);
    } else {
      cyclic.forEach((r) => {
        const cell = this.cells.get(r);
        if (cell) { cell.value = null; cell.error = "#CIRCULAR!"; }
      });
    }
  }

  /** Kahn's algorithm restricted to the affected subgraph; cells left over after the queue drains are in a cycle. Purely structural -- doesn't touch any cell's value/error, just says which cells are safely orderable and which aren't. */
  private topoSort(subset: Set<string>): { order: string[]; cyclic: string[] } {
    // Edges run dep -> ref within the subset; localInDegree counts how many
    // of a cell's dependencies still need to be evaluated first.
    const subsetList = Array.from(subset);
    const localInDegree = new Map<string, number>();
    subsetList.forEach((ref) => localInDegree.set(ref, 0));
    subsetList.forEach((ref) => {
      const cell = this.cells.get(ref);
      if (!cell) return;
      for (const dep of cell.deps) {
        if (subset.has(dep)) localInDegree.set(ref, (localInDegree.get(ref) ?? 0) + 1);
      }
    });

    const queue: string[] = Array.from(subset).filter((r) => (localInDegree.get(r) ?? 0) === 0);
    const order: string[] = [];
    const seen = new Set<string>();
    while (queue.length) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      order.push(cur);
      const deps = this.dependents.get(cur);
      if (!deps) continue;
      Array.from(deps).forEach((d) => {
        if (!subset.has(d)) return;
        const remaining = (localInDegree.get(d) ?? 0) - 1;
        localInDegree.set(d, remaining);
        if (remaining <= 0) queue.push(d);
      });
    }

    const cyclic = subsetList.filter((r) => !seen.has(r));
    return { order, cyclic };
  }

  /**
   * Gauss-Seidel-style fixed-point iteration: repeatedly re-evaluate every
   * cell in the cycle, each pass using whatever value every other cyclic
   * cell most recently computed (not last-pass's value -- that's the
   * "Gauss-Seidel" part, and it converges meaningfully faster than
   * re-evaluating everyone off last pass's snapshot). Stops once the
   * largest single-cell change in a pass drops under the tolerance, or
   * gives up and reports #DIVERGED! if it never settles within the
   * iteration cap -- this is exactly the mechanism behind Excel's own
   * "Enable iterative calculation" setting, used for the textbook circular
   * case of an LBO debt schedule where interest depends on the average of
   * beginning/ending balance, which depends on the sweep, which depends on
   * free cash flow, which depends on interest.
   */
  private runIterativeConvergence(cyclicRefs: string[]): void {
    // Seed every cyclic cell before the first pass: a fresh value to
    // bootstrap from (circular formulas have no "first" value to start
    // with), and -- critically -- clear any stale #CIRCULAR!/#DIVERGED!
    // error left over from a PREVIOUS recalculation. Without clearing it,
    // resolveRef's "if (cell.error) throw" fires the instant a cell's own
    // formula references itself (or another still-erroring cyclic cell),
    // poisoning the very first iteration before it can compute anything.
    for (const ref of cyclicRefs) {
      const cell = this.cells.get(ref);
      if (!cell) continue;
      if (cell.value === null) cell.value = 0;
      cell.error = null;
    }

    let converged = false;
    for (let iter = 0; iter < this.maxIterations; iter++) {
      let maxChange = 0;
      for (const ref of cyclicRefs) {
        const cell = this.cells.get(ref);
        if (!cell || !cell.ast) continue;
        const before = typeof cell.value === "number" ? cell.value : 0;
        try {
          const next = this.evalNode(cell.ast);
          cell.value = next;
          cell.error = null;
          if (typeof next === "number") maxChange = Math.max(maxChange, Math.abs(next - before));
        } catch (e: any) {
          cell.value = null;
          cell.error = e instanceof FormulaError ? e.message : "#ERROR!";
        }
      }
      if (maxChange < this.convergenceTolerance) { converged = true; break; }
    }
    if (!converged) {
      for (const ref of cyclicRefs) {
        const cell = this.cells.get(ref);
        if (cell && !cell.error) { cell.value = null; cell.error = "#DIVERGED! exceeded the iteration limit without converging"; }
      }
    }
  }

  private evaluateCell(ref: string): void {
    const cell = this.cells.get(ref);
    if (!cell || !cell.ast) return; // literal value, nothing to evaluate
    try {
      cell.value = this.evalNode(cell.ast);
      cell.error = null;
    } catch (e: any) {
      cell.value = null;
      cell.error = e instanceof FormulaError ? e.message : "#ERROR!";
    }
  }

  private resolveRef(col: number, row: number): CellValue {
    const ref = cellRefToString(col, row);
    const cell = this.cells.get(ref);
    if (!cell) return null;
    if (cell.error) throw new FormulaError(cell.error);
    return cell.value;
  }

  // Row-major (row-by-row, not column-by-column) so a 2D-aware function
  // like VLOOKUP/INDEX can reshape .values back into a grid using
  // numRows/numCols and get the right cell at values[row*numCols+col] --
  // column-major order would silently transpose every lookup.
  private resolveRange(node: Extract<AstNode, { kind: "range" }>): FnArg {
    const numRows = node.toRow - node.fromRow + 1;
    const numCols = node.toCol - node.fromCol + 1;
    const values: CellValue[] = [];
    for (let r = node.fromRow; r <= node.toRow; r++) {
      for (let c = node.fromCol; c <= node.toCol; c++) values.push(this.resolveRef(c, r));
    }
    return { values, numRows, numCols };
  }

  private evalNode(node: AstNode): CellValue {
    switch (node.kind) {
      case "number": return node.value;
      case "string": return node.value;
      case "ref": return this.resolveRef(node.col, node.row);
      case "range": throw new FormulaError("#VALUE! Range used where a single value was expected");
      case "unary": {
        const v = toNumber(this.evalNode(node.arg));
        return node.op === "-" ? -v : v;
      }
      case "binary": {
        if (node.op === "&") {
          const l = this.evalNode(node.left);
          const r = this.evalNode(node.right);
          return `${l ?? ""}${r ?? ""}`;
        }
        const l = toNumber(this.evalNode(node.left));
        const r = toNumber(this.evalNode(node.right));
        switch (node.op) {
          case "+": return l + r;
          case "-": return l - r;
          case "*": return l * r;
          case "/": if (r === 0) throw new FormulaError("#DIV/0!"); return l / r;
          case "^": return Math.pow(l, r);
          case "=": return l === r ? 1 : 0;
          case "<>": return l !== r ? 1 : 0;
          case "<": return l < r ? 1 : 0;
          case ">": return l > r ? 1 : 0;
          case "<=": return l <= r ? 1 : 0;
          case ">=": return l >= r ? 1 : 0;
          default: throw new FormulaError(`#ERROR! Unknown operator '${node.op}'`);
        }
      }
      case "call": {
        // IF/AND/OR/IFERROR/IFNA/ISERROR/ISNA/ISBLANK/ISNUMBER/ISTEXT need
        // their argument ASTs, not pre-evaluated values: IF must not
        // evaluate the untaken branch (so IF(x<>0, 1/x, 0) doesn't throw
        // #DIV/0! when x is 0), and IFERROR/ISERROR need to catch an error
        // thrown BY evaluating an argument, which is impossible once
        // that argument has already been eagerly evaluated into a value.
        // Every other function is a pure function of already-evaluated
        // arguments and goes through the generic FUNCTIONS table below.
        switch (node.name) {
          case "IF":
            return toNumber(this.evalNode(node.args[0])) !== 0
              ? (node.args[1] ? this.evalNode(node.args[1]) : 0)
              : (node.args[2] ? this.evalNode(node.args[2]) : 0);
          case "AND":
            for (const arg of node.args) if (toNumber(this.evalNode(arg)) === 0) return 0;
            return 1;
          case "OR":
            for (const arg of node.args) if (toNumber(this.evalNode(arg)) !== 0) return 1;
            return 0;
          case "IFERROR":
            try { return this.evalNode(node.args[0]); }
            catch { return node.args[1] ? this.evalNode(node.args[1]) : ""; }
          case "IFNA":
            try { return this.evalNode(node.args[0]); }
            catch (e) {
              if (e instanceof FormulaError && e.message.startsWith("#N/A")) return node.args[1] ? this.evalNode(node.args[1]) : "";
              throw e;
            }
          case "ISERROR":
            try { this.evalNode(node.args[0]); return 0; } catch { return 1; }
          case "ISNA":
            try { this.evalNode(node.args[0]); return 0; }
            catch (e) { return e instanceof FormulaError && e.message.startsWith("#N/A") ? 1 : 0; }
          case "ISBLANK": {
            let v: CellValue;
            try { v = this.evalNode(node.args[0]); } catch { return 0; }
            return v === null ? 1 : 0;
          }
          case "ISNUMBER": {
            let v: CellValue;
            try { v = this.evalNode(node.args[0]); } catch { return 0; }
            return typeof v === "number" ? 1 : 0;
          }
          case "ISTEXT": {
            let v: CellValue;
            try { v = this.evalNode(node.args[0]); } catch { return 0; }
            return typeof v === "string" ? 1 : 0;
          }
        }

        const fn = FUNCTIONS[node.name];
        if (!fn) throw new FormulaError(`#NAME? Unknown function ${node.name}`);
        const argValues: FnArg[] = node.args.map((arg) => (arg.kind === "range" ? this.resolveRange(arg) : scalarArg(this.evalNode(arg))));
        return fn(argValues);
      }
    }
  }
}

export function isFormulaCell(raw: string): boolean {
  return raw.trim().startsWith("=");
}
