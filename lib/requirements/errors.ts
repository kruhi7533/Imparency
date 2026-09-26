/**
 * Error carrying an HTTP status, thrown by the CSR requirement workflow and
 * mapped to a JSON response by lib/requirements/http.ts. Pure (no Next.js
 * imports) so client components can share the status/transition modules.
 */
export class RequirementWorkflowError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RequirementWorkflowError";
    this.status = status;
  }
}

export const ERRORS = {
  unauthenticated: () => new RequirementWorkflowError("Please sign in to continue.", 401),
  forbidden: () => new RequirementWorkflowError("You do not have permission to access this requirement.", 403),
  notFound: () => new RequirementWorkflowError("Requirement not found.", 404),
  matchingNotAllowed: () =>
    new RequirementWorkflowError("Matching can only be started after admin validation.", 400),
  conflict: () =>
    new RequirementWorkflowError("This requirement was changed by someone else. Reload and try again.", 409),
};
