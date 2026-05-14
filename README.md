# Pi Grill Me

A pi extension for Socratic planning sessions. It keeps a shared-understanding checkpoint, asks one focused question at a time, offers Tab-insertable answer alternatives, and blocks implementation mutations until an output phase is explicitly approved.

## Install

```bash
pi install git:github.com/majorgilles/pi-grill-me
```

For a one-off run without adding it to settings:

```bash
pi -e git:github.com/majorgilles/pi-grill-me
```

## Commands

- `/grill <topic>` — start a grill session.
- `/grill` — infer the topic from the current conversation and ask for confirmation/editing.
- `/grill stop` — stop grill mode.
- `/checkpoint [edit|chat]` — show the current checkpoint in an overlay by default; use `edit` to edit or `chat` to print it.
- `/grill checkpoint [edit|chat]` — same checkpoint controls from the `/grill` command.
- `/grill status` — show current grill state.
- `/grill intensity gentle|standard|hard|adversarial` — set Socratic intensity.
- `/grill intent auto|plan|learn|research|content|decide` — set the intent preset.
- `/grill output <type>` — set a preferred output format, such as `design-doc`, `prd`, `adr`, `issues`, or `summary`.
- `/grill research off|ask|auto` — configure whether the assistant should inspect/research while grilling.

## Behavior

While active, the extension injects Grill Me instructions into the agent context and exposes these assistant tools:

- `grill_set_alternatives`
- `grill_update_checkpoint`
- `grill_enter_output_phase`
- `grill_finish_output_phase`

During interview mode it blocks `edit`, `write`, and bash commands that appear mutating. After the user approves a concrete output plan, the assistant can enter output phase and create only the approved artifacts.

See [DESIGN.md](./DESIGN.md) for the design notes.
