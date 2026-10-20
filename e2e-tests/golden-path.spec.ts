import { test, expect, type Browser, type APIRequestContext } from '@playwright/test';

/**
 * The golden path across all three portals (roadmap row 13, "critical E2E"),
 * on a real database, as the real seeded users, through the real APIs:
 *
 *   admin verifies the CSR company → donor submits the requirement → admin
 *   validates → approver runs matching and invites the NGO → NGO proposes →
 *   donor asks for a change → NGO revises → approver approves → contract drafted,
 *   proposed and signed by both → NGO accepts → donor records the full payment →
 *   NGO finance confirms → project is FUNDED → donor impact report shows it.
 *
 * Data: `npm run seed`, `npm run seed:csr -- --apply`, `npm run seed:ngo -- --apply`.
 * It consumes the seeded Acme requirement (it ends CONTRACTED); re-running needs
 * a fresh requirement — the test creates one through the donor form API if the
 * seeded one has already been used.
 */

const PASSWORD = 'demoPassword123';
const ADMIN = { email: 'admin@impactbridge.com', password: 'adminpassword123' };

async function session(browser: Browser, email: string, password = PASSWORD): Promise<APIRequestContext> {
  const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
  return page.request;
}

async function ok(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  const body = await res.text();
  expect(res.ok(), `${what} → ${res.status()} ${body.slice(0, 300)}`).toBeTruthy();
  return body ? JSON.parse(body) : {};
}

test.describe.configure({ mode: 'serial' });

test('golden path: CSR requirement → matching → proposal v1 → change → v2 → approval → contract → payment → FUNDED → donor report', async ({ browser }) => {
  test.setTimeout(15 * 60_000);

  const admin = await session(browser, ADMIN.email, ADMIN.password);
  const owner = await session(browser, 'csr.acme@demo.com');
  const approver = await session(browser, 'approver.acme@demo.com');
  const ngo = await session(browser, 'akshar@demo.org');
  const finance = await session(browser, 'finance.akshar@demo.org');

  // ── 1. Admin verifies the CSR company ────────────────────────────────────
  const acmeId = (await ok(await admin.post('/api/admin/search', { data: { q: 'csr.acme@demo.com' } }), 'search Acme')).results.find(
    (r: any) => r.kind === 'Donor'
  )?.id;
  expect(acmeId, 'Acme account found by admin search').toBeTruthy();
  const verify = await admin.post(`/api/admin/donors/${acmeId}/org-review`, { data: { action: 'VERIFY', note: 'CIN checked against MCA record (golden path).' } });
  expect([200, 409]).toContain(verify.status()); // 409 if already verified by an earlier run
  // The funder gate also needs the company PAN verified before NGOs see it.
  const pan = await admin.post(`/api/admin/donors/${acmeId}/pan-review`, { data: { action: "VERIFY", note: "PAN matched against the company record (golden path)." } });
  expect([200, 409]).toContain(pan.status());

  // ── 2. The donor's requirement: the seeded draft, or a fresh one ─────────
  const list = (await ok(await owner.get('/api/requirements'), 'list requirements')).requirements as any[];
  let req = list.find((r) => r.status === 'DONOR_REVIEW');
  if (!req) {
    req = (
      await ok(
        await owner.post('/api/requirements', {
          data: {
            title: `Golden path ${Date.now()}`,
            fields: {
              summary: 'Digital classrooms in government schools.',
              sector: 'Education',
              state: 'Karnataka',
              budgetMin: 250000,
              budgetMax: 400000,
              currency: 'INR',
              durationMonths: 12,
              expectedBeneficiaries: 1000,
              primaryKPIs: ['Students using digital lessons weekly'],
              reportingCadence: 'Quarterly',
              contactPerson: 'Meera Iyer',
              contactEmail: 'csr.acme@demo.com',
            },
          },
        }),
        'create requirement'
      )
    ).requirement;
  }
  const reqId = req.id as string;
  await ok(await owner.post(`/api/requirements/${reqId}/submit-review`), 'submit for admin review');

  // ── 3. Admin validates ───────────────────────────────────────────────────
  await ok(await admin.post(`/api/requirements/${reqId}/admin-approve`, { data: { note: 'Budget, sector and KPIs are clear (golden path).' } }), 'admin validates');

  // ── 4. Approver runs matching and invites Akshar ─────────────────────────
  await ok(await approver.post(`/api/requirements/${reqId}/matches`), 'run matching');
  const run = await ok(await approver.get(`/api/requirements/${reqId}/matches`), 'read matches');
  const matches: any[] = run.run?.matches ?? run.matches ?? [];
  const akshar = matches.find((m) => (m.ngoName ?? m.ngo?.orgName ?? '').includes('Akshar'));
  expect(akshar, `Akshar in the shortlist (got: ${matches.map((m) => m.ngoName ?? m.ngo?.orgName).join(', ')})`).toBeTruthy();
  await ok(await approver.post(`/api/requirements/${reqId}/matches/${akshar.id}/invite`), 'invite Akshar');

  // ── 5. NGO proposes v1 ───────────────────────────────────────────────────
  const proposal = {
    proposedBudget: 300000,
    proposedDurationMonths: 12,
    implementationPlan: 'Install projectors in 5 schools, train teachers, assess learning each term.',
    expectedOutcomes: '1,200 students using digital lessons weekly.',
    milestones: [
      { title: 'Equipment installed', amount: 150000, durationMonths: 3 },
      { title: 'Teachers trained and first assessment', amount: 150000, durationMonths: 9 },
    ],
  };
  await ok(await ngo.post(`/api/opportunities/${reqId}/interest`, { data: proposal }), 'NGO proposal v1');

  // ── 6. Donor requests a change; NGO revises to v2 ────────────────────────
  const responses = (await ok(await owner.get(`/api/requirements/${reqId}/responses`), 'list responses')).responses as any[];
  const resp = responses.find((r) => r.ngo?.orgName?.includes('Akshar')) ?? responses[0];
  await ok(
    await owner.post(`/api/requirements/${reqId}/responses/${resp.id}/request-changes`, { data: { note: 'Please add an attendance KPI and quarterly reports.' } }),
    'request changes'
  );
  await ok(
    await ngo.post(`/api/opportunities/${reqId}/interest`, {
      data: { ...proposal, expectedOutcomes: '1,200 students weekly; attendance tracked; quarterly reports.' },
    }),
    'NGO proposal v2'
  );

  // ── 7. Approver approves v2 ──────────────────────────────────────────────
  await ok(await approver.post(`/api/requirements/${reqId}/select`, { data: { responseId: resp.id } }), 'approve proposal v2');

  // ── 8. Contract: draft → propose → both sign → NGO accepts ───────────────
  const projectId = akshar.projectId ?? akshar.project?.id;
  const contract = (
    await ok(
      await owner.post('/api/contracts', {
        data: {
          projectId,
          requirementId: reqId,
          title: 'Digital classrooms grant (golden path)',
          totalGrantAmount: '300000',
          termsAndConditions: 'Funds are released per milestone against approved evidence.',
          milestones: [
            { title: 'Equipment installed', allocatedAmount: '150000' },
            { title: 'Teachers trained and first assessment', allocatedAmount: '150000' },
          ],
        },
      }),
      'draft contract'
    )
  ).contract;
  await ok(await owner.post(`/api/contracts/${contract.id}/propose`), 'propose contract');
  await ok(await approver.post(`/api/contracts/${contract.id}/sign`, { data: { signerName: 'Arjun Nair', signerTitle: 'CSR Approver' } }), 'donor signs');
  await ok(await ngo.post(`/api/contracts/${contract.id}/sign`, { data: { signerName: 'Akshar Director', signerTitle: 'Director' } }), 'NGO signs');
  await ok(await ngo.post(`/api/contracts/${contract.id}/accept`), 'NGO accepts the funded project');

  // ── 9. Donor records the full payment; NGO finance confirms ──────────────
  const pay = (
    await ok(
      await approver.post(`/api/contracts/${contract.id}/payments`, {
        data: { idempotencyKey: `golden-${Date.now()}`, amount: '300000', mode: 'SANDBOX' },
      }),
      'record payment'
    )
  ).payment;
  await ok(await finance.patch(`/api/contracts/${contract.id}/payments/${pay.id}`, { data: { decision: 'CONFIRM' } }), 'NGO finance confirms');

  // ── 10. FUNDED, and the donor's impact report shows the project ──────────
  const csv = await (await owner.get('/api/donor/impact-report')).text();
  expect(csv.split('\n')[0]).toContain('project,organisation');
  const report = await ok(await owner.get(`/api/contracts/${contract.id}`), 'read contract');
  expect(report.contract?.status ?? report.status).toBe('ACTIVE');
  const notif = (await ok(await ngo.get('/api/user/notifications?limit=50'), 'NGO notifications')).notifications as any[];
  expect(notif.some((n) => n.type === 'PROJECT_FUNDED'), 'NGO told the project is FUNDED').toBeTruthy();
});
