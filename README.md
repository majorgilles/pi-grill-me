# Pi Grill Me

A pi extension for Socratic planning sessions. It keeps a shared-understanding checkpoint, asks one focused question at a time, offers Tab-insertable answer alternatives, forces a mandatory output-selection phase at the end of the interview, and blocks implementation mutations until output production is explicitly approved.

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
- `/grill output <outputs>` — set one or more preferred output formats, such as `design-doc`, `prd`, `adr`, `issues`, `summary`, or `design-doc,issues`. This is a preference only; Grill Me still explicitly asks/gets approval before producing outputs.
- `/grill research off|ask|auto` — configure whether the assistant should inspect/research while grilling.

## Behavior

While active, the extension injects Grill Me instructions into the agent context and exposes these assistant tools:

- `grill_set_alternatives`
- `grill_update_checkpoint`
- `grill_enter_output_selection_phase`
- `grill_finish_output_selection_phase`
- `grill_enter_output_phase`
- `grill_finish_output_phase`

During interview mode it blocks `edit`, `write`, and bash commands that appear mutating. Grill Me does not assume a default output mode; when the interview is ready to end, the assistant must enter the hardcoded output-selection phase, ask which output(s) to produce, and support one or many outputs, such as a design doc and uploaded GitHub issues. Output production can only start after the user approves a concrete plan from that selection phase; choosing to continue grilling or stop without output is recorded separately.

## Acknowledgements

Kudos to [Matt Pocock](https://github.com/mattpocock) for the idea that inspired this extension.

## Testing

This package currently has no npm scripts. Useful checks:

```bash
npm pack --dry-run
tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --skipLibCheck index.ts
```

The TypeScript check requires pi peer dependencies to be resolvable in the local environment.

See [DESIGN.md](./DESIGN.md) for the design notes.
