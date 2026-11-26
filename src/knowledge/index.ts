/**
 * Knowledge: what the chain remembers, and the projects it works in.
 *
 * `search.ts` ranks memory and message events; `projects.ts` stores one JSON file
 * per project and renders the context block for it. Both are pure of daemon and
 * home assumptions, so they can be wired anywhere.
 */

export {
  DEFAULT_MEMORY_LIMIT,
  MAX_MEMORY_LIMIT,
  queryTerms,
  searchMemories,
  searchMemoryEvents,
  searchStoreMemories,
  type MemoryEventLike,
  type MemoryHit,
  type MemorySourceRef,
} from "./search.js";

export {
  MAX_CONTEXT_INSTRUCTIONS,
  ProjectError,
  createProject,
  listProjects,
  projectContext,
  projectFile,
  projectStore,
  requireProjectName,
  resolveProject,
  saveProject,
  type Project,
  type ProjectInput,
  type ProjectStore,
} from "./projects.js";
