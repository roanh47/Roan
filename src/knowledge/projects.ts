/**
 * Projects: a named directory plus the standing instructions for it.
 *
 * A project is three strings — `name`, `dir`, `instructions` — and lives as one
 * JSON file per project under a directory the caller passes in. Nothing here
 * knows about `$HOME`, the chain or the daemon: the root is an argument, so a
 * desktop app can keep projects beside the workspace, a test can keep them in a
 * temporary directory, and neither has to be told about the other.
 *
 * `projectContext(project)` renders the block to inject at the start of a turn:
 * which project, which directory, what standing rules. That block is the whole
 * point of the file — it is short by construction (`MAX_CONTEXT_INSTRUCTIONS`),
 * because a project file that eats the context window is worse than no project.
 *
 * Names are restricted to `[a-z0-9-_]` starting with a letter or digit. That is
 * not cosmetic: the name is the file name, so a name carrying `/`, `\`, `..` or a
 * drive letter would let a caller read or write outside the project directory.
 * `projectFile` validates the name and then re-checks that the resolved path's
 * parent is the root — two independent refusals, because a path escape is the one
 * bug in this file that matters.
 *
 * A missing project is `null`, not an error: "I have no project called x" is an
 * answer. A project file that exists but is unreadable or malformed throws, naming
 * the file — silently treating corruption as absence would lose the user's rules
 * without telling anyone.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

/** One project, exactly as stored. */
export interface Project {
  /** Slug used as the file name; `[a-z0-9-_]`, starting with a letter or digit. */
  readonly name: string;
  /** Absolute directory the project works in. */
  readonly dir: string;
  /** Standing instructions, free text; empty when there are none. */
  readonly instructions: string;
}

/** What `createProject` / `saveProject` accept: `name` plus the rest. */
export interface ProjectInput {
  readonly name: string;
  readonly dir: string;
  readonly instructions?: string;
}

/** A bad name, a bad directory, a duplicate or a corrupt file. */
export class ProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

/** Suffix of a stored project. */
const PROJECT_EXT = ".json";

/** Longest accepted name; long enough for a slug, short enough for a filename. */
const MAX_NAME_CHARS = 64;

/** Longest accepted directory path. */
const MAX_DIR_CHARS = 4096;

/** Instructions kept in the context block; the rest is reported as truncated. */
export const MAX_CONTEXT_INSTRUCTIONS = 2000;

/** The name rule, spelled once. */
const NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Validate `name` and return it. Throws `ProjectError` naming the rule, never the
 * offending bytes verbatim when they could be a path.
 */
export function requireProjectName(name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new ProjectError("project name must be a non-empty string");
  }
  if (name.length > MAX_NAME_CHARS) {
    throw new ProjectError(`project name must be at most ${String(MAX_NAME_CHARS)} characters`);
  }
  if (!NAME_PATTERN.test(name)) {
    throw new ProjectError(
      "project name must start with a letter or digit and contain only a-z, 0-9, '-' or '_'",
    );
  }
  return name;
}

/** Resolve the root directory, insisting it is a non-empty path. */
function rootDir(root: string): string {
  if (typeof root !== "string" || root.trim().length === 0) {
    throw new ProjectError("project root must be a non-empty path");
  }
  return path.resolve(root);
}

/** Validate a project directory: absolute, no NUL, bounded length. */
function requireDir(dir: string): string {
  if (typeof dir !== "string" || dir.trim().length === 0) {
    throw new ProjectError("project dir must be a non-empty path");
  }
  if (dir.includes("\0")) {
    throw new ProjectError("project dir must not contain NUL");
  }
  if (dir.length > MAX_DIR_CHARS) {
    throw new ProjectError(`project dir must be at most ${String(MAX_DIR_CHARS)} characters`);
  }
  if (!path.isAbsolute(dir)) {
    throw new ProjectError(`project dir must be absolute, got ${JSON.stringify(dir)}`);
  }
  return dir;
}

/** Validate instructions: a string, possibly empty, bounded. */
function requireInstructions(instructions: string | undefined): string {
  if (instructions === undefined) return "";
  if (typeof instructions !== "string") {
    throw new ProjectError("project instructions must be a string");
  }
  if (instructions.includes("\0")) {
    throw new ProjectError("project instructions must not contain NUL");
  }
  return instructions;
}

/**
 * Path of the JSON file for `name` under `root`.
 *
 * Validates the name, then checks that the joined path really sits directly in
 * the root. The second check can only fire if the first is ever weakened, which
 * is exactly when it is needed.
 */
export function projectFile(root: string, name: string): string {
  const base = rootDir(root);
  requireProjectName(name);
  const file = path.join(base, `${name}${PROJECT_EXT}`);
  if (path.dirname(file) !== base) {
    throw new ProjectError("project name escapes the project directory");
  }
  return file;
}

function isMissing(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err.code === "ENOENT" || err.code === "ENOTDIR")
  );
}

/** One stored project, or null when the file is not there. */
function readProject(root: string, name: string): Project | null {
  const file = projectFile(root, name);
  if (!existsSync(file)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch (err) {
    if (isMissing(err)) return null;
    throw new ProjectError(`project file ${file} is not valid JSON`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ProjectError(`project file ${file} is not a project object`);
  }
  const record = parsed as Record<string, unknown>;
  const storedName = record["name"];
  const dir = record["dir"];
  const instructions = record["instructions"];

  if (typeof storedName !== "string" || storedName !== name) {
    throw new ProjectError(`project file ${file} names ${JSON.stringify(storedName)}, expected ${JSON.stringify(name)}`);
  }
  if (typeof dir !== "string" || dir.trim().length === 0) {
    throw new ProjectError(`project file ${file} has no dir`);
  }
  if (!path.isAbsolute(dir)) {
    throw new ProjectError(`project file ${file} has a relative dir`);
  }
  if (typeof instructions !== "string") {
    throw new ProjectError(`project file ${file} has no instructions`);
  }
  return { name, dir, instructions };
}

function writeProject(root: string, project: Project): void {
  const base = rootDir(root);
  mkdirSync(base, { recursive: true });
  const file = projectFile(base, project.name);
  const temporary = path.join(base, `.${project.name}.${randomBytes(6).toString("hex")}.tmp`);
  const body = `${JSON.stringify(
    { name: project.name, dir: project.dir, instructions: project.instructions },
    null,
    2,
  )}\n`;

  try {
    writeFileSync(temporary, body, "utf8");
    // Rename is atomic on one filesystem: a reader sees the old file or the new
    // one, never half a JSON document.
    renameSync(temporary, file);
  } catch (err) {
    try {
      unlinkSync(temporary);
    } catch {
      // The temp file may never have been created; the original error is the one
      // worth surfacing.
    }
    throw err;
  }
}

/**
 * Create a new project. Throws `ProjectError` when one with that name exists:
 * creating never overwrites instructions the user took the time to write.
 */
export function createProject(root: string, input: ProjectInput): Project {
  const name = requireProjectName(input.name);
  if (readProject(root, name) !== null) {
    throw new ProjectError(`project ${JSON.stringify(name)} already exists`);
  }
  const project: Project = {
    name,
    dir: requireDir(input.dir),
    instructions: requireInstructions(input.instructions),
  };
  writeProject(root, project);
  return project;
}

/**
 * Write a project, creating it or replacing it. Use `createProject` when an
 * existing project should be an error, and this when the caller is editing.
 */
export function saveProject(root: string, input: ProjectInput): Project {
  const project: Project = {
    name: requireProjectName(input.name),
    dir: requireDir(input.dir),
    instructions: requireInstructions(input.instructions),
  };
  writeProject(root, project);
  return project;
}

/** The project called `name`, or null when there is none. */
export function resolveProject(root: string, name: string): Project | null {
  return readProject(root, requireProjectName(name));
}

/**
 * Every project under `root`, by name. A root that does not exist yet has no
 * projects, which is an empty list rather than an error.
 */
export function listProjects(root: string): Project[] {
  const base = rootDir(root);
  const entries = (() => {
    try {
      return readdirSync(base, { withFileTypes: true });
    } catch (err) {
      if (isMissing(err)) return [];
      throw err;
    }
  })();

  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(PROJECT_EXT)) continue;
    const name = entry.name.slice(0, -PROJECT_EXT.length);
    if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_CHARS) continue;
    names.push(name);
  }
  names.sort((a, b) => a.localeCompare(b));

  const projects: Project[] = [];
  for (const name of names) {
    const project = readProject(base, name);
    if (project !== null) projects.push(project);
  }
  return projects;
}

/**
 * The block to put in front of a turn's context.
 *
 * Three lines of framing plus the instructions, capped at
 * {@link MAX_CONTEXT_INSTRUCTIONS} characters. Empty instructions say so rather
 * than leaving a blank section that reads like a rendering bug.
 */
export function projectContext(project: Project): string {
  const instructions = project.instructions.replace(/\r\n/g, "\n").trim();
  const body =
    instructions.length === 0
      ? "(none specified)"
      : instructions.length > MAX_CONTEXT_INSTRUCTIONS
        ? `${instructions.slice(0, MAX_CONTEXT_INSTRUCTIONS).trimEnd()}\n…(instructions truncated)`
        : instructions;

  return [
    `Project: ${project.name}`,
    `Directory: ${project.dir}`,
    "Instructions:",
    body,
  ].join("\n");
}

/** The same functions, bound to one root, for callers that always use the same one. */
export interface ProjectStore {
  create(input: ProjectInput): Project;
  save(input: ProjectInput): Project;
  list(): Project[];
  resolve(name: string): Project | null;
  context(project: Project): string;
}

/** Bind a project root once. Every function above stays available unbound. */
export function projectStore(root: string): ProjectStore {
  return {
    create: (input) => createProject(root, input),
    save: (input) => saveProject(root, input),
    list: () => listProjects(root),
    resolve: (name) => resolveProject(root, name),
    context: (project) => projectContext(project),
  };
}
