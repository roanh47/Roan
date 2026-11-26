/**
 * Deep research: a bounded plan → search → extract → cited-report loop.
 *
 * The three halves stay separate so each is testable on its own: `plan` decides
 * what to search for, `run` owns the loop and its budget, `report` renders the
 * artifact and guards the citations. Callers inject the web tools and the model,
 * which is what keeps the loop off the network in tests.
 */

export {
  DEFAULT_SUB_QUERIES,
  MAX_SUB_QUERIES,
  buildPlanPrompt,
  normaliseQuery,
  parseSubQueries,
  planSubQueries,
  type PlanDeps,
  type PlanModel,
} from "./plan.js";

export {
  MAX_EXTRACTS,
  MAX_EXTRACT_BYTES,
  MAX_MILLISECONDS,
  RESULTS_PER_QUERY,
  buildReportPrompt,
  capBytes,
  resolveLimits,
  runResearch,
  type ResearchDeps,
  type ResearchExtract,
  type ResearchLimits,
  type ResearchModel,
  type ResearchResult,
  type ResearchSearch,
  type ResearchStopReason,
} from "./run.js";

export {
  buildReport,
  citationIndex,
  sanitiseCitations,
  type ReportInput,
  type ResearchReport,
  type ResearchSource,
  type SanitisedBody,
} from "./report.js";
