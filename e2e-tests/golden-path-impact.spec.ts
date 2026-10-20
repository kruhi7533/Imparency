import { test, expect, type Browser, type APIRequestContext } from '@playwright/test';

/**
 * The impact half of the golden path (roadmap rows 11–12), on a real database
 * as the real seeded users:
 *
 *   field staff capture a photo against their task → admin approves it → the
 *   CSR donor funding the project can see it (no people in it, so no consent
 *   needed) and a donor from ANOTHER organisation cannot → the NGO files an
 *   outcome claim citing it → submits → admin approves → the donor's impact
 *   report shows the figure as verified.
 *
 * Runs after e2e-tests/golden-path.spec.ts, which gives Acme an ACTIVE contract
 * on an Akshar project. Data: npm run seed, seed:csr, seed:ngo, seed-metric-registry.
 */

const PASSWORD = 'demoPassword123';

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

/** A real, decodable 1×1 JPEG — the server sniffs the bytes, not the filename. */
const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64'
);

test('impact path: field photo → review → donor sees it (consent rules) → outcome claim → approval → verified figure in the donor report', async ({ browser }) => {
  test.setTimeout(10 * 60_000);

  const admin = await session(browser, 'admin@impactbridge.com', 'adminpassword123');
  const owner = await session(browser, 'akshar@demo.org');
  const field = await session(browser, 'field.akshar@demo.org');
  const donor = await session(browser, 'csr.acme@demo.com');
  const otherDonor = await session(browser, 'priya.sharma@demo.com');

  // The project Acme funds (ACTIVE contract from the golden path).
  const contracts = (await ok(await donor.get('/api/contracts'), 'donor contracts')).contracts as any[];
  const active = contracts.find((c) => c.status === 'ACTIVE');
  expect(active, 'Acme has an ACTIVE contract — run golden-path.spec.ts first').toBeTruthy();
  const projectId: string = active.projectId;

  // ── 1. Field staff capture a photo against one of their tasks on that project ──
  const tasks = (await ok(await field.get('/api/ngo/field-tasks'), 'field tasks')).tasks as any[];
  let task = tasks.find((t) => t.project.id === projectId && t.status === 'OPEN');
  if (!task) {
    // The seeded tasks are on Digital Classrooms and Rural Literacy Kits; if the
    // golden path funded a different Akshar project, the owner assigns one here.
    const fieldUserId = (await ok(await field.get('/api/auth/session'), 'field session')).user?.id;
    await ok(
      await owner.post('/api/ngo/field-tasks', {
        data: { projectId, title: 'Photograph installed equipment (golden path)', assignedToId: fieldUserId },
      }),
      'assign a field task'
    );
    task = ((await ok(await field.get('/api/ngo/field-tasks'), 'field tasks')).tasks as any[]).find(
      (t) => t.project.id === projectId && t.status === 'OPEN'
    );
  }
  expect(task, 'an OPEN field task on the funded project').toBeTruthy();
  const form = {
    clientId: `golden-${Date.now()}`,
    taskId: task.id,
    capturedAt: new Date().toISOString(),
    note: 'Projector installed and running in class 7 (golden path).',
    containsPeople: 'false',
    photo: { name: 'proof.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG },
  };
  const evidence = (await ok(await field.post('/api/field/evidence', { multipart: form as any }), 'field capture')).evidence;
  expect(evidence?.id).toBeTruthy();

  // Before review, the donor cannot see it.
  expect((await donor.get(`/api/field/evidence/${evidence.id}/photo`)).status()).toBe(404);

  // ── 2. Admin approves the evidence ─────────────────────────────────────────
  await ok(await admin.patch(`/api/admin/field-evidence/${evidence.id}`, { data: { decision: 'APPROVE' } }), 'admin approves evidence');

  // ── 3. The funding donor sees it; a donor from another org does not ────────
  expect((await donor.get(`/api/field/evidence/${evidence.id}/photo`)).status()).toBe(200);
  expect((await otherDonor.get(`/api/field/evidence/${evidence.id}/photo`)).status()).toBe(404);

  // ── 4. The NGO files an outcome claim citing the approved photo, and submits ──
  const today = new Date();
  const start = new Date(today.getTime() - 30 * 86_400_000);
  const claim = (
    await ok(
      await owner.post('/api/ngo/outcome-claims', {
        data: {
          projectId,
          metricCode: 'IB-ITEMS-001',
          value: '5',
          periodStart: start.toISOString().slice(0, 10),
          periodEnd: today.toISOString().slice(0, 10),
          method: 'Counted installed projectors from the approved field photos (golden path).',
          citations: [{ kind: 'FIELD_PHOTO', id: evidence.id }],
        },
      }),
      'file outcome claim'
    )
  ).claim;
  await ok(await owner.patch(`/api/ngo/outcome-claims/${claim.id}`, { data: { action: 'SUBMIT' } }), 'submit claim');

  // Before approval the donor report shows it as unverified, never 0.
  let csv = await (await donor.get('/api/donor/impact-report')).text();
  expect(csv).toMatch(/Items distributed,unverified,COUNT_ITEMS/);

  // ── 5. Admin approves; the donor report now shows the verified figure ──────
  await ok(await admin.patch(`/api/admin/outcome-claims/${claim.id}`, { data: { action: 'APPROVE' } }), 'admin approves claim');
  csv = await (await donor.get('/api/donor/impact-report')).text();
  expect(csv).toMatch(/Items distributed,5(\.00)?,COUNT_ITEMS,.*,verified/);
});
