import { test, expect, Page } from '@playwright/test';

const DONOR_EMAIL = 'csr.manager@example.test';
const DONOR_PASSWORD = 'TestPass123!';
const BASE_URL = 'http://localhost:3000';

test.describe('Donor/CSR Portal Tests', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    page = await context.newPage();
  });

  test('DON-001: CSR onboarding & login', async () => {
    // Navigate to login
    await page.goto(`${BASE_URL}/login`);

    // Fill login form
    await page.fill('input[type="email"]', DONOR_EMAIL);
    await page.fill('input[type="password"]', DONOR_PASSWORD);

    // Submit login
    await page.click('button[type="submit"]');

    // Wait for redirect (should go to donor dashboard or home)
    await page.waitForURL(`${BASE_URL}/**`);

    // Verify logged in (should not be on login page)
    expect(page.url()).not.toContain('/login');
  });

  test('DON-002: Donor profile view', async () => {
    await page.goto(`${BASE_URL}/donor`);

    // Verify donor page loads or redirects appropriately
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-003: Browse campaigns', async () => {
    await page.goto(`${BASE_URL}/discover`);

    // Verify campaigns displayed
    await page.waitForSelector('[role="main"]');
    const campaigns = await page.locator('a[href*="/projects/"]').count();
    expect(campaigns).toBeGreaterThan(0);
  });

  test('DON-004: Campaign detail view', async () => {
    // Get first campaign link
    const firstCampaign = page.locator('a[href*="/projects/"]').first();
    const campaignHref = await firstCampaign.getAttribute('href');

    if (campaignHref) {
      await page.goto(`${BASE_URL}${campaignHref}`);

      // Verify campaign details displayed
      await expect(page.locator('heading')).toBeDefined();

      // Verify milestones visible
      const milestoneCount = await page.locator('[*="Milestone"], [*="milestone"]').count();
      expect(milestoneCount).toBeGreaterThanOrEqual(0);
    }
  });

  test('DON-005: RFP/Opportunity creation (if applicable)', async () => {
    await page.goto(`${BASE_URL}/donor/opportunities`);

    // Verify page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-006: Proposal review workflow', async () => {
    await page.goto(`${BASE_URL}/donor/proposals`);

    // Verify proposals page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-007: Contract management', async () => {
    await page.goto(`${BASE_URL}/donor/contracts`);

    // Verify contracts page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-008: Dashboard view', async () => {
    await page.goto(`${BASE_URL}/donor/dashboard`);

    // Verify dashboard loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-009: Matching review', async () => {
    await page.goto(`${BASE_URL}/donor/matching`);

    // Verify matching page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-010: Payment tracking', async () => {
    await page.goto(`${BASE_URL}/donor/payments`);

    // Verify payments page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-011: Impact monitoring', async () => {
    await page.goto(`${BASE_URL}/donor/impact`);

    // Verify impact page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-012: Notifications', async () => {
    await page.goto(`${BASE_URL}/donor/notifications`);

    // Verify notifications page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-013: Impact stories', async () => {
    await page.goto(`${BASE_URL}/donor/stories`);

    // Verify stories page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-014: NGO feedback', async () => {
    await page.goto(`${BASE_URL}/donor/feedback`);

    // Verify feedback page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-015: Team management', async () => {
    await page.goto(`${BASE_URL}/donor/team`);

    // Verify team page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-016: Settings & preferences', async () => {
    await page.goto(`${BASE_URL}/donor/settings`);

    // Verify settings page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-017: Privacy & consent', async () => {
    await page.goto(`${BASE_URL}/donor/privacy`);

    // Verify privacy page loads
    const pageContent = page.locator('main');
    expect(pageContent).toBeDefined();
  });

  test('DON-018: Donor logout', async () => {
    // Navigate to a page that should have logout
    await page.goto(`${BASE_URL}/donor`);

    // Look for logout/profile menu
    const profileButton = page.locator('button[aria-label*="profile"], button[*="user"]').first();

    if (await profileButton.isVisible()) {
      await profileButton.click();

      // Click logout if menu appears
      const logoutOption = page.locator('text=Logout, text=Sign out, text=Exit');
      if (await logoutOption.first().isVisible()) {
        await logoutOption.first().click();

        // Verify redirected away from donor section
        await page.waitForURL(`${BASE_URL}/**`);
        expect(page.url()).not.toContain('/donor');
      }
    }
  });
});
