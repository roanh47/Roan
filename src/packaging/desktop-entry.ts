/**
 * freedesktop.org desktop entry (`.desktop` file): render one from an app
 * description, and parse such a file back into the same shape.
 *
 * Only the `[Desktop Entry]` group is written; no `Desktop Action` or
 * localized (`Name[nl]`) keys. Values are escaped the way the specification's
 * string type requires, and the `Exec=` command is double-quoted when it holds
 * a character that would otherwise be read as a separator, so a path with
 * spaces survives a render/parse round trip unchanged.
 *
 * See https://specifications.freedesktop.org/desktop-entry-spec/latest/.
 */

/** `Type=` value for entries that start an application. */
const APPLICATION_TYPE = "Application";

/** The one group this module writes and reads. */
const GROUP_HEADER = "[Desktop Entry]";

/** Group name without the brackets. */
const GROUP_NAME = "Desktop Entry";

/** Keys every rendered entry carries, in the order they are written. */
const REQUIRED_KEYS = [
  "Type",
  "Name",
  "Comment",
  "Exec",
  "Icon",
  "Categories",
  "Terminal",
] as const;

type RequiredKey = (typeof REQUIRED_KEYS)[number];

/** Everything one `[Desktop Entry]` group needs for a launchable app. */
export interface DesktopEntry {
  /** `Name=`: the name shown in menus. Non-empty, no surrounding spaces. */
  appName: string;
  /** `Comment=`: the one-line description used as a tooltip. May be empty. */
  comment: string;
  /** `Exec=`: the command to launch, as a path. Non-empty, no field codes. */
  execPath: string;
  /** `Icon=`: icon name or absolute path, without an extension. Non-empty. */
  iconName: string;
  /** `Categories=`: main categories in order, each without `;`. May be empty. */
  categories: readonly string[];
  /** When true, `%U` is appended to `Exec=` so the entry accepts URLs. */
  takesUrls: boolean;
  /** `Terminal=`: whether the launcher opens a terminal first. Default false. */
  terminal?: boolean;
}

/** A parsed entry: identical to {@link DesktopEntry}, with `terminal` filled in. */
export interface ParsedDesktopEntry extends DesktopEntry {
  terminal: boolean;
}

/** String escapes of the desktop entry string type. */
const VALUE_ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  "\\": "\\\\",
  "\n": "\\n",
  "\r": "\\r",
  "\t": "\\t",
});

/**
 * Characters in an `Exec=` argument that force it into double quotes: the
 * specification's reserved set plus every whitespace character.
 */
const EXEC_RESERVED = /[\s"'`$\\><~|&;*?#()]/;

/** Render an arbitrary value for an error message, bounded in length. */
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

/** Escape one value for the right-hand side of a `Key=value` line. */
function escapeValue(value: string): string {
  let out = "";
  for (const char of value) {
    const escaped = VALUE_ESCAPES[char];
    out += escaped === undefined ? char : escaped;
  }
  return out;
}

/**
 * Reverse {@link escapeValue} in a single pass, so `\\n` stays a backslash
 * followed by an `n` instead of turning into a newline.
 */
function unescapeValue(value: string, line: number): string {
  let out = "";
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = value.charAt(index + 1);
    if (next === "") {
      throw new Error(`line ${line}: value ends with a lone backslash`);
    }
    if (next === "\\") out += "\\";
    else if (next === "n") out += "\n";
    else if (next === "r") out += "\r";
    else if (next === "t") out += "\t";
    else if (next === "s") out += " ";
    else {
      throw new Error(`line ${line}: unknown escape ${describe("\\" + next)} in value`);
    }
    index += 1;
  }
  return out;
}

/** Read a value that must be a string, optionally non-empty, without \0. */
function checkText(value: unknown, field: string, allowEmpty: boolean): string {
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string, got ${describe(value)}`);
  }
  if (!allowEmpty && value === "") {
    throw new Error(`${field} must be a non-empty string`);
  }
  if (value !== value.trim()) {
    throw new Error(
      `${field} must not start or end with whitespace, got ${describe(value)}`,
    );
  }
  if (value.includes("\0")) {
    throw new Error(`${field} must not contain a NUL character`);
  }
  return value;
}

/** Read a value that must be a boolean. */
function checkBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean, got ${describe(value)}`);
  }
  return value;
}

/** Read the category list: strings, non-empty, trimmed, free of `;`. */
function checkCategories(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`categories must be an array of strings, got ${describe(value)}`);
  }
  const items: unknown[] = value;
  const categories: string[] = [];
  for (const item of items) {
    const category = checkText(item, "each category", false);
    if (category.includes(";")) {
      throw new Error(
        `a category must not contain ";" because it separates categories, got ${describe(category)}`,
      );
    }
    categories.push(category);
  }
  return categories;
}

/**
 * Render one `Exec=` value: value escapes first (`\\`, `\n`), then `%` doubled
 * so the shell never sees a field code, then quoting, because the quoting
 * layer escapes backslashes a second time.
 */
function renderExecArgument(execPath: string, takesUrls: boolean): string {
  const escaped = escapeValue(execPath).replaceAll("%", "%%");
  const argument = EXEC_RESERVED.test(execPath)
    ? `"${escaped.replace(/["`$\\]/g, (char) => "\\" + char)}"`
    : escaped;
  return takesUrls ? `${argument} %U` : argument;
}

interface UnquotedArgument {
  /** Content between the quotes, with the quoting escapes removed. */
  argument: string;
  /** Text after the closing quote, trimmed. */
  rest: string;
}

/** Strip one pair of double quotes and their escapes from `value`. */
function unquoteExecArgument(value: string, line: number): UnquotedArgument {
  let out = "";
  let index = 1;
  while (index < value.length) {
    const char = value.charAt(index);
    if (char === '"') {
      return { argument: out, rest: value.slice(index + 1).trim() };
    }
    if (char === "\\") {
      const next = value.charAt(index + 1);
      if (next === '"' || next === "`" || next === "$" || next === "\\") {
        out += next;
        index += 2;
        continue;
      }
      throw new Error(
        `line ${line}: invalid escape ${describe("\\" + next)} inside the quoted Exec= argument`,
      );
    }
    out += char;
    index += 1;
  }
  throw new Error(`line ${line}: quoted Exec= argument has no closing quote`);
}

interface ExecSpec {
  /** The command, still carrying the value escapes and `%%` pairs. */
  path: string;
  takesUrls: boolean;
}

/** Read an `Exec=` value into its command and its URL field code. */
function readExecField(raw: string, line: number): ExecSpec {
  const value = raw.trim();
  if (value === "") {
    throw new Error(`line ${line}: Exec= must not be empty`);
  }

  const quoted = value.startsWith('"');
  let argument = value;
  let rest = "";
  if (quoted) {
    const unquoted = unquoteExecArgument(value, line);
    argument = unquoted.argument;
    rest = unquoted.rest;
  }

  let takesUrls = false;
  if (rest !== "") {
    if (rest !== "%U") {
      throw new Error(
        `line ${line}: only %U may follow the Exec= argument, got ${describe(rest)}`,
      );
    }
    takesUrls = true;
  }

  let path = "";
  for (let index = 0; index < argument.length; index += 1) {
    const char = argument.charAt(index);
    if (char !== "%") {
      path += char;
      continue;
    }
    const next = argument.charAt(index + 1);
    if (next === "%") {
      path += "%";
      index += 1;
      continue;
    }
    if (next === "U") {
      takesUrls = true;
      index += 1;
      continue;
    }
    if (next === "") {
      throw new Error(`line ${line}: Exec= ends with a lone "%"`);
    }
    throw new Error(
      `line ${line}: Exec= uses the field code ${describe("%" + next)}, which this module does not understand`,
    );
  }

  if (!quoted) {
    // An unquoted argument cannot contain whitespace; trailing space comes from
    // the separator before a field code.
    path = path.trimEnd();
  }
  if (path === "") {
    throw new Error(`line ${line}: Exec= names no command`);
  }
  if (!quoted && /\s/.test(path)) {
    throw new Error(
      `line ${line}: Exec= argument contains whitespace and must be double-quoted`,
    );
  }
  return { path, takesUrls };
}

/** Split a `Categories=` value into its entries. */
function readCategories(raw: string, line: number): string[] {
  const categories: string[] = [];
  for (const part of raw.split(";")) {
    if (part === "") continue;
    categories.push(unescapeValue(part, line));
  }
  return categories;
}

/**
 * Render a `.desktop` file for `entry`, ending in a single newline.
 *
 * The group is always `[Desktop Entry]` and every key from `Type` through
 * `Terminal` is written, in that order. `%U` is appended to `Exec=` only when
 * `takesUrls` is true, and the command is double-quoted (with `\`, `"`, `` ` ``
 * and `$` escaped) when it contains whitespace or another reserved character.
 *
 * Throws `Error` naming the field when a text field is empty where it may not
 * be, starts or ends with whitespace (the specification ignores spaces around
 * `=`, so such a value could not be read back), holds a NUL, or when a
 * category holds the `;` separator.
 */
export function renderDesktopEntry(entry: DesktopEntry): string {
  const appName = checkText(entry.appName, "appName", false);
  const comment = checkText(entry.comment, "comment", true);
  const execPath = checkText(entry.execPath, "execPath", false);
  const iconName = checkText(entry.iconName, "iconName", false);
  const categories = checkCategories(entry.categories);
  const takesUrls = checkBoolean(entry.takesUrls, "takesUrls");
  const terminal = entry.terminal === undefined ? false : checkBoolean(entry.terminal, "terminal");

  const categoryValue = categories.map(escapeValue).join(";");
  const lines = [
    GROUP_HEADER,
    `Type=${APPLICATION_TYPE}`,
    `Name=${escapeValue(appName)}`,
    `Comment=${escapeValue(comment)}`,
    `Exec=${renderExecArgument(execPath, takesUrls)}`,
    `Icon=${escapeValue(iconName)}`,
    `Categories=${categoryValue === "" ? "" : `${categoryValue};`}`,
    `Terminal=${terminal ? "true" : "false"}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Parse the output of {@link renderDesktopEntry} back into an entry.
 *
 * Blank lines and `#` comments are skipped, keys of other groups are ignored,
 * and the value escapes, quoting and `%U` code are undone. Throws `Error`
 * naming the line and the reason when a line is not `Key=value`, a key repeats,
 * a required key is missing, `Type` is not `Application`, `Terminal` is not
 * `true`/`false`, or the `Exec=` value cannot be decoded.
 */
export function parseDesktopEntry(text: string): ParsedDesktopEntry {
  const lines = text.split("\n");
  const values = new Map<RequiredKey, { value: string; line: number }>();
  let groupLine = 0;
  let inGroup = false;
  let sawGroup = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const line = (lines[index] ?? "").replace(/\r$/, "").trim();
    if (line === "" || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      if (!line.endsWith("]")) {
        throw new Error(`line ${lineNumber}: group header ${describe(line)} is not closed with "]"`);
      }
      const name = line.slice(1, -1);
      inGroup = name === GROUP_NAME;
      if (inGroup) {
        sawGroup = true;
        groupLine = lineNumber;
      }
      continue;
    }

    if (!inGroup) {
      if (!sawGroup) {
        throw new Error(
          `line ${lineNumber}: entry does not start with the ${GROUP_HEADER} group`,
        );
      }
      continue;
    }

    const equals = line.indexOf("=");
    if (equals <= 0) {
      throw new Error(`line ${lineNumber}: expected "Key=value", got ${describe(line)}`);
    }
    const key = line.slice(0, equals).trim();
    if (!isRequiredKey(key)) continue;

    const previous = values.get(key);
    if (previous !== undefined) {
      throw new Error(
        `line ${lineNumber}: duplicate key ${describe(key)}, already set on line ${previous.line}`,
      );
    }
    values.set(key, { value: line.slice(equals + 1).trim(), line: lineNumber });
  }

  if (!sawGroup) {
    throw new Error(`line 1: entry has no ${GROUP_HEADER} group`);
  }

  const required = (key: RequiredKey): { value: string; line: number } => {
    const found = values.get(key);
    if (found === undefined) {
      throw new Error(`line ${groupLine}: required key ${describe(key)} is missing`);
    }
    return found;
  };

  const type = required("Type");
  if (type.value !== APPLICATION_TYPE) {
    throw new Error(
      `line ${type.line}: Type= must be ${describe(APPLICATION_TYPE)}, got ${describe(type.value)}`,
    );
  }

  const exec = readExecField(required("Exec").value, required("Exec").line);
  const terminalField = required("Terminal");
  const terminalText = terminalField.value.toLowerCase();
  if (terminalText !== "true" && terminalText !== "false") {
    throw new Error(
      `line ${terminalField.line}: Terminal= must be "true" or "false", got ${describe(terminalField.value)}`,
    );
  }

  const nameField = required("Name");
  const commentField = required("Comment");
  const iconField = required("Icon");
  const categoriesField = required("Categories");

  return {
    appName: unescapeValue(nameField.value, nameField.line),
    comment: unescapeValue(commentField.value, commentField.line),
    execPath: unescapeValue(exec.path, required("Exec").line),
    iconName: unescapeValue(iconField.value, iconField.line),
    categories: readCategories(categoriesField.value, categoriesField.line),
    takesUrls: exec.takesUrls,
    terminal: terminalText === "true",
  };
}

/** True for the seven keys this module writes; other keys are not ours. */
function isRequiredKey(key: string): key is RequiredKey {
  return (REQUIRED_KEYS as readonly string[]).includes(key);
}
