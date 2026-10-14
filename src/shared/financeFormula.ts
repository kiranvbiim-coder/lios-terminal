export interface FinanceFormulaResult {
  value: number | null;
  dependencies: string[];
  missing: string[];
  error?: string;
}

type Token =
  | { type: "number"; value: number }
  | { type: "identifier"; value: string }
  | { type: "operator"; value: "+" | "-" | "*" | "/" | "^" }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma"; value: "," };

const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_.]*/y;
const NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) { index += 1; continue; }
    if ("+-*/^".includes(char)) {
      tokens.push({ type: "operator", value: char as "+" | "-" | "*" | "/" | "^" });
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: "," });
      index += 1;
      continue;
    }
    NUMBER.lastIndex = index;
    const number = NUMBER.exec(expression);
    if (number?.index === index) {
      tokens.push({ type: "number", value: Number(number[0]) });
      index = NUMBER.lastIndex;
      continue;
    }
    IDENTIFIER.lastIndex = index;
    const identifier = IDENTIFIER.exec(expression);
    if (identifier?.index === index) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index = IDENTIFIER.lastIndex;
      continue;
    }
    throw new Error(`Unexpected token '${char}' at position ${index + 1}`);
  }
  return tokens;
}

class Parser {
  private index = 0;
  readonly dependencies = new Set<string>();
  readonly missing = new Set<string>();

  constructor(private readonly tokens: Token[], private readonly values: Record<string, number | null | undefined>) {}

  parse(): number {
    const value = this.parseAdditive();
    if (this.index !== this.tokens.length) throw new Error("Unexpected trailing formula tokens");
    return value;
  }

  private peek(): Token | undefined { return this.tokens[this.index]; }
  private consume(): Token { return this.tokens[this.index++]; }

  private parseAdditive(): number {
    let value = this.parseMultiplicative();
    while (this.peek()?.type === "operator" && (this.peek() as { type: "operator"; value: string }).value.match(/[+-]/)) {
      const op = (this.consume() as { type: "operator"; value: "+" | "-" }).value;
      const right = this.parseMultiplicative();
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  private parseMultiplicative(): number {
    let value = this.parsePower();
    while (this.peek()?.type === "operator" && ["*", "/"].includes((this.peek() as { type: "operator"; value: string }).value)) {
      const op = (this.consume() as { type: "operator"; value: "*" | "/" }).value;
      const right = this.parsePower();
      if (op === "/" && right === 0) throw new Error("Division by zero");
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  private parsePower(): number {
    let value = this.parseUnary();
    if (this.peek()?.type === "operator" && (this.peek() as { type: "operator"; value: string }).value === "^") {
      this.consume();
      value = Math.pow(value, this.parsePower());
    }
    return value;
  }

  private parseUnary(): number {
    const token = this.peek();
    if (token?.type === "operator" && (token.value === "+" || token.value === "-")) {
      this.consume();
      const value = this.parseUnary();
      return token.value === "-" ? -value : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number {
    const token = this.consume();
    if (!token) throw new Error("Unexpected end of formula");
    if (token.type === "number") return token.value;
    if (token.type === "paren" && token.value === "(") {
      const value = this.parseAdditive();
      const close = this.consume();
      if (close?.type !== "paren" || close.value !== ")") throw new Error("Missing closing parenthesis");
      return value;
    }
    if (token.type !== "identifier") throw new Error("Expected number, metric identifier, or parenthesis");

    if (this.peek()?.type === "paren" && (this.peek() as { type: "paren"; value: string }).value === "(") {
      return this.parseFunction(token.value);
    }

    this.dependencies.add(token.value);
    const value = this.values[token.value];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.missing.add(token.value);
      return Number.NaN;
    }
    return value;
  }

  private parseFunction(name: string): number {
    this.consume(); // (
    const args: number[] = [];
    if (!(this.peek()?.type === "paren" && (this.peek() as { type: "paren"; value: string }).value === ")")) {
      while (true) {
        args.push(this.parseAdditive());
        if (this.peek()?.type === "comma") { this.consume(); continue; }
        break;
      }
    }
    const close = this.consume();
    if (close?.type !== "paren" || close.value !== ")") throw new Error(`Missing ')' after ${name}`);
    const normalized = name.toLowerCase();
    if (normalized === "abs" && args.length === 1) return Math.abs(args[0]);
    if (normalized === "min" && args.length >= 1) return Math.min(...args);
    if (normalized === "max" && args.length >= 1) return Math.max(...args);
    if (normalized === "sqrt" && args.length === 1) {
      if (args[0] < 0) throw new Error("sqrt() cannot accept a negative value");
      return Math.sqrt(args[0]);
    }
    if (normalized === "pow" && args.length === 2) return Math.pow(args[0], args[1]);
    throw new Error(`Unsupported function '${name}'`);
  }
}

/**
 * Deterministic arithmetic formula evaluator for user-defined finance metrics.
 * No eval/Function/global access is used; identifiers resolve only from the supplied value map.
 */
export function evaluateFinanceFormula(expression: string, values: Record<string, number | null | undefined>): FinanceFormulaResult {
  try {
    const parser = new Parser(tokenize(expression), values);
    const value = parser.parse();
    const missing = [...parser.missing];
    return {
      value: missing.length || !Number.isFinite(value) ? null : value,
      dependencies: [...parser.dependencies],
      missing,
    };
  } catch (error) {
    return {
      value: null,
      dependencies: [],
      missing: [],
      error: error instanceof Error ? error.message : "Invalid formula",
    };
  }
}

export function extractFinanceFormulaDependencies(expression: string): string[] {
  const result = evaluateFinanceFormula(expression, new Proxy({}, { get: () => 1 }) as Record<string, number>);
  return result.error ? [] : result.dependencies;
}
