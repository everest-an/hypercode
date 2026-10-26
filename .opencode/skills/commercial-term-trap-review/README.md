# Commercial Term Trap Review

An agent skill for auditing commercial term sheets, leases, pop-ups, consignment and partnership deals.

**The headline number is not the price.** The price is every line item, every tax clause, and every word that changed since the last version.

## Why this exists

Most commercial reviews focus on the headline rent. The expensive mistakes hide in the qualifiers:

- a rate is quoted as **8%**, but a clause adds **5% VAT** on the rent;
- a note says **"rent, service fee and deposit include VAT"** in the old version, then the new version removes the word **"rent"**;
- a term says **"no free rent"**, while a note mentions a **"fit-out rent-free period"**;
- a **service fee** and a **property fee** are both charged, with different inclusions;
- a **deposit** is "three months" — but three months of what?

A single deleted word can change the effective cost without changing the headline rate. This skill makes that visible before you reply "we agree".

## What it catches

- tax-inclusive / tax-exclusive scope mismatches;
- version drift between a new offer, a prior term sheet, a signed contract and actual bills;
- effective rent after VAT, property fee, service fee and marketing fees;
- base rent vs turnover rent vs pure percentage;
- deposit basis and refund conditions;
- free rent vs fit-out period contradictions;
- turnover definitions (returns, discounts, shipping, gift cards, VAT);
- landlord early termination, handover, restoration and hoarding obligations;
- invoice type, tax rate and timing;
- one-sided adjustment rights without caps or notice.

## Install

### Hypercode

Copy the folder into the project skill directory:

```text
E:\hypercode\.opencode\skills\commercial-term-trap-review
```

Hypercode will load it as a project skill.

### OpenCode

```bash
git clone https://github.com/everest-an/commercial-term-trap-review.git
cp -r commercial-term-trap-review ~/.config/opencode/skills/
```

Windows:

```powershell
git clone https://github.com/everest-an/commercial-term-trap-review.git
Copy-Item -Recurse .\commercial-term-trap-review "$env:USERPROFILE\.config\opencode\skills\commercial-term-trap-review"
```

### Other agents

Any agent that loads `SKILL.md` skills can use this folder. Keep `references/`, `assets/` and `scripts/` next to `SKILL.md` so relative links resolve.

## Use

Ask your agent:

```text
Review this lease term sheet. Build a line-item tax matrix, compare it with the
prior version and the last three bills, and flag every trap before I reply.
```

```text
Compare this new pop-up offer with last year's signed contract. What changed in
the tax-inclusive wording, and what is the effective cost at low/base/high sales?
```

```text
Draft a clarification email. We want the old treatment: rent inclusive of VAT.
Do not accept the new 8% + 5% VAT wording without written confirmation.
```

## Output

The skill returns:

1. **Term snapshot** — unit, term, rent, fees, deposit, free rent, handover, termination.
2. **Tax matrix** — one row per line item, with inclusive/exclusive, rate, invoice and effective cost.
3. **Version diff** — exact words added or removed.
4. **Effective cost** — low/base/high sales scenarios, all-in percentage.
5. **Traps** — severity, why it matters, contract language requested.
6. **Recommended reply** — conditional acceptance or clarification email.
7. **Decision log** — version, date, open items, next step.

## The "one deleted word" case

An anonymized pattern from the case library:

- **Old term sheet:** rent at 8% of monthly turnover; the rent clause says "plus 5% VAT"; the note says **"rent, service fee and deposit include VAT"**.
- **New term sheet:** same 8% headline; the note now says **"service fee and deposit include VAT"** — the word **"rent"** is gone.
- **Effect:** the old note read as 8% inclusive; the new note reads as 8% + 5% VAT, or about 8.4% effective.
- **Signal:** nothing changed in the headline. Only one word disappeared from a note.
- **Fix:** diff every version, build the tax matrix, and require one controlling sentence in the contract.

See `references/case-library.md` for more patterns, including a positive "12% inclusive of tax and property fee, pure percentage" structure.

## Repository structure

```text
commercial-term-trap-review/
├── SKILL.md
├── README.md
├── LICENSE
├── references/
│   ├── tax-matrix.md
│   ├── red-flags.md
│   ├── case-library.md
│   ├── reply-templates.md
│   └── negotiation-playbook.md
├── assets/
│   ├── term-review-template.md
│   └── tax-matrix.csv
└── scripts/
    └── term_diff.py
```

## Contributing

Contributions are welcome, especially anonymized case patterns.

Before submitting a case:

- remove company names, project names, unit numbers, addresses, people, emails and phone numbers;
- replace exact dates with `Year 0`, `Year -1`, `Month 1`;
- replace exact amounts with percentages or indexed numbers;
- remove combinations that could identify a deal;
- keep the pattern, the signal and the fix.

Open an issue or a pull request. By contributing, you agree that your contribution is licensed under MIT.

## License

MIT. See `LICENSE`.

## Disclaimer

This skill is a commercial review workflow, not legal, tax or investment advice. Laws, VAT rates, invoice rules and market practice vary by jurisdiction and change over time. Confirm with local counsel and tax advisers before signing.
