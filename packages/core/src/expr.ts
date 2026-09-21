/**
 * The tiny arithmetic language behind `SrcExpr`.
 *
 * It exists so that a user can write `pv - feedIn` instead of waiting for somebody to add
 * "subtract two states" to a dropdown. It is a hand-written recursive-descent parser rather than
 * `new Function()` for three reasons: a widget configuration is data that travels through view
 * exports and object databases and should not be executable, `Function` is blocked under a strict
 * CSP, and -- the one that actually shows up every day -- it gives us control over what a **missing
 * value** does.
 *
 * ## Null propagation
 *
 * An ioBroker state can be `null` (never written, adapter not running). Arithmetic on it must not
 * silently produce `NaN` that then gets formatted as "NaN kW". Every operator therefore propagates
 * `null`: if any operand is unknown, the result is unknown and the renderer shows a placeholder.
 * The exceptions are `sum()` and `avg()`, which skip unknown arguments -- that is what makes
 * `sum(inverter1, inverter2, inverter3)` survive one inverter being offline.
 *
 * ## Syntax
 *
 * ```text
 * numbers        1  2.5  1e3
 * variables      pv  grid_import   (the keys of SrcExpr.vars)
 * operators      + - * / %  unary -   comparisons < <= > >= == !=
 * grouping       ( )
 * functions      abs min max round floor ceil sqrt pow clamp sum avg if
 * ```
 *
 * Comparisons yield 1 or 0, which makes `if(soc > 95, 0, charge)` work.
 */

export type ExprValue = number | null;

/** A parsed expression, ready to be evaluated against a set of variables */
export type CompiledExpr = (vars: Record<string, ExprValue>) => ExprValue;

interface Token {
    type: 'num' | 'id' | 'op' | 'paren' | 'comma';
    value: string;
    pos: number;
}

const OPERATOR_CHARS = '+-*/%<>=!';

/** Longest first, so that `<=` is not read as `<` followed by `=` */
const OPERATORS = ['<=', '>=', '==', '!=', '+', '-', '*', '/', '%', '<', '>'];

export class ExprError extends Error {
    constructor(
        message: string,
        readonly position: number,
    ) {
        super(message);
        this.name = 'ExprError';
    }
}

function tokenize(source: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < source.length) {
        const ch = source[i];

        if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
            i++;
            continue;
        }

        if (ch === '(' || ch === ')') {
            tokens.push({ type: 'paren', value: ch, pos: i });
            i++;
            continue;
        }

        if (ch === ',') {
            tokens.push({ type: 'comma', value: ch, pos: i });
            i++;
            continue;
        }

        if ((ch >= '0' && ch <= '9') || ch === '.') {
            const start = i;
            while (i < source.length && /[0-9.]/.test(source[i])) {
                i++;
            }
            // Exponent notation, e.g. 1e3 / 2.5e-2
            if (source[i] === 'e' || source[i] === 'E') {
                const mark = i;
                i++;
                if (source[i] === '+' || source[i] === '-') {
                    i++;
                }
                if (i < source.length && source[i] >= '0' && source[i] <= '9') {
                    while (i < source.length && source[i] >= '0' && source[i] <= '9') {
                        i++;
                    }
                } else {
                    // Not an exponent after all -- `1e` is a number followed by an identifier
                    i = mark;
                }
            }
            const text = source.slice(start, i);
            if (Number.isNaN(Number(text))) {
                throw new ExprError(`Not a number: "${text}"`, start);
            }
            tokens.push({ type: 'num', value: text, pos: start });
            continue;
        }

        if (/[A-Za-z_$]/.test(ch)) {
            const start = i;
            while (i < source.length && /[A-Za-z0-9_$.]/.test(source[i])) {
                i++;
            }
            tokens.push({ type: 'id', value: source.slice(start, i), pos: start });
            continue;
        }

        if (OPERATOR_CHARS.includes(ch)) {
            const two = source.substr(i, 2);
            const op = OPERATORS.find(candidate => candidate.length === 2 && candidate === two) || ch;
            if (!OPERATORS.includes(op)) {
                throw new ExprError(`Unknown operator "${op}"`, i);
            }
            tokens.push({ type: 'op', value: op, pos: i });
            i += op.length;
            continue;
        }

        throw new ExprError(`Unexpected character "${ch}"`, i);
    }

    return tokens;
}

type Node = (vars: Record<string, ExprValue>) => ExprValue;

/** Lift a plain numeric operation into one that propagates `null` */
function binary(op: string, left: Node, right: Node): Node {
    return vars => {
        const a = left(vars);
        const b = right(vars);
        if (a === null || b === null) {
            return null;
        }
        switch (op) {
            case '+':
                return a + b;
            case '-':
                return a - b;
            case '*':
                return a * b;
            case '/':
                // Division by zero would give Infinity, which formats as garbage
                return b === 0 ? null : a / b;
            case '%':
                return b === 0 ? null : a % b;
            case '<':
                return a < b ? 1 : 0;
            case '<=':
                return a <= b ? 1 : 0;
            case '>':
                return a > b ? 1 : 0;
            case '>=':
                return a >= b ? 1 : 0;
            case '==':
                return a === b ? 1 : 0;
            case '!=':
                return a !== b ? 1 : 0;
            default:
                return null;
        }
    };
}

/** Arguments of `sum` / `avg`, with the unknown ones removed */
function known(args: Node[], vars: Record<string, ExprValue>): number[] {
    const values: number[] = [];
    for (const arg of args) {
        const value = arg(vars);
        if (value !== null) {
            values.push(value);
        }
    }
    return values;
}

function callFunction(name: string, args: Node[], pos: number): Node {
    const arity = (min: number, max = min): void => {
        if (args.length < min || args.length > max) {
            const expected = min === max ? `${min}` : `${min}..${max}`;
            throw new ExprError(`"${name}" takes ${expected} argument(s), got ${args.length}`, pos);
        }
    };

    /** Wrap a plain numeric function so that it yields null as soon as one argument is unknown */
    const strict =
        (fn: (values: number[]) => number): Node =>
        vars => {
            const values: number[] = [];
            for (const arg of args) {
                const value = arg(vars);
                if (value === null) {
                    return null;
                }
                values.push(value);
            }
            const result = fn(values);
            return Number.isFinite(result) ? result : null;
        };

    switch (name) {
        case 'abs':
            arity(1);
            return strict(v => Math.abs(v[0]));
        case 'round':
            arity(1);
            return strict(v => Math.round(v[0]));
        case 'floor':
            arity(1);
            return strict(v => Math.floor(v[0]));
        case 'ceil':
            arity(1);
            return strict(v => Math.ceil(v[0]));
        case 'sqrt':
            arity(1);
            return strict(v => Math.sqrt(v[0]));
        case 'pow':
            arity(2);
            return strict(v => v[0] ** v[1]);
        case 'min':
            arity(1, 32);
            return strict(v => Math.min(...v));
        case 'max':
            arity(1, 32);
            return strict(v => Math.max(...v));
        case 'clamp':
            arity(3);
            return strict(v => Math.min(Math.max(v[0], v[1]), v[2]));
        case 'sum':
            arity(1, 32);
            return vars => {
                const values = known(args, vars);
                return values.length ? values.reduce((a, b) => a + b, 0) : null;
            };
        case 'avg':
            arity(1, 32);
            return vars => {
                const values = known(args, vars);
                return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
            };
        case 'if':
            arity(3);
            return vars => {
                const condition = args[0](vars);
                if (condition === null) {
                    return null;
                }
                return condition !== 0 ? args[1](vars) : args[2](vars);
            };
        default:
            throw new ExprError(`Unknown function "${name}"`, pos);
    }
}

/**
 * Binding power of the binary operators. Higher binds tighter; comparisons sit below `+`/`-`
 * so that `a - b > 0` parses as `(a - b) > 0`.
 */
const PRECEDENCE: Record<string, number> = {
    '<': 1,
    '<=': 1,
    '>': 1,
    '>=': 1,
    '==': 1,
    '!=': 1,
    '+': 2,
    '-': 2,
    '*': 3,
    '/': 3,
    '%': 3,
};

function parse(tokens: Token[], source: string): Node {
    let index = 0;

    const peek = (): Token | undefined => tokens[index];

    const expect = (value: string): Token => {
        const token = peek();
        if (!token || token.value !== value) {
            throw new ExprError(`Expected "${value}"`, token ? token.pos : source.length);
        }
        index++;
        return token;
    };

    /** A number, a variable, a function call, a parenthesised expression or a unary sign */
    // Function declarations rather than const arrows: `parsePrimary` and `parseExpression` call each
    // other, and only a declaration is hoisted so that either order of definition works
    function parsePrimary(): Node {
        const token = peek();
        if (!token) {
            throw new ExprError('Unexpected end of expression', source.length);
        }

        if (token.type === 'op' && (token.value === '-' || token.value === '+')) {
            index++;
            const operand = parsePrimary();
            if (token.value === '+') {
                return operand;
            }
            return vars => {
                const value = operand(vars);
                return value === null ? null : -value;
            };
        }

        if (token.type === 'num') {
            index++;
            const value = Number(token.value);
            return () => value;
        }

        if (token.type === 'id') {
            index++;
            const next = peek();
            if (next && next.value === '(') {
                index++;
                const args: Node[] = [];
                if (peek()?.value !== ')') {
                    for (;;) {
                        args.push(parseExpression(0));
                        const separator = peek();
                        if (separator?.type === 'comma') {
                            index++;
                            continue;
                        }
                        break;
                    }
                }
                expect(')');
                return callFunction(token.value, args, token.pos);
            }
            const name = token.value;
            return vars => {
                const value = vars[name];
                return value === undefined ? null : value;
            };
        }

        if (token.value === '(') {
            index++;
            const inner = parseExpression(0);
            expect(')');
            return inner;
        }

        throw new ExprError(`Unexpected token "${token.value}"`, token.pos);
    }

    /** Precedence climbing over the binary operators */
    function parseExpression(minPrecedence: number): Node {
        let left = parsePrimary();
        for (;;) {
            const token = peek();
            if (!token || token.type !== 'op') {
                break;
            }
            const precedence = PRECEDENCE[token.value];
            if (precedence === undefined || precedence < minPrecedence) {
                break;
            }
            index++;
            // All operators here are left-associative, so the right side must bind tighter
            const right = parseExpression(precedence + 1);
            left = binary(token.value, left, right);
        }
        return left;
    }

    const result = parseExpression(0);
    const rest = peek();
    if (rest) {
        throw new ExprError(`Unexpected token "${rest.value}"`, rest.pos);
    }
    return result;
}

/**
 * Parsing the same expression on every state update would be wasteful -- a diagram re-renders
 * several times per second. The cache is keyed by the source text, which is what the configuration
 * stores, so it survives re-renders and is shared between widgets that use the same formula.
 */
const cache = new Map<string, CompiledExpr | ExprError>();

const CACHE_LIMIT = 500;

/**
 * Compile an expression. Throws {@link ExprError} on a syntax error -- the editor uses that to show
 * where the formula is broken.
 *
 * @param source the expression text
 * @returns a function that evaluates the expression against a set of variables
 */
export function compileExpr(source: string): CompiledExpr {
    const cached = cache.get(source);
    if (cached) {
        if (cached instanceof ExprError) {
            throw cached;
        }
        return cached;
    }

    let compiled: CompiledExpr;
    try {
        compiled = parse(tokenize(source), source);
    } catch (error) {
        const wrapped =
            error instanceof ExprError
                ? error
                : new ExprError(error instanceof Error ? error.message : String(error), 0);
        if (cache.size < CACHE_LIMIT) {
            cache.set(source, wrapped);
        }
        throw wrapped;
    }

    if (cache.size >= CACHE_LIMIT) {
        cache.clear();
    }
    cache.set(source, compiled);
    return compiled;
}

/**
 * Evaluate an expression, returning `null` instead of throwing when it does not parse.
 *
 * The renderer uses this: a broken formula must show "no value", not tear down the whole diagram.
 * The editor calls {@link compileExpr} directly, because there the error message is the point.
 *
 * @param source the expression text
 * @param vars values of the variables it refers to
 * @returns the result, or null if unknown or not parseable
 */
export function evalExpr(source: string, vars: Record<string, ExprValue>): ExprValue {
    try {
        return compileExpr(source)(vars);
    } catch {
        return null;
    }
}

/**
 * Names the expression reads. Used by the editor to point out a variable that has no source
 * assigned, and to prune sources that nothing refers to.
 *
 * @param source the expression text
 * @returns the variable names, without function names
 */
export function exprVariables(source: string): string[] {
    let tokens: Token[];
    try {
        tokens = tokenize(source);
    } catch {
        return [];
    }
    const names = new Set<string>();
    tokens.forEach((token, i) => {
        // An identifier directly followed by "(" is a function call, not a variable
        if (token.type === 'id' && tokens[i + 1]?.value !== '(') {
            names.add(token.value);
        }
    });
    return [...names];
}
