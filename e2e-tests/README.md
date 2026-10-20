# ImpactBridge E2E Test Suite

Comprehensive end-to-end test suite using Playwright covering all major user flows across admin, donor, NGO, and cross-portal scenarios.

## Test Coverage

### Test Files

| File | Tests | Coverage |
|------|-------|----------|
| `admin.spec.ts` | 20 tests (ADM-001 to ADM-020) | Admin portal: verification, donors, dashboards, audit |
| `donor.spec.ts` | 10 tests (DON-001 to DON-010) | Donor portal: navigation, CSR workspace, withdrawal, team roles, impact report + CSV, activity, notifications, tenant isolation, phone menu |
| `ngo.spec.ts` | 25 tests (NGO-001 to NGO-025) | NGO portal: registration, projects, milestones, reporting |
| `cross-portal-e2e.spec.ts` | 8 tests (E2E-001 to E2E-008) | Golden path flows across all portals |
| `security.spec.ts` | 15+ tests (SEC-001+) | Security, validation, access control |

**Total: 85+ test cases**

## Prerequisites

### Test Credentials

Seed the data first (see Environment Setup). Every seeded password is
`demoPassword123`; the admin is `admin@impactbridge.com` / `adminpassword123`.

| Account | Seeded by | Used for |
|---|---|---|
| `csr.acme@demo.com` | `npm run seed:csr -- --apply` | CSR company owner (Acme Industries, verification PENDING) |
| `approver.acme@demo.com` | `npm run seed:csr -- --apply` | Acme team member, APPROVER |
| `viewer.acme@demo.com` | `npm run seed:csr -- --apply` | Acme team member, VIEWER (read-only) |
| `priya.sharma@demo.com` | `npm run seed` | Individual donor (tenant-isolation checks) |
| `akshar@demo.org` | `npm run seed` | NGO owner |

### Environment Setup

1. Apply migrations and seed:
   ```bash
   npx prisma migrate deploy
   npm run seed
   npm run seed:csr -- --apply
   npm run seed:ngo -- --apply
   ```

2. Ensure dev server is running (`npm run dev`), or let Playwright start it.

3. Install Playwright (if not already installed):
   ```bash
   npm install -D @playwright/test
   ```

## Running Tests

### Run All Tests
```bash
npm run e2e
```

### Run Specific Test Suite
```bash
npm run e2e:admin        # Admin tests only
npm run e2e:donor       # Donor tests only
npm run e2e:ngo         # NGO tests only
npm run e2e:e2e         # Cross-portal E2E tests
npm run e2e:security    # Security tests
```

### Run Specific Test File
```bash
npx playwright test e2e-tests/admin.spec.ts
npx playwright test e2e-tests/donor.spec.ts
```

### Run Specific Test
```bash
npx playwright test -g "ADM-001"
npx playwright test -g "admin authentication"
```

### Run with UI Mode (Interactive)
```bash
npx playwright test --ui
```

### Run with Debug Mode
```bash
npx playwright test --debug
```

### Run in Headed Mode (See Browser)
```bash
npx playwright test --headed
```

## Test Reports

After running tests, view the HTML report:

```bash
npm run e2e:report
```

Or directly open:
```bash
npx playwright show-report
```

## Test Structure

Each test file follows this pattern:

1. **Setup**: Authenticate user (admin/donor/NGO)
2. **Navigation**: Go to relevant page/module
3. **Verification**: Check for expected elements/functionality
4. **Assertion**: Validate results

### Example Test

```typescript
test('ADM-001: Admin authentication & RBAC', async () => {
  // Navigate to login
  await page.goto(`${BASE_URL}/login`);

  // Fill login form
  await page.fill('input[type="email"]', ADMIN_EMAIL);
  await page.fill('input[type="password"]', ADMIN_PASSWORD);

  // Submit login
  await page.click('button[type="submit"]');

  // Wait for redirect to admin dashboard
  await page.waitForURL(`${BASE_URL}/admin/**`);

  // Verify admin dashboard accessible
  await expect(page).toHaveURL(/\/admin\//);
  await expect(page.locator('text=Administrator')).toBeVisible();
});
```

## Test Execution Flow

### Admin Tests (ADM-001 to ADM-020)
1. Login as admin
2. Access verification queues (NGO, CSR)
3. View dashboards (overview, metrics, impact)
4. Access all admin modules
5. Verify audit logging
6. Logout

### Donor Tests (DON-001 to DON-018)
1. Login as donor
2. Browse campaigns
3. View campaign details
4. Access donor portal modules:
   - Opportunities
   - Proposals
   - Contracts
   - Dashboard
   - Impact monitoring
   - Feedback
5. Logout

### NGO Tests (NGO-001 to NGO-025)
1. Access NGO registration page
2. Verify form fields
3. Access NGO portal modules:
   - Initiatives
   - Projects
   - Milestones
   - Evidence
   - Beneficiaries
   - Outcomes
   - Reporting

### Cross-Portal E2E (E2E-001 to E2E-008)
1. Admin: Verify both NGO and CSR queues
2. Donor: Create opportunity, browse matches
3. Donor: Submit proposal, track changes
4. Admin: Process funding, allocations
5. NGO: Execute field work, submit evidence
6. Donor: Monitor impact, view updates
7. Feedback collection and re-engagement
8. Full workflow accessibility across all portals

### Security Tests (SEC-001 to SEC-015)
1. Invalid login attempts
2. Session management
3. Unauthorized access attempts
4. CSRF validation
5. Input validation (empty fields, XSS, SQL injection)
6. HTTP method validation
7. Content Security Policy
8. Sensitive data exposure
9. Rate limiting
10. Password requirements
11. HTTPS enforcement
12. Access control
13. Data isolation

## Debugging

### View Test Traces
Playwright saves traces for failed tests:
```bash
npx playwright show-trace trace.zip
```

### Slow Down Test Execution
```bash
npx playwright test --trace-on --slow-mo=1000
```

### Run Single Test with Full Output
```bash
npx playwright test e2e-tests/admin.spec.ts:1 --reporter=verbose
```

## Common Issues

### Tests Timeout
- Increase timeout in playwright.config.ts:
  ```typescript
  use: {
    timeout: 30000,
  }
  ```

### Server Not Running
```bash
# Make sure dev server is running in another terminal
npm run dev
```

### Seed Data Missing
```bash
# Re-seed the database
npm run seed:csr
npm run seed:demo
```

### Port Already in Use
```bash
# Change port in playwright.config.ts
baseURL: 'http://localhost:3001'
# And update .env or start dev server on that port
```

## Test Results

Test results are saved in multiple formats:

- **HTML Report**: `playwright-report/index.html`
- **JSON Report**: `test-results.json`
- **JUnit Report**: `junit-report.xml`
- **Screenshots**: `test-results/` (for failed tests)
- **Videos**: `test-results/` (for failed tests)
- **Traces**: `test-results/` (for failed tests)

## CI/CD Integration

To run tests in CI/CD pipeline:

```yaml
# GitHub Actions example
- name: Run E2E tests
  run: npm run e2e

- name: Upload test results
  if: always()
  uses: actions/upload-artifact@v2
  with:
    name: playwright-report
    path: playwright-report/
    retention-days: 30
```

## Maintenance

### Adding New Tests

1. Create new test file or add to existing
2. Follow naming convention: `TEST_ID: Test description`
3. Use proper selectors (avoid magic numbers, hardcoded IDs)
4. Add proper waits for async operations
5. Include assertions for expected behavior

### Updating Selectors

If UI changes, update selectors in test files:

```typescript
// Old
await page.click('button[type="submit"]');

// New (more specific)
await page.click('button[type="submit"]:has-text("Sign In")');
```

## Performance Baselines

Tests should complete in:
- Admin tests: ~30-40 seconds
- Donor tests: ~20-30 seconds
- NGO tests: ~20-30 seconds
- E2E tests: ~40-50 seconds
- Security tests: ~30-40 seconds

**Total suite: ~3-4 minutes**

## Next Steps

1. Run full test suite: `npm run e2e`
2. Review HTML report: `npm run e2e:report`
3. Fix any failing tests
4. Add to CI/CD pipeline
5. Run regularly before deployments

## Support

For issues or questions:
1. Check Playwright documentation: https://playwright.dev
2. Review test traces in HTML report
3. Run with `--debug` flag for step-by-step execution
4. Check test server logs for backend errors
