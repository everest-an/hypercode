---
name: commercial-term-trap-review
description: >-
  Audit commercial term sheets, leases, pop-ups, consignment and partnership deals
  for hidden economic traps. Use when reviewing rent, turnover rent, pure percentage,
  tax-inclusive/exclusive wording, property or service fees, deposits, free rent,
  fit-out, early termination, or comparing a new offer with a prior version, signed
  contract or actual bill. Triggers - 商业条款, 合同审查, 租赁, 快闪, 寄售, 联营,
  保底租金, 提成租金, 纯扣率, 含税, 不含税, 物业费, 服务费, 保证金, 免租期,
  装修期, 商务条件, 版本对比, term sheet, lease, pop-up, consignment, partnership,
  tax-inclusive, effective rent.
license: MIT
---

# Commercial Term Trap Review

> The headline number is not the price. The price is every line item, every tax clause, and every word that changed since the last version.

## Core rule

**Never reply "we agree" to a commercial term sheet before:**

1. building a line-item tax matrix;
2. diffing the new offer against the last signed contract, prior term sheet, or actual bill;
3. computing the all-in effective cost at more than one sales scenario.

A single deleted word — for example removing "rent" from a sentence that says "rent, service fee and deposit include VAT" — can change the effective cost without changing the headline rate.

## When to use

Use this skill for:

- retail leases, pop-ups, shop-in-shop, concession, consignment and joint-venture term sheets;
- percentage rent, base rent, "whichever is higher", pure percentage, minimum guarantee;
- tax-inclusive / tax-exclusive wording, VAT, invoice type, service fee, property fee, marketing fund;
- deposit, free rent, fit-out period, handover condition, restoration, early termination;
- comparing a new offer with a prior version, signed contract, or actual monthly bill;
- drafting a clarification, conditional acceptance, or fallback proposal.

Do **not** use it as a substitute for local legal or tax advice. It is a commercial review workflow.

## Non-negotiable rules

1. **Freeze the version.** Save the exact email/PDF/term sheet with date and message ID. Never review from memory.
2. **One line item, one row.** Rent, turnover rent, property fee, service fee, marketing fund, utilities, deposit, fit-out contribution, late fee, commission and taxes each get their own row.
3. **"含税" is not a fact until it has a scope.** Which line item? Which tax? What rate? What invoice type?
4. **A rate plus VAT is not the same as an inclusive rate.** Model both.
5. **Diff the words, not just the numbers.** Added/removed qualifiers such as "租金", "额外", "暂定", "可调整", "以出租方确认为准" are substantive.
6. **Never accept a contradiction.** If one clause says "no rent-free period" and a note mentions a "fit-out rent-free period", require one controlling sentence.
7. **Write before you agree.** Conditional acceptance is stronger than a verbal "OK" followed by a dispute.

## Workflow

### 1. Freeze the versions

Collect:

- the current offer (email, PDF, term sheet, WeChat screenshot);
- the prior offer or signed contract for the same or a comparable unit;
- the last 3–6 monthly bills, if available;
- the floor plan, handover condition, and any side letters.

Record the source, date, sender, and message ID. If a prior version is missing, say so and proceed with the tax matrix; do not pretend the current version is the baseline.

### 2. Extract every economic term

Create a table with at least:

| Field | What to capture |
|---|---|
| Unit / area | Unit number, gross/net area, measurement basis |
| Term | Start, expiry, break options, renewal |
| Base rent | Amount, currency, per sqm or per month, escalation |
| Turnover rent | Percentage, threshold, base/turnover "higher of", pure percentage |
| Taxes | VAT rate, who bears, inclusive/exclusive per line |
| Property fee | Rate, basis, inclusions (AC, water, electricity, cleaning) |
| Service fee | Rate, basis, inclusions, adjustment rights |
| Marketing / promotion | Fixed fee, percentage, cap |
| Deposit | Months, basis (rent vs property fee), refund conditions |
| Free rent | Rent-free vs fit-out, length, fees payable during period |
| Fit-out | Contribution, approval, restoration, hoarding removal |
| Handover | As-is / shell / condition; delivery long-stop |
| Termination | Landlord break right, notice, compensation |
| Exclusivity / co-tenancy | Radius, category, remedies |
| Insurance / POS / utilities | Responsibility and caps |

### 3. Build the tax matrix

For each line item, answer:

- Is the quoted number **tax-inclusive** or **tax-exclusive**?
- If exclusive, what tax rate applies and on what base?
- Is the tax recoverable? Is a special VAT invoice (专票) issued?
- Does "含税" cover VAT only, or also property/service fees?
- Is the tax clause in the main terms, a note, or only in the invoice?

Use `references/tax-matrix.md` and `assets/tax-matrix.csv`.

**Red flag:** a term says "8% of turnover" and another clause says "plus 5% VAT on rent", while a note says "rent, service fee and deposit include VAT". This is not a rounding issue; it is a contradiction that must be resolved in writing.

### 4. Diff against history

Run a word-level diff on the old and new versions. Focus on:

- deleted words: "租金", "含", "不含", "额外", "不再", "已包含";
- changed subjects: "租金" vs "商场服务费" vs "物业管理费";
- changed bases: "营业额" vs "含税营业额" vs "净营业额";
- changed timing: "交付日" vs "暂定交付日";
- changed rights: "可调整" vs "固定", "提前一个月" vs "提前三个月";
- changed obligations: "围板拆除", "复原", "现状交付".

Use `scripts/term_diff.py` or any diff tool. Read the changed line in full context; never review a diff hunk in isolation.

### 5. Compute the all-in effective cost

Model at least three sales scenarios: low, base, high. Include:

- base rent or turnover rent (whichever applies);
- VAT if tax-exclusive;
- property fee and service fee;
- marketing/promotion;
- utilities not included;
- deposit carrying cost (optional);
- free-rent value;
- fit-out amortization.

Formulas:

- **Tax-exclusive percentage rent:** effective % = headline % × (1 + VAT rate).
- **Tax-inclusive percentage rent:** effective % = headline %.
- **All-in occupancy cost:** (rent + taxes + property fee + service fee + other mandatory fees − free-rent value) ÷ net sales.
- **Pure percentage with property fee included:** effective % = headline %; confirm no separate property fee.
- **Base vs turnover "higher of":** model both and take the higher at each sales level.

### 6. Flag traps by severity

Use `references/red-flags.md`. At minimum, check:

- tax-scope mismatch;
- version drift;
- rate basis (gross vs net sales, VAT-inclusive vs exclusive);
- fee stacking (service fee + property fee + marketing fee);
- deposit basis;
- free-rent contradiction;
- turnover definition (returns, discounts, shipping, gift cards, VAT);
- landlord early termination without compensation;
- handover/restoration/hoarding;
- invoice type and timing;
- unilateral adjustment rights without cap or notice.

### 7. Reply with conditional acceptance

Do not send an unconditional "同意". Use `references/reply-templates.md`.

Structure:

1. Thank the counterparty and confirm intent to move quickly.
2. State the agreed commercial terms that are clear.
3. List the open items as numbered questions.
4. Ask for one controlling sentence in the contract.
5. Propose a fallback if the counterparty resists.
6. Set a next step and timeline.

Example:

> We agree to the commercial terms **subject to** written confirmation that the rent is 8% of monthly turnover, inclusive of VAT, and that no additional 5% VAT will be charged. Please confirm this in the contract; if the rent is tax-exclusive, we would need to re-confirm the commercial terms.

### 8. Log the decision

Record:

- version reviewed;
- key differences;
- tax matrix result;
- open items;
- reply sent;
- counterparty response;
- final contract language.

This log is the institutional memory that prevents the same trap from recurring.

## Output contract

When reviewing a term sheet, return these sections:

1. **Term snapshot** — unit, term, rent, fees, deposit, free rent, handover, termination.
2. **Tax matrix** — one row per line item; inclusive/exclusive, rate, invoice, effective cost.
3. **Version diff** — old vs new, with the exact words added/removed.
4. **Effective cost** — low/base/high sales scenarios; all-in percentage.
5. **Traps** — severity, why it matters, contract language requested.
6. **Recommended reply** — conditional acceptance or clarification email.
7. **Decision log** — version, date, open items, next step.

## Quick triage (5 minutes)

Scan for these tokens:

`含税` · `不含税` · `额外` · `5%` · `6%` · `9%` · `13%` · `服务费` · `物业费` · `保证金` · `免租` · `装修期` · `暂定` · `可调整` · `提前终止` · `复原` · `现状交付`

If **any** tax-scope token appears, do not accept before the matrix is complete.

## Trap taxonomy

| Family | Typical form | What to check |
|---|---|---|
| Tax-scope | "8% + 5% VAT" vs "rent inclusive" | Which line item, which rate, invoice type |
| Version drift | New version removes "租金" from an inclusive note | Word-level diff; prior contract/bill |
| Rate basis | Gross vs net turnover; VAT-inclusive vs exclusive | Definition of turnover; deductions |
| Fee stacking | Service fee + property fee + marketing fund | Inclusions; double counting |
| Deposit | "3 months property fee" vs "3 months rent + property fee" | Basis, refund, interest |
| Free rent | "No free rent" vs "fit-out rent-free" | One controlling sentence; fees during period |
| Turnover definition | Returns, discounts, shipping, gift cards, VAT | Net sales formula |
| Termination | Landlord break right with one month notice | Compensation; amortization of fit-out |
| Handover | As-is; hoarding removal; restoration | Cost cap; condition report |
| Invoice | "含税" but no special VAT invoice | Invoice type, timing, tax rate |

## Desensitization rule

When adding a case to this skill or its public case library:

- remove company names, project names, unit numbers, addresses, people, emails and phone numbers;
- replace exact dates with `Year 0`, `Year -1`, `Month 1`;
- replace exact amounts with percentages or indexed numbers;
- remove combinations that could identify a deal (unique unit + date + rate);
- keep the **pattern**, the **signal**, and the **fix**.

Use `Landlord L`, `Tenant T`, `Project A`.

## References

- `references/tax-matrix.md` — line-item tax matrix, formulas, questions.
- `references/red-flags.md` — severity-ranked trap checklist.
- `references/case-library.md` — anonymized patterns, including the "one deleted word" case.
- `references/reply-templates.md` — clarification, conditional acceptance, fallback.
- `references/negotiation-playbook.md` — trade-offs and red lines.
- `assets/term-review-template.md` — fill-in review sheet.
- `assets/tax-matrix.csv` — machine-readable matrix.
- `scripts/term_diff.py` — word-level diff with commercial-term highlighting.

## Disclaimer

This skill is a commercial review workflow, not legal, tax or investment advice. Laws, VAT rates, invoice rules and market practice vary by jurisdiction and change over time. Confirm with local counsel and tax advisers before signing.
