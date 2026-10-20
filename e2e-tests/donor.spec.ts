import { test, expect, type Page } from '@playwright/test';

/**
 * Donor / CSR journeys (roadmap row 13, ">= 8 donor E2E").
 *
 * The previous version visited routes that do not exist (/donor/opportunities,
 * /donor/proposals, /donor/payments ...) and asserted `expect(locator).toBeDefined()`,
 * which is always true — every test passed whatever the app did. Each test here
 * hits a real route and asserts something that fails when the feature breaks.
 *
 * Data: `npm run seed`, then `npm run seed:csr -- --apply` (tools/seed-csr-donor.ts).
 * Password for every seeded account: demoPassword123.
 */

const PASSWORD = 'demoPassword123';
const OWNER = 'csr.acme@demo.com';
const VIEWER = 'viewer.acme@demo.com';
const INDIVIDUAL = 'priya.sharma@demo.com';
const NGO = 'akshar@demo.org';
const SEEDED_TITLE = 'FY 2026-27 — Digital learning in Karnataka government schools';

async function login(page: Page, email: string) {
  await page.goto('/login');
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 });
}

async function seededRequirementId(page: Page): Promise<string> {
  const res = await page.request.get('/api/requirements');
  expect(res.ok()).toBeTruthy();
  const { requirements } = await res.json();
  const req = requirements.find((r: any) => r.fileName === SEEDED_TITLE);
  expect(req, 'seeded requirement — run `npm run seed:csr -- --apply`').toBeTruthy();
  return req.id;
}

test.describe('Donor / CSR portal', () => {
  test('DON-001: CSR owner signs in and the portal navigation lists every donor area', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/donor/requirements');
    const nav = page.getByRole('complementary', { name: 'Donor portal' });
    for (const label of ['Dashboard', 'Impact Report', 'CSR Requirements', 'Contracts & Grants', 'Team', 'Activity', 'Notifications']) {
      await expect(nav.getByRole('link', { name: new RegExp(label) })).toBeVisible();
    }
  });

  test('DON-002: the CSR workspace lists the organisation\'s requirement', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/donor/requirements');
    await expect(page.getByText(SEEDED_TITLE)).toBeVisible();
  });

  test('DON-003: a draft requirement can be withdrawn only with a reason', async ({ page }) => {
    await login(page, OWNER);
    const id = await seededRequirementId(page);
    await page.goto(`/donor/requirements/${id}`);
    await page.getByRole('button', { name: /Withdraw this requirement/ }).click();
    const confirm = page.getByRole('button', { name: 'Withdraw requirement' });
    await expect(confirm).toBeDisabled();
    await page.getByLabel(/Why are you withdrawing it/).fill('short');
    await expect(confirm).toBeDisabled();
    // Not submitted: the seeded draft stays usable for the rest of the UAT.
  });

  test('DON-004: the team page shows the owner, the approver and the viewer, and the owner can add people', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/donor/team');
    await expect(page.getByRole('heading', { name: 'Team', level: 1 })).toBeVisible();
    await expect(page.getByText('approver.acme@demo.com')).toBeVisible();
    await expect(page.getByText('viewer.acme@demo.com')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Add someone' })).toBeVisible();
  });

  test('DON-005: a VIEWER member sees the organisation\'s work read-only', async ({ page }) => {
    await login(page, VIEWER);
    await page.goto('/donor/team');
    await expect(page.getByRole('heading', { name: 'Add someone' })).toHaveCount(0);

    const id = await seededRequirementId(page); // a member lists the org's requirements
    await page.goto(`/donor/requirements/${id}`);
    await expect(page.getByText(/view-only access/)).toBeVisible();
    // The API refuses a write regardless of the UI.
    const res = await page.request.post(`/api/requirements/${id}/withdraw`, { data: { reason: 'Trying as a viewer member.' } });
    expect(res.status()).toBe(403);
  });

  test('DON-006: impact report renders and the CSV export is a CSV with "unverified", never a blank figure', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/donor/impact-report');
    await expect(page.getByRole('heading', { name: 'Impact report', level: 1 })).toBeVisible();
    const csv = await page.request.get('/api/donor/impact-report');
    expect(csv.status()).toBe(200);
    expect(csv.headers()['content-type']).toContain('text/csv');
    const body = await csv.text();
    expect(body.split('\n')[0]).toBe('project,organisation,metric,value,unit,period_start,period_end,status');
    for (const line of body.trim().split('\n').slice(1)) {
      // value is column 4 (after project, organisation, metric); status is last.
      const cols = line.split(',');
      const status = cols[cols.length - 1];
      const value = cols[cols.length - 5];
      expect(['verified', 'unverified']).toContain(status);
      expect(value).not.toBe('');
      if (status === 'unverified') expect(value).toBe('unverified');
    }
  });

  test('DON-007: activity and notifications pages load for the donor', async ({ page }) => {
    await login(page, OWNER);
    await page.goto('/donor/activity');
    await expect(page.getByRole('heading', { name: 'Activity', level: 1 })).toBeVisible();
    await expect(page.getByRole('link', { name: /^All \(/ })).toBeVisible();
    await page.goto('/notifications');
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    await expect(page.getByText(/\d+ unread/)).toBeVisible();
  });

  test('DON-008: tenant isolation — another donor cannot read Acme\'s requirement', async ({ page, browser }) => {
    await login(page, OWNER);
    const id = await seededRequirementId(page);
    // A separate browser context, not clearCookies(): the open page keeps the
    // first session alive client-side and /login would redirect straight away.
    const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const otherPage = await other.newPage();
    await login(otherPage, INDIVIDUAL);
    const res = await otherPage.request.get(`/api/requirements/${id}`);
    expect([403, 404]).toContain(res.status());
    await other.close();
  });

  test('DON-009: a non-donor cannot open the donor portal', async ({ page }) => {
    await login(page, NGO);
    await page.goto('/donor/impact-report');
    await expect(page).not.toHaveURL(/\/donor\/impact-report/);
    const res = await page.request.get('/api/donor/impact-report');
    expect(res.status()).toBe(403);
  });

  test('DON-010: on a phone the donor menu opens and reaches the impact report', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await login(page, OWNER);
    await page.goto('/donor/requirements');
    await page.getByRole('button', { name: 'Open donor menu' }).click();
    await page.getByRole('complementary', { name: 'Donor portal' }).getByRole('link', { name: /Impact Report/ }).click();
    await expect(page).toHaveURL(/\/donor\/impact-report/);
  });
});
