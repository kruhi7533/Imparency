import { describe, it, expect } from "vitest";
import {
  buildInboxItems,
  countBySeverity,
  countByQueue,
  filterByQueue,
  groupByCategory,
  isBreached,
  breachedItems,
  breachesByQueue,
  isChaseable,
  partitionByChase,
  chaseExpiry,
  isTodayWorthy,
  splitTodayAndOlder,
  CHASE_WINDOW_DAYS,
  MAX_DETAIL_LINES,
  type InboxSources,
} from "@/lib/today-inbox";

/**
 * What these tests protect.
 *
 * The Action Center's whole claim is that an admin can tell, at a glance, what
 * they owe versus what someone else owes versus what is merely worth knowing.
 * A queue drifting into the wrong column, or the oldest/most severe item
 * sinking down a list, silently breaks that claim while the page still renders
 * perfectly fine.
 */

const NOW = new Date("2026-09-18T12:00:00.000Z").getTime();
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000);

function sources(overrides: Partial<InboxSources> = {}): InboxSources {
  return {
    pendingNgos: [],
    pendingProjects: [],
    completedProjects: [],
    pendingProofs: [],
    pendingFcra: [],
    pendingOrgs: [],
    institutionalDonations: [],
    openRiskReviews: [],
    openAlerts: [],
    threadsNeedingReply: [],
    quietNgos: [],
    overdueMilestones: [],
    ...overrides,
  };
}

const ONE_OF_EACH = sources({
  pendingNgos: [{ id: "n1", orgName: "Asha Trust", createdAt: daysAgo(2) }],
  pendingProjects: [
    { id: "p1", title: "Well repair", createdAt: daysAgo(1), ngo: { orgName: "Asha Trust" } },
  ],
  pendingProofs: [
    {
      id: "m1",
      title: "Phase 1 photos",
      updatedAt: daysAgo(1),
      project: { title: "Well repair", ngo: { orgName: "Asha Trust" } },
    },
  ],
  pendingFcra: [{ id: "c1", updatedAt: daysAgo(1), ngo: { id: "n1", orgName: "Asha Trust" } }],
  openRiskReviews: [
    {
      id: "r1",
      riskLevel: "MEDIUM",
      status: "OPEN",
      createdAt: daysAgo(1),
      ngo: { orgName: "Asha Trust" },
    },
  ],
  openAlerts: [
    {
      id: "a1",
      type: "DUPLICATE_PAN",
      severity: "LOW",
      createdAt: daysAgo(1),
      entityType: "NGO",
      entityId: "n1",
      description: "Two organisations share one PAN",
    },
  ],
  threadsNeedingReply: [
    { id: "t1", subject: "Appeal", updatedAt: daysAgo(1), subjectType: "NGO" },
  ],
  quietNgos: [{ id: "n2", orgName: "Silent Foundation" }],
  overdueMilestones: [
    {
      id: "m2",
      title: "Phase 2",
      deadline: daysAgo(3),
      project: { title: "Well repair", ngo: { orgName: "Asha Trust" } },
    },
  ],
});

function categoryOf(queueOrId: string) {
  const items = buildInboxItems(ONE_OF_EACH, NOW);
  const item = items.find((i) => i.id.startsWith(queueOrId));
  if (!item) throw new Error(`no item for ${queueOrId}`);
  return item.category;
}

describe("which column each queue lands in", () => {
  it("puts everything the admin personally owes under Waiting on you", () => {
    expect(categoryOf("ngo-")).toBe("Waiting on you");
    expect(categoryOf("project-")).toBe("Waiting on you");
    expect(categoryOf("proof-")).toBe("Waiting on you");
    expect(categoryOf("fcra-")).toBe("Waiting on you");
    expect(categoryOf("risk-")).toBe("Waiting on you");
    // An NGO replied and is now waiting on the admin, not the other way round.
    expect(categoryOf("thread-")).toBe("Waiting on you");
  });

  it("surfaces a finished project for close-out under Waiting on you", () => {
    // A project reaching COMPLETED had no queue at all before this.
    const [item] = buildInboxItems(
      sources({
        completedProjects: [
          { id: "p9", title: "Well repair", updatedAt: daysAgo(2), ngo: { orgName: "Asha Trust" } },
        ],
      }),
      NOW
    );

    expect(item.category).toBe("Waiting on you");
    expect(item.queue).toBe("Project Completions");
    expect(item.title).toBe("Well repair");
    expect(item.subtitle).toContain("awaiting close-out");
  });

  it("puts work owed by an organisation under Waiting on others", () => {
    expect(categoryOf("overdue-")).toBe("Waiting on others");
  });

  it("puts things nobody is blocked on under Signals", () => {
    expect(categoryOf("quiet-")).toBe("Signals");
  });

  it("splits fraud alerts by whether they are owed or merely noted", () => {
    // A LOW alert is awareness; anything higher is a decision the admin owes.
    const [low] = buildInboxItems(
      sources({
        openAlerts: [
          { id: "a", type: "T", severity: "LOW", createdAt: daysAgo(1), entityType: "NGO", entityId: "n1", description: "d" },
        ],
      }),
      NOW
    );
    const [high] = buildInboxItems(
      sources({
        openAlerts: [
          { id: "a", type: "T", severity: "HIGH", createdAt: daysAgo(1), entityType: "NGO", entityId: "n1", description: "d" },
        ],
      }),
      NOW
    );
    expect(low.category).toBe("Signals");
    expect(high.category).toBe("Waiting on you");
  });

  it("falls back to the defect text when the organisation cannot be resolved", () => {
    // Nine alerts sharing a type must not render as nine identical rows.
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          {
            id: "a",
            type: "VERIFICATION_DEFECT",
            severity: "HIGH",
            createdAt: daysAgo(1),
            entityType: "NGO",
            entityId: "n1",
            description: '"Asha Trust" failed a document name check',
          },
        ],
      }),
      NOW
    );
    expect(item.title).toBe('"Asha Trust" failed a document name check');
    expect(item.subtitle).toContain("VERIFICATION DEFECT");
  });

  it("falls back to the type when an alert has no description", () => {
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          { id: "a", type: "VERIFICATION_DEFECT", severity: "HIGH", createdAt: daysAgo(1), entityType: "NGO", entityId: "n1", description: null },
        ],
      }),
      NOW
    );
    expect(item.title).toBe("VERIFICATION DEFECT");
  });


  it("names the organisation and links to it when the id resolves", () => {
    // Several NGOs trip the same defect; without the name they are one row
    // repeated, pointing at a queue instead of the organisation in question.
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          {
            id: "a",
            type: "VERIFICATION_DEFECT",
            severity: "HIGH",
            createdAt: daysAgo(1),
            entityType: "NGO",
            entityId: "ngo_7",
            description: "PAN number in the documents does not match the form.",
          },
        ],
        alertNgos: { ngo_7: { ngoId: "ngo_7", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.title).toBe("Tejamma");
    expect(item.subtitle).toContain("PAN number");
    expect(item.href).toBe("/admin/ngos/ngo_7");
  });

  it("links a milestone alert to the organisation, not to the milestone id", () => {
    // EXTREMELY_LOW_PROOF_SCORE and DEADLINE_EXCEEDED store a MILESTONE id.
    // Using it as an NGO id would build /admin/ngos/<milestoneId> — a 404.
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          {
            id: "a",
            type: "EXTREMELY_LOW_PROOF_SCORE",
            severity: "HIGH",
            createdAt: daysAgo(1),
            entityType: "MILESTONE",
            entityId: "milestone_3",
            description: 'Milestone "Phase 2" scored 12/100.',
          },
        ],
        alertNgos: { milestone_3: { ngoId: "ngo_9", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.title).toBe("Tejamma");
    expect(item.href).toBe("/admin/ngos/ngo_9");
  });

  it("stays on the queue when the id is not an NGO after all", () => {
    // Some call sites store a milestone id under entityType "NGO"; linking
    // blindly would send the admin to a page that does not exist.
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          {
            id: "a",
            type: "EXTREMELY_LOW_PROOF_SCORE",
            severity: "HIGH",
            createdAt: daysAgo(1),
            entityType: "NGO",
            entityId: "milestone_3",
            description: "Scored 12/100.",
          },
        ],
        alertNgos: {},
      }),
      NOW
    );

    expect(item.href).toBe("/admin/risk-compliance");
  });

  it("gives every item a category, a link out, and an icon", () => {
    // The page must never be the only place an item can be actioned.
    for (const item of buildInboxItems(ONE_OF_EACH, NOW)) {
      expect(item.category).toBeTruthy();
      expect(item.href).toMatch(/^\//);
      expect(item.iconKey).toBeTruthy();
    }
  });
});

describe("fraud alerts collapse per organisation", () => {
  function alert(id: string, entityId: string, severity: string, description: string, ageDays = 3) {
    return {
      id,
      type: "VERIFICATION_DEFECT",
      severity,
      createdAt: daysAgo(ageDays),
      entityType: "NGO",
      entityId,
      description,
    };
  }

  it("shows one row for an organisation with several defects", () => {
    // Ten rows naming the same NGO is a page that cannot be read.
    const items = buildInboxItems(
      sources({
        openAlerts: [
          alert("a1", "ngo_1", "HIGH", "Organisation name does not match."),
          alert("a2", "ngo_1", "HIGH", "Registration number does not match."),
          alert("a3", "ngo_1", "HIGH", "PAN number does not match."),
        ],
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Tejamma");
    expect(items[0].subtitle).toContain("3 open alerts");
    expect(items[0].href).toBe("/admin/ngos/ngo_1");
  });

  it("lists the defects underneath rather than hiding them", () => {
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          alert("a1", "ngo_1", "HIGH", "Organisation name does not match."),
          alert("a2", "ngo_1", "HIGH", "PAN number does not match."),
        ],
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.details).toEqual([
      "Organisation name does not match.",
      "PAN number does not match.",
    ]);
  });

  it("truncates a long list but says how many it left out", () => {
    const [item] = buildInboxItems(
      sources({
        openAlerts: Array.from({ length: 7 }, (_, i) =>
          alert(`a${i}`, "ngo_1", "HIGH", `Defect ${i}`)
        ),
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.details).toHaveLength(MAX_DETAIL_LINES + 1);
    expect(item.details?.[MAX_DETAIL_LINES]).toBe(`+${7 - MAX_DETAIL_LINES} more`);
  });

  it("takes the worst severity in the group, never an average", () => {
    // A grouped row must not look calmer than the worst thing inside it.
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          alert("a1", "ngo_1", "LOW", "Minor"),
          alert("a2", "ngo_1", "HIGH", "Serious"),
        ],
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.severity).toBe("high");
    expect(item.category).toBe("Waiting on you");
    // Worst first, so truncation can never hide the most serious defect.
    expect(item.details?.[0]).toBe("Serious");
  });

  it("takes the oldest arrival in the group, never the newest", () => {
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          alert("a1", "ngo_1", "HIGH", "Recent", 1),
          alert("a2", "ngo_1", "HIGH", "Ancient", 30),
        ],
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.age).toBe(30);
  });

  it("does not merge alerts belonging to different organisations", () => {
    const items = buildInboxItems(
      sources({
        openAlerts: [
          alert("a1", "ngo_1", "HIGH", "Defect"),
          alert("a2", "ngo_2", "HIGH", "Defect"),
        ],
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" }, ngo_2: { ngoId: "ngo_2", orgName: "Kiran Welfare Society" } },
      }),
      NOW
    );

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title).sort()).toEqual(["Kiran Welfare Society", "Tejamma"]);
  });

  it("keeps the single-alert row unchanged, with no sub-points", () => {
    const [item] = buildInboxItems(
      sources({
        openAlerts: [alert("a1", "ngo_1", "HIGH", "PAN number does not match.")],
        alertNgos: { ngo_1: { ngoId: "ngo_1", orgName: "Tejamma" } },
      }),
      NOW
    );

    expect(item.title).toBe("Tejamma");
    expect(item.subtitle).toContain("PAN number does not match.");
    expect(item.details).toBeUndefined();
  });
});


describe("severity", () => {
  it("escalates an NGO waiting more than five days", () => {
    const [item] = buildInboxItems(
      sources({ pendingNgos: [{ id: "n", orgName: "Slow", createdAt: daysAgo(6) }] }),
      NOW
    );
    expect(item.severity).toBe("high");
  });

  it("treats a CRITICAL or HIGH risk review as needing attention", () => {
    const [critical] = buildInboxItems(
      sources({
        openRiskReviews: [
          { id: "r", riskLevel: "CRITICAL", status: "OPEN", createdAt: daysAgo(0), ngo: { orgName: "X" } },
        ],
      }),
      NOW
    );
    expect(critical.severity).toBe("high");
  });

  it("escalates a milestone more than a week overdue", () => {
    const [item] = buildInboxItems(
      sources({
        overdueMilestones: [
          {
            id: "m",
            title: "Late",
            deadline: daysAgo(8),
            project: { title: "P", ngo: { orgName: "X" } },
          },
        ],
      }),
      NOW
    );
    expect(item.severity).toBe("high");
  });

  it("counts each severity band for the header summary", () => {
    const counts = countBySeverity(buildInboxItems(ONE_OF_EACH, NOW));
    expect(counts.high + counts.medium + counts.low).toBe(9);
  });
});

describe("the queue filter", () => {
  it("lists the busiest queue first so the pile-up is obvious", () => {
    const items = buildInboxItems(
      sources({
        pendingNgos: [
          { id: "n1", orgName: "A", createdAt: daysAgo(1) },
          { id: "n2", orgName: "B", createdAt: daysAgo(1) },
        ],
        quietNgos: [{ id: "q1", orgName: "C" }],
      }),
      NOW
    );

    expect(countByQueue(items)).toEqual([
      { queue: "NGO Verification", count: 2 },
      { queue: "Impact Health", count: 1 },
    ]);
  });

  it("offers no chip for a queue with nothing waiting", () => {
    const items = buildInboxItems(
      sources({ pendingNgos: [{ id: "n1", orgName: "A", createdAt: daysAgo(1) }] }),
      NOW
    );

    expect(countByQueue(items).map((q) => q.queue)).toEqual(["NGO Verification"]);
  });

  it("narrows to one queue while keeping its column placement", () => {
    const items = buildInboxItems(ONE_OF_EACH, NOW);
    const onlyAlerts = filterByQueue(items, "Fraud Alerts");

    expect(onlyAlerts).toHaveLength(1);
    expect(onlyAlerts[0].queue).toBe("Fraud Alerts");
    // A filter must not move an item into a different column.
    expect(onlyAlerts[0].category).toBe("Signals");
  });

  it("returns everything when no queue is selected", () => {
    const items = buildInboxItems(ONE_OF_EACH, NOW);
    expect(filterByQueue(items, undefined)).toHaveLength(items.length);
  });

  it("returns nothing for a queue that does not exist", () => {
    // The page only passes a queue it found in the counts, but a hand-typed
    // URL must not silently fall back to showing everything.
    const items = buildInboxItems(ONE_OF_EACH, NOW);
    expect(filterByQueue(items, "Nonsense")).toEqual([]);
  });
});

describe("chasing", () => {
  it("allows a chase only on work somebody else owes", () => {
    const items = buildInboxItems(ONE_OF_EACH, NOW);
    const chaseable = items.filter(isChaseable);

    expect(chaseable).toHaveLength(1);
    expect(chaseable[0].category).toBe("Waiting on others");
    // Nothing the admin owes, and nothing purely informational, is chaseable.
    expect(items.filter((i) => isChaseable(i) && i.category !== "Waiting on others")).toEqual([]);
  });

  it("keeps a chased item visible so a mistaken tick can be undone", () => {
    const items = buildInboxItems(ONE_OF_EACH, NOW).filter(isChaseable);
    const { pending, chased } = partitionByChase(items, new Set([items[0].id]));

    expect(pending).toEqual([]);
    expect(chased).toHaveLength(1);
  });

  it("leaves everything pending when nothing has been chased", () => {
    const items = buildInboxItems(ONE_OF_EACH, NOW);
    const { pending, chased } = partitionByChase(items, new Set());

    expect(pending).toHaveLength(items.length);
    expect(chased).toEqual([]);
  });

  it("buys exactly one week", () => {
    const from = new Date("2026-09-22T00:00:00.000Z");
    const days = (chaseExpiry(from).getTime() - from.getTime()) / (1000 * 60 * 60 * 24);
    expect(days).toBe(CHASE_WINDOW_DAYS);
    expect(CHASE_WINDOW_DAYS).toBe(7);
  });
});

describe("what earns a place on Today", () => {
  const anHourAgo = new Date(NOW - 60 * 60 * 1000);

  it("shows work that arrived since the admin last looked", () => {
    const [justArrived] = buildInboxItems(
      sources({
        pendingProjects: [
          { id: "p", title: "Just arrived", createdAt: new Date(NOW - 60_000), ngo: { orgName: "Asha Trust" } },
        ],
      }),
      NOW
    );
    expect(isTodayWorthy(justArrived, anHourAgo)).toBe(true);
  });

  it("hides the same item once the admin has seen it", () => {
    // Same row, same severity — the only thing that changed is that the visit
    // marker has moved past it.
    const [item] = buildInboxItems(
      sources({
        pendingProjects: [
          { id: "p", title: "Seen already", createdAt: daysAgo(2), ngo: { orgName: "Asha Trust" } },
        ],
      }),
      NOW
    );
    expect(isTodayWorthy(item, daysAgo(3))).toBe(true);
    expect(isTodayWorthy(item, anHourAgo)).toBe(false);
  });

  it("keeps urgent work regardless of how long it has sat", () => {
    // A three-week-old HIGH alert must not fall off the page just for ageing.
    const [item] = buildInboxItems(
      sources({ pendingNgos: [{ id: "n", orgName: "Old and urgent", createdAt: daysAgo(21) }] }),
      NOW
    );
    expect(item.severity).toBe("high");
    expect(isTodayWorthy(item, anHourAgo)).toBe(true);
  });

  it("drops routine work that is neither new nor urgent", () => {
    // This is the whole point: Today was a backlog, so the counts never moved.
    const [item] = buildInboxItems(
      sources({
        pendingProjects: [
          { id: "p", title: "Old", createdAt: daysAgo(14), ngo: { orgName: "Asha Trust" } },
        ],
      }),
      NOW
    );
    expect(item.severity).not.toBe("high");
    expect(isTodayWorthy(item, anHourAgo)).toBe(false);
  });

  it("counts what it left out instead of dropping it", () => {
    const items = buildInboxItems(
      sources({
        pendingNgos: [{ id: "n", orgName: "Old and urgent", createdAt: daysAgo(21) }],
        pendingProjects: [
          { id: "p", title: "Old routine", createdAt: daysAgo(14), ngo: { orgName: "Asha Trust" } },
        ],
      }),
      NOW
    );
    const { today, older } = splitTodayAndOlder(items, anHourAgo);

    expect(today.map((i) => i.title)).toEqual(["Old and urgent"]);
    expect(older.map((i) => i.title)).toEqual(["Old routine"]);
    expect(today.length + older.length).toBe(items.length);
  });

  it("never treats a standing condition as new", () => {
    // Quiet NGOs have no arrival event; dating them to now would make them
    // "new" on every single visit.
    const [item] = buildInboxItems(sources({ quietNgos: [{ id: "q", orgName: "Silent" }] }), NOW);
    expect(isTodayWorthy(item, anHourAgo)).toBe(false);
  });

  it("gives every item a real arrival time", () => {
    for (const item of buildInboxItems(ONE_OF_EACH, NOW)) {
      expect(item.occurredAt).toBeInstanceOf(Date);
      expect(Number.isNaN(item.occurredAt.getTime())).toBe(false);
    }
  });
});

describe("breaches", () => {
  it("flags an item past its queue's declared target", () => {
    // Proof Review's target is 3 days.
    const [fresh] = buildInboxItems(
      sources({
        pendingProofs: [
          { id: "m1", title: "Fresh", updatedAt: daysAgo(1), project: { title: "P", ngo: { orgName: "X" } } },
        ],
      }),
      NOW
    );
    const [late] = buildInboxItems(
      sources({
        pendingProofs: [
          { id: "m2", title: "Late", updatedAt: daysAgo(9), project: { title: "P", ngo: { orgName: "X" } } },
        ],
      }),
      NOW
    );

    expect(isBreached(fresh)).toBe(false);
    expect(isBreached(late)).toBe(true);
  });

  it("orders breaches by how far past target they are, not by age", () => {
    // A 5-day-old fraud alert (target 1d) is further past its promise than a
    // 6-day-old proof (target 3d), even though the proof is older.
    const items = buildInboxItems(
      sources({
        openAlerts: [
          {
            id: "a1",
            type: "T",
            severity: "HIGH",
            createdAt: daysAgo(5),
            entityType: "NGO",
            entityId: "n1",
            description: "Alert",
          },
        ],
        pendingProofs: [
          { id: "m1", title: "Proof", updatedAt: daysAgo(6), project: { title: "P", ngo: { orgName: "X" } } },
        ],
      }),
      NOW
    );

    const order = breachedItems(items).map((i) => i.queue);
    expect(order).toEqual(["Fraud Alerts", "Proof Review"]);
  });

  it("summarises breaches per queue with the worst overrun", () => {
    const items = buildInboxItems(
      sources({
        pendingProofs: [
          { id: "m1", title: "A", updatedAt: daysAgo(5), project: { title: "P", ngo: { orgName: "X" } } },
          { id: "m2", title: "B", updatedAt: daysAgo(10), project: { title: "P", ngo: { orgName: "X" } } },
        ],
      }),
      NOW
    );

    expect(breachesByQueue(items)).toEqual([{ queue: "Proof Review", count: 2, worst: 7 }]);
  });

  it("reports nothing when every queue is inside its target", () => {
    const items = buildInboxItems(
      sources({
        pendingProofs: [
          { id: "m1", title: "A", updatedAt: daysAgo(0), project: { title: "P", ngo: { orgName: "X" } } },
        ],
      }),
      NOW
    );

    expect(breachedItems(items)).toEqual([]);
    expect(breachesByQueue(items)).toEqual([]);
  });

  it("keeps breach separate from severity", () => {
    // A LOW alert past target is a broken promise, not a serious problem —
    // collapsing the two would lose one of those facts.
    const [item] = buildInboxItems(
      sources({
        openAlerts: [
          {
            id: "a1",
            type: "T",
            severity: "LOW",
            createdAt: daysAgo(30),
            entityType: "NGO",
            entityId: "n1",
            description: "Minor",
          },
        ],
      }),
      NOW
    );

    expect(item.severity).toBe("low");
    expect(isBreached(item)).toBe(true);
  });
});

describe("grouping and order", () => {
  it("returns categories in a fixed order regardless of input order", () => {
    const groups = groupByCategory(buildInboxItems(ONE_OF_EACH, NOW));
    expect(groups.map((g) => g.category)).toEqual([
      "Waiting on you",
      "Waiting on others",
      "Signals",
    ]);
  });

  it("keeps an empty category so the columns do not shuffle between loads", () => {
    const groups = groupByCategory(
      buildInboxItems(
        sources({ pendingNgos: [{ id: "n", orgName: "Only one", createdAt: daysAgo(1) }] }),
        NOW
      )
    );
    expect(groups).toHaveLength(3);
    expect(groups[0].items).toHaveLength(1);
    expect(groups[1].items).toEqual([]);
    expect(groups[2].items).toEqual([]);
  });

  it("holds all three columns even when every queue is caught up", () => {
    const groups = groupByCategory(buildInboxItems(sources(), NOW));
    expect(groups).toHaveLength(3);
    expect(groups.every((g) => g.items.length === 0)).toBe(true);
  });

  it("sorts by severity first, then oldest first within a band", () => {
    const groups = groupByCategory(
      buildInboxItems(
        sources({
          pendingNgos: [
            { id: "new-high", orgName: "New high", createdAt: daysAgo(6) },
            { id: "old-high", orgName: "Old high", createdAt: daysAgo(30) },
            { id: "medium", orgName: "Medium", createdAt: daysAgo(1) },
          ],
        }),
        NOW
      )
    );

    expect(groups[0].items.map((i) => i.title)).toEqual(["Old high", "New high", "Medium"]);
  });
});

/**
 * Corporate giving in the Action Center.
 *
 * Two different things, deliberately in two different columns: a company
 * waiting on a decision is work the admin OWES, while money that already
 * landed is something they can only be TOLD about. Putting the second in
 * "Waiting on you" would fill the queue with items nobody can action.
 */
describe("donor organisations", () => {
  it("puts a company awaiting verification in Waiting on you", () => {
    const groups = groupByCategory(
      buildInboxItems(
        sources({
          pendingOrgs: [
            {
              id: "d1",
              displayName: "Suryodaya Industries Limited",
              donorPersona: "CSR_OFFICER",
              orgSubmittedAt: daysAgo(2),
              createdAt: daysAgo(40),
            },
          ],
        }),
        NOW
      )
    );
    const waiting = groups.find((g) => g.category === "Waiting on you")!;
    expect(waiting.items).toHaveLength(1);
    expect(waiting.items[0].title).toBe("Suryodaya Industries Limited");
    expect(waiting.items[0].queue).toBe("CSR Verification");
    expect(waiting.items[0].href).toBe("/admin/donors/d1");
  });

  it("ages a submission from when it was SUBMITTED, not when the account was made", () => {
    // A company can hold an account for months before filing anything; ageing
    // from createdAt would show every new submission as instantly overdue.
    const [item] = buildInboxItems(
      sources({
        pendingOrgs: [
          {
            id: "d1",
            displayName: "Late Filer Ltd",
            donorPersona: "CSR_OFFICER",
            orgSubmittedAt: daysAgo(1),
            createdAt: daysAgo(200),
          },
        ],
      }),
      NOW
    );
    expect(item.age).toBe(1);
    expect(item.severity).toBe("medium");
  });

  it("falls back to account age when nothing recorded a submission time", () => {
    const [item] = buildInboxItems(
      sources({
        pendingOrgs: [
          {
            id: "d1",
            displayName: "No Timestamp Ltd",
            donorPersona: "FOUNDATION",
            orgSubmittedAt: null,
            createdAt: daysAgo(9),
          },
        ],
      }),
      NOW
    );
    expect(item.age).toBe(9);
    expect(item.severity).toBe("high");
  });

  it("names the kind of body without leaking the raw enum", () => {
    const [item] = buildInboxItems(
      sources({
        pendingOrgs: [
          {
            id: "d1",
            displayName: "Asha Foundation",
            donorPersona: "FOUNDATION",
            orgSubmittedAt: daysAgo(1),
            createdAt: daysAgo(1),
          },
        ],
      }),
      NOW
    );
    expect(item.subtitle).toContain("Foundation");
    expect(item.subtitle).not.toContain("FOUNDATION");
  });
});

describe("institutional donations", () => {
  const donation = (overrides: Record<string, unknown> = {}) => ({
    id: "don1",
    amount: 2250000,
    createdAt: daysAgo(1),
    donorId: "d1",
    donorName: "Suryodaya Industries Limited",
    donorPersona: "CSR_OFFICER",
    orgVerificationStatus: "VERIFIED",
    projectTitle: "After-School Learning Centres",
    ...overrides,
  });

  it("reports corporate money as a Signal, never as a queue item", () => {
    const groups = groupByCategory(
      buildInboxItems(sources({ institutionalDonations: [donation()] }), NOW)
    );
    const signals = groups.find((g) => g.category === "Signals")!;
    expect(signals.items).toHaveLength(1);
    expect(groups.find((g) => g.category === "Waiting on you")!.items).toHaveLength(0);
  });

  it("states the amount in the title, so the feed is readable without clicking", () => {
    const [item] = buildInboxItems(sources({ institutionalDonations: [donation()] }), NOW);
    expect(item.title).toContain("22,50,000");
    expect(item.title).toContain("Suryodaya Industries Limited");
  });

  it("is LOW severity when the organisation behind the money was verified", () => {
    const [item] = buildInboxItems(sources({ institutionalDonations: [donation()] }), NOW);
    expect(item.severity).toBe("low");
  });

  it("is HIGH severity when it came from an unverified organisation", () => {
    // Money taken on behalf of a company nobody checked. Should be true only
    // for rows predating the create-order gate, so it must be loud.
    const [item] = buildInboxItems(
      sources({
        institutionalDonations: [donation({ orgVerificationStatus: "NOT_SUBMITTED" })],
      }),
      NOW
    );
    expect(item.severity).toBe("high");
    expect(item.subtitle).toContain("not submitted");
  });

  it("links to the donor, which is where the organisation can be acted on", () => {
    const [item] = buildInboxItems(sources({ institutionalDonations: [donation()] }), NOW);
    expect(item.href).toBe("/admin/donors/d1");
  });
});
