AGENTS.md
=========

Read this before changing anything in this repository. `README.md` says what
the format is; `docs/` says how it works and why (start with
`docs/ARCHITECTURE.md`, `docs/SPEC.md` and `docs/DECISIONS.md`).


Work starts from an issue on the board
--------------------------------------
This repository's board is <https://github.com/orgs/workspace-sh/projects/7>.
It is how anyone, on any machine, can see what is being done and what is left.

- **No issue, no branch.** Before starting, find the issue for the work or
  open one, and move it to In Progress on the board.
- **A pull request names its issue** in its description: `Closes #123` when it
  finishes the issue, `Refs #123` when it is one of several. The `Tracked`
  check fails a pull request that names none.
- **If you stop part-way, the issue says where it stands**: what is done, what
  is left, and the branch, pushed. A message to another session is not a
  record.
- **Something found and not fixed gets an issue**, then and there.
- **When work changes hands or is dropped**, the board's status changes with
  it. In Progress means someone is on it now.

```sh
gh issue create --title "…" --body "…"
gh project item-add 7 --owner workspace-sh --url <issue url>
```

`gh project item-add` prints nothing whether or not it worked. Check with
`gh project item-list 7 --owner workspace-sh --format json`.

Say which platform an issue is about in its title (`Web:`, `Mac:`, `iOS:`,
`Android:`, `Linux:`), or leave it off when it is the shared code.


This repository and its board are public
----------------------------------------
Issues, comments, commit messages, pull requests and board items can be read
by anyone. Write each one for a reader outside the project:

- State the problem, what is known, and what is left.
- Leave out who did what, the order things were tried in, and what went wrong
  along the way.
- Leave out people's names, device names, machine names, local paths, private
  links and anything from a private repository.

Anything that can't be said in public goes on a private repository's board.


Numbers
-------
A performance number comes from a Release build, never a development build.
`docs/BENCHMARKING.md` says how to measure; `docs/LARGE-TABLES.md` holds the
results.
