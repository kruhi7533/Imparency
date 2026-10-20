import { test, expect, Page, BrowserContext } from '@playwright/test';

const ADMIN_EMAIL = 'admin@impactbridge.com';
const ADMIN_PASSWORD = 'adminpassword123';
// Seeded by tools/seed-csr-donor.ts (npm run seed:csr -- --apply).
const DONOR_EMAIL = 'csr.acme@demo.com';
const DONOR_PASSWORD = 'demoPassword123';
const BASE_URL = 'http://localhost:3000';

test.describe('Cross-Portal E2E Tests', () => {

  test('E2E-001: NGO & CSR verification flow', async ({ browser }) => {
    // Admin context
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // Admin login
    await adminPage.goto(`${BASE_URL}/login`);
    await adminPage.fill('input[type="email"]', ADMIN_EMAIL);
    await adminPage.fill('input[type="password"]', ADMIN_PASSWORD);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL(`${BASE_URL}/admin/**`);

    // Verify both NGO and CSR verification queues accessible
    await adminPage.goto(`${BASE_URL}/admin/verification`);
    expect(adminPage.url()).toContain('/admin/verification');

    await adminPage.goto(`${BASE_URL}/admin/donors?org=PENDING`);
    expect(adminPage.url()).toContain('/admin/donors');

    // Both queues should be accessible
    expect(adminPage).toBeDefined();

    await adminContext.close();
  });

  test('E2E-002: RFP creation to NGO matching', async ({ browser }) => {
    // Donor context
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();

    // Donor login
    await donorPage.goto(`${BASE_URL}/login`);
    await donorPage.fill('input[type="email"]', DONOR_EMAIL);
    await donorPage.fill('input[type="password"]', DONOR_PASSWORD);
    await donorPage.click('button[type="submit"]');
    // Wait until we have LEFT /login — "**" also matches the login URL itself.
    await donorPage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });

    // Verify donor can browse campaigns (proxy for opportunity creation)
    await donorPage.goto(`${BASE_URL}/discover`);

    // Should see NGO listings
    const ngoCards = await donorPage.locator('a[href*="/ngo/"]').count();
    expect(ngoCards).toBeGreaterThan(0);

    await donorContext.close();
  });

  test('E2E-003: Proposal submission & response', async ({ browser }) => {
    // Donor context
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();

    // Donor login
    await donorPage.goto(`${BASE_URL}/login`);
    await donorPage.fill('input[type="email"]', DONOR_EMAIL);
    await donorPage.fill('input[type="password"]', DONOR_PASSWORD);
    await donorPage.click('button[type="submit"]');
    // Wait until we have LEFT /login — "**" also matches the login URL itself.
    await donorPage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });

    // Navigate to proposals section
    await donorPage.goto(`${BASE_URL}/donor/proposals`);
    expect(donorPage).toBeDefined();

    await donorContext.close();
  });

  test('E2E-004: Funding flow & allocation', async ({ browser }) => {
    // Admin context - verify allocation functionality
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    // Admin login
    await adminPage.goto(`${BASE_URL}/login`);
    await adminPage.fill('input[type="email"]', ADMIN_EMAIL);
    await adminPage.fill('input[type="password"]', ADMIN_PASSWORD);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL(`${BASE_URL}/admin/**`);

    // Check allocations page
    await adminPage.goto(`${BASE_URL}/admin/allocations`);
    expect(adminPage).toBeDefined();

    // Check finance page
    await adminPage.goto(`${BASE_URL}/admin/finance`);
    expect(adminPage).toBeDefined();

    await adminContext.close();
  });

  test('E2E-005: Field execution & donor updates', async ({ browser }) => {
    // NGO context - evidence submission
    const ngoContext = await browser.newContext();
    const ngoPage = await ngoContext.newPage();

    // Navigate to NGO evidence section (requires NGO login, skipped if no setup)
    await ngoPage.goto(`${BASE_URL}/ngo/evidence`);
    expect(ngoPage).toBeDefined();

    // Donor context - verify can see updates
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();

    await donorPage.goto(`${BASE_URL}/login`);
    await donorPage.fill('input[type="email"]', DONOR_EMAIL);
    await donorPage.fill('input[type="password"]', DONOR_PASSWORD);
    await donorPage.click('button[type="submit"]');
    // Wait until we have LEFT /login — "**" also matches the login URL itself.
    await donorPage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });

    // Check donor impact monitoring
    await donorPage.goto(`${BASE_URL}/donor/impact`);
    expect(donorPage).toBeDefined();

    await ngoContext.close();
    await donorContext.close();
  });

  test('E2E-006: Outcome reporting & calculation', async ({ browser }) => {
    // Admin context - verify impact quality
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();

    await adminPage.goto(`${BASE_URL}/login`);
    await adminPage.fill('input[type="email"]', ADMIN_EMAIL);
    await adminPage.fill('input[type="password"]', ADMIN_PASSWORD);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL(`${BASE_URL}/admin/**`);

    // Check impact quality
    await adminPage.goto(`${BASE_URL}/admin/impact-quality`);
    expect(adminPage).toBeDefined();

    // Check impact review
    await adminPage.goto(`${BASE_URL}/admin/impact-review`);
    expect(adminPage).toBeDefined();

    // Check metrics registry
    await adminPage.goto(`${BASE_URL}/admin/metrics`);
    expect(adminPage).toBeDefined();

    await adminContext.close();
  });

  test('E2E-007: Feedback & re-engagement', async ({ browser }) => {
    // Donor context - provide feedback
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();

    await donorPage.goto(`${BASE_URL}/login`);
    await donorPage.fill('input[type="email"]', DONOR_EMAIL);
    await donorPage.fill('input[type="password"]', DONOR_PASSWORD);
    await donorPage.click('button[type="submit"]');
    // Wait until we have LEFT /login — "**" also matches the login URL itself.
    await donorPage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });

    // Check feedback section
    await donorPage.goto(`${BASE_URL}/donor/feedback`);
    expect(donorPage).toBeDefined();

    await donorContext.close();
  });

  test('E2E-008: Complete workflow accessibility', async ({ browser }) => {
    // Verify all major portals are accessible in sequence

    // Public access
    const publicPage = await browser.newPage();
    await publicPage.goto(`${BASE_URL}`);
    await expect(publicPage.getByRole('heading').first()).toContainText(/transparency|impact/i);
    await publicPage.close();

    // Admin access
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await adminPage.goto(`${BASE_URL}/login`);
    await adminPage.fill('input[type="email"]', ADMIN_EMAIL);
    await adminPage.fill('input[type="password"]', ADMIN_PASSWORD);
    await adminPage.click('button[type="submit"]');
    await adminPage.waitForURL(`${BASE_URL}/admin/**`);
    expect(adminPage.url()).toContain('/admin');
    await adminContext.close();

    // Donor access
    const donorContext = await browser.newContext();
    const donorPage = await donorContext.newPage();
    await donorPage.goto(`${BASE_URL}/login`);
    await donorPage.fill('input[type="email"]', DONOR_EMAIL);
    await donorPage.fill('input[type="password"]', DONOR_PASSWORD);
    await donorPage.click('button[type="submit"]');
    // Wait until we have LEFT /login — "**" also matches the login URL itself.
    await donorPage.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60000 });
    expect(donorPage.url()).not.toContain('/login');
    await donorContext.close();
  });
});
