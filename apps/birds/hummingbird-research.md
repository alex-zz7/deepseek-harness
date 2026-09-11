# Hummingbird (hummingbird.co) — Research Report

**Method note:** direct fetch of www.hummingbird.co worked from this environment (HTTP 200). Everything marked VERIFIED was read on the live page. G2/Capterra/itqlick returned 403; those gaps are marked.

## 1. What it is / who it's for
- **VERIFIED** (help center): "Hummingbird is a platform for case management, investigation, and regulatory reporting in financial compliance… used by companies in the financial industry to manage workflows and operations in several practice areas, including anti-money laundering (AML), customer diligence, transaction dispute management, compliance testing, and more."
- **VERIFIED** (homepage): "an orchestration platform bringing automation and AI to risk and compliance."
- Products: Customer Screening, Transaction Monitoring, Investigations, Regulatory Reporting. Features: Customer Profiles, AI, Automations, Apps.
- Audiences (nav): Banks, Fintechs, Crypto; use cases AML, CDD, Sponsor Banks (BaaS), Government.
- Team size is never stated; framing is enterprise compliance/financial-crime teams ("compliance managers", "investigators", "BSA officers"). Named customers on-site: Grasshopper Bank, BHG Financial, MoonPay, Evolve Bank & Trust, Stripe, Affirm; press release adds Raymond James, Crypto.com, DraftKings, Etsy, BILL. Case studies cite "10x" efficiency.
- Company: San Francisco; co-founder/CEO Joe Robinson; $30M Series B (Dec 2021, Battery Ventures; $41.8M total); acquired no-code data-integration startup LogicLoop (Sept 2024).

## 2. "Apps and Integrations" page + full app list
- **VERIFIED** page structure: hero "Integrations for app-solutely everything" → four value props (Bring it together / Easy implementation / Efficiency at scale) → four capability sections (Apps — "Do and see more"; Real-time data views; Automations; Tool & data integrations) → APIs → Apps Marketplace CTA → "Partner with us".
- Claims: "more than 50 different apps" (homepage), "Hundreds of integrations".
- **VERIFIED** — `/apps` App Marketplace lists **47 apps** across 18 filter categories: Adverse Media, AML, Blockchain, Business Data, Collaboration, CRM, Customer Intelligence, Email, File Management, Fraud, KYC/KYB, PEPs, Regulatory Reporting, Sanctions, Spreadsheets, Team Communication, Ticketing, Workflows. Featured: Castellum.AI, Chainalysis, LexisNexis Risk Solutions, TRSS LincsConnect.
- **Data / intelligence (appears inside the case):** Thomson Reuters CLEAR (Customer Intelligence, KYC/KYB; US-only), Middesk, OpenCorporates, BrokerCheck, OpenSanctions, Castellum.AI, Minerva, TRSS LincsConnect, LexisNexis Risk Solutions (Bridger Insight XG), Chainalysis, Elliptic.
- **Warehouse / BI (bidirectional):** Snowflake, BigQuery, Tableau, Looker, Microsoft Power BI, CSV.
- **Workflow & ticketing:** ServiceNow, Zendesk, Jira, Salesforce, Microsoft Dynamics 365.
- **Comms & files:** Slack, Microsoft Teams, Gmail, Microsoft Outlook, Box, Dropbox, Microsoft SharePoint.
- **Spreadsheets:** Google Sheets, Microsoft Excel.
- **Regulatory filing (jurisdictions):** US (FinCEN SAR/CTR), Canada (FINTRAC), Bermuda, Germany, Ghana, Ireland (GNECB), Netherlands, Nigeria, Sweden (goAML XML); Luxembourg STR filing added Winter '25 (in update, not in marketplace list).
- **Hummingbird-native "apps" (review types / tools):** AML Investigations, Customer Due Diligence, Fraud Investigations, Custom Investigations, Bank Partner Referrals (UAR), Request for Information (RFI), Tip Intake.
- Math check: 30 third-party + 9 filing + 8 native = 47. "50+" is marketing headroom.

## 3. How "apps" are framed technically
- **VERIFIED** framing is a no-code **marketplace of installable connectors** ("one-click installs", "no-code integrations"), not a generic iframe host.
- Three integration shapes stated on-page: (a) in-case panels — data providers "brought right into your case… without ever leaving the platform"; (b) live data views — connect a warehouse and "pull a live view of data into any case or customer profile"; (c) two-way sync — "automatically create cases and close the loop" with Chainalysis, Elliptic, ServiceNow, Zendesk, Slack.
- **RFI/Tip Intake is the one explicitly web-hosted surface**: "a fully-integrated web-based experience" with forms/emails sent from a **custom domain** (Winter '23 update).
- **Quick Links** (VERIFIED docs): no-code URL templates that open external tools in a new browser tab — explicitly *not* embedded. So: native panels + API/data connectors + link-outs, not a webview shell.
- **Surrounding shell (VERIFIED docs):** Cases → Reviews (Overview / Research / Actions) inside an "Investigation Canvas" with Subjects, Accounts, Devices, transaction and relationship graph views; configurable **workflows** (stages, tasks, decision dependencies); **Queues** (+ Queues API); **Automations** (visual no-code builder); **Customer Profiles/CRM** (entity merging, beneficial owners); Analytics; narrative templates; audit logs; sandbox→production rollout; AWS-hosted, 5-year retention.

## 4. UX pattern
- Navigation: case dashboard → case → review; left panel = Overview/Research/Actions; right rail = Comments; bottom-left bell = in-app notifications; separate email-notification settings.
- Collaboration: assignments, approvers, comments & approvals, joint SARs, peer feedback, tags, case pinning, ongoing-monitoring reminders.
- Permissions: **"badges"** — top-level Admin → most-restricted Analyst ("only see cases assigned to them"); custom badges toggle "see all cases", "ability to file", "complete/reopen a review". Plus SSO, 2FA, SCIM directory sync, IP filtering, custom session settings, org switching.
- AI is embedded in-flow: Narrative AI, case insights, and (2026) Research/Review Agents that run in-platform or over API, with an **Observe → Recommend → Automate** autonomy ladder.

## 5. Pricing
- **VERIFIED:** no public pricing — `/pricing` returns 404; no pricing block on the apps page; "Talk to an expert"/"Request demo" CTAs everywhere. Sales-led/quote-based.
- **LOW CONFIDENCE:** comparatif-logiciels.fr claims "from $349.00 per feature (Starter)" — that page also describes a *cybersecurity* product and is auto-generated, so treat as unreliably matched. rfp.wiki confirms "private-company pricing… thin in public sources."

## 6. Praise & complaints
- **Praise (vendor-published, VERIFIED):** faster case handling, one "single source of truth" for screening/investigations/escalations, narrative standardization saving time, automated STR filing cutting manual FINTRAC portal entry.
- **Praise (third-party aggregation, rfp.wiki):** "faster SAR/STR filing, clearer case visibility, and investigator-friendly workflows"; named bank/fintech references; patented regulatory reporting widely cited as a differentiator.
- **Complaints / gaps:** G2, Capterra, Trustpilot, Gartner Peer Insights "still lack verifiable overall scores"; native Transaction Monitoring and Customer Screening are newer than the mature investigations/reporting core; warehouse-native monitoring "heavier for institutions still on legacy cores"; "independent public benchmarks of model accuracy… remain thin"; complex rule governance and QA load fall on the institution; granular entitlements/field masking need configuration.
- Rating signal: rfp.wiki reports a 3.23/5 average across review sites (small sample, >3 reviews).
- Product-update cadence (VERIFIED): Winter '23 (Middesk, Elliptic, queues, custom domains) → Fall '23 (TR CLEAR, 8 integrations) → Spring '24 (Automations, Gmail/Outlook/Sheets/Excel, Queues API) → Winter '25 (alert enrichment, business screening, Castellum.AI expansion, Narrative AI, Luxembourg) → 2026 Research & Review Agents. Awards: Datos Insights 2026 Impact Award; Forrester Financial Crime Management Solutions Landscape, Q1 2026.

## Sources
- https://www.hummingbird.co/platform/apps-and-integrations
- https://www.hummingbird.co/apps
- https://www.hummingbird.co/
- https://www.hummingbird.co/resources/2025-winter-product-release
- https://www.hummingbird.co/resources-old/2024-spring-product-release
- https://www.hummingbird.co/resources-old/2023-winter-product-release
- https://www.hummingbird.co/resources/research-and-review-agents
- https://help.hummingbird.co/general/what-is-hummingbird.md
- https://help.hummingbird.co/llms.txt and https://help.hummingbird.co/llms-full.txt
- https://help.hummingbird.co/features/quick-links.md
- https://help.hummingbird.co/platform-administration/how-do-badges-roles-and-permissions-work-in-hummingbird.md
- https://fintech.global/2026/06/10/hummingbird-targets-compliance-fragmentation-with-ai/
- https://www.rfp.wiki/crypto/compliance-analytics/aml-kyc-transaction-monitoring/hummingbird
- https://www.finsmes.com/2021/12/hummingbird-raises-30m-in-series-b-funding.html
- https://www.businesswire.com/news/home/20240920755670/en/Hummingbird-Acquires-LogicLoop-Opening-the-Door-for-Risk-and-Compliance-Teams-Seeking-Seamless-Data-Integration-and-Automation
