import { test, expect, type Browser, type BrowserContext, type Page, type APIRequestContext, type APIResponse } from '@playwright/test';
import { makeTextPdf } from '../tests/helpers/make-pdf';
import { deflateSync } from 'node:zlib';

/**
 * Acceptance pack v2 (25 Oct 2026) — the NGO (NGO-001..020), Donor/CSR
 * (DON-001..018) and Cross-portal (E2E-001..008) cases, one test per case ID.
 * ADM / NEG / AI cases live in a separate file.
 *
 * The tester's rule: a case passes only when the VISIBLE expected result works in
 * the UI with persisted data. So every test drives the user-visible steps through
 * the browser and asserts on what the user sees. `page.request` (the same signed-in
 * session) is used only to set up the state a case starts from — e.g. a contract
 * that already exists — and to confirm persistence after the UI step.
 *
 * Re-runnable: everything a test creates carries a per-run suffix.
 *
 * Each browser context gets its own `x-forwarded-for`, i.e. it is a distinct
 * client as far as the per-IP limiter on signup / contract writes is concerned —
 * otherwise a second run inside the same hour would hit the signup limit
 * (5/hour/IP), which is the limiter working, not a defect.
 */

const PASSWORD = 'demoPassword123';
const NEW_PASSWORD = 'Pilot-Acceptance-2026!';
const ADMIN = { email: 'admin@impactbridge.com', password: 'adminpassword123' };
const RUN = Date.now();
let seq = 0;
const uniq = (p: string) => `${p}${RUN.toString(36)}${(seq++).toString(36)}`;
const BASE = 'http://localhost:3000';

type Actor = { ctx: BrowserContext; page: Page; api: APIRequestContext };

function fakeIp() {
  return `10.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
}

async function newActor(browser: Browser): Promise<Actor> {
  const ctx = await browser.newContext({ baseURL: BASE, extraHTTPHeaders: { 'x-forwarded-for': fakeIp() } });
  ctx.setDefaultTimeout(30_000);
  // The dev server compiles pages on first hit; give navigations room.
  ctx.setDefaultNavigationTimeout(120_000);
  const page = await ctx.newPage();
  // Confirmation dialogs ("Approve proposal V2?", "Confirm this money has arrived?") are answered yes.
  page.on('dialog', (d) => d.accept().catch(() => {}));
  return { ctx, page, api: retrying(page.request) };
}

/**
 * The dev server answers a route it is still (re)compiling with its HTML 404
 * page. That is not the API's answer, so such a response is retried; a JSON
 * 404 from the route itself is returned as-is.
 */
function retrying(api: APIRequestContext): APIRequestContext {
  return new Proxy(api, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== 'function' || !['get', 'post', 'put', 'patch', 'delete', 'fetch'].includes(String(prop))) return v.bind ? v.bind(target) : v;
      return async (...args: any[]) => {
        for (let i = 0; ; i++) {
          const res: APIResponse = await v.apply(target, args);
          const html = (res.headers()['content-type'] ?? '').includes('text/html');
          if (!(html && res.status() === 404 && String(args[0]).startsWith('/api/')) || i >= 4) return res;
          await new Promise((r) => setTimeout(r, 3_000));
        }
      };
    },
  });
}

const sessions = new Map<string, Actor>();

/** Signs in through the real login form; sessions are reused across tests. */
async function as(browser: Browser, email: string, password = PASSWORD): Promise<Actor> {
  const cached = sessions.get(email);
  if (cached) {
    try {
      if (!cached.page.isClosed()) return cached;
    } catch {}
  }
  const a = await newActor(browser);
  // Retried once: a dev server recompiling mid-login can bounce the first attempt.
  for (let attempt = 1; ; attempt++) {
    try {
      await a.page.goto('/login');
      await a.page.locator('input[type="email"]').waitFor({ timeout: 120_000 });
      await a.page.fill('input[type="email"]', email);
      await a.page.fill('input[type="password"]', password);
      await a.page.locator('form button[type="submit"]').first().click();
      await a.page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 90_000 });
      break;
    } catch (e) {
      if (attempt >= 2) throw e;
    }
  }
  sessions.set(email, a);
  return a;
}

async function ok(res: APIResponse, what: string) {
  const body = await res.text();
  expect(res.ok(), `${what} → ${res.status()} ${body.slice(0, 400)}`).toBeTruthy();
  return body ? JSON.parse(body) : {};
}

/** Registers a brand-new account through /login → Register Account. */
async function signUp(browser: Browser, role: 'NGO' | 'DONOR', name: string, email: string): Promise<Actor> {
  const a = await newActor(browser);
  await a.page.goto('/login');
  await a.page.locator('input[type="email"]').waitFor({ timeout: 120_000 });
  await a.page.getByRole('button', { name: 'Register Account' }).first().click();
  await a.page.fill('input[placeholder="e.g. John Doe"]', name);
  await a.page.fill('input[type="email"]', email);
  await a.page.fill('input[type="password"]', NEW_PASSWORD);
  await a.page.locator('select').first().selectOption(role);
  await a.page.locator('#consentCheckbox').check();
  await a.page.locator('form button[type="submit"]').first().click();
  await a.page.waitForURL(role === 'NGO' ? /\/ngo\/register/ : /\/donor\/onboarding|\/discover/, { timeout: 90_000 });
  sessions.set(email, a);
  return a;
}

function randomPan(fourth = 'T') {
  const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const r = (n: number) => Array.from({ length: n }, () => L[Math.floor(Math.random() * L.length)]).join('');
  return `${r(3)}${fourth}${r(1)}${String(Math.floor(1000 + Math.random() * 8999))}${r(1)}`;
}

function ngoDocs(orgName: string, regNo: string, pan: string, regNameOverride?: string) {
  return {
    reg: makeTextPdf([
      'SYNTHETIC TEST DOCUMENT',
      'Certificate of Registration',
      'Registered under the Indian Trusts Act, 1882',
      `Name of the Trust: ${regNameOverride ?? orgName}`,
      `Registration No: ${regNo}`,
      'Date of registration: 12 March 2014',
    ]),
    pan: makeTextPdf(['SYNTHETIC TEST DOCUMENT', 'Income Tax Department', 'Permanent Account Number Card', `PAN: ${pan}`, `Name: ${orgName}`]),
    tax: makeTextPdf(['SYNTHETIC TEST DOCUMENT', 'Order under section 80G of the Income-tax Act', `Name of the Trust: ${orgName}`, `PAN: ${pan}`, `Unique Registration Number: ${pan}F20261`]),
  };
}

const pdfFile = (name: string, buffer: Buffer) => ({ name, mimeType: 'application/pdf', buffer });

/** Fills the /ngo/register form's text fields. */
async function fillNgoForm(page: Page, f: { orgName: string; regNo: string; pan: string }) {
  await page.fill('input[placeholder="e.g. Hope Foundation"]', f.orgName);
  await page.fill('input[placeholder="e.g. 2012"]', '2014');
  await page.fill('input[placeholder="e.g. U85100MH2021NPL12345"]', f.regNo);
  await page.fill('input[placeholder="e.g. AAATH1234F"]', f.pan);
  await page.fill('textarea[placeholder^="e.g. 101"], input[placeholder^="e.g. 101"]', 'Plot 14, Collectorate Road, Mahabubnagar, Telangana 509001');
  const edu = page.getByRole('button', { name: 'Education', exact: true });
  // A selected cause shows a check icon.
  if ((await edu.locator('svg').count()) === 0) await edu.click();
  await page.fill('textarea[placeholder^="Describe your organization"]', 'Rural education trust running digital-learning centres in government schools of Mahabubnagar district.');
}

async function setNgoFiles(page: Page, docs: { reg?: Buffer; pan?: Buffer; tax?: Buffer }) {
  const inputs = page.locator('input[type="file"]');
  if (docs.reg) await inputs.nth(0).setInputFiles(pdfFile('registration.pdf', docs.reg));
  if (docs.pan) await inputs.nth(1).setInputFiles(pdfFile('pan.pdf', docs.pan));
  if (docs.tax) await inputs.nth(2).setInputFiles(pdfFile('80g.pdf', docs.tax));
}

async function submitNgoForm(page: Page) {
  const consent = page.locator('form input[type="checkbox"]').last();
  if (!(await consent.isChecked())) await consent.check();
  await page.getByRole('button', { name: 'Submit Registration Documents' }).click();
  await page.waitForURL(/\/ngo\/dashboard/, { timeout: 90_000 });
}

/** Polls the admin Approvals queue until the org's row shows the expected verdict. */
async function waitForQueueVerdict(admin: Page, orgName: string, verdict: RegExp, timeout = 180_000) {
  await expect
    .poll(
      async () => {
        await admin.goto('/admin/verification');
        const row = admin.locator('tr', { hasText: orgName }).first();
        return (await row.count()) ? await row.innerText() : '';
      },
      { timeout, intervals: [3_000, 5_000] }
    )
    .toMatch(verdict);
  return admin.locator('tr', { hasText: orgName }).first();
}

async function adminApproveNgo(admin: Page, orgName: string) {
  const row = await waitForQueueVerdict(admin, orgName, /DOCUMENTS CLEAN/);
  await row.getByRole('button', { name: 'Approve', exact: true }).click();
  await admin.fill('textarea[placeholder="Add verification notes..."]', 'Registration certificate, PAN and 80G match the form (acceptance v2).');
  await admin.getByRole('button', { name: 'Confirm Approval' }).click();
  await expect(admin.locator('tr', { hasText: orgName })).toHaveCount(0, { timeout: 30_000 });
}

/** The verified NGO dashboard: the review stepper is gone and "Next actions" is shown. */
async function expectVerifiedDashboard(page: Page) {
  await page.goto('/ngo/dashboard');
  await expect(page.locator('[aria-labelledby="next-actions"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Application Under Review')).toHaveCount(0);
}

/** A fresh NGO, registered and verified entirely through the UI. */
async function onboardVerifiedNgo(browser: Browser, label: string) {
  const email = `${uniq(label)}@example.test`.toLowerCase();
  const orgName = `${label} Trust ${uniq('')}`;
  const regNo = `TEST-TRUST-TG-${uniq('')}`.toUpperCase();
  const pan = randomPan();
  const ngo = await signUp(browser, 'NGO', `${label} Director`, email);
  await fillNgoForm(ngo.page, { orgName, regNo, pan });
  const d = ngoDocs(orgName, regNo, pan);
  await setNgoFiles(ngo.page, d);
  await submitNgoForm(ngo.page);
  const admin = await as(browser, ADMIN.email, ADMIN.password);
  await adminApproveNgo(admin.page, orgName);
  return { ngo, email, orgName, regNo, pan };
}


// ─── CSR requirement → match → proposal → contract pipeline (API set-up) ────
const CSR_OWNER = 'csr.acme@demo.com';
const CSR_APPROVER = 'approver.acme@demo.com';
const NGO_OWNER = 'akshar@demo.org';
const NGO_FINANCE = 'finance.akshar@demo.org';
const NGO_FIELD = 'field.akshar@demo.org';

const REQ_FIELDS = (extra: Record<string, unknown> = {}) => ({
  summary: 'Digital classrooms and teacher training in government schools.',
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
  ...extra,
});

const PROPOSAL = {
  proposedBudget: 300000,
  proposedDurationMonths: 12,
  implementationPlan: 'Install projectors in 5 schools, train teachers, assess learning each term.',
  expectedOutcomes: '1,200 students using digital lessons weekly.',
  milestones: [
    { title: 'Equipment installed', amount: 150000, durationMonths: 3 },
    { title: 'Teachers trained and first assessment', amount: 150000, durationMonths: 9 },
  ],
};

type Pipe = {
  reqId: string;
  title: string;
  matchId?: string;
  projectId?: string;
  responseId?: string;
  contractId?: string;
  milestones?: { id: string; title: string }[];
};

const STAGES = ['created', 'submitted', 'validated', 'matched', 'shortlisted', 'invited', 'v1', 'changes', 'v2', 'selected', 'contract', 'active', 'accepted'] as const;
type Stage = (typeof STAGES)[number];
const reached = (s: Stage, target: Stage) => STAGES.indexOf(s) <= STAGES.indexOf(target);

/** Drives the requirement pipeline through the API up to (and including) `upTo`. */
/**
 * Each pipeline is a separate CSR deal. The contract-write routes are limited per
 * client IP (pinned by tests/contract-rate-limits.test.ts); the suite creates ~25
 * contracts per run, so each pipeline presents as a fresh client rather than one
 * office hammering the API — the limiter itself is untouched.
 */
async function freshClient(...emails: [string, string?][]) {
  for (const [e] of emails) {
    const a = sessions.get(e);
    if (a) await a.ctx.setExtraHTTPHeaders({ 'x-forwarded-for': fakeIp() });
  }
}

async function pipeline(browser: Browser, upTo: Stage, opts: { fields?: Record<string, unknown>; title?: string } = {}): Promise<Pipe> {
  const owner = (await as(browser, CSR_OWNER)).api;
  const approver = (await as(browser, CSR_APPROVER)).api;
  const admin = (await as(browser, ADMIN.email, ADMIN.password)).api;
  const ngo = (await as(browser, NGO_OWNER)).api;
  await freshClient([CSR_OWNER], [CSR_APPROVER], [NGO_OWNER], [NGO_FINANCE]);
  const title = opts.title ?? `Acceptance ${uniq('req')}`;
  const req = (await ok(await owner.post('/api/requirements', { data: { title, fields: REQ_FIELDS(opts.fields) } }), 'create requirement')).requirement;
  const p: Pipe = { reqId: req.id, title };
  if (!reached('submitted', upTo)) return p;
  await ok(await owner.post(`/api/requirements/${p.reqId}/submit-review`), 'submit for review');
  if (!reached('validated', upTo)) return p;
  await ok(await admin.post(`/api/requirements/${p.reqId}/admin-approve`, { data: { note: 'Sector, budget and KPIs are clear (acceptance).' } }), 'admin validates');
  if (!reached('matched', upTo)) return p;
  await ok(await approver.post(`/api/requirements/${p.reqId}/matches`), 'run matching');
  if (!reached('shortlisted', upTo)) return p;
  await adminApproveShortlist(admin, p.reqId);
  const run = (await ok(await approver.get(`/api/requirements/${p.reqId}/matches`), 'read matches')).run;
  // Prefer the seeded project (stable field-work/story data); any Akshar match otherwise.
  const aksharMatches = (run?.matches ?? []).filter((m: any) => m.eligible && /Akshar/.test(m.ngoName));
  const akshar = aksharMatches.find((m: any) => m.projectTitle === 'Digital Classrooms Initiative') ?? aksharMatches[0];
  expect(akshar, `Akshar in the shortlist (got ${(run?.matches ?? []).map((m: any) => m.ngoName).join(', ')})`).toBeTruthy();
  p.matchId = akshar.id;
  p.projectId = akshar.projectId;
  if (!reached('invited', upTo)) return p;
  await ok(await approver.post(`/api/requirements/${p.reqId}/matches/${p.matchId}/invite`), 'invite Akshar');
  if (!reached('v1', upTo)) return p;
  await ok(await ngo.post(`/api/opportunities/${p.reqId}/interest`, { data: { ...PROPOSAL, projectId: p.projectId } }), 'proposal v1');
  const responses = (await ok(await owner.get(`/api/requirements/${p.reqId}/responses`), 'responses')).responses as any[];
  p.responseId = (responses.find((r) => /Akshar/.test(r.ngo?.orgName ?? '')) ?? responses[0]).id;
  if (!reached('changes', upTo)) return p;
  await ok(
    await owner.post(`/api/requirements/${p.reqId}/responses/${p.responseId}/request-changes`, { data: { note: 'Please add an attendance KPI and quarterly reports.' } }),
    'request changes'
  );
  if (!reached('v2', upTo)) return p;
  await ok(
    await ngo.post(`/api/opportunities/${p.reqId}/interest`, {
      data: { ...PROPOSAL, projectId: p.projectId, expectedOutcomes: '1,200 students weekly; attendance tracked; quarterly reports.' },
    }),
    'proposal v2'
  );
  if (!reached('selected', upTo)) return p;
  await ok(await approver.post(`/api/requirements/${p.reqId}/select`, { data: { responseId: p.responseId } }), 'approve proposal');
  if (!reached('contract', upTo)) return p;
  const contract = (
    await ok(
      await owner.post('/api/contracts', {
        data: {
          projectId: p.projectId,
          requirementId: p.reqId,
          title: `${title} grant`,
          totalGrantAmount: '300000',
          termsAndConditions: 'Funds are released per milestone against approved evidence. Aggregate, consented impact data may be shared with the funder.',
          milestones: [
            { title: 'Equipment installed', allocatedAmount: '150000' },
            { title: 'Teachers trained and first assessment', allocatedAmount: '150000' },
          ],
        },
      }),
      'draft contract'
    )
  ).contract;
  p.contractId = contract.id;
  await ok(await owner.post(`/api/contracts/${p.contractId}/propose`), 'propose contract');
  if (!reached('active', upTo)) return p;
  await ok(await approver.post(`/api/contracts/${p.contractId}/sign`, { data: { signerName: 'Arjun Nair', signerTitle: 'CSR Approver' } }), 'donor signs');
  await ok(await ngo.post(`/api/contracts/${p.contractId}/sign`, { data: { signerName: 'Akshar Director', signerTitle: 'Director' } }), 'NGO signs');
  if (!reached('accepted', upTo)) return p;
  await ok(await ngo.post(`/api/contracts/${p.contractId}/accept`), 'NGO accepts');
  const c = await ok(await owner.get(`/api/contracts/${p.contractId}`), 'read contract');
  p.milestones = ((c.contract ?? c).milestones ?? []).map((m: any) => ({ id: m.id, title: m.title }));
  return p;
}

async function adminApproveShortlist(admin: APIRequestContext, reqId: string) {
  const run = (await ok(await admin.get(`/api/requirements/${reqId}/matches`), 'admin reads matches')).run;
  const order = (run?.matches ?? []).filter((m: any) => m.eligible).map((m: any) => m.id);
  await ok(await admin.put(`/api/requirements/${reqId}/shortlist`, { data: { gapReportId: run.id, order, note: 'Shortlist checked (acceptance).' } }), 'admin approves shortlist');
}

/** Records a payment as the CSR approver (API set-up), returns the payment. */
async function recordPayment(browser: Browser, contractId: string, amount: string, extra: Record<string, unknown> = {}) {
  const approver = (await as(browser, CSR_APPROVER)).api;
  return (
    await ok(
      await approver.post(`/api/contracts/${contractId}/payments`, { data: { idempotencyKey: uniq('pay'), amount, mode: 'SANDBOX', ...extra } }),
      'record payment'
    )
  ).payment;
}

async function confirmPayment(browser: Browser, contractId: string, paymentId: string) {
  const finance = (await as(browser, NGO_FINANCE)).api;
  await ok(await finance.patch(`/api/contracts/${contractId}/payments/${paymentId}`, { data: { decision: 'CONFIRM' } }), 'NGO confirms payment');
}

/** A fully funded, accepted contract (both milestones reconciled). */
async function fundedContract(browser: Browser) {
  const p = await pipeline(browser, 'accepted');
  const pay = await recordPayment(browser, p.contractId!, '300000');
  await confirmPayment(browser, p.contractId!, pay.id);
  return p;
}

/** Fill the e-sign modal on a contract page. */
async function eSign(page: Page, name: string, title: string) {
  await page.getByRole('button', { name: 'Sign Agreement (E-Sign)' }).click();
  const modal = page.locator('form', { hasText: 'Execute Grant Agreement' });
  await modal.locator('input').nth(0).fill(name);
  await modal.locator('input').nth(1).fill(title);
  await modal.getByRole('button', { name: 'Confirm Electronic Signature' }).click();
}

test.describe.configure({ mode: 'default' });

// ═══════════════════════════════════════════════════════════════════════════
// NGO
// ═══════════════════════════════════════════════════════════════════════════
test.describe('NGO', () => {
  test('NGO-001 registration can be saved as a draft and resumed later', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const email = `${uniq('ngo001')}@example.test`;
    const orgName = `Draft Resume Trust ${uniq('')}`;
    const regNo = `TEST-TRUST-TG-${uniq('')}`.toUpperCase();
    const pan = randomPan();
    const ngo = await signUp(browser, 'NGO', 'Draft Tester', email);
    const { page } = ngo;

    // Part-fill the form, attach one document, save the draft.
    await page.fill('input[placeholder="e.g. Hope Foundation"]', orgName);
    await page.fill('input[placeholder="e.g. U85100MH2021NPL12345"]', regNo);
    const d = ngoDocs(orgName, regNo, pan);
    await setNgoFiles(page, { reg: d.reg });
    await page.getByRole('button', { name: 'Save draft and finish later' }).click();
    await expect(page.getByText(/Draft saved\. You can leave and resume later/)).toBeVisible();

    // Leave and come back: the draft is resumed with the field values and the stored document.
    await page.goto('/ngo/register');
    await expect(page.getByText(/Resumed your draft saved/)).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('input[placeholder="e.g. Hope Foundation"]')).toHaveValue(orgName);
    await expect(page.locator('input[placeholder="e.g. U85100MH2021NPL12345"]')).toHaveValue(regNo);
    await expect(page.getByText(/Documents on your draft: registration\.pdf/)).toBeVisible();

    // Nothing was submitted for review yet.
    const draft = await ok(await ngo.api.get('/api/ngo/register/draft'), 'read draft');
    expect(draft.draft?.status ?? 'DRAFT').not.toBe('SUBMITTED');

    // Finish it: the saved registration certificate is reused, only PAN + 80G are attached now.
    await fillNgoForm(page, { orgName, regNo, pan });
    await setNgoFiles(page, { pan: d.pan, tax: d.tax });
    await submitNgoForm(page);
    await expect(page.getByText('Application Under Review')).toBeVisible({ timeout: 30_000 });
  });

  test('NGO-002 documents submitted → extraction runs → profile pending → verified', async ({ browser }) => {
    test.setTimeout(6 * 60_000);
    const email = `${uniq('ngo002')}@example.test`;
    const orgName = `Verification Path Trust ${uniq('')}`;
    const regNo = `TEST-TRUST-TG-${uniq('')}`.toUpperCase();
    const pan = randomPan();
    const ngo = await signUp(browser, 'NGO', 'Verification Tester', email);
    await fillNgoForm(ngo.page, { orgName, regNo, pan });
    await setNgoFiles(ngo.page, ngoDocs(orgName, regNo, pan));
    await submitNgoForm(ngo.page);
    await expect(ngo.page.getByText('Application Under Review')).toBeVisible({ timeout: 30_000 });

    // Admin: extraction has run on the documents and the queue says they are clean.
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await adminApproveNgo(admin.page, orgName);

    // NGO: pending → verified.
    await ngo.page.goto('/ngo/dashboard');
    await expectVerifiedDashboard(ngo.page);
  });
});

/** The innermost element that contains every given text and (optionally) a control. */
function cardWith(page: Page, texts: (string | RegExp)[], control?: ReturnType<Page['getByRole']>) {
  let loc = page.locator('div, li, tr, section, article');
  for (const t of texts) loc = loc.filter({ hasText: t });
  if (control) loc = loc.filter({ has: control });
  return loc.last();
}

const RFP_LINES = (title: string) => [
  'CSR REQUIREMENT DOCUMENT (SYNTHETIC TEST)',
  `Requirement Title: ${title}`,
  'Executive Summary: Fund digital classrooms and teacher training in government schools.',
  'CSR Sector: Education',
  'Target State: Karnataka',
  'Target District: Mysuru',
  'Minimum Budget: INR 250000',
  'Maximum Budget: INR 400000',
  'Duration: 12 months',
  'Expected Beneficiaries: 1000',
  'Primary KPIs: Students using digital lessons weekly',
  'Reporting Cadence: Quarterly',
  'FCRA registration required: No',
  'Contact Person: Meera Iyer',
  'Contact Email: csr.acme@demo.com',
];

/** Upload an RFP PDF on /donor/requirements and land on its detail page. */
async function uploadRfp(page: Page, lines: string[]) {
  await page.goto('/donor/requirements');
  await page.locator('input[type="file"]').setInputFiles(pdfFile(`rfp-${uniq('')}.pdf`, makeTextPdf(lines)));
  await page.waitForURL(/\/donor\/requirements\/[0-9a-f-]{36}/, { timeout: 120_000 });
  const id = page.url().match(/requirements\/([0-9a-f-]{36})/)![1];
  await expect(page.getByText(/Extracted with (AI \(Claude\)|AI \(Gemini\)|rule-based extraction)/)).toBeVisible({ timeout: 120_000 });
  return id;
}

// ═══════════════════════════════════════════════════════════════════════════
// DONOR / CSR
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Donor / CSR', () => {
  test('DON-003 manual (form) opportunity is created, validated and enters matching', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const owner = await as(browser, CSR_OWNER);
    const { page } = owner;
    const title = `Form requirement ${uniq('')}`;
    await page.goto('/donor/requirements');
    await page.fill('#rf-title', title);
    await page.fill('#rf-summary', 'Digital classrooms and teacher training in government schools of Karnataka.');
    await page.fill('#rf-sector', 'Education');
    await page.fill('#rf-state', 'Karnataka');
    await page.fill('#rf-budgetMin', '250000');
    await page.fill('#rf-budgetMax', '400000');
    await page.fill('#rf-durationMonths', '12');
    await page.fill('#rf-expectedBeneficiaries', '1000');
    await page.fill('#rf-primaryKPIs', 'Students using digital lessons weekly');
    await page.locator('#rf-fcraRequired').selectOption('false');
    await page.getByRole('button', { name: 'Create requirement' }).click();
    await page.waitForURL(/\/donor\/requirements\/[0-9a-f-]{36}/);
    const reqId = page.url().match(/requirements\/([0-9a-f-]{36})/)![1];
    await expect(page.getByText(/Check the details you entered/)).toBeVisible();
    await page.getByRole('button', { name: 'Submit for Admin Verification' }).click();
    await expect(page.getByText(/Awaiting admin verification/)).toBeVisible({ timeout: 30_000 });

    // Admin validates it in the admin console.
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto(`/admin/requirements/${reqId}`);
    await admin.page.getByRole('button', { name: 'Approve Requirement' }).click();
    await admin.page.getByPlaceholder('Optional note for the record').fill('Sector, geography, budget and KPIs are complete (acceptance DON-003).');
    await admin.page.getByRole('button', { name: 'Confirm approval' }).click();
    await expect(admin.page.getByText('Requirement validated. It can now enter matching.')).toBeVisible({ timeout: 30_000 });

    // Donor: validated → Find Matches → the requirement is in matching (ranked shortlist awaiting admin approval).
    await page.goto(`/donor/requirements/${reqId}`);
    await expect(page.getByText(/Validated by an admin/)).toBeVisible();
    await page.getByRole('button', { name: 'Find Matches' }).click();
    await expect(page.getByText(/ranked shortlist is ready and is awaiting admin approval/)).toBeVisible({ timeout: 60_000 });
    const r = await ok(await owner.api.get(`/api/requirements/${reqId}`), 'read requirement');
    expect((r.requirement ?? r).status).toBe('SHORTLISTED');
  });

  test('DON-004 RFP PDF upload → extraction with confidence → donor correction persists', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const owner = await as(browser, CSR_OWNER);
    const { page } = owner;
    const title = `RFP upload ${uniq('')}`;
    const reqId = await uploadRfp(page, RFP_LINES(title));
    // Every extracted field shows its confidence.
    await expect(page.getByText(/· \d{1,3}%/).first()).toBeVisible();
    await expect(page.locator('#field-sector')).toHaveValue(/Education/i);
    // Correct a field and save.
    await page.locator('#field-district').fill('Mandya');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Donor corrected').first()).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(page.locator('#field-district')).toHaveValue('Mandya');
    const r = await ok(await owner.api.get(`/api/requirements/${reqId}`), 'read requirement');
    const fields = (r.requirement ?? r).fields;
    expect(JSON.stringify(fields)).toContain('Mandya');
  });

  test('DON-005 ranked shortlist with per-dimension explanations; FCRA-required variant excludes non-FCRA NGOs', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'shortlisted');
    const { page } = await as(browser, CSR_APPROVER);
    await page.goto(`/donor/requirements/${p.reqId}?tab=matches`);
    await expect(page.getByText(/An admin has approved your shortlist/)).toBeVisible();
    await expect(page.getByText(/Admin-approved #1/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Why this score?' }).first().click();
    await expect(page.getByRole('columnheader', { name: 'Dimension' }).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /Sector/i }).first()).toBeVisible();

    // FCRA variant: the hard rule removes NGOs without an active FCRA registration, with the reason shown.
    const f = await pipeline(browser, 'matched', { fields: { fcraRequired: true } });
    await page.goto(`/donor/requirements/${f.reqId}?tab=matches`);
    await page.getByRole('button', { name: /excluded — see why/ }).click();
    await expect(page.getByText(/FCRA/).first()).toBeVisible();
  });

  test('DON-006 donor invites an approved candidate; the NGO is notified and sees the invitation', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'shortlisted');
    const { page } = await as(browser, CSR_APPROVER);
    await page.goto(`/donor/requirements/${p.reqId}?tab=matches`);
    const invite = page.getByRole('button', { name: 'Invite to respond' });
    const card = cardWith(page, [/Akshar/], invite);
    const since = Date.now() - 5_000;
    await card.getByRole('button', { name: 'Invite to respond' }).click();
    await expect(page.getByText(/✓ Brief shared/).first()).toBeVisible({ timeout: 30_000 });

    const ngo = await as(browser, NGO_OWNER);
    const notes = (await ok(await ngo.api.get('/api/user/notifications?limit=50'), 'NGO notifications')).notifications as any[];
    const fresh = notes.filter((n) => new Date(n.createdAt).getTime() >= since);
    expect(fresh.length, `NGO notified of the invitation (latest: ${JSON.stringify(notes[0] ?? {}).slice(0, 200)})`).toBeGreaterThan(0);
    await ngo.page.goto('/ngo/match-inbox');
    await expect(ngo.page.locator('li').filter({ has: ngo.page.locator(`a[href^="/ngo/opportunities/${p.reqId}"]`) })).toContainText('Invited — respond with a proposal');
  });

  test('DON-007 donor requests a change on v1; the NGO revises to v2', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'v1');
    const { page } = await as(browser, CSR_OWNER);
    await page.goto(`/donor/requirements/${p.reqId}?tab=responses`);
    await page.getByRole('button', { name: /NGO responses/ }).click();
    await page.getByRole('button', { name: 'Request changes' }).first().click();
    await page.locator('textarea[id^="change-note-"]').fill('Please add an attendance KPI and quarterly progress reports.');
    await page.getByRole('button', { name: 'Send change request' }).click();
    await expect(page.getByText(/back with the organisation for changes/)).toBeVisible({ timeout: 30_000 });

    // The NGO sees the note word for word and revises.
    const ngo = await as(browser, NGO_OWNER);
    await ngo.page.goto(`/ngo/opportunities/${p.reqId}`);
    await expect(ngo.page.getByText('Please add an attendance KPI and quarterly progress reports.')).toBeVisible();
    await ok(
      await ngo.api.post(`/api/opportunities/${p.reqId}/interest`, { data: { ...PROPOSAL, projectId: p.projectId, expectedOutcomes: 'Attendance tracked; quarterly reports.' } }),
      'NGO v2'
    );
    await page.reload();
    await page.getByRole('button', { name: /NGO responses/ }).click();
    await expect(page.getByRole('button', { name: 'Approve proposal V2' })).toBeVisible();
  });

  test('DON-008 v1 vs v2 side-by-side diff, then v2 approved with version history', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'v2');
    const { page } = await as(browser, CSR_APPROVER);
    await page.goto(`/donor/requirements/${p.reqId}?tab=responses`);
    await page.getByRole('button', { name: /NGO responses/ }).click();
    await page.getByRole('button', { name: /Compare versions side by side/ }).first().click();
    await expect(page.getByText(/\d+ of \d+ fields changed/).first()).toBeVisible();
    await expect(page.getByRole('cell', { name: /attendance tracked/ }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Approve proposal V2' }).click();
    await expect(page.getByText('Proposal Approved — Ready for Contracting', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/You approved proposal V2/)).toBeVisible();
  });

  test('DON-009 contract proposed, e-signed by both sides and accepted by the NGO → ACTIVE', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'contract');
    const donor = await as(browser, CSR_APPROVER);
    await donor.page.goto(`/donor/contracts/${p.contractId}`);
    await expect(donor.page.getByText(/Aggregate, consented impact data may be shared with the funder/)).toBeVisible();
    await eSign(donor.page, 'Arjun Nair', 'CSR Approver');
    await expect(donor.page.getByText(/Signature pending from NGO Authorized Signatory/)).toBeVisible({ timeout: 30_000 });

    const ngo = await as(browser, NGO_OWNER);
    await ngo.page.goto(`/ngo/contracts/${p.contractId}`);
    await eSign(ngo.page, 'Akshar Director', 'Director');
    await ngo.page.getByRole('button', { name: 'Accept funded project' }).click();
    await expect(ngo.page.getByText(/✓ Accepted by the NGO/)).toBeVisible({ timeout: 30_000 });
    const c = await ok(await donor.api.get(`/api/contracts/${p.contractId}`), 'read contract');
    expect((c.contract ?? c).status).toBe('ACTIVE');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// NGO — CSR invitations and proposals
// ═══════════════════════════════════════════════════════════════════════════
test.describe('NGO proposals', () => {
  test('NGO-005 match inbox lists the CSR invitation and opens the brief to respond', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'invited');
    const { page } = await as(browser, NGO_OWNER);
    await page.goto('/ngo/match-inbox');
    // Briefs are anonymised ("Education CSR opportunity in Karnataka"), so the row is found by its link.
    const link = page.locator(`a[href^="/ngo/opportunities/${p.reqId}"]`);
    const row = page.locator('li').filter({ has: link });
    await expect(row.getByText('Invited — respond with a proposal')).toBeVisible();
    await expect(row.getByText('Education CSR opportunity in Karnataka')).toBeVisible();
    await row.getByRole('link', { name: 'Respond' }).click();
    await page.waitForURL(new RegExp(`/ngo/opportunities/${p.reqId}`));
    await expect(page.getByText(/Express interest \/ submit a proposal/)).toBeVisible();
  });

  test('NGO-006 proposal v1 drafted with the assistant and submitted', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'invited');
    const { page, api } = await as(browser, NGO_OWNER);
    await page.goto(`/ngo/opportunities/${p.reqId}`);
    await page.getByRole('button', { name: /Draft with proposal assistant/ }).click();
    await expect(page.getByText(/(Template draft|AI-assisted draft):/)).toBeVisible({ timeout: 90_000 });
    const form = page.locator('form#respond');
    await form.getByLabel('Proposed budget (₹)').fill('300000');
    await form.getByLabel('Duration (months)').fill('12');
    const plan = form.getByLabel('Implementation plan');
    if (!(await plan.inputValue()).trim()) await plan.fill('Install projectors in 5 schools and train teachers.');
    const outcomes = form.getByLabel('Expected outcomes');
    if (!(await outcomes.inputValue()).trim()) await outcomes.fill('1,200 students using digital lessons weekly.');
    while ((await form.getByPlaceholder('Amount ₹').count()) < 2) await form.getByRole('button', { name: '+ Add milestone' }).click();
    await form.getByPlaceholder('Milestone 1').fill('Equipment installed');
    await form.getByPlaceholder('Amount ₹').nth(0).fill('150000');
    await form.getByPlaceholder('Months').nth(0).fill('3');
    await form.getByPlaceholder('Milestone 2').fill('Teachers trained');
    await form.getByPlaceholder('Amount ₹').nth(1).fill('150000');
    await form.getByPlaceholder('Months').nth(1).fill('9');
    await form.getByRole('button', { name: 'Submit', exact: true }).click();
    await expect(page.getByText(/Your response:/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/· V1/)).toBeVisible();
    const owner = await as(browser, CSR_OWNER);
    const responses = (await ok(await owner.api.get(`/api/requirements/${p.reqId}/responses`), 'responses')).responses as any[];
    expect(responses.find((r) => /Akshar/.test(r.ngo?.orgName ?? ''))?.version).toBe(1);
    void api;
  });

  test('NGO-007 change request → NGO submits revision V2; V1 kept in history', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'changes');
    const { page } = await as(browser, NGO_OWNER);
    await page.goto('/ngo/match-inbox');
    await expect(page.locator('li').filter({ has: page.locator(`a[href^="/ngo/opportunities/${p.reqId}"]`) })).toContainText('Changes requested — revise your proposal');
    await page.goto(`/ngo/opportunities/${p.reqId}`);
    await expect(page.getByText(/The sponsor asked for changes/)).toBeVisible();
    await expect(page.getByText(/Revise your proposal \(V2\)/)).toBeVisible();
    await page.locator('form#respond').getByLabel('Expected outcomes').fill('1,200 students weekly; attendance tracked; quarterly reports.');
    await page.getByRole('button', { name: 'Submit revision' }).click();
    await expect(page.getByText(/· V2/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Previous versions \(1\)/)).toBeVisible();
  });
});

// ─── Field evidence helpers ─────────────────────────────────────────────────

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** A real, decodable PNG whose pixels depend on `seed` — distinct seeds are distinct photos. */
function makePng(seed: number, size = 96): Buffer {
  let x = seed * 2654435761 || 1;
  const rnd = () => ((x = (x ^ (x << 13)) >>> 0), (x = (x ^ (x >>> 17)) >>> 0), (x = (x ^ (x << 5)) >>> 0), x & 0xff);
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let i = 1; i <= size * 3; i++) raw[y * (size * 3 + 1) + i] = (rnd() + ((y * 7 + i) & 0x7f)) & 0xff;
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const pngFile = (seed: number) => ({ name: `photo-${seed}.png`, mimeType: 'image/png', buffer: makePng(seed) });
const photoSeed = () => (RUN % 100000) * 100 + seq++;

/** The seeded Akshar project with a site location (21.1458, 79.0882). */
const SITE = { latitude: 21.1458, longitude: 79.0882 };
const FAR_AWAY = { latitude: 28.6139, longitude: 77.209 }; // ~900 km from the site

async function aksharProjectId(browser: Browser, title = 'Rural Literacy Kits') {
  const owner = await as(browser, NGO_OWNER);
  const projects = (await ok(await owner.api.get('/api/ngo/projects'), 'NGO projects')).projects as any[];
  const p = projects.find((x) => x.title === title);
  expect(p, `${title} exists`).toBeTruthy();
  return p.id as string;
}

async function userIdOf(api: APIRequestContext) {
  return (await ok(await api.get('/api/auth/session'), 'session')).user?.id as string;
}

/** Owner assigns a task (API set-up) and returns its title + id. */
async function assignTask(browser: Browser, projectId: string, assigneeEmail = NGO_FIELD, extra: Record<string, unknown> = {}) {
  const owner = await as(browser, NGO_OWNER);
  const assignee = await as(browser, assigneeEmail);
  const title = `Photograph ${uniq('task')}`;
  const res = await ok(
    await owner.api.post('/api/ngo/field-tasks', { data: { projectId, title, assignedToId: await userIdOf(assignee.api), ...extra } }),
    'assign field task'
  );
  return { title, id: (res.task ?? res).id as string };
}

/** Field worker's phone: signed in, location permission granted at `coords`. */
async function fieldPhone(browser: Browser, coords: { latitude: number; longitude: number }, email = NGO_FIELD, password = PASSWORD) {
  const a = await as(browser, email, password);
  await a.ctx.grantPermissions(['geolocation'], { origin: BASE });
  await a.ctx.setGeolocation({ ...coords, accuracy: 15 });
  return a;
}

/** In /ngo/field: open the task, attach a photo, wait for a GPS fix, save. */
async function captureInFieldApp(page: Page, taskTitle: string, seed: number, opts: { note?: string; feedback?: { ref: string; record: boolean; share: boolean; rating?: string; text?: string } } = {}) {
  await page.goto('/ngo/field');
  await page.getByRole('button', { name: new RegExp(`^${taskTitle}, `) }).click();
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile(seed));
  await expect(page.getByText(/📍 -?\d+\.\d{5}, -?\d+\.\d{5}/)).toBeVisible({ timeout: 30_000 });
  await page.getByPlaceholder('What does this show?').fill(opts.note ?? `Acceptance capture ${seed}`);
  if (opts.feedback) {
    const f = opts.feedback;
    await page.getByLabel('Record beneficiary feedback & consent').check();
    await page.getByPlaceholder('e.g. HH-014').fill(f.ref);
    if (f.record) await page.getByLabel('Agrees to their feedback being recorded').check();
    if (f.share) await page.getByLabel('Agrees to the photo being shown to the funder').check();
    if (f.record && f.rating) await page.getByLabel('Rating (1–5)').selectOption(f.rating);
    if (f.record && f.text) await page.getByLabel('Feedback', { exact: true }).fill(f.text);
  } else {
    const people = page.getByLabel(/people/i).first();
    if (await people.isChecked()) await people.uncheck();
  }
  await page.getByRole('button', { name: 'Save capture' }).click();
}

async function evidenceForTask(browser: Browser, taskId: string) {
  const owner = await as(browser, NGO_OWNER);
  const tasks = (await ok(await owner.api.get('/api/ngo/field-tasks'), 'tasks')).tasks as any[];
  return (tasks.find((t) => t.id === taskId)?.evidence ?? []) as any[];
}

/** Admin /admin/field-evidence: the card for a task. */
async function adminEvidenceCard(admin: Page, taskTitle: string, tab = 'Pending') {
  await admin.goto('/admin/field-evidence');
  await admin.getByRole('tab', { name: new RegExp(`^${tab}`) }).click();
  const title = admin.getByText(taskTitle, { exact: true });
  // The queue is oldest-first and paged: page forward until the capture appears.
  const more = admin.getByRole('button', { name: 'Load more' });
  await expect(title.or(more).first()).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 30 && !(await title.first().isVisible()) && (await more.isVisible().catch(() => false)); i++) {
    await more.click();
    await expect(title.or(more).first()).toBeVisible({ timeout: 30_000 });
  }
  await expect(title.first()).toBeVisible({ timeout: 30_000 });
  return admin.locator('div').filter({ has: title }).filter({ has: admin.getByRole('button', { name: /Approve|Return to NGO/ }) }).last();
}

async function adminApproveEvidence(browser: Browser, taskTitle: string, overrideNote?: string) {
  const admin = await as(browser, ADMIN.email, ADMIN.password);
  const card = await adminEvidenceCard(admin.page, taskTitle);
  const approve = card.getByRole('button', { name: /^Approve/ });
  if ((await approve.innerText()).includes('override')) {
    await approve.click();
    await card.locator('textarea').fill(overrideNote ?? 'Checked against the site visit log; approving despite the flag.');
    await card.getByRole('button', { name: 'Confirm approve' }).click();
  } else {
    await approve.click();
  }
  await expect(admin.page.getByText(taskTitle, { exact: true })).toHaveCount(0, { timeout: 30_000 });
}

/** Team invite (NGO-003) — shared by NGO-009/011 so the suite creates one field worker per run. */
let fieldWorkerPromise: Promise<{ email: string; name: string }> | null = null;
async function invitedFieldWorker(browser: Browser) {
  if (!fieldWorkerPromise) fieldWorkerPromise = inviteFieldWorkerViaUi(browser);
  return fieldWorkerPromise;
}
async function inviteFieldWorkerViaUi(browser: Browser) {
  const owner = await as(browser, NGO_OWNER);
  const email = `${uniq('fw')}@example.test`;
  const name = `Field Worker ${uniq('')}`;
  await owner.page.goto('/ngo/settings/team');
  await owner.page.getByPlaceholder('colleague@example.org').fill(email);
  await owner.page.locator('form', { has: owner.page.getByPlaceholder('colleague@example.org') }).locator('select').selectOption('FIELD_STAFF');
  await owner.page.getByRole('button', { name: 'Send invite' }).click();
  const link = await owner.page.getByLabel('Invite link').inputValue({ timeout: 30_000 });
  expect(link).toMatch(/\/invite\/[A-Za-z0-9_-]+/);

  const fw = await newActor(browser);
  await fw.page.goto(link.replace(/^https?:\/\/[^/]+/, ''));
  await expect(fw.page.getByText(/You've been invited as/)).toContainText('Field Worker');
  await fw.page.getByLabel('Your name').fill(name);
  await fw.page.getByLabel(/Choose a password/).fill(NEW_PASSWORD);
  await fw.page.getByRole('button', { name: 'Create account and join' }).click();
  await fw.page.waitForURL(/\/ngo\/field/, { timeout: 90_000 });
  sessions.set(email, fw);
  return { email, name };
}

// ═══════════════════════════════════════════════════════════════════════════
// NGO — team, field work, evidence
// ═══════════════════════════════════════════════════════════════════════════
test.describe('NGO field work', () => {
  test('NGO-003 owner invites a Field Worker and a Program Manager; invite accepted, link single-use; revoke works', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const fw = await invitedFieldWorker(browser);
    const owner = await as(browser, NGO_OWNER);
    await owner.page.goto('/ngo/settings/team');
    await expect(owner.page.getByRole('row', { name: new RegExp(fw.email) }).first()).toContainText(/Field Worker|ACCEPTED/);

    // Program Manager invite, then revoke it.
    const pm = `${uniq('pm')}@example.test`;
    await owner.page.getByPlaceholder('colleague@example.org').fill(pm);
    await owner.page.locator('form', { has: owner.page.getByPlaceholder('colleague@example.org') }).locator('select').selectOption('PROGRAM_MANAGER');
    await owner.page.getByRole('button', { name: 'Send invite' }).click();
    const pmLink = await owner.page.getByLabel('Invite link').inputValue();
    const row = owner.page.locator('li').filter({ hasText: pm }).first();
    await expect(row).toContainText('PENDING');
    await expect(row).toContainText('Program Manager');
    await row.getByRole('button', { name: /Revoke/ }).click();
    await expect(owner.page.locator('li').filter({ hasText: pm }).first()).toContainText('REVOKED');
    const anon = await newActor(browser);
    await anon.page.goto(pmLink.replace(/^https?:\/\/[^/]+/, ''));
    await expect(anon.page.getByRole('link', { name: 'Go to sign in' })).toBeVisible();
    await anon.ctx.close();
  });

  test('NGO-009 owner assigns a field task to the field worker from the project page', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const fw = await invitedFieldWorker(browser);
    const projectId = await aksharProjectId(browser);
    const owner = await as(browser, NGO_OWNER);
    await owner.page.goto(`/ngo/projects/${projectId}`);
    await owner.page.getByRole('button', { name: '+ Assign field task' }).click();
    const title = `Photograph the reading corner ${uniq('')}`;
    await owner.page.getByPlaceholder('e.g. Photograph the completed classroom').fill(title);
    const assign = owner.page.getByLabel('Assign to');
    const opt = assign.locator('option', { hasText: fw.name });
    await assign.selectOption(await opt.getAttribute('value'));
    const ms = owner.page.locator('form', { has: owner.page.getByPlaceholder('e.g. Photograph the completed classroom') }).locator('select').nth(1);
    if ((await ms.locator('option').count()) > 1) await ms.selectOption({ index: 1 });
    await owner.page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(owner.page.getByText(title)).toBeVisible({ timeout: 30_000 });
    const tasks = (await ok(await owner.api.get('/api/ngo/field-tasks'), 'tasks')).tasks as any[];
    const t = tasks.find((x) => x.title === title);
    expect(t?.assignedTo?.email ?? t?.assignee?.email ?? t?.assignedToId).toBeTruthy();
  });

  test('NGO-011 field worker signs in and lands on /ngo/field seeing only their own tasks', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const fw = await invitedFieldWorker(browser);
    const projectId = await aksharProjectId(browser);
    const mine = await assignTask(browser, projectId, fw.email);
    const other = await assignTask(browser, projectId, NGO_FIELD);
    // Fresh sign-in through the login form.
    const a = await newActor(browser);
    await a.page.goto('/login');
    await a.page.locator('input[type="email"]').waitFor({ timeout: 120_000 });
    await a.page.fill('input[type="email"]', fw.email);
    await a.page.fill('input[type="password"]', NEW_PASSWORD);
    await a.page.locator('form button[type="submit"]').first().click();
    await a.page.waitForURL(/\/ngo\/field/, { timeout: 90_000 });
    await expect(a.page.getByRole('button', { name: new RegExp(`^${mine.title}, `) })).toBeVisible({ timeout: 30_000 });
    await expect(a.page.getByText(other.title)).toHaveCount(0);
    // Not an owner: money pages are refused.
    const res = await a.api.get('/api/ngo/field-tasks');
    const titles = ((await res.json()).tasks as any[]).map((t) => t.title);
    expect(titles).toContain(mine.title);
    expect(titles).not.toContain(other.title);
    await a.ctx.close();
  });

  test('NGO-013 normal photo with correct GPS syncs with progress and lands for review', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const projectId = await aksharProjectId(browser);
    const task = await assignTask(browser, projectId);
    const fw = await fieldPhone(browser, SITE);
    await captureInFieldApp(fw.page, task.title, photoSeed());
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    const ev = await evidenceForTask(browser, task.id);
    expect(ev.length).toBe(1);
    expect(ev[0].status).toBe('PENDING_REVIEW');
    const owner = await as(browser, NGO_OWNER);
    await owner.page.goto(`/ngo/projects/${projectId}`);
    await expect(cardWith(owner.page, [task.title], owner.page.getByText(/GPS match/)).getByText(/GPS match/).first()).toBeVisible();
  });

  test('NGO-012 offline capture is queued, syncs when back online, and a replayed clientId does not duplicate', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const projectId = await aksharProjectId(browser);
    const task = await assignTask(browser, projectId);
    const fw = await fieldPhone(browser, SITE);
    await fw.page.goto('/ngo/field');
    await expect(fw.page.getByRole('button', { name: new RegExp(`^${task.title}, `) })).toBeVisible();
    await fw.ctx.setOffline(true);
    try {
      await fw.page.getByRole('button', { name: new RegExp(`^${task.title}, `) }).click();
      await fw.page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile(photoSeed()));
      await expect(fw.page.getByText(/📍 -?\d+\.\d{5}/)).toBeVisible({ timeout: 30_000 });
      await fw.page.getByPlaceholder('What does this show?').fill('Captured with no signal.');
      await fw.page.getByRole('button', { name: 'Save capture' }).click();
      await expect(fw.page.getByText(/Saved on this phone\. It will sync when you are back online\./)).toBeVisible();
      await expect(fw.page.getByText('1 waiting to sync')).toBeVisible();
      await expect(fw.page.getByRole('status').filter({ hasText: 'Offline' })).toBeVisible();
    } finally {
      await fw.ctx.setOffline(false);
    }
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    await expect(fw.page.getByText('0 waiting to sync')).toBeVisible();
    expect((await evidenceForTask(browser, task.id)).length).toBe(1);

    // Same capture replayed by a flaky network: same clientId → same row, no duplicate.
    const clientId = uniq('replay');
    const form = { clientId, taskId: task.id, capturedAt: new Date().toISOString(), note: 'replay', containsPeople: 'false', latitude: String(SITE.latitude), longitude: String(SITE.longitude), photo: pngFile(photoSeed()) };
    const first = await ok(await fw.api.post('/api/field/evidence', { multipart: form as any }), 'first sync');
    const again = await ok(await fw.api.post('/api/field/evidence', { multipart: form as any }), 'replayed sync');
    expect(again.replayed).toBe(true);
    expect(again.evidence?.id ?? again.id).toBe(first.evidence?.id ?? first.id);
    expect((await evidenceForTask(browser, task.id)).length).toBe(2);
  });

  test('NGO-014 duplicate photo and bad GPS are flagged, returned to the NGO, and recaptured', async ({ browser }) => {
    test.setTimeout(6 * 60_000);
    const projectId = await aksharProjectId(browser);
    const taskA = await assignTask(browser, projectId);
    const taskB = await assignTask(browser, projectId);
    const seed = photoSeed();
    const fw = await fieldPhone(browser, SITE);
    await captureInFieldApp(fw.page, taskA.title, seed);
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    // Same photo again, from ~900 km away.
    await fw.ctx.setGeolocation({ ...FAR_AWAY, accuracy: 15 });
    await captureInFieldApp(fw.page, taskB.title, seed);
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });

    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto('/admin/field-evidence');
    const findPaged = async () => {
      const title = admin.page.getByText(taskB.title, { exact: true });
      const more = admin.page.getByRole('button', { name: 'Load more' });
      await expect(title.or(more).first()).toBeVisible({ timeout: 30_000 });
      for (let i = 0; i < 30 && !(await title.first().isVisible()) && (await more.isVisible().catch(() => false)); i++) {
        await more.click();
        await expect(title.or(more).first()).toBeVisible({ timeout: 30_000 });
      }
      await expect(title.first()).toBeVisible({ timeout: 30_000 });
    };
    await admin.page.getByLabel('Flags').selectOption('duplicate');
    await findPaged();
    await admin.page.getByLabel('Flags').selectOption('gps');
    await findPaged();
    const card = await adminEvidenceCard(admin.page, taskB.title);
    await expect(card.getByText(/GPS mismatch/i).first()).toBeVisible();
    await expect(card.getByRole('button', { name: 'Approve (override flag)' })).toBeVisible();
    await card.getByRole('button', { name: 'Return to NGO' }).click();
    await card.locator('textarea').fill('Duplicate of another task photo and taken far from the site. Retake at the school.');
    await card.getByRole('button', { name: 'Confirm return' }).click();
    await expect(admin.page.getByText(taskB.title, { exact: true })).toHaveCount(0, { timeout: 30_000 });

    // The field worker sees why and recaptures at the site with a new photo.
    await fw.ctx.setGeolocation({ ...SITE, accuracy: 15 });
    await fw.page.goto('/ngo/field');
    await expect(fw.page.getByText(/Resubmit requested: Duplicate of another task photo/)).toBeVisible();
    await captureInFieldApp(fw.page, taskB.title, photoSeed());
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    const ev = await evidenceForTask(browser, taskB.id);
    expect(ev.map((e) => e.status).sort()).toEqual(['PENDING_REVIEW', 'RESUBMIT_REQUESTED']);
  });

  test('NGO-010 beneficiary consent is captured per purpose and shown on each capture', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const projectId = await aksharProjectId(browser);
    const task = await assignTask(browser, projectId);
    const fw = await fieldPhone(browser, SITE);
    const refA = `BEN-${uniq('')}`.toUpperCase();
    const refB = `BEN-${uniq('')}`.toUpperCase();
    await captureInFieldApp(fw.page, task.title, photoSeed(), { feedback: { ref: refA, record: true, share: false, rating: '4', text: 'Classes are useful.' } });
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    await captureInFieldApp(fw.page, task.title, photoSeed(), { feedback: { ref: refB, record: true, share: true, rating: '5', text: 'My daughter reads better now.' } });
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    const owner = await as(browser, NGO_OWNER);
    await owner.page.goto(`/ngo/projects/${projectId}`);
    const t = cardWith(owner.page, [task.title], owner.page.getByText('Consent: share with funder'));
    await expect(t.getByText('Consent: do not share')).toBeVisible();
    await expect(t.getByText('Consent: share with funder')).toBeVisible();
  });
});

// ─── Impact chain (API set-up): funded contract → approved photos → approved 42% / 61% claims ──
const DAY = 86_400_000;
const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);
const LITERACY = 'IB-LITERACY-PCT-001';

async function apiCapture(
  api: APIRequestContext,
  taskId: string,
  opts: { feedback?: { ref: string; record: boolean; share: boolean; rating?: number; text?: string }; containsPeople?: boolean; note?: string } = {}
) {
  const form: Record<string, any> = {
    clientId: uniq('cap'),
    taskId,
    capturedAt: new Date().toISOString(),
    latitude: String(SITE.latitude),
    longitude: String(SITE.longitude),
    accuracyM: '12',
    note: opts.note ?? 'Acceptance field capture',
    containsPeople: String(opts.containsPeople ?? !!opts.feedback),
    photo: pngFile(photoSeed()),
  };
  if (opts.feedback) {
    Object.assign(form, {
      hasFeedback: 'true',
      beneficiaryRef: opts.feedback.ref,
      consentMethod: 'VERBAL',
      consentToRecord: String(opts.feedback.record),
      consentToSharePhoto: String(opts.feedback.share),
      ...(opts.feedback.rating ? { rating: String(opts.feedback.rating) } : {}),
      ...(opts.feedback.text ? { feedbackText: opts.feedback.text } : {}),
    });
  }
  const res = await ok(await api.post('/api/field/evidence', { multipart: form }), 'field capture');
  return res.evidence as { id: string };
}

async function apiApproveEvidence(browser: Browser, id: string) {
  const admin = await as(browser, ADMIN.email, ADMIN.password);
  await ok(await admin.api.patch(`/api/admin/field-evidence/${id}`, { data: { decision: 'APPROVE', note: 'Checked against the site (acceptance).' } }), 'approve evidence');
}

async function fileClaim(browser: Browser, projectId: string, value: string, from: string, to: string, evidenceId: string, submit = true) {
  const owner = await as(browser, NGO_OWNER);
  const method = `Reading assessment of enrolled learners, ${value}% at grade level (acceptance ${uniq('')}).`;
  const claim = (
    await ok(
      await owner.api.post('/api/ngo/outcome-claims', {
        data: {
          projectId,
          metricCode: LITERACY,
          value,
          periodStart: from,
          periodEnd: to,
          method,
          citations: [{ kind: 'FIELD_PHOTO', id: evidenceId }],
        },
      }),
      'file claim'
    )
  ).claim;
  if (submit) await ok(await owner.api.patch(`/api/ngo/outcome-claims/${claim.id}`, { data: { action: 'SUBMIT' } }), 'submit claim');
  return { id: claim.id as string, method: method as string };
}

async function apiApproveClaim(browser: Browser, id: string) {
  const admin = await as(browser, ADMIN.email, ADMIN.password);
  await ok(await admin.api.patch(`/api/admin/outcome-claims/${id}`, { data: { action: 'APPROVE', note: 'Assessment sheets checked against the photos (acceptance).' } }), 'approve claim');
}

type Chain = Pipe & { evidence: { id: string }[]; tasks: { id: string; title: string }[]; feedbackRef: string };
let chainPromise: Promise<Chain> | null = null;
/** One funded contract with approved field evidence and approved 42% → 61% literacy claims (shared, built once per run). */
function impactChain(browser: Browser) {
  if (!chainPromise) chainPromise = buildImpactChain(browser);
  return chainPromise;
}
async function buildImpactChain(browser: Browser): Promise<Chain> {
  const p = await fundedContract(browser);
  const fw = await as(browser, NGO_FIELD);
  const tasks = [await assignTask(browser, p.projectId!), await assignTask(browser, p.projectId!), await assignTask(browser, p.projectId!)];
  const feedbackRef = `BEN-${uniq('')}`.toUpperCase();
  const evidence = [
    await apiCapture(fw.api, tasks[0].id),
    await apiCapture(fw.api, tasks[1].id),
    await apiCapture(fw.api, tasks[2].id, { feedback: { ref: feedbackRef, record: true, share: true, rating: 5, text: 'My son now reads the Kannada textbook on his own.' } }),
  ];
  for (const e of evidence) await apiApproveEvidence(browser, e.id);
  const base = await fileClaim(browser, p.projectId!, '42', isoDay(-120), isoDay(-90), evidence[0].id);
  await apiApproveClaim(browser, base.id);
  const end = await fileClaim(browser, p.projectId!, '61', isoDay(-30), isoDay(0), evidence[1].id);
  await apiApproveClaim(browser, end.id);
  return { ...p, evidence, tasks, feedbackRef };
}

/** NGO writes an impact report on the contract (API), submits, admin publishes (API). */
async function publishedReport(browser: Browser, c: Chain) {
  const owner = await as(browser, NGO_OWNER);
  const admin = await as(browser, ADMIN.email, ADMIN.password);
  const title = `Impact report ${uniq('')}`;
  const r = (
    await ok(
      await owner.api.post('/api/ngo/impact-reports', {
        data: { contractId: c.contractId, title, periodStart: isoDay(-150), periodEnd: isoDay(0), summary: 'Learners reading at grade level rose from 42% to 61%.' },
      }),
      'create report'
    )
  ).report;
  await ok(await owner.api.patch(`/api/ngo/impact-reports/${r.id}`, { data: { action: 'SUBMIT' } }), 'submit report');
  await ok(await admin.api.patch(`/api/admin/impact-reports/${r.id}`, { data: { action: 'PUBLISH', note: '' } }), 'publish report');
  return { id: r.id as string, title };
}

// ═══════════════════════════════════════════════════════════════════════════
// NGO — projects, money, outcomes, reports
// ═══════════════════════════════════════════════════════════════════════════
test.describe('NGO delivery & reporting', () => {
  test('NGO-004 project with geography, budget and milestones is created, admin-approved and ACTIVE', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const { page, api } = await as(browser, NGO_OWNER);
    const title = `Library corners ${uniq('')}`;
    await page.goto('/ngo/projects/new');
    await page.getByPlaceholder('e.g. Clean Water for Dharavi').fill(title);
    await page.locator('select').first().selectOption({ label: 'Education' }).catch(async () => page.locator('select').first().selectOption({ index: 1 }));
    await page.getByPlaceholder('e.g. 50000', { exact: true }).fill('300000');
    await page.getByPlaceholder('e.g. Dharavi, Mumbai').fill('Mysuru, Karnataka');
    await page.getByPlaceholder(/Describe the scope, objectives/).fill('Reading corners with 300 graded books in 10 government schools, with weekly library periods.');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile(photoSeed()));
    await page.getByPlaceholder('e.g. 12', { exact: true }).fill('12');
    await page.getByPlaceholder('e.g. 500', { exact: true }).fill('800');
    await page.getByPlaceholder('e.g. Purchase 500 textbooks').first().fill('Books purchased and corners set up');
    await page.getByPlaceholder('e.g. 15000').first().fill('300000');
    await pickDeadline(page);
    await page.getByPlaceholder(/Buy and distribute physical textbooks/).first().fill('Procure graded readers and set up a reading corner in each school.');
    await page.getByRole('button', { name: 'Publish Project & Milestones' }).click();
    let projectId = '';
    await expect
      .poll(async () => {
        const projects = (await (await api.get('/api/ngo/projects')).json()).projects as any[];
        projectId = projects.find((x) => x.title === title)?.id ?? '';
        return projectId;
      }, { timeout: 60_000 })
      .not.toBe('');

    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto('/admin/project-review');
    const card = cardWith(admin.page, [title], admin.page.getByRole('button', { name: 'Approve & Publish' }));
    await card.getByRole('button', { name: 'Approve & Publish' }).click();
    await expect(admin.page.getByText(title).first()).toBeVisible();
    await expect.poll(async () => ((await (await api.get('/api/ngo/projects')).json()).projects as any[]).find((x) => x.id === projectId)?.status, { timeout: 30_000 }).toBe('ACTIVE');
    await page.goto(`/ngo/projects/${projectId}`);
    await expect(page.getByText('Mysuru, Karnataka').first()).toBeVisible();
    await expect(page.getByText('Books purchased and corners set up').first()).toBeVisible();
  });

  test('NGO-008 NGO confirms a payment received; milestones show Funded and the contract FUNDED', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await pipeline(browser, 'accepted');
    await recordPayment(browser, p.contractId!, '150000', { contractMilestoneId: p.milestones![0].id });
    await recordPayment(browser, p.contractId!, '150000', { contractMilestoneId: p.milestones![1].id });
    const { page } = await as(browser, NGO_FINANCE);
    await page.goto(`/ngo/contracts/${p.contractId}`);
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'Confirm received' }).first().click();
      await expect(page.getByRole('button', { name: 'Confirm received' })).toHaveCount(1 - i, { timeout: 30_000 });
    }
    const schedule = page.locator('table', { has: page.getByRole('columnheader', { name: 'Funding' }) }).first();
    await expect(schedule.getByText('Funded', { exact: true })).toHaveCount(2);
    await expect(page.getByText('Fully funded').first()).toBeVisible();
    await expect(page.getByText(/Contract FUNDED on/).first()).toBeVisible();
  });

  test('NGO-015 NGO records an expense with a receipt; utilisation updates', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const p = await fundedContract(browser);
    const { page } = await as(browser, NGO_OWNER);
    await page.goto(`/ngo/contracts/${p.contractId}`);
    const panel = page.locator('section[aria-labelledby="utilisation-h"]');
    await expect(panel.getByText('Fund utilisation')).toBeVisible({ timeout: 30_000 });
    await panel.getByRole('button', { name: 'Record expense' }).click();
    await panel.getByLabel('Amount (₹)').fill('45000');
    await panel.getByLabel('Category').selectOption('EQUIPMENT');
    await panel.getByLabel('Date spent').fill(isoDay(-1));
    const desc = `Projectors for 3 classrooms ${uniq('')}`;
    await panel.getByLabel('Description').fill(desc);
    await panel.getByLabel(/Receipt/).setInputFiles(pdfFile('invoice.pdf', makeTextPdf(['TAX INVOICE', 'Projector x3', 'Total INR 45,000'])));
    await panel.getByRole('button', { name: 'Save expense' }).click();
    await expect(panel.getByText(desc)).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('₹45,000').first()).toBeVisible();
    await expect(panel.getByRole('link', { name: 'Receipt' }).first()).toBeVisible();
    // The funder sees the same utilisation, read-only.
    const donor = await as(browser, CSR_OWNER);
    await donor.page.goto(`/donor/contracts/${p.contractId}`);
    const dpanel = donor.page.locator('section[aria-labelledby="utilisation-h"]');
    await expect(dpanel.getByText(desc)).toBeVisible({ timeout: 30_000 });
    await expect(dpanel.getByRole('button', { name: 'Record expense' })).toHaveCount(0);
  });

  test('NGO-016 baseline 42% and endline 61% claims approved → +19 pp computed', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const p = await fundedContract(browser);
    const fw = await as(browser, NGO_FIELD);
    const t1 = await assignTask(browser, p.projectId!);
    const t2 = await assignTask(browser, p.projectId!);
    const e1 = await apiCapture(fw.api, t1.id);
    const e2 = await apiCapture(fw.api, t2.id, { note: `Endline sheet — ${t2.title}` });
    await apiApproveEvidence(browser, e1.id);
    await apiApproveEvidence(browser, e2.id);
    const base = await fileClaim(browser, p.projectId!, '42', isoDay(-120), isoDay(-90), e1.id);

    // Endline filed through the impact cockpit (period randomised so the draft is unique to this run).
    const { page } = await as(browser, NGO_OWNER);
    const method = `Endline reading assessment of all enrolled learners ${uniq('')}.`;
    await uiFileClaim(page, p.projectId!, '61', isoDay(-20 - Math.floor(Math.random() * 40)), isoDay(-Math.floor(Math.random() * 10)), method, t2.title);

    // Admin approves both in the impact review console.
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    for (const m of [base.method, method]) {
      await admin.page.goto('/admin/impact-review');
      const card = cardWith(admin.page, [m], admin.page.getByRole('button', { name: /^Approve/ }));
      await card.getByRole('button', { name: /^Approve/ }).click();
      await expect(admin.page.getByText(m)).toHaveCount(0, { timeout: 30_000 });
    }

    await page.goto('/ngo/impact/report');
    const article = page.locator('article').filter({ hasText: 'Baseline → endline' }).filter({ hasText: '+19 pp' }).first();
    await expect(article.getByText('+19 pp').first()).toBeVisible();
    await expect(article.getByText(/42[^→]*→[^→]*61/).first()).toBeVisible();
  });

  test('NGO-017 NGO report draft uses only approved figures; submitted, published to the funder', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    // A claim still in review must not appear in the report.
    const fw = await as(browser, NGO_FIELD);
    const t = await assignTask(browser, c.projectId!);
    const e = await apiCapture(fw.api, t.id);
    await apiApproveEvidence(browser, e.id);
    await fileClaim(browser, c.projectId!, '58', isoDay(-60), isoDay(-45), e.id);

    const { page } = await as(browser, NGO_OWNER);
    await page.goto('/ngo/impact/report');
    await expect(page.getByText('Draft').first()).toBeVisible();
    await expect(page.getByText('+19 pp').first()).toBeVisible();

    await page.goto(`/ngo/contracts/${c.contractId}`);
    const panel = page.locator('section[aria-labelledby="ngo-reports-h"]');
    await panel.getByRole('button', { name: 'New report' }).click();
    const title = `Q3 impact report ${uniq('')}`;
    await panel.getByLabel('Title').fill(title);
    await panel.getByLabel('Period start').fill(isoDay(-150));
    await panel.getByLabel('Period end').fill(isoDay(0));
    await panel.getByLabel('Summary (your narrative)').fill('Reading at grade level rose from 42% to 61% across the schools.');
    await panel.getByRole('button', { name: 'Save draft' }).click();
    await openReportDetail(panel, title);
    await expect(panel.getByText('Approved claims that will be included')).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByText('In review — not included')).toBeVisible();
    await panel.getByRole('button', { name: 'Submit for review' }).click();
    await expect(panel.getByText(/submitted|in review/i).first()).toBeVisible({ timeout: 30_000 });

    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto('/admin/impact-publishing');
    const card = cardWith(admin.page, [title], admin.page.getByRole('button', { name: 'Publish to funder' }));
    await card.getByRole('button', { name: 'Publish to funder' }).click();
    await expect(admin.page.getByText(title)).toHaveCount(0, { timeout: 30_000 });

    const donor = await as(browser, CSR_OWNER);
    await donor.page.goto(`/donor/contracts/${c.contractId}`);
    const dpanel = donor.page.locator('section[aria-labelledby="donor-reports-h"]');
    await expect(dpanel.getByText(title)).toBeVisible({ timeout: 30_000 });
    await expect(cardWith(donor.page, [title]).getByText(/58/)).toHaveCount(0);
  });

  test('NGO-018 beneficiary feedback is aggregated for the NGO and only consented, de-identified data reaches the donor', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const fw = await as(browser, NGO_FIELD);
    const t = await assignTask(browser, c.projectId!);
    const privateRef = `BEN-${uniq('')}`.toUpperCase();
    const e = await apiCapture(fw.api, t.id, { feedback: { ref: privateRef, record: true, share: false, rating: 3, text: 'Private remark that must stay inside the NGO.' } });
    await apiApproveEvidence(browser, e.id);

    const { page } = await as(browser, NGO_OWNER);
    await page.goto('/ngo/impact/report');
    await expect(page.getByText(/\d+ consented of \d+ captured/).first()).toBeVisible();
    await expect(page.getByRole('heading', { name: 'What funders see' }).first()).toBeVisible();

    const donor = await as(browser, CSR_OWNER);
    await donor.page.goto(`/donor/funded/${c.projectId}`);
    await expect(donor.page.getByRole('heading', { name: 'Verified field evidence' })).toBeVisible();
    const body = await donor.page.locator('body').innerText();
    expect(body).not.toContain(privateRef);
    expect(body).not.toContain(c.feedbackRef);
    expect(body).not.toContain('Private remark that must stay inside the NGO.');
    const csv = await (await donor.api.get('/api/donor/impact-report')).text();
    expect(csv).not.toContain(privateRef);
    expect(csv).not.toContain(c.feedbackRef);
  });

  test('NGO-019 a concern filed while signed in as the NGO gets its own reference and runs through the admin workflow', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const { page } = await as(browser, NGO_OWNER);
    await page.goto('/report-concern');
    const form = page.locator('form');
    await form.locator('select').nth(0).selectOption({ index: 1 });
    await form.locator('select').nth(1).selectOption({ index: 1 });
    const subject = `Partner NGO staff asked for cash ${uniq('')}`;
    await form.getByPlaceholder('e.g. Milestone reported complete but no work was done').fill(subject);
    await form.locator('textarea').fill('On a school visit a person claiming to be partner staff asked parents for cash to enrol children.');
    await form.locator('button[type="submit"]').click();
    await expect(page.getByText('Report filed')).toBeVisible({ timeout: 30_000 });
    const ref = (await page.getByText(/Reference:/).innerText()).replace('Reference:', '').trim();
    expect(ref.length).toBeGreaterThan(5);

    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto(`/admin/grievances/${ref}`);
    await expect(admin.page.getByText(subject).first()).toBeVisible();
    await admin.page.getByRole('button', { name: 'MEDIUM', exact: true }).click();
    await admin.page.getByRole('button', { name: 'Triage' }).click();
    await admin.page.getByRole('button', { name: 'Start investigating' }).click();
    await admin.page.getByRole('button', { name: 'Resolve' }).click();
    await admin.page.locator('textarea').last().fill('Spoke to the school and the partner; staff member identified and removed. Parents informed.');
    await admin.page.getByRole('button', { name: 'Confirm resolution' }).click();
    await expect(admin.page.getByText(/RESOLVED|Resolved/).first()).toBeVisible({ timeout: 30_000 });
  });

  test('NGO-020 funder renewal request reaches the NGO, which answers it', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const report = await publishedReport(browser, c);
    const donor = await as(browser, CSR_OWNER);
    await ok(
      await donor.api.post('/api/engagement/re-engage', { data: { reportId: report.id, kind: 'NEXT_OPPORTUNITY', message: `Interested in a second district ${uniq('')}` } }),
      'next opportunity request'
    );
    const { page } = await as(browser, NGO_OWNER);
    await page.goto('/ngo/dashboard');
    await expect(page.getByText(/funder request\(s\) to renew or discuss next steps/)).toBeVisible();
    await page.goto('/ngo/reporting');
    const section = page.locator('section[aria-labelledby="renewal-h"]');
    const row = section.locator('li').filter({ hasText: 'Interested in a second district' }).filter({ has: page.getByRole('button', { name: 'Accept' }) }).last();
    await row.locator('textarea').fill('Yes — we can start in Mandya district from April.');
    await row.getByRole('button', { name: 'Accept' }).click();
    await expect(section.getByText(/Your response: Yes — we can start in Mandya/).first()).toBeVisible({ timeout: 30_000 });
  });
});

// ─── Fresh project (API) — for cases that need milestones no earlier run completed ──
async function freshAksharProject(browser: Browser) {
  const owner = await as(browser, NGO_OWNER);
  const admin = await as(browser, ADMIN.email, ADMIN.password);
  const title = `Digital classrooms phase ${uniq('')}`;
  const res = await ok(
    await owner.api.post('/api/ngo/projects', {
      multipart: {
        title,
        description: 'Projectors, tablets and teacher training for government schools in Karnataka.',
        problemStatement: 'Students in government schools have no access to digital lessons.',
        expectedOutcome: 'More learners reading at grade level.',
        causeCategory: 'Education',
        targetAmount: '300000',
        location: 'Mysuru, Karnataka',
        coverImage: pngFile(photoSeed()) as any,
        durationMonths: '12',
        expectedBeneficiaries: '1000',
        beneficiaryGroup: 'Students in government schools',
        reportingCadence: 'Quarterly',
        primaryKPIs: JSON.stringify(['Students using digital lessons weekly']),
        milestones: JSON.stringify([
          { title: 'Equipment installed', description: 'Install projectors in 5 schools.', targetAmount: '150000', deadline: isoDay(90), proofType: 'Photo Evidence' },
          { title: 'Teachers trained and first assessment', description: 'Train 20 teachers.', targetAmount: '150000', deadline: isoDay(270), proofType: 'Photo Evidence' },
        ]),
      },
    }),
    'create project'
  );
  const projectId = res.projectId ?? res.project?.id;
  await ok(await admin.api.post('/api/admin/review-project', { data: { projectId, action: 'APPROVE' } }), 'approve project');
  return { projectId: projectId as string, title };
}

// ═══════════════════════════════════════════════════════════════════════════
// DONOR / CSR — onboarding, team, money, impact, engagement
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Donor / CSR — lifecycle', () => {
  test('DON-001 CSR donor registers, sets persona and company profile; admin verifies organisation and PAN', async ({ browser }) => {
    test.setTimeout(5 * 60_000);
    const email = `${uniq('csr')}@example.test`;
    const donor = await signUp(browser, 'DONOR', 'Suryodaya CSR Manager', email);
    const { page } = donor;
    if (!/onboarding/.test(page.url())) await page.goto('/donor/onboarding');
    await page.getByRole('button', { name: /CSR \/ Corporate/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /^Education/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: /CSR compliance \/ audit requirement/ }).click();
    await page.getByRole('button', { name: 'Complete Setup' }).click();
    await page.waitForURL((u) => !u.pathname.includes('onboarding'), { timeout: 60_000 });

    await page.goto('/donor/profile');
    const company = `Suryodaya Industries ${uniq('')} Limited`;
    await page.locator('#companyName').fill(company);
    await page.locator('#cin').fill(`U99999TG2026PLC${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`);
    await page.locator('#csrBudget').fill('5000000');
    const companyPan = randomPan('C');
    await page.locator('#gstNumber').fill(`29${companyPan}1Z5`);
    await page.locator('#panNumber').fill(companyPan);
    const saved = page.waitForResponse((r) => r.url().includes('/api/donor/profile') && r.request().method() !== 'GET');
    await page.getByRole('button', { name: 'Save Changes' }).click();
    const res = await saved;
    expect(res.ok(), `profile save → ${res.status()} ${await res.text()}`).toBeTruthy();
    await page.reload();
    await expect(page.getByText('Organisation awaiting verification.')).toBeVisible({ timeout: 30_000 });

    const admin = await as(browser, ADMIN.email, ADMIN.password);
    const found = await ok(await admin.api.post('/api/admin/search', { data: { q: email } }), 'admin search');
    const donorId = found.results.find((r: any) => r.kind === 'Donor')?.id;
    expect(donorId).toBeTruthy();
    await admin.page.goto(`/admin/donors/${donorId}`);
    await admin.page.getByRole('button', { name: 'Verify Organisation' }).click();
    await admin.page.getByPlaceholder(/What did you check to confirm this company exists/).fill('CIN matched on the MCA portal; CSR policy on file (acceptance DON-001).');
    await admin.page.getByRole('button', { name: 'Confirm Verification' }).click();
    await expect(admin.page.getByText(/Organisation verified\. The donor has been notified\.|This organisation is verified\./).first()).toBeVisible({ timeout: 30_000 });
    const manual = admin.page.getByRole('button', { name: 'Verify Manually' });
    if (await manual.isVisible().catch(() => false)) {
      await manual.click();
      await admin.page.getByPlaceholder(/Justification — what did you check/).fill('Company PAN card copy matched the name on the CIN record.');
      await admin.page.getByRole('button', { name: 'Confirm Manual Verification' }).click();
    }
    await page.goto('/donor/profile');
    await expect(page.getByText('Organisation verified.')).toBeVisible();
    await expect(page.getByText(/✅ Verified/)).toBeVisible();
  });

  test('DON-002 CSR owner invites a FINANCE team member; finance can pay but cannot sign or approve', async ({ browser }) => {
    test.setTimeout(6 * 60_000);
    const owner = await as(browser, CSR_OWNER);
    const email = `${uniq('fin')}@example.test`;
    await owner.page.goto('/donor/team');
    await owner.page.locator('#invite-email').fill(email);
    await owner.page.locator('#invite-role').selectOption('FINANCE');
    await owner.page.locator('section[aria-labelledby="invite-h"] button[type="submit"]').click();
    await expect(owner.page.getByText(new RegExp(`${email.replace(/[.]/g, '\\.')} · finance`))).toBeVisible({ timeout: 30_000 });

    const fin = await signUp(browser, 'DONOR', 'Acme Finance', email).catch(async () => {
      const a = sessions.get(email)!;
      return a;
    });
    await owner.page.reload();
    await expect(owner.page.getByText(email).first()).toBeVisible();

    // Finance on an active contract: may record payments, may not e-sign or approve proposals.
    const p = await pipeline(browser, 'accepted');
    await fin.page.goto(`/donor/contracts/${p.contractId}`);
    await expect(fin.page.getByRole('button', { name: '+ Record payment' })).toBeVisible({ timeout: 30_000 });
    const c2 = await pipeline(browser, 'contract');
    expect((await fin.api.post(`/api/contracts/${c2.contractId}/sign`, { data: { signerName: 'Finance', signerTitle: 'Finance' } })).status()).toBe(403);
    const v2 = await pipeline(browser, 'v2');
    expect((await fin.api.post(`/api/requirements/${v2.reqId}/select`, { data: { responseId: v2.responseId } })).status()).toBe(403);
  });

  test('DON-010 donor records a bank transfer with UTR; the NGO bank statement reconciles it; milestones fund', async ({ browser }) => {
    test.setTimeout(6 * 60_000);
    const p = await pipeline(browser, 'accepted');
    const donor = await as(browser, CSR_APPROVER);
    const utr = `TESTUTR${uniq('').toUpperCase()}`.slice(0, 22);
    await donor.page.goto(`/donor/contracts/${p.contractId}`);
    await donor.page.getByRole('button', { name: '+ Record payment' }).click();
    const form = donor.page.locator('form', { has: donor.page.getByRole('button', { name: 'Record payment' }) });
    await form.getByLabel('Payment type').selectOption('MANUAL');
    await form.getByLabel('Amount (₹)').fill('300000');
    await form.getByLabel(/Bank reference/).fill(utr);
    await form.getByRole('button', { name: 'Record payment' }).click();
    await expect(donor.page.getByText(utr).first()).toBeVisible({ timeout: 30_000 });
    await expect(donor.page.getByText('Awaiting NGO confirmation').first()).toBeVisible();

    // NGO finance uploads the bank statement: the credit with that UTR reconciles the payment.
    const fin = await as(browser, NGO_FINANCE);
    await fin.page.goto('/ngo/bank-reconciliation');
    const d = new Date();
    const csv = `Date,Narration,Ref No,Debit,Credit,Balance\n${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()},NEFT CR ACME CSR ${utr},${utr},,"3,00,000.00",0\n`;
    await fin.page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: `stmt-${uniq('')}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(fin.page.getByText(/1 payment reconciled/)).toBeVisible({ timeout: 60_000 });

    await donor.page.reload();
    await expect(donor.page.getByText("Matched on the NGO's bank statement").first()).toBeVisible({ timeout: 30_000 });
    await expect(donor.page.getByText('Fully funded').first()).toBeVisible();
    const schedule = donor.page.locator('table', { has: donor.page.getByRole('columnheader', { name: 'Funding' }) }).first();
    await expect(schedule.getByText('Funded', { exact: true })).toHaveCount(2);
  });

  test('DON-011 donor sees contract, payments summary, receivable schedule and milestone utilisation', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const owner = await as(browser, NGO_OWNER);
    await ok(
      await owner.api.post(`/api/ngo/contracts/${c.contractId}/expenses`, {
        multipart: { idempotencyKey: uniq('expense'), contractMilestoneId: c.milestones![0].id, amount: '60000', category: 'EQUIPMENT', spentOn: isoDay(-2), description: 'Projectors for two classrooms' },
      }),
      'record expense'
    );
    const { page } = await as(browser, CSR_OWNER);
    await page.goto(`/donor/contracts/${c.contractId}`);
    await expect(page.getByText('Committed').first()).toBeVisible();
    await expect(page.getByText('Reconciled').first()).toBeVisible();
    await expect(page.getByText('Receivable schedule by milestone')).toBeVisible();
    await expect(page.getByText('Fully funded').first()).toBeVisible();
    const util = page.locator('section[aria-labelledby="utilisation-h"]');
    await expect(util.getByText('Utilisation of received')).toBeVisible({ timeout: 30_000 });
    await expect(util.getByText('Projectors for two classrooms').first()).toBeVisible();
    await expect(util.getByText(/% of received/)).toBeVisible();
  });

  test('DON-012 milestone completion on a funded project notifies the CSR funder', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const fresh = await freshAksharProject(browser);
    // Pipeline onto the fresh project: the match is chosen by project id.
    const p = await pipeline(browser, 'shortlisted');
    const approver = await as(browser, CSR_APPROVER);
    const run = (await ok(await approver.api.get(`/api/requirements/${p.reqId}/matches`), 'matches')).run;
    const match = run.matches.find((m: any) => m.projectId === fresh.projectId);
    expect(match, 'the fresh project is in the shortlist').toBeTruthy();
    await ok(await approver.api.post(`/api/requirements/${p.reqId}/matches/${match.id}/invite`), 'invite');
    const ngo = await as(browser, NGO_OWNER);
    await ok(await ngo.api.post(`/api/opportunities/${p.reqId}/interest`, { data: { ...PROPOSAL, projectId: fresh.projectId } }), 'proposal');
    const owner = await as(browser, CSR_OWNER);
    const resp = ((await ok(await owner.api.get(`/api/requirements/${p.reqId}/responses`), 'responses')).responses as any[]).find((r) => r.projectId === fresh.projectId || r.project?.id === fresh.projectId) ?? null;
    expect(resp).toBeTruthy();
    await ok(await approver.api.post(`/api/requirements/${p.reqId}/select`, { data: { responseId: resp.id } }), 'select');
    const contract = (
      await ok(
        await owner.api.post('/api/contracts', {
          data: { projectId: fresh.projectId, requirementId: p.reqId, title: `${fresh.title} grant`, totalGrantAmount: '300000', termsAndConditions: 'Per milestone.', milestones: [{ title: 'Equipment installed', allocatedAmount: '150000' }, { title: 'Teachers trained and first assessment', allocatedAmount: '150000' }] },
        }),
        'contract'
      )
    ).contract;
    await ok(await owner.api.post(`/api/contracts/${contract.id}/propose`), 'propose');
    await ok(await approver.api.post(`/api/contracts/${contract.id}/sign`, { data: { signerName: 'Arjun Nair', signerTitle: 'CSR Approver' } }), 'donor sign');
    await ok(await ngo.api.post(`/api/contracts/${contract.id}/sign`, { data: { signerName: 'Akshar Director', signerTitle: 'Director' } }), 'ngo sign');
    await ok(await ngo.api.post(`/api/contracts/${contract.id}/accept`), 'accept');

    // NGO submits milestone proof (approved field photo attached by reference).
    // The owner assigns a milestone task from the project page (milestone 1).
    const taskTitle = `Photograph installed projectors ${uniq('')}`;
    await ngo.page.goto(`/ngo/projects/${fresh.projectId}`);
    await ngo.page.getByRole('button', { name: '+ Assign field task' }).click();
    await ngo.page.getByPlaceholder('e.g. Photograph the completed classroom').fill(taskTitle);
    const assignTo = ngo.page.getByLabel('Assign to');
    await assignTo.selectOption(await userIdOf((await as(browser, NGO_FIELD)).api));
    await ngo.page.locator('form', { has: ngo.page.getByPlaceholder('e.g. Photograph the completed classroom') }).locator('select').nth(1).selectOption({ label: 'Equipment installed' });
    await ngo.page.getByRole('button', { name: 'Assign', exact: true }).click();
    await expect(ngo.page.getByText(taskTitle)).toBeVisible({ timeout: 30_000 });
    const task = ((await ok(await ngo.api.get('/api/ngo/field-tasks'), 'tasks')).tasks as any[]).find((t) => t.title === taskTitle);
    const milestoneId = task.milestoneId ?? task.milestone?.id;
    expect(milestoneId, 'task carries its milestone').toBeTruthy();
    const ev = await apiCapture((await as(browser, NGO_FIELD)).api, task.id);
    await apiApproveEvidence(browser, ev.id);
    await ok(await ngo.api.post('/api/ngo/submit-proof', { multipart: { milestoneId, description: 'Projectors installed and running in all 5 schools.', fieldEvidenceIds: ev.id } }), 'submit proof');

    // Admin approves the proof in the proof-review console.
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto('/admin/proof-review');
    const card = cardWith(admin.page, [fresh.title], admin.page.getByRole('button', { name: 'Approve Proof' }));
    await card.getByRole('button', { name: 'Approve Proof' }).click();
    const modalNote = admin.page.locator('textarea:visible').last();
    if (await modalNote.isVisible().catch(() => false)) await modalNote.fill('Photos show all projectors installed; verified against the field visit.');
    await admin.page.getByRole('button', { name: 'Confirm Approval' }).click();
    await expect(admin.page.getByRole('button', { name: 'Confirm Approval' })).toHaveCount(0, { timeout: 60_000 });

    // The CSR funder is told — in the notification centre.
    await owner.page.goto('/notifications');
    await expect(owner.page.getByText(new RegExp(`"Equipment installed" on "${fresh.title}" has been verified as complete`)).first()).toBeVisible({ timeout: 30_000 });
  });

  test('DON-013 donor impact dashboard shows only approved figures, with the +19 pp change', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const { page, api } = await as(browser, CSR_OWNER);
    await page.goto('/donor/impact-report');
    await expect(page.getByRole('heading', { name: 'Impact report' })).toBeVisible();
    await expect(page.getByText('+19 pp').first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download CSV' })).toBeVisible();
    const csv = await (await api.get('/api/donor/impact-report')).text();
    expect(csv).toMatch(/Learners reading at grade level/);
    expect(csv).toMatch(/Learners reading at grade level,42(\.00)?,PERCENTAGE,.*,verified/);
    expect(csv).toMatch(/Learners reading at grade level,61(\.00)?,PERCENTAGE,.*,verified/);
    void c;
  });

  test('DON-014 consent-safe funder story: only consented beneficiary content is published to the donor', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const fw = await as(browser, NGO_FIELD);
    const t = await assignTask(browser, c.projectId!);
    const noShare = await apiCapture(fw.api, t.id, { feedback: { ref: `BEN-${uniq('')}`.toUpperCase(), record: true, share: false, rating: 4, text: 'Do not quote me, but the classes are good.' } });
    await apiApproveEvidence(browser, noShare.id);

    const { page, api } = await as(browser, NGO_OWNER);
    await page.goto('/ngo/reporting');
    const section = page.locator('section[aria-labelledby="stories-h"]');
    await section.getByLabel(/^Project/).selectOption(c.projectId!);
    const consentFor = (text: string) => section.locator('li').filter({ hasText: text }).filter({ has: page.locator('select') }).last().locator('select');
    await expect(section.getByText(/Donor story would use/)).toBeVisible({ timeout: 120_000 });
    await expect(consentFor('My son now reads')).toBeEnabled({ timeout: 60_000 });
    await consentFor('My son now reads').selectOption('DONOR_ONLY');
    await expect(section.getByText(/Donor story would use [1-9]\d* quote/)).toBeVisible({ timeout: 30_000 });
    const before = ((await (await api.get('/api/ngo/impact-stories')).json()).stories ?? []).map((s: any) => s.id);
    await section.getByRole('button', { name: 'Generate funder story' }).click();
    let story: any;
    await expect
      .poll(async () => {
        const all = ((await (await api.get('/api/ngo/impact-stories')).json()).stories ?? []) as any[];
        story = all.find((s) => !before.includes(s.id) && s.variant === 'DONOR');
        return !!story;
      }, { timeout: 120_000 })
      .toBe(true);
    expect(story.body).not.toContain('Do not quote me');
    await ok(await api.patch(`/api/ngo/impact-stories/${story.id}`, { data: { action: 'SUBMIT' } }), 'submit story');
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await ok(await admin.api.patch(`/api/admin/impact-stories/${story.id}`, { data: { action: 'PUBLISH', note: '' } }), 'publish story');

    const donor = await as(browser, CSR_OWNER);
    await donor.page.goto(`/donor/contracts/${c.contractId}`);
    const stories = donor.page.locator('section[aria-labelledby="donor-stories-h"]');
    await expect(stories.getByText(story.title).first()).toBeVisible({ timeout: 30_000 });
    await expect(stories.getByText('Do not quote me')).toHaveCount(0);
    await expect(stories.getByText(c.feedbackRef)).toHaveCount(0);
  });

  test('DON-015 donor leaves feedback on the funded project updates', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const { page } = await as(browser, CSR_OWNER);
    await page.goto(`/donor/funded/${c.projectId}`);
    await page.getByRole('button', { name: "I'd like more detail" }).click();
    await page.getByPlaceholder(/What would you like to know\?/).fill('Please share attendance by school next quarter.');
    const put = page.waitForResponse((r) => r.url().includes('/api/donor/update-feedback') && r.request().method() === 'PUT' && (r.request().postData() ?? '').includes('attendance'));
    await page.getByRole('button', { name: 'Send note' }).click();
    await expect(page.getByText('Thanks — the organisation sees this without your name.')).toBeVisible({ timeout: 30_000 });
    const body = await (await put).json();
    expect(body.feedback?.signal).toBe('NEED_MORE_DETAIL');
  });

  test('DON-016 from a published impact report the donor asks to renew the grant (re-engagement)', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const report = await publishedReport(browser, c);
    const { page } = await as(browser, CSR_OWNER);
    await page.goto(`/donor/contracts/${c.contractId}`);
    const item = page.locator('section[aria-labelledby="donor-reports-h"] li').filter({ hasText: report.title }).first();
    await expect(item).toBeVisible({ timeout: 30_000 });
    await expect(item.getByText('+19 pp').or(item.getByText(/61/)).first()).toBeVisible();
    await item.getByRole('button', { name: 'Renew this grant' }).click();
    await item.getByPlaceholder('Message to the organisation (optional)').fill('Strong results — we would like to renew for FY27.');
    await item.getByPlaceholder('Indicative amount, ₹ (optional)').fill('400000');
    await item.getByRole('button', { name: 'Send' }).click();
    await expect(item.getByPlaceholder('Message to the organisation (optional)')).toHaveCount(0, { timeout: 30_000 });
    const ngo = await as(browser, NGO_OWNER);
    await ngo.page.goto('/ngo/reporting');
    await expect(ngo.page.locator('section[aria-labelledby="renewal-h"]').getByText('Strong results — we would like to renew for FY27.').first()).toBeVisible();
  });

  test('DON-017 donor views and exports expose no beneficiary PII and no internal risk data', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const { page, api } = await as(browser, CSR_OWNER);
    const forbidden = [c.feedbackRef, 'riskScore', 'fraud', 'aiScore', 'beneficiaryRef', 'RiskReview'];
    for (const url of [`/donor/funded/${c.projectId}`, `/donor/contracts/${c.contractId}`, '/donor/impact-report', '/donor/dashboard']) {
      await page.goto(url);
      const text = await page.locator('body').innerText();
      for (const f of forbidden) expect(text, `${url} must not show ${f}`).not.toContain(f);
    }
    const csv = await (await api.get('/api/donor/impact-report')).text();
    for (const f of forbidden) expect(csv).not.toContain(f);
    // Admin / NGO-internal data is refused outright.
    for (const url of ['/api/admin/field-evidence', '/api/admin/risk/review', '/api/ngo/field-tasks', `/api/ngo/contracts/${c.contractId}/expenses`]) {
      expect([401, 403, 404, 405]).toContain((await api.get(url)).status());
    }
    const photo = await api.get(`/api/field/evidence/${c.evidence[0].id}/photo`);
    expect(photo.status()).toBe(200);
  });

  test('DON-018 donor turns WhatsApp off; the next update is opted out on WhatsApp and delivered in-app', async ({ browser }) => {
    test.setTimeout(8 * 60_000);
    const c = await impactChain(browser);
    const { page } = await as(browser, CSR_OWNER);
    await page.goto('/donor/profile?tab=notifications');
    const wa = page.getByRole('checkbox', { name: /^WhatsApp/ });
    await expect(wa).toBeVisible({ timeout: 30_000 });
    if (await wa.isChecked()) await wa.click();
    await expect(wa).not.toBeChecked({ timeout: 30_000 });
    try {
      // Something worth telling the funder: a new approved field photo on their project.
      const t = await assignTask(browser, c.projectId!);
      const ev = await apiCapture((await as(browser, NGO_FIELD)).api, t.id);
      const since = Date.now() - 5_000;
      await apiApproveEvidence(browser, ev.id);
      await page.reload();
      const list = page.locator('li').filter({ hasText: 'New verified field update' });
      await expect(list.filter({ hasText: 'WhatsApp' }).filter({ hasText: 'Opted out' }).first()).toBeVisible({ timeout: 30_000 });
      await expect(list.filter({ hasText: 'In-app' }).filter({ hasText: 'Sent' }).first()).toBeVisible();
      void since;
    } finally {
      await page.goto('/donor/profile?tab=notifications');
      const wa2 = page.getByRole('checkbox', { name: /^WhatsApp/ });
      await wa2.waitFor();
      if (!(await wa2.isChecked())) {
        await wa2.click();
        await expect(wa2).toBeChecked({ timeout: 30_000 });
      }
    }
  });
});

// ─── UI step helpers shared by the cross-portal journeys ────────────────────
/** Opens a report's detail in the NGO reports panel (a freshly saved report may already be open). */
async function openReportDetail(panel: ReturnType<Page['locator']>, title: string) {
  const detail = panel.getByText(/Approved claims that will be included|Figures/).first();
  await expect(panel.getByRole('button', { name: title })).toBeVisible({ timeout: 30_000 });
  // Saving opens the new report and loads its detail; only click if that did not happen.
  try {
    await expect(detail).toBeVisible({ timeout: 8_000 });
  } catch {
    await panel.getByRole('button', { name: title }).click();
    await expect(detail).toBeVisible({ timeout: 30_000 });
  }
}
async function uiSubmitRequirementForAdmin(page: Page) {
  // Rule-based extraction may raise warnings the donor must confirm (with a note) before submitting.
  const confirmBtn = page.getByRole('button', { name: 'Confirm…' }).filter({ visible: true });
  for (let i = 0; i < 5 && (await confirmBtn.count()) > 0; i++) {
    await confirmBtn.first().click({ force: true });
    await page.locator('textarea[id^="flag-note-"]').fill('Checked against the RFP document; the extracted values are correct.');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.locator('textarea[id^="flag-note-"]')).toHaveCount(0, { timeout: 30_000 });
  }
  await page.getByRole('button', { name: 'Submit for Admin Verification' }).click();
  await expect(page.getByText(/Awaiting admin verification/)).toBeVisible({ timeout: 30_000 });
}
async function uiAdminApproveRequirement(admin: Page, reqId: string) {
  await admin.goto(`/admin/requirements/${reqId}`);
  await admin.getByRole('button', { name: 'Approve Requirement' }).click();
  await admin.getByPlaceholder('Optional note for the record').fill('Requirement complete and consistent (acceptance).');
  await admin.getByRole('button', { name: 'Confirm approval' }).click();
  await expect(admin.getByText('Requirement validated. It can now enter matching.')).toBeVisible({ timeout: 30_000 });
}
async function uiAdminApproveShortlist(admin: Page, reqId: string) {
  await admin.goto(`/admin/requirements/${reqId}`);
  await admin.getByRole('button', { name: /^matches$/i }).click();
  for (let attempt = 1; ; attempt++) {
    await expect(admin.getByText('Approve the shortlist before NGOs are invited')).toBeVisible({ timeout: 30_000 });
    await admin.getByRole('button', { name: /^Approve shortlist \(/ }).click();
    await expect(admin.getByRole('button', { name: /^Approve shortlist \(/ })).toHaveCount(0, { timeout: 30_000 });
    const run = (await (await admin.request.get(`/api/requirements/${reqId}/matches`)).json()).run;
    if (run?.reviewStatus === 'APPROVED' || attempt >= 3) {
      expect(run?.reviewStatus, 'shortlist approved').toBe('APPROVED');
      break;
    }
    // A newer matching run superseded the one on screen: review the latest.
    await admin.goto(`/admin/requirements/${reqId}`);
    await admin.getByRole('button', { name: /^matches$/i }).click();
  }
}
async function uiInvite(page: Page, reqId: string, projectTitle: RegExp | string) {
  await page.goto(`/donor/requirements/${reqId}?tab=matches`);
  await expect(page.getByText(/An admin has approved your shortlist/)).toBeVisible({ timeout: 30_000 });
  const card = cardWith(page, [projectTitle], page.getByRole('button', { name: 'Invite to respond' }));
  await card.getByRole('button', { name: 'Invite to respond' }).click();
  await expect(cardWith(page, [projectTitle], page.getByText(/✓ Brief shared/)).getByText(/✓ Brief shared/).first()).toBeVisible({ timeout: 30_000 });
}
async function uiNgoPropose(page: Page, reqId: string, projectId: string | null, outcomes: string) {
  await page.goto(`/ngo/opportunities/${reqId}`);
  const form = page.locator('form#respond');
  if (projectId) await form.getByLabel(/^Project/).selectOption(projectId);
  await form.getByLabel('Proposed budget (₹)').fill('300000');
  await form.getByLabel('Duration (months)').fill('12');
  await form.getByLabel('Implementation plan').fill('Install projectors in 5 schools, train 20 teachers, assess learning each term.');
  await form.getByLabel('Expected outcomes').fill(outcomes);
  if ((await form.getByPlaceholder('Amount ₹').count()) === 0) {
    while ((await form.getByPlaceholder('Amount ₹').count()) < 2) await form.getByRole('button', { name: '+ Add milestone' }).click();
    await form.getByPlaceholder('Milestone 1').fill('Equipment installed');
    await form.getByPlaceholder('Amount ₹').nth(0).fill('150000');
    await form.getByPlaceholder('Months').nth(0).fill('3');
    await form.getByPlaceholder('Milestone 2').fill('Teachers trained and first assessment');
    await form.getByPlaceholder('Amount ₹').nth(1).fill('150000');
    await form.getByPlaceholder('Months').nth(1).fill('9');
  }
  await form.getByRole('button', { name: /^(Submit|Submit revision|Update response)$/ }).click();
  await expect(page.getByText(/Your response:/)).toBeVisible({ timeout: 30_000 });
}
async function uiRequestChanges(page: Page, reqId: string, note: string) {
  await page.goto(`/donor/requirements/${reqId}?tab=responses`);
  await page.getByRole('button', { name: /NGO responses/ }).click();
  await page.getByRole('button', { name: 'Request changes' }).first().click();
  await page.locator('textarea[id^="change-note-"]').fill(note);
  await page.getByRole('button', { name: 'Send change request' }).click();
  await expect(page.getByText(/back with the organisation for changes/)).toBeVisible({ timeout: 30_000 });
}
async function uiApproveProposal(page: Page, reqId: string, version: number) {
  await page.goto(`/donor/requirements/${reqId}?tab=responses`);
  await page.getByRole('button', { name: /NGO responses/ }).click();
  await page.getByRole('button', { name: /Compare versions side by side/ }).first().click();
  await expect(page.getByText(/\d+ of \d+ fields changed/).first()).toBeVisible();
  await page.getByRole('button', { name: `Approve proposal V${version}` }).click();
  await expect(page.getByText('Proposal Approved — Ready for Contracting', { exact: true })).toBeVisible({ timeout: 30_000 });
}
async function uiInitiateContract(page: Page, reqId: string) {
  await page.goto(`/donor/requirements/${reqId}`);
  await page.getByRole('link', { name: 'Initiate Contract' }).click();
  await page.waitForURL(/\/donor\/contracts\/new/);
  const title = page.getByPlaceholder(/FY2026 CSR Grant Agreement/);
  if (!(await title.inputValue())) await title.fill(`CSR grant ${uniq('')}`);
  await page.getByRole('button', { name: 'Propose Agreement to NGO →' }).click();
  await page.waitForURL(/\/donor\/contracts\/[0-9a-f-]{36}$/, { timeout: 60_000 });
  return page.url().match(/contracts\/([0-9a-f-]{36})/)![1];
}
async function uiRecordUtrPayment(page: Page, contractId: string, amount: string, utr: string) {
  await page.goto(`/donor/contracts/${contractId}`);
  await page.getByRole('button', { name: '+ Record payment' }).click();
  const form = page.locator('form', { has: page.getByRole('button', { name: 'Record payment' }) });
  await form.getByLabel('Payment type').selectOption('MANUAL');
  await form.getByLabel('Amount (₹)').fill(amount);
  await form.getByLabel(/Bank reference/).fill(utr);
  await form.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByText(utr).first()).toBeVisible({ timeout: 30_000 });
}
async function uiUploadStatement(page: Page, utr: string, amountInr: string) {
  await page.goto('/ngo/bank-reconciliation');
  const d = new Date();
  const csv = `Date,Narration,Ref No,Debit,Credit,Balance\n${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()},NEFT CR CSR ${utr},${utr},,"${amountInr}",0\n`;
  await page.locator('input[type="file"][accept=".csv,text/csv"]').setInputFiles({ name: `stmt-${uniq('')}.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await expect(page.getByText(/1 payment reconciled/)).toBeVisible({ timeout: 60_000 });
}
async function uiAdminApproveAllocations(admin: Page, utr: string) {
  await admin.goto('/admin/allocations');
  const rows = admin.locator('tr').filter({ hasText: utr }).filter({ has: admin.getByRole('button', { name: 'Approve', exact: true }) });
  await expect(rows.first()).toBeVisible({ timeout: 30_000 });
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    await admin.locator('tr').filter({ hasText: utr }).filter({ has: admin.getByRole('button', { name: 'Approve', exact: true }) }).first().getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(admin.locator('tr').filter({ hasText: utr }).filter({ has: admin.getByRole('button', { name: 'Approve', exact: true }) })).toHaveCount(n - i - 1, { timeout: 30_000 });
  }
}
const newUtr = () => `UTR${uniq('').toUpperCase()}`.slice(0, 20);

// ═══════════════════════════════════════════════════════════════════════════
// CROSS-PORTAL
// ═══════════════════════════════════════════════════════════════════════════
test.describe('Cross-portal E2E', () => {
  test('E2E-001 NGO onboarding: wrong certificate flagged and approval refused → documents replaced → clean → verified', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const email = `${uniq('jjrt')}@example.test`;
    const orgName = `Jeevan Jyoti Rural Development Trust ${uniq('')}`;
    const regNo = `TEST-TRUST-TG-${uniq('')}`.toUpperCase();
    const pan = randomPan();
    const ngo = await signUp(browser, 'NGO', 'JJRT Director', email);
    await fillNgoForm(ngo.page, { orgName, regNo, pan });
    const wrong = ngoDocs(orgName, regNo, pan, 'Sri Lakshmi Welfare Society');
    await setNgoFiles(ngo.page, wrong);
    await submitNgoForm(ngo.page);

    const admin = await as(browser, ADMIN.email, ADMIN.password);
    const row = await waitForQueueVerdict(admin.page, orgName, /AT RISK|CANNOT APPROVE YET/);
    await expect(row.getByText('Approve blocked')).toBeVisible();
    await expect(row.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);

    // The NGO replaces its documents from the dashboard; the form comes back prefilled.
    await ngo.page.goto('/ngo/dashboard');
    await ngo.page.getByRole('link', { name: 'Replace your documents' }).click();
    await ngo.page.waitForURL(/\/ngo\/register/);
    await expect(ngo.page.locator('input[placeholder="e.g. Hope Foundation"]')).toHaveValue(orgName, { timeout: 30_000 });
    const right = ngoDocs(orgName, regNo, pan);
    await setNgoFiles(ngo.page, right);
    await submitNgoForm(ngo.page);

    await adminApproveNgo(admin.page, orgName);
    await expectVerifiedDashboard(ngo.page);
  });

  test('E2E-002 RFP upload → extraction → admin validation → matching → admin shortlist approval → invite; FCRA variant excludes', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const owner = await as(browser, CSR_OWNER);
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    const reqId = await uploadRfp(owner.page, RFP_LINES(`RFP journey ${uniq('')}`));
    await expect(owner.page.locator('#field-state')).toHaveValue(/Karnataka/);
    await uiSubmitRequirementForAdmin(owner.page);
    await uiAdminApproveRequirement(admin.page, reqId);
    await owner.page.goto(`/donor/requirements/${reqId}`);
    await owner.page.getByRole('button', { name: 'Find Matches' }).click();
    await expect(owner.page.getByText(/awaiting admin approval/)).toBeVisible({ timeout: 60_000 });
    await uiAdminApproveShortlist(admin.page, reqId);
    await uiInvite(owner.page, reqId, /Akshar/);

    // FCRA-required variant.
    const fcraId = await uploadRfp(owner.page, RFP_LINES(`RFP FCRA ${uniq('')}`).map((l) => (l.startsWith('FCRA') ? 'FCRA registration required: Yes' : l)));
    await expect(owner.page.locator('#field-fcraRequired')).toHaveValue('true');
    await uiSubmitRequirementForAdmin(owner.page);
    await uiAdminApproveRequirement(admin.page, fcraId);
    await owner.page.goto(`/donor/requirements/${fcraId}`);
    await owner.page.getByRole('button', { name: 'Find Matches' }).click();
    await expect(owner.page.getByText(/awaiting admin approval|No eligible NGO projects/).first()).toBeVisible({ timeout: 60_000 });
    await owner.page.goto(`/donor/requirements/${fcraId}?tab=matches`);
    await owner.page.getByRole('button', { name: /excluded — see why/ }).click();
    await expect(owner.page.getByText(/FCRA/).first()).toBeVisible();
  });

  test('E2E-003 proposal v1 → change request → v2 → donor approval → contract proposed, version history intact', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const p = await pipeline(browser, 'invited');
    const ngo = await as(browser, NGO_OWNER);
    const donor = await as(browser, CSR_APPROVER);
    const owner = await as(browser, CSR_OWNER);
    await uiNgoPropose(ngo.page, p.reqId, p.projectId!, '1,200 students using digital lessons weekly.');
    await uiRequestChanges(owner.page, p.reqId, 'Please add an attendance KPI and quarterly progress reports.');
    await ngo.page.goto(`/ngo/opportunities/${p.reqId}`);
    await ngo.page.locator('form#respond').getByLabel('Expected outcomes').fill('1,200 students weekly; attendance tracked; quarterly reports.');
    await ngo.page.getByRole('button', { name: 'Submit revision' }).click();
    await expect(ngo.page.getByText(/· V2/)).toBeVisible({ timeout: 30_000 });
    await uiApproveProposal(donor.page, p.reqId, 2);
    const contractId = await uiInitiateContract(owner.page, p.reqId);
    await expect(owner.page.getByText(/Signature pending/).first()).toBeVisible();
    await ngo.page.goto(`/ngo/opportunities/${p.reqId}`);
    await expect(ngo.page.getByText(/The sponsor approved your proposal V2/)).toBeVisible();
    const c = await ok(await owner.api.get(`/api/contracts/${contractId}`), 'contract');
    expect((c.contract ?? c).status).toBe('PROPOSED');
  });

  test('E2E-004 contract → UTR payment → bank reconciliation → admin allocation approval → milestones FUNDED', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const p = await pipeline(browser, 'accepted');
    const donor = await as(browser, CSR_APPROVER);
    const utr = newUtr();
    await uiRecordUtrPayment(donor.page, p.contractId!, '300000', utr);
    await uiUploadStatement((await as(browser, NGO_FINANCE)).page, utr, '3,00,000.00');
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await uiAdminApproveAllocations(admin.page, utr);
    await donor.page.goto(`/donor/contracts/${p.contractId}`);
    const schedule = donor.page.locator('table', { has: donor.page.getByRole('columnheader', { name: 'Allocated (approved)' }) }).first();
    await expect(schedule.getByText('Funded', { exact: true })).toHaveCount(2);
    await expect(schedule.getByRole('cell', { name: '₹1,50,000' }).first()).toBeVisible();
    await expect(donor.page.getByText(/Contract FUNDED on/).first()).toBeVisible();
  });

  test('E2E-005 money → work → field evidence → admin approval → donor-safe update', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const p = await fundedContract(browser);
    const task = await assignTask(browser, p.projectId!);
    const fw = await fieldPhone(browser, SITE);
    await captureInFieldApp(fw.page, task.title, photoSeed(), { note: 'Projector running in class 7.' });
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    const [ev] = await evidenceForTask(browser, task.id);
    const donor = await as(browser, CSR_OWNER);
    expect((await donor.api.get(`/api/field/evidence/${ev.id}/photo`)).status(), 'not visible before review').toBe(404);
    await adminApproveEvidence(browser, task.title);
    await donor.page.goto(`/donor/funded/${p.projectId}`);
    await expect(donor.page.getByRole('img', { name: task.title })).toBeVisible({ timeout: 30_000 });
    expect((await donor.api.get(`/api/field/evidence/${ev.id}/photo`)).status()).toBe(200);
    const other = await as(browser, 'priya.sharma@demo.com');
    expect((await other.api.get(`/api/field/evidence/${ev.id}/photo`)).status(), 'another donor cannot see it').toBe(404);
  });

  test('E2E-006 evidence → outcome claims approved → NGO report published → donor sees +19 pp', async ({ browser }) => {
    test.setTimeout(10 * 60_000);
    const p = await fundedContract(browser);
    const fw = await as(browser, NGO_FIELD);
    const t1 = await assignTask(browser, p.projectId!);
    const t2 = await assignTask(browser, p.projectId!);
    const e1 = await apiCapture(fw.api, t1.id);
    const e2 = await apiCapture(fw.api, t2.id);
    await adminApproveEvidence(browser, t1.title);
    await adminApproveEvidence(browser, t2.title);
    const base = await fileClaim(browser, p.projectId!, '42', isoDay(-120), isoDay(-90), e1.id);
    const end = await fileClaim(browser, p.projectId!, '61', isoDay(-30), isoDay(0), e2.id);
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    for (const m of [base.method, end.method]) {
      await admin.page.goto('/admin/impact-review');
      const card = cardWith(admin.page, [m], admin.page.getByRole('button', { name: /^Approve/ }));
      await card.getByRole('button', { name: /^Approve/ }).click();
      await expect(admin.page.getByText(m)).toHaveCount(0, { timeout: 30_000 });
    }
    const ngo = await as(browser, NGO_OWNER);
    await ngo.page.goto(`/ngo/contracts/${p.contractId}`);
    const panel = ngo.page.locator('section[aria-labelledby="ngo-reports-h"]');
    await panel.getByRole('button', { name: 'New report' }).click();
    const title = `Outcome report ${uniq('')}`;
    await panel.getByLabel('Title').fill(title);
    await panel.getByLabel('Period start').fill(isoDay(-150));
    await panel.getByLabel('Period end').fill(isoDay(0));
    await panel.getByLabel('Summary (your narrative)').fill('Reading at grade level: 42% → 61%.');
    await panel.getByRole('button', { name: 'Save draft' }).click();
    await openReportDetail(panel, title);
    await panel.getByRole('button', { name: 'Submit for review' }).click();
    await admin.page.goto('/admin/impact-publishing');
    await cardWith(admin.page, [title], admin.page.getByRole('button', { name: 'Publish to funder' })).getByRole('button', { name: 'Publish to funder' }).click();
    await expect(admin.page.getByText(title)).toHaveCount(0, { timeout: 30_000 });
    const donor = await as(browser, CSR_OWNER);
    await donor.page.goto(`/donor/contracts/${p.contractId}`);
    await expect(donor.page.locator('section[aria-labelledby="donor-reports-h"]').getByText(title)).toBeVisible({ timeout: 30_000 });
    await donor.page.goto('/donor/impact-report');
    await expect(donor.page.getByText('+19 pp').first()).toBeVisible();
  });

  test('E2E-007 grievance resolved, beneficiary feedback captured, donor feedback given, re-engagement started', async ({ browser }) => {
    test.setTimeout(12 * 60_000);
    const c = await impactChain(browser);
    // Beneficiary feedback from the field app.
    const task = await assignTask(browser, c.projectId!);
    const fw = await fieldPhone(browser, SITE);
    await captureInFieldApp(fw.page, task.title, photoSeed(), { feedback: { ref: `BEN-${uniq('')}`.toUpperCase(), record: true, share: true, rating: '5', text: 'Teachers now use the projector daily.' } });
    await expect(fw.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
    // Grievance by the donor about the project, resolved by an admin.
    const donor = await as(browser, CSR_OWNER);
    await donor.page.goto('/report-concern');
    const form = donor.page.locator('form');
    const orgOpt = form.locator('select').nth(0).locator('option', { hasText: 'Akshar' }).first();
    await form.locator('select').nth(0).selectOption((await orgOpt.getAttribute('value'))!);
    const subject = `Unclear milestone photos ${uniq('')}`;
    await form.getByPlaceholder('e.g. Milestone reported complete but no work was done').fill(subject);
    await form.locator('textarea').fill('Some milestone photos do not show the school name board.');
    await form.locator('button[type="submit"]').click();
    const ref = (await donor.page.getByText(/Reference:/).innerText()).replace('Reference:', '').trim();
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    await admin.page.goto(`/admin/grievances/${ref}`);
    await admin.page.getByRole('button', { name: 'LOW', exact: true }).click();
    await admin.page.getByRole('button', { name: 'Triage' }).click();
    await admin.page.getByRole('button', { name: 'Start investigating' }).click();
    await admin.page.getByRole('button', { name: 'Resolve' }).click();
    await admin.page.locator('textarea').last().fill('NGO re-shared photos showing the name board; donor informed.');
    await admin.page.getByRole('button', { name: 'Confirm resolution' }).click();
    await expect(admin.page.getByText(/RESOLVED|Resolved/).first()).toBeVisible({ timeout: 30_000 });
    // Donor feedback and re-engagement.
    await donor.page.goto(`/donor/funded/${c.projectId}`);
    await donor.page.getByRole('button', { name: 'Helpful', exact: true }).click();
    await expect(donor.page.getByText('Thanks — the organisation sees this without your name.')).toBeVisible({ timeout: 30_000 });
    const report = await publishedReport(browser, c);
    await donor.page.goto(`/donor/contracts/${c.contractId}`);
    const item = donor.page.locator('section[aria-labelledby="donor-reports-h"] li').filter({ hasText: report.title }).first();
    await item.getByRole('button', { name: 'Ask about next opportunity' }).click();
    await item.getByPlaceholder('Message to the organisation (optional)').fill('Could this extend to Mandya district?');
    await item.getByRole('button', { name: 'Send' }).click();
    await expect(item.getByText('Next opportunity').first()).toBeVisible({ timeout: 30_000 });
  });
});

/** The milestone deadline picker is a button + calendar: open it, go two months ahead, pick the 15th. */
async function pickDeadline(page: Page) {
  const trigger = page.getByRole('button', { name: 'Select deadline' }).first();
  await trigger.click();
  const popup = trigger.locator('xpath=following-sibling::div[1]');
  await popup.locator('button').nth(1).click();
  await popup.locator('button').nth(1).click();
  await popup.getByRole('button', { name: '15', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select deadline' })).toHaveCount(0);
}

async function uiCreateProject(page: Page, title: string) {
  await page.goto('/ngo/projects/new');
  await page.getByPlaceholder('e.g. Clean Water for Dharavi').fill(title);
  const cause = page.locator('select').first();
  const edu = cause.locator('option', { hasText: 'Education' }).first();
  await cause.selectOption((await edu.getAttribute('value')) ?? { index: 1 } as any);
  await page.getByPlaceholder('e.g. 50000', { exact: true }).fill('300000');
  await page.getByPlaceholder('e.g. Dharavi, Mumbai').fill('Mysuru, Karnataka');
  await page.getByPlaceholder(/Describe the scope, objectives/).fill('Digital classrooms and teacher training in 5 government schools of Mysuru district.');
  await page.locator('input[type="file"][accept="image/*"]').setInputFiles(pngFile(photoSeed()));
  await page.getByPlaceholder('e.g. 12', { exact: true }).fill('12');
  await page.getByPlaceholder('e.g. 500', { exact: true }).fill('1000');
  await page.getByPlaceholder('e.g. Attendance Rate, Literacy Score').fill('Students using digital lessons weekly, Learners reading at grade level');
  await page.getByPlaceholder('e.g. Purchase 500 textbooks').first().fill('Classrooms equipped and teachers trained');
  await page.getByPlaceholder('e.g. 15000').first().fill('300000');
  await pickDeadline(page);
  await page.getByPlaceholder(/Buy and distribute physical textbooks/).first().fill('Install projectors and train teachers in each school.');
  await page.getByRole('button', { name: 'Publish Project & Milestones' }).click();
  await expect
    .poll(async () => ((await (await page.request.get('/api/ngo/projects')).json()).projects as any[] ?? []).some((x) => x.title === title), { timeout: 60_000 })
    .toBe(true);
}

async function uiFileClaim(page: Page, projectId: string, value: string, from: string, to: string, method: string, evidenceTaskTitle: string) {
  await page.goto('/ngo/impact');
  // Claim cards are identified by their period: move the start until no existing card shares it.
  const range = (f: string) => `${new Date(f).toLocaleDateString('en-IN')} – ${new Date(to).toLocaleDateString('en-IN')}`;
  await expect(page.getByRole('button', { name: 'Report an outcome' })).toBeVisible({ timeout: 30_000 });
  for (let i = 0; i < 30 && (await page.getByText(range(from)).count()) > 0; i++) from = new Date(new Date(from).getTime() - DAY).toISOString().slice(0, 10);
  await page.getByRole('button', { name: 'Report an outcome' }).click();
  await page.getByLabel(/^Project/).selectOption(projectId);
  await page.getByLabel(/^Metric/).selectOption(LITERACY);
  await page.getByLabel(/^Value/).fill(value);
  await page.getByLabel(/^From/).fill(from);
  await page.getByLabel(/^To\b/).fill(to);
  await page.getByLabel('How you arrived at the number').fill(method);
  await page.locator('label', { hasText: evidenceTaskTitle }).locator('input[type="checkbox"]').check();
  const created = page.waitForResponse((r) => /\/api\/ngo\/outcome-claims$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save as draft' }).click();
  const claimId = (await (await created).json()).claim?.id as string;
  expect(claimId, 'claim saved').toBeTruthy();
  // Cards show value + period, so the (randomised) period identifies this run's draft.
  const card = cardWith(
    page,
    [`${new Date(from).toLocaleDateString('en-IN')} – ${new Date(to).toLocaleDateString('en-IN')}`, new RegExp(value)],
    page.getByRole('button', { name: 'Submit for review' })
  );
  const submitted = page.waitForResponse((r) => /\/api\/ngo\/outcome-claims\/[^/]+$/.test(r.url()) && r.request().method() === 'PATCH');
  await card.getByRole('button', { name: 'Submit for review' }).click();
  const sres = await submitted;
  expect(sres.url(), 'submitted the claim just saved').toContain(claimId);
  expect(sres.ok(), `submit claim → ${sres.status()}`).toBeTruthy();
  return claimId;
}

async function uiAdminApproveClaim(admin: Page, method: string) {
  await admin.goto('/admin/impact-review');
  const card = cardWith(admin, [method], admin.getByRole('button', { name: /^Approve/ }));
  await card.getByRole('button', { name: /^Approve/ }).click();
  await expect(admin.getByText(method)).toHaveCount(0, { timeout: 30_000 });
}

test.describe('Cross-portal pilot journey', () => {
  test('E2E-008 uninterrupted pilot journey through the UI: verification → RFP → match → proposal → contract → payment → FUNDED → evidence → outcome → report → feedback', async ({ browser }) => {
    test.setTimeout(45 * 60_000);
    const admin = await as(browser, ADMIN.email, ADMIN.password);
    const csr = await as(browser, CSR_OWNER);
    const approver = await as(browser, CSR_APPROVER);

    // 1 ── A new NGO registers and is verified.
    const email = `${uniq('pilot')}@example.test`;
    const orgName = `Pilot Learning Trust ${uniq('')}`;
    const regNo = `TEST-TRUST-KA-${uniq('')}`.toUpperCase();
    const pan = randomPan();
    const ngo = await signUp(browser, 'NGO', 'Pilot Director', email);
    await fillNgoForm(ngo.page, { orgName, regNo, pan });
    await setNgoFiles(ngo.page, ngoDocs(orgName, regNo, pan));
    await submitNgoForm(ngo.page);
    await adminApproveNgo(admin.page, orgName);
    await expectVerifiedDashboard(ngo.page);

    // 2 ── It publishes a project; an admin approves it.
    const projectTitle = `Pilot digital classrooms ${uniq('')}`;
    await uiCreateProject(ngo.page, projectTitle);
    await admin.page.goto('/admin/project-review');
    await cardWith(admin.page, [projectTitle], admin.page.getByRole('button', { name: 'Approve & Publish' })).getByRole('button', { name: 'Approve & Publish' }).click();
    await expect(cardWith(admin.page, [projectTitle]).getByRole('button', { name: 'Approve & Publish' })).toHaveCount(0, { timeout: 30_000 });

    // 3 ── The CSR uploads an RFP; admin validates; matching; admin approves the shortlist; CSR invites the new NGO.
    const reqId = await uploadRfp(csr.page, RFP_LINES(`Pilot RFP ${uniq('')}`));
    await uiSubmitRequirementForAdmin(csr.page);
    await uiAdminApproveRequirement(admin.page, reqId);
    await csr.page.goto(`/donor/requirements/${reqId}`);
    await csr.page.getByRole('button', { name: 'Find Matches' }).click();
    await expect(csr.page.getByText(/awaiting admin approval/)).toBeVisible({ timeout: 60_000 });
    await uiAdminApproveShortlist(admin.page, reqId);
    await uiInvite(csr.page, reqId, projectTitle);

    // 4 ── Proposal v1 → change request → v2 → approval → contract → both e-sign → NGO accepts.
    await ngo.page.goto('/ngo/match-inbox');
    await ngo.page.locator(`a[href^="/ngo/opportunities/${reqId}"]`).first().click();
    await uiNgoPropose(ngo.page, reqId, null, '1,000 students using digital lessons weekly.');
    await uiRequestChanges(csr.page, reqId, 'Please add a reading-level outcome and quarterly reports.');
    await ngo.page.goto(`/ngo/opportunities/${reqId}`);
    await ngo.page.locator('form#respond').getByLabel('Expected outcomes').fill('Learners reading at grade level rise from 42% to 61%; quarterly reports.');
    await ngo.page.getByRole('button', { name: 'Submit revision' }).click();
    await expect(ngo.page.getByText(/· V2/)).toBeVisible({ timeout: 30_000 });
    await uiApproveProposal(approver.page, reqId, 2);
    const contractId = await uiInitiateContract(csr.page, reqId);
    await approver.page.goto(`/donor/contracts/${contractId}`);
    await eSign(approver.page, 'Arjun Nair', 'CSR Approver');
    await expect(approver.page.getByText(/Signature pending from NGO Authorized Signatory/)).toBeVisible({ timeout: 30_000 });
    await ngo.page.goto(`/ngo/contracts/${contractId}`);
    await eSign(ngo.page, 'Pilot Director', 'Managing Trustee');
    await ngo.page.getByRole('button', { name: 'Accept funded project' }).click();
    await expect(ngo.page.getByText(/✓ Accepted by the NGO/)).toBeVisible({ timeout: 30_000 });

    // 5 ── Payment by bank transfer → NGO bank statement reconciles it → admin approves allocation → FUNDED.
    const utr = newUtr();
    await uiRecordUtrPayment(approver.page, contractId, '300000', utr);
    await uiUploadStatement(ngo.page, utr, '3,00,000.00');
    await uiAdminApproveAllocations(admin.page, utr);
    await csr.page.goto(`/donor/contracts/${contractId}`);
    await expect(csr.page.getByText(/Contract FUNDED on/).first()).toBeVisible({ timeout: 30_000 });
    const schedule = csr.page.locator('table', { has: csr.page.getByRole('columnheader', { name: 'Allocated (approved)' }) }).first();
    await expect(schedule.getByText('Funded', { exact: true }).first()).toBeVisible();
    await expect(schedule.getByText(/Unfunded|Partially funded/)).toHaveCount(0);

    // 6 ── Field evidence: the NGO assigns two tasks, captures photos in the field app, admin approves.
    const projectId = (await ok(await ngo.api.get(`/api/contracts/${contractId}`), 'contract')).contract?.projectId ?? (await ok(await ngo.api.get(`/api/contracts/${contractId}`), 'contract')).projectId;
    const taskTitles = [`Baseline reading assessment ${uniq('')}`, `Endline reading assessment ${uniq('')}`];
    for (const t of taskTitles) {
      await ngo.page.goto(`/ngo/projects/${projectId}`);
      await ngo.page.getByRole('button', { name: '+ Assign field task' }).click();
      await ngo.page.getByPlaceholder('e.g. Photograph the completed classroom').fill(t);
      await ngo.page.getByRole('button', { name: 'Assign', exact: true }).click();
      await expect(ngo.page.getByText(t)).toBeVisible({ timeout: 30_000 });
    }
    await ngo.ctx.grantPermissions(['geolocation'], { origin: BASE });
    await ngo.ctx.setGeolocation({ latitude: 12.2958, longitude: 76.6394, accuracy: 15 });
    for (const t of taskTitles) {
      await captureInFieldApp(ngo.page, t, photoSeed(), { note: `${t} — sheet photographed.` });
      await expect(ngo.page.getByText(/Synced 1 capture\./)).toBeVisible({ timeout: 60_000 });
      await adminApproveEvidence(browser, t);
    }
    await csr.page.goto(`/donor/funded/${projectId}`);
    await expect(csr.page.getByRole('img', { name: taskTitles[0] })).toBeVisible({ timeout: 30_000 });

    // 7 ── Outcome: baseline 42% and endline 61% filed in the cockpit, approved by the impact reviewer.
    const mBase = `Baseline assessment of 400 learners ${uniq('')}.`;
    const mEnd = `Endline assessment of 400 learners ${uniq('')}.`;
    const r = Math.floor(Math.random() * 25);
    await uiFileClaim(ngo.page, projectId, '42', isoDay(-150 + r), isoDay(-100), mBase, taskTitles[0]);
    await uiFileClaim(ngo.page, projectId, '61', isoDay(-60 + r), isoDay(0), mEnd, taskTitles[1]);
    await uiAdminApproveClaim(admin.page, mBase);
    await uiAdminApproveClaim(admin.page, mEnd);
    await ngo.page.goto('/ngo/impact/report');
    await expect(ngo.page.locator('article').filter({ hasText: projectTitle }).getByText('+19 pp')).toBeVisible();

    // 8 ── Donor report: NGO writes it, admin publishes, donor reads +19 pp.
    await ngo.page.goto(`/ngo/contracts/${contractId}`);
    const panel = ngo.page.locator('section[aria-labelledby="ngo-reports-h"]');
    await panel.getByRole('button', { name: 'New report' }).click();
    const reportTitle = `Pilot impact report ${uniq('')}`;
    await panel.getByLabel('Title').fill(reportTitle);
    await panel.getByLabel('Period start').fill(isoDay(-150));
    await panel.getByLabel('Period end').fill(isoDay(0));
    await panel.getByLabel('Summary (your narrative)').fill('Learners reading at grade level rose from 42% to 61%.');
    await panel.getByRole('button', { name: 'Save draft' }).click();
    await openReportDetail(panel, reportTitle);
    await panel.getByRole('button', { name: 'Submit for review' }).click();
    await admin.page.goto('/admin/impact-publishing');
    await cardWith(admin.page, [reportTitle], admin.page.getByRole('button', { name: 'Publish to funder' })).getByRole('button', { name: 'Publish to funder' }).click();
    await expect(admin.page.getByText(reportTitle)).toHaveCount(0, { timeout: 30_000 });
    await csr.page.goto('/donor/impact-report');
    await expect(csr.page.locator('article, section, div').filter({ hasText: projectTitle }).getByText('+19 pp').first()).toBeVisible();

    // 9 ── Feedback and re-engagement.
    await csr.page.goto(`/donor/funded/${projectId}`);
    await csr.page.getByRole('button', { name: 'Helpful', exact: true }).click();
    await expect(csr.page.getByText('Thanks — the organisation sees this without your name.')).toBeVisible({ timeout: 30_000 });
    await csr.page.goto(`/donor/contracts/${contractId}`);
    const item = csr.page.locator('section[aria-labelledby="donor-reports-h"] li').filter({ hasText: reportTitle }).first();
    await item.getByRole('button', { name: 'Renew this grant' }).click();
    await item.getByPlaceholder('Message to the organisation (optional)').fill('Excellent results — let us renew for a second year.');
    await item.getByRole('button', { name: 'Send' }).click();
    await expect(item.getByText('Renewal').first()).toBeVisible({ timeout: 30_000 });
    await ngo.page.goto('/ngo/reporting');
    const req = ngo.page.locator('section[aria-labelledby="renewal-h"] li').filter({ hasText: 'Excellent results — let us renew for a second year.' }).last();
    await req.locator('textarea').fill('Gladly — we propose to add two more schools.');
    await req.getByRole('button', { name: 'Accept' }).click();
    await expect(ngo.page.getByText(/Your response: Gladly — we propose to add two more schools\./)).toBeVisible({ timeout: 30_000 });
  });
});
