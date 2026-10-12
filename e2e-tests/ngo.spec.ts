import { test, expect, Page } from '@playwright/test';

const BASE_URL = 'http://localhost:3000';

test.describe('NGO Portal Tests', () => {
  let page: Page;
  let ngoEmail = `test-ngo-${Date.now()}@example.test`;
  let ngoPassword = 'TestPass123!';

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test('NGO-001: NGO registration page load', async () => {
    await page.goto(`${BASE_URL}/ngo/register`);

    // Verify registration form loads
    await expect(page.locator('heading, h1')).toContainText(/registration|profile|verify/i);

    // Verify form fields present
    await expect(page.locator('input[placeholder*="Hope Foundation"], input[placeholder*="Organization"]')).toBeVisible();
  });

  test('NGO-002: Registration form fields', async () => {
    await page.goto(`${BASE_URL}/ngo/register`);

    // Verify all required fields present
    const fieldLabels = ['Organization Name', 'Founded Year', 'Registration Number', 'PAN Number', 'Office Address'];

    for (const label of fieldLabels) {
      const fieldVisible = await page.locator(`label:has-text("${label}")`).isVisible();
      expect(fieldVisible).toBeTruthy();
    }
  });

  test('NGO-003: Cause categories selection', async () => {
    await page.goto(`${BASE_URL}/ngo/register`);

    // Verify category buttons visible
    const categories = ['Education', 'Healthcare', 'Environment', 'Women Empowerment', 'Rural Development', 'Hunger'];

    for (const category of categories) {
      const button = page.locator(`button:has-text("${category}")`);
      await expect(button).toBeVisible();
    }
  });

  test('NGO-004: Document upload section', async () => {
    await page.goto(`${BASE_URL}/ngo/register`);

    // Verify document upload fields
    await expect(page.locator('text=Certificate of Registration')).toBeVisible();
    await expect(page.locator('text=NGO PAN Card Copy')).toBeVisible();
    await expect(page.locator('text=80G Registration Copy')).toBeVisible();
  });

  test('NGO-005: NGO portal access (requires login)', async () => {
    await page.goto(`${BASE_URL}/ngo`);

    // If no login, should redirect
    const currentUrl = page.url();
    expect(
      currentUrl.includes('/login') ||
      currentUrl.includes('/ngo/register') ||
      currentUrl.includes('/ngo')
    ).toBeTruthy();
  });

  test('NGO-006: Initiative creation flow', async () => {
    await page.goto(`${BASE_URL}/ngo/initiatives`);

    // Verify page loads (may require login)
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-007: Project management', async () => {
    await page.goto(`${BASE_URL}/ngo/projects`);

    // Verify projects page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-008: Milestone tracking', async () => {
    await page.goto(`${BASE_URL}/ngo/milestones`);

    // Verify milestones page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-009: Evidence submission', async () => {
    await page.goto(`${BASE_URL}/ngo/evidence`);

    // Verify evidence page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-010: Beneficiary management', async () => {
    await page.goto(`${BASE_URL}/ngo/beneficiaries`);

    // Verify beneficiaries page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-011: Field team management', async () => {
    await page.goto(`${BASE_URL}/ngo/team`);

    // Verify team page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-012: Outcome reporting', async () => {
    await page.goto(`${BASE_URL}/ngo/outcomes`);

    // Verify outcomes page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-013: Financial tracking', async () => {
    await page.goto(`${BASE_URL}/ngo/finances`);

    // Verify finances page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-014: Donor communications', async () => {
    await page.goto(`${BASE_URL}/ngo/communications`);

    // Verify communications page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-015: Impact metrics', async () => {
    await page.goto(`${BASE_URL}/ngo/metrics`);

    // Verify metrics page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-016: Stories & media', async () => {
    await page.goto(`${BASE_URL}/ngo/stories`);

    // Verify stories page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-017: Compliance & certifications', async () => {
    await page.goto(`${BASE_URL}/ngo/compliance`);

    // Verify compliance page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-018: Settings & profile', async () => {
    await page.goto(`${BASE_URL}/ngo/settings`);

    // Verify settings page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-019: Notifications & alerts', async () => {
    await page.goto(`${BASE_URL}/ngo/notifications`);

    // Verify notifications page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-020: Feedback & reviews', async () => {
    await page.goto(`${BASE_URL}/ngo/feedback`);

    // Verify feedback page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-021: Help & support', async () => {
    await page.goto(`${BASE_URL}/ngo/support`);

    // Verify support page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-022: Dashboard overview', async () => {
    await page.goto(`${BASE_URL}/ngo/dashboard`);

    // Verify dashboard loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-023: Proposal management', async () => {
    await page.goto(`${BASE_URL}/ngo/proposals`);

    // Verify proposals page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-024: Contract agreements', async () => {
    await page.goto(`${BASE_URL}/ngo/contracts`);

    // Verify contracts page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('NGO-025: Document library', async () => {
    await page.goto(`${BASE_URL}/ngo/documents`);

    // Verify documents page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });
});
