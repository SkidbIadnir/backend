# Git conventions

## Branches

- `master` — released code only. Never commit to it directly.
- `dev` — integration branch. Work branches start from `dev` and merge back into it via PR.
- Work branches are named `type/short-description`:
  - lowercase kebab-case, 2–5 words, describing the change (no names, dates or `wip`)
  - optional GitHub issue number after the prefix: `feat/42-wishlist-sharing`
- Allowed types:

| Prefix      | Use for                                   |
|-------------|-------------------------------------------|
| `feat/`     | new functionality                         |
| `fix/`      | bug fixes                                 |
| `chore/`    | dependencies, config, housekeeping        |
| `refactor/` | restructuring with no behavior change     |
| `docs/`     | documentation only                        |
| `test/`     | adding or fixing tests                    |
| `ci/`       | pipelines and workflows                   |
| `perf/`     | performance work                          |
| `hotfix/`   | urgent fix branched from `master`, merged into both `master` and `dev` |
| `release/`  | release preparation (`release/1.2.0`)     |

- Delete branches once merged.

## Commits

Follow Conventional Commits, with the same types as branches:
`type(optional-scope): imperative summary`, e.g. `feat(tasteep): add wishlist sharing`,
`fix: handle empty geocode response`, `chore(deps): fix npm audit vulnerabilities`.
Reference issues with `Closes #42` in the PR description when relevant.
