import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  JOBS,
  JOB_NAMES,
  jobByName,
  jobHealth,
  healthLabel,
  renderCrontab,
  type JobDefinition,
  type LastRunFacts,
} from "@/lib/job-registry";

/**
 * The job ledger and the registry behind it (Week 9 SPEC-2).
 *
 * What is worth pinning is the handful of judgements whose failure is silent:
 *
 *  - a job that has never run must NEVER read as healthy, which is the rule
 *    the whole ops console exists to express;
 *  - health is measured from the last SUCCESS, so a job failing every hour
 *    cannot look punctual;
 *  - SKIPPED and `itemsProcessed: 0` are healthy outcomes, not failures —
 *    conflating either with a real problem is how a true alert gets buried;
 *  - and a ledger write that fails must never fail the job it was watching.
 */

const NOW = new Date("2026-10-19T12:00:00.000Z");
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 3_600_000);

const daily: JobDefinition = {
  name: "test-daily",
  label: "Test daily",
  purpose: "test",
  schedule: "0 2 * * *",
  everyHours: 24,
  graceHours: 12,
  maxRuntimeMinutes: 15,
};

const facts = (over: Partial<LastRunFacts> = {}): LastRunFacts => ({
  status: "SUCCEEDED",
  startedAt: hoursAgo(2),
  finishedAt: hoursAgo(2),
  lastSuccessAt: hoursAgo(2),
  ...over,
});

describe("the registry", () => {
  it("registers every cron route exactly once", () => {
    expect(new Set(JOB_NAMES).size).toBe(JOBS.length);
    expect(JOBS.length).toBe(9);
  });

  it("gives every job a cadence, a grace and a runtime budget", () => {
    for (const j of JOBS) {
      expect(j.everyHours, j.name).toBeGreaterThan(0);
      expect(j.graceHours, j.name).toBeGreaterThan(0);
      expect(j.maxRuntimeMinutes, j.name).toBeGreaterThan(0);
      expect(j.schedule.trim().split(/\s+/), j.name).toHaveLength(5);
    }
  });

  it("looks a job up by name and reports an unknown one as undefined", () => {
    expect(jobByName("deliver-impact")?.label).toBeTruthy();
    expect(jobByName("not-a-job")).toBeUndefined();
  });
});

describe("jobHealth", () => {
  it("reports a job that has never run as never_run, never as ok", () => {
    // The rule the console is built on. A green empty state would assert
    // something false about work that is not happening at all.
    expect(jobHealth(daily, null, NOW)).toBe("never_run");
    expect(healthLabel("never_run").tone).toBe("bad");
  });

  it("is ok when the last success is inside cadence plus grace", () => {
    expect(jobHealth(daily, facts({ lastSuccessAt: hoursAgo(30) }), NOW)).toBe("ok");
  });

  it("is overdue once past cadence plus grace", () => {
    // 24 + 12 = 36h budget.
    expect(jobHealth(daily, facts({ lastSuccessAt: hoursAgo(37) }), NOW)).toBe("overdue");
  });

  it("measures from the last SUCCESS, not the last attempt", () => {
    // Ran a minute ago and failed; last success was four days back. A naive
    // "time since last run" would call this punctual.
    const health = jobHealth(
      daily,
      facts({ status: "FAILED", startedAt: hoursAgo(0.01), lastSuccessAt: hoursAgo(96) }),
      NOW
    );
    expect(health).toBe("failing");
  });

  it("treats a succeeded run with no recorded success as failing, not ok", () => {
    expect(jobHealth(daily, facts({ lastSuccessAt: null }), NOW)).toBe("failing");
  });

  it("distinguishes a run in flight from one that is stuck", () => {
    // Budget is 15 minutes.
    expect(
      jobHealth(daily, facts({ status: "RUNNING", startedAt: hoursAgo(0.1) }), NOW)
    ).toBe("ok");
    expect(jobHealth(daily, facts({ status: "RUNNING", startedAt: hoursAgo(2) }), NOW)).toBe(
      "stuck"
    );
  });

  it("does not call the quarterly report overdue for being a day late", () => {
    // A fixed daily threshold would scream about this job eleven months a
    // year, which is how an alert category gets ignored.
    const quarterly = jobByName("fcra-quarterly-report")!;
    expect(jobHealth(quarterly, facts({ lastSuccessAt: hoursAgo(24 * 30) }), NOW)).toBe("ok");
    expect(jobHealth(quarterly, facts({ lastSuccessAt: hoursAgo(24 * 120) }), NOW)).toBe(
      "overdue"
    );
  });

  it("labels every health state, and only overdue is a warning", () => {
    expect(healthLabel("ok").tone).toBe("good");
    expect(healthLabel("overdue").tone).toBe("warn");
    for (const bad of ["never_run", "failing", "stuck"] as const) {
      expect(healthLabel(bad).tone, bad).toBe("bad");
    }
  });
});

describe("renderCrontab", () => {
  it("emits one line per job, carrying the shared secret", () => {
    const out = renderCrontab("https://example.test/");
    for (const j of JOBS) {
      expect(out).toContain(`${j.schedule} curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://example.test/api/cron/${j.name}`);
    }
    // Trailing slash normalised, not doubled.
    expect(out).not.toContain("example.test//api");
  });

  it("says it is generated, so nobody hand-edits it into disagreement", () => {
    expect(renderCrontab("https://x.test")).toContain("GENERATED");
  });
});

// --- the runner itself ----------------------------------------------------

// vi.hoisted, because the static import below loads lib/job-runner during the
// import phase — which runs this mock factory BEFORE a plain `const` would be
// initialised. Without it the file fails to collect with "Cannot access
// prismaMock before initialization".
const prismaMock = vi.hoisted(() => ({
  jobRun: {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

import { countOf } from "@/lib/job-runner";

describe("runJob", () => {
  let runJob: typeof import("@/lib/job-runner").runJob;

  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.jobRun.create.mockResolvedValue({ id: "run-1" });
    prismaMock.jobRun.update.mockResolvedValue({});
    prismaMock.jobRun.findFirst.mockResolvedValue(null);
    ({ runJob } = await import("@/lib/job-runner"));
  });

  it("records a successful run with its duration and item count", async () => {
    const outcome = await runJob("risk-sweep", {}, async (job) => {
      job.recordItems(7);
      return "done";
    });

    expect(outcome).toEqual({ skipped: false, value: "done" });
    expect(prismaMock.jobRun.create).toHaveBeenCalledOnce();
    const closing = prismaMock.jobRun.update.mock.calls.at(-1)![0];
    expect(closing.data.status).toBe("SUCCEEDED");
    expect(closing.data.itemsProcessed).toBe(7);
    expect(closing.data.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("gives the run a correlation id and stores it on the row", async () => {
    let seen = "";
    await runJob("risk-sweep", {}, async (job) => {
      seen = job.correlationId;
      return null;
    });
    expect(seen).toMatch(/^[0-9a-f]{32}$/);
    expect(prismaMock.jobRun.create.mock.calls[0][0].data.correlationId).toBe(seen);
  });

  it("records a failure and rethrows, so the route keeps its 500", async () => {
    await expect(
      runJob("risk-sweep", {}, async () => {
        throw new TypeError("kaboom");
      })
    ).rejects.toThrow("kaboom");

    const closing = prismaMock.jobRun.update.mock.calls.at(-1)![0];
    expect(closing.data.status).toBe("FAILED");
    expect(closing.data.errorName).toBe("TypeError");
    expect(closing.data.errorMessage).toBe("kaboom");
  });

  it("truncates a huge error message rather than storing a payload", async () => {
    await expect(
      runJob("risk-sweep", {}, async () => {
        throw new Error("x".repeat(5000));
      })
    ).rejects.toThrow();
    const closing = prismaMock.jobRun.update.mock.calls.at(-1)![0];
    expect(closing.data.errorMessage.length).toBe(500);
  });

  it("skips when another run of the same job is already in flight", async () => {
    // A competitor that started earlier wins; we back off.
    prismaMock.jobRun.findFirst.mockResolvedValue({
      id: "run-0",
      startedAt: new Date(Date.now() - 1000),
    });

    const body = vi.fn();
    const outcome = await runJob("risk-sweep", {}, async () => {
      body();
      return "ran";
    });

    expect(outcome.skipped).toBe(true);
    expect(body).not.toHaveBeenCalled();
    // SKIPPED is a normal outcome and is recorded as such, not as a failure.
    expect(prismaMock.jobRun.update.mock.calls.at(-1)![0].data.status).toBe("SKIPPED");
  });

  it("runs anyway when the competitor started later — earliest wins", async () => {
    prismaMock.jobRun.findFirst.mockResolvedValue({
      id: "run-2",
      startedAt: new Date(Date.now() + 60_000),
    });
    const outcome = await runJob("risk-sweep", {}, async () => "ran");
    expect(outcome).toEqual({ skipped: false, value: "ran" });
  });

  it("runs the job even when the ledger cannot be written", async () => {
    // The guarantee: an unrecorded run is a monitoring gap, but a job that
    // refused to run because monitoring was down is an outage caused by the
    // monitoring.
    prismaMock.jobRun.create.mockRejectedValue(new Error("db down"));

    const outcome = await runJob("risk-sweep", {}, async () => "still ran");
    expect(outcome).toEqual({ skipped: false, value: "still ran" });
  });

  it("runs the job even when the concurrency check explodes", async () => {
    prismaMock.jobRun.findFirst.mockRejectedValue(new Error("db down"));
    const outcome = await runJob("risk-sweep", {}, async () => "still ran");
    expect(outcome).toEqual({ skipped: false, value: "still ran" });
  });

  it("does not let a failed ledger close swallow the job's own error", async () => {
    prismaMock.jobRun.update.mockRejectedValue(new Error("db down"));
    await expect(
      runJob("risk-sweep", {}, async () => {
        throw new Error("the real failure");
      })
    ).rejects.toThrow("the real failure");
  });
});

describe("countOf", () => {
  it("counts an array and reads common count keys", () => {
    expect(countOf([1, 2, 3])).toBe(3);
    expect(countOf({ processed: 5 })).toBe(5);
    expect(countOf({ sent: 2 })).toBe(2);
  });

  it("returns null rather than inventing a zero", () => {
    // A fabricated 0 is indistinguishable on the console from a real run that
    // found nothing to do, which is exactly what the column exists to show.
    expect(countOf(undefined)).toBeNull();
    expect(countOf("done")).toBeNull();
    expect(countOf({ ok: true })).toBeNull();
  });
});
