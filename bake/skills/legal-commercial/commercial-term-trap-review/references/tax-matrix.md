# Tax Matrix

## Purpose

The tax matrix converts a prose term sheet into a line-by-line economic model. It answers one question:

> For every dollar of sales, what do we actually pay, and is tax included in the number we were quoted?

## Matrix columns

| Column | Meaning |
|---|---|
| Line item | Rent, turnover rent, property fee, service fee, marketing, utilities, deposit, fit-out, late fee, commission |
| Headline | The number in the term sheet: `8%`, `RMB X/sqm/month`, `3 months` |
| Basis | Monthly turnover, gross sales, net sales, sqm, month, fixed |
| Tax clause | The exact words: "含税", "不含税", "另加 5% VAT", "含增值税" |
| Inclusive? | `Inclusive`, `Exclusive`, `Unclear`, `N/A` |
| Tax rate | 5%, 6%, 9%, 13%, or `not stated` |
| Invoice | Special VAT invoice (专票), general invoice (普票), receipt, not stated |
| Effective cost | All-in cost after tax and fees, in the same unit |
| Notes | Inclusions, caps, adjustment rights, contradictions |

## Minimum rows

1. Base rent
2. Turnover rent / percentage rent
3. Property management fee
4. Service fee
5. Marketing / promotion fund
6. Utilities (HVAC, water, electricity, gas)
7. Deposit
8. Fit-out contribution / allowance
9. Rent-free / fit-out period
10. Late payment fee
11. Commission / channel fee
12. Other mandatory fees

## Core questions

### Scope

- Which line item does "含税" modify?
- Does it cover VAT only, or also the property/service fee?
- Does it apply to the rent, the deposit, the marketing fund, or all of them?
- Is there a sentence that says "以上价格含税" and another that says "plus VAT"? Which controls?

### Rate

- What is the tax rate?
- Is the rate fixed or "以政府规定为准"?
- If the rate changes, who bears the difference?
- Is the invoice a special VAT invoice (专票) or a general invoice (普票)?

### Base

- Is turnover gross or net of VAT?
- Are returns, discounts, shipping, gift cards and platform fees deducted?
- Is turnover measured by POS, landlord meter, or audited sales?
- Is the percentage applied before or after tax?

### Effective cost

- If rent is 8% and tax-exclusive with 5% VAT: effective = 8% × 1.05 = 8.4%.
- If rent is 8% inclusive: effective = 8%.
- If rent is 12% inclusive of tax and property fee, and no separate property fee: effective = 12%.
- If rent is 12% inclusive of tax but a separate property fee applies: effective = 12% + property fee.

### Deposit

- Three months of what: rent, property fee, or rent + property fee?
- Is the deposit tax-inclusive?
- When is it refunded? Within how many days?
- Can the landlord apply it to any amount, or only to unpaid rent?
- Is interest paid?

### Free rent

- Is it rent-free, fit-out-free, or both?
- During the period, is the property/service fee still payable?
- Does the free period start on delivery or on opening?
- If opening is delayed, does the free period expire?

### Termination

- Can the landlord terminate early? On what notice?
- Is there compensation for unamortized fit-out?
- Is there a lock-in period?
- Does the tenant have a reciprocal break right?

## Worked examples

### Example A — tax-exclusive percentage rent

- Headline: 8% of monthly turnover.
- Clause: "plus 5% VAT on rent."
- Note: "service fee and deposit include VAT."
- Effective rent: 8% × 1.05 = **8.4%** of turnover.
- Follow-up: confirm whether the 5% is VAT on rent, and whether a special invoice is issued.

### Example B — tax-inclusive percentage rent

- Headline: 8% of monthly turnover.
- Note: "rent, service fee and deposit include VAT."
- Effective rent: **8%** of turnover.
- Follow-up: if another clause says "plus 5% VAT", require one controlling sentence.

### Example C — pure percentage, all-in

- Headline: 12% of monthly turnover.
- Note: "inclusive of tax and property fee; no base rent; no minimum."
- Effective occupancy cost: **12%** of turnover, assuming no other mandatory fees.
- Follow-up: confirm turnover definition, invoice type, marketing fund, utilities, and early termination.

### Example D — base or turnover, whichever is higher

- Base rent: RMB X/sqm/month.
- Turnover rent: 8% of monthly turnover.
- Payable: the higher of the two.
- Model at low/base/high sales; the crossover point is where turnover rent overtakes base rent.
- Follow-up: confirm whether base rent is tax-inclusive; confirm turnover definition.

## Red flags in the matrix

- A row marked `Inclusive` but the tax rate is blank.
- A row marked `Exclusive` but no invoice type.
- "含税" in a note but "plus VAT" in the clause.
- A service fee and a property fee with overlapping inclusions.
- A deposit based on "three months" without specifying the base.
- A free-rent period that is "none" in one place and "fit-out" in another.
- A percentage rent with no turnover definition.

## Output

Fill `assets/tax-matrix.csv` and include the completed matrix in the review. Do not summarize it away; the matrix is the evidence.
