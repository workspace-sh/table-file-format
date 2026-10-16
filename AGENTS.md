# Working in this repository

For any agent (Claude Code, Codex, or a person using one). `CLAUDE.md` points here.

## Before new work: review the high-priority backlog

Work that has been agreed is more important than work that just occurred to you.

1. **Look first.** Before you start anything, list what's waiting and read it:

   ```sh
   gh issue list -R workspace-sh/table-file-format --label "priority: high" --state open
   ```

   Read each issue your task touches, and any nobody has picked up.
2. **Say what you found.** In your first message to the person you're working for, name the open high-priority issues and say which you're taking. A direct request from them comes first, but still tell them what's waiting, in one line.
3. **New work needs a reason.** If you start something that isn't one of those issues, say why it comes first. Don't take an issue labelled `backlog` ("Parked: not scheduled") unless you're asked to.
4. **Leave the priority alone.** Don't remove, lower or close a `priority: high` issue unless its work is done, or Leslie says so. Close it from the PR that does the work (`Closes #N`).
5. **Put new high-priority work where the next agent will see it.** If you find something that should come before new work, file it with the `priority: high` label and add it to the project board (`gh project item-add 7 --owner workspace-sh --url <issue>`). A chat message or a memory note is not a backlog.
6. **PRs say it.** The PR template asks whether you checked. Answer it honestly: "none open" is a fine answer only if you ran the command.

## Labels

- `priority: high`: do before new work (this file).
- `backlog`: parked, not scheduled.
- `decision`: a decision Leslie has confirmed; the issue says what.
