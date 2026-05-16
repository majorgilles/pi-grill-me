# Grill Me Pi Extension Design

## Purpose

Create a Pi extension inspired by Claude's `grill-me` skill. The extension applies a Socratic, one-question-at-a-time planning process to reach shared understanding of a project, plan, idea, learning goal, or design.

The extension should be useful both for:

- beginners who do not yet know which dimensions should be explored, and
- expert users who want a planning/stress-test mode as an alternative to plan mode.

## Core Principles

1. **Shared understanding first**: the goal is not to immediately implement, but to converge on a clear, useful understanding of the user's intent.
2. **Adaptive interview, hardcoded ending**: avoid fixed product/UX/architecture interview phases. Use adaptive dimensions such as objective, constraints, outcome mode, risks, tradeoffs, unknowns, and next steps. The final output-selection phase is the one mandatory hardcoded phase before stopping or producing outputs.
3. **Mostly one question at a time**: default pacing asks one focused question per assistant turn, with small grouped questions allowed only when inseparable.
4. **Alternatives included by default**: each grill question should include 2-5 concrete answer alternatives, including the assistant's recommended answer, and expose them through Tab reply selection.
5. **Stateful memory**: maintain a single evolving Markdown checkpoint representing current shared understanding.
6. **Automatic checkpointing**: whenever shared understanding changes meaningfully, the assistant must update the checkpoint before asking the next question.
7. **Read-only during grilling**: while interviewing/planning, the extension blocks implementation mutations. Output selection is a mandatory workflow step before the session can end or output production can begin. Output production is a deliberate approved phase and can temporarily use the tools required for that output.

## User Experience

### Starting

- `/grill <topic>` starts immediately when the topic is clear.
- `/grill` with no topic uses recent conversation as an inferred topic and asks for confirmation/editing.
- The default intent is `auto`.

### Interaction

The user interacts through normal chat, not a rigid wizard. The extension adds:

- a persistent active state,
- a status widget/footer indicator,
- checkpoint review commands,
- prompt injection while active,
- read-only enforcement during the interview, and
- checkpoint update/output-selection/output-phase tools available to the assistant, and
- Tab-cyclable suggested replies for each grill question or output-selection choice.

### Commands for v1

- `/grill <topic>`: start or resume a grill session.
- `/grill stop`: stop grill mode and clear active status.
- `/grill checkpoint`: review the current Markdown checkpoint; supports quick display and editable review.
- `/grill status`: show operational state.
- `/grill intensity <gentle|standard|hard|adversarial>`: set intensity. Default: `standard`.
- `/grill intent <auto|plan|learn|research|content|decide>`: set intent preset. Default: `auto`.
- `/grill output <outputs>`: set one or more output preferences, e.g. `github-issues`, `design-doc`, `readme`, `adr`, `prd`, `summary`, or comma-separated combinations. This preference is never production approval; the assistant still explicitly asks/confirm outputs later.
- `/grill research <off|ask|auto>`: set research behavior. Default: `auto`.

### Checkpoint

The checkpoint is a single adaptive Markdown document. It should start generic, but sections may be added/removed based on the topic.

Example sections:

```md
# Shared Understanding

## Topic

## Current Understanding

## Decisions

## Assumptions

## Constraints

## Risks / Unknowns

## Open Questions

## Likely Output Strategy
```

The checkpoint should not force every topic into a product-design template. For example, `I want to make a game engine` might become a learning roadmap, an implementation plan, a tutorial series, or a research project depending on the grilled outcome mode.

## Output Model

Output generation is part of the normal `/grill` workflow, not only a separate export command.

When the assistant believes shared understanding is sufficient, it must enter a hardcoded output-selection phase. This phase is mandatory before stopping, stopping without outputs, or producing outputs. The phase shows a readiness gate containing:

1. why it thinks the session is ready,
2. recommended output destination(s),
3. recommended output strategy,
4. an explicit question asking which output(s) to produce, and
5. choices: continue grilling, review checkpoint, or produce one or more outputs.

There is no default output mode for a grilling session. A missing output preference means no output has been chosen yet. Even when `/grill output` was used, the assistant must explicitly ask/confirm the final output set before output production. The user may choose 1..n outputs, such as both a design doc and uploaded GitHub issues.

Output generation should choose both:

- **destination/format**: explicit options include GitHub issues, design doc, README.md, ADR doc(s), PRD, implementation plan, research brief, summary/decision memo, tutorial/content outline, test plan/QA checklist, and changelog/release notes; one or more destinations may be chosen or customized.
- **strategy**: implementation vertical slices, tutorial chapters, research investigations, content outline, ADR candidates, milestone experiments, etc.

The output-selection phase should show the explicit destination catalog before asking the user to decide:

- GitHub issues
- Design doc
- README.md
- ADR doc
- PRD
- Implementation plan
- Research brief
- Summary / decision memo
- Tutorial / content outline
- Test plan / QA checklist
- Changelog / release notes

For example, GitHub issues might mean:

- implementation vertical-slice tickets,
- tutorial chapter issues,
- research investigation issues,
- blog/content installment issues, or
- prototype experiment milestones.

### Approval Before Mutations

Before writing files or creating issues:

- For file outputs: draft first, then write after approval.
- For GitHub issues: preview issue titles/bodies/labels first, then create after approval.

During output selection, the user may choose to continue grilling, review the checkpoint, stop without output, or approve one or more concrete outputs. During approved output production, the assistant can enter an output phase that permits the required tools for the job. Approved mutating actions, such as creating GitHub issues, should not be refused merely because they mutate state; if pi, a CLI, a platform, or the OS blocks the mutation for permission/authentication reasons, the assistant must ask the user for the needed permission, confirmation, credentials, or a revised plan instead of bypassing the gate.

## Technical Design

### Extension State

Persist state using `pi.appendEntry("grill-me-state", state)`.

State fields:

- `active`: whether grill mode is active.
- `topic`: current topic.
- `intent`: `auto | plan | learn | research | content | decide`.
- `intensity`: `gentle | standard | hard | adversarial`.
- `outputPreference`: user-provided output preference(s), if any. Empty means unset; it must not imply a default.
- `researchMode`: `off | ask | auto`.
- `checkpoint`: evolving Markdown shared-understanding document.
- `phase`: `interview | output-selection | output`.
- `outputPhase`: legacy/compatibility boolean for whether the user has approved output production and mutating tools may be used.
- `outputSelection`: readiness rationale, recommended outputs, recommended strategy, and output-selection question while the mandatory output-selection phase is active.
- `approvedOutputPlan`: approved concrete output plan while output phase is active.
- `currentQuestion`: the latest grill question or output-selection question that has Tab alternatives.
- `alternatives`: suggested replies exposed in the widget and Tab reply-selection UX.
- `updatedAt`: last state update timestamp.
- `lastChangeSummary`: latest checkpoint change summary.

On session start/resume, restore the latest state entry from the current branch.

### Prompt Injection

When active, `before_agent_start` appends grill instructions to the system prompt:

- apply Socratic method,
- ask mostly one question at a time,
- include 2-5 concrete answer alternatives and a recommended answer by default,
- call `grill_set_alternatives` before each question so Tab can fill/cycle those alternatives and Enter can send the selected or edited reply,
- adapt dimensions to topic and intent,
- inspect code/files instead of asking when research mode allows and the answer is discoverable,
- do not implement during interview,
- update checkpoint with `grill_update_checkpoint` before the next question whenever shared understanding changes,
- when ready, call `grill_enter_output_selection_phase` to enter the mandatory hardcoded output-selection phase, explicitly list concrete output options (GitHub issues, design doc, README.md, ADR doc, PRD, etc.), ask for one or more outputs/continue/review/stop, and wait for the user's selection,
- after output approval from that phase, call `grill_enter_output_phase` before using mutating tools,
- during output phase, perform only approved mutations; if a permission/authentication/tool gate blocks an approved mutation, ask the user for the needed permission, confirmation, credentials, or plan change instead of refusing the approved output or bypassing the gate,
- if the user continues grilling or stops without output, call `grill_finish_output_selection_phase`.

### Tools

#### `grill_set_alternatives`

Parameters:

- `question`: the question these alternatives answer.
- `alternatives`: 2-5 objects containing:
  - `value`: exact reply inserted into the user's editor via Tab reply selection.
  - `label`: short visible label.
  - `description`: optional explanation/recommendation note.

Behavior:

- stores the current question and alternatives in state,
- shows them in the status widget below the editor,
- exposes them through the active reply-selection editor so pressing Tab fills/cycles them, and
- does not prevent the user from typing a custom answer.

#### `grill_update_checkpoint`

Parameters:

- `markdown`: full replacement checkpoint Markdown.
- `changeSummary`: brief visible summary of what changed.

Behavior:

- replaces the stored checkpoint,
- persists state,
- displays a visible confirmation,
- does not terminate the conversation.

#### `grill_enter_output_selection_phase`

Parameters:

- `readinessRationale`: why shared understanding is sufficient to leave interview mode.
- `recommendedOutputs`: recommended output destination(s)/format(s) from the explicit catalog, or none.
- `recommendedStrategy`: recommended output strategy, distinct from destination.
- `question`: the explicit output-selection question.
- `alternatives`: 2-5 choices for Tab reply selection.

Behavior:

- marks `phase = "output-selection"`,
- stores the output-selection summary,
- updates the current question/alternatives,
- persists state, and
- makes output selection visible in status/widget.

#### `grill_finish_output_selection_phase`

Parameters:

- `outcome`: `continue-grilling` or `stop-without-output`.
- `summary`: optional summary of the user's choice.

Behavior:

- resolves the mandatory output-selection phase without entering output production,
- either returns to `interview` or stops Grill Me after a no-output choice,
- persists state, and
- clears the output-selection alternatives.

#### `grill_enter_output_phase`

Parameters:

- `outputPlan`: description of approved outputs and planned mutations.

Behavior:

- requires the mandatory `output-selection` phase first,
- marks `phase = "output"` and `outputPhase = true` for the approved 1..n output plan,
- persists state,
- displays that output tools are enabled, and
- instructs the assistant to ask the user for permission/authentication if an approved mutation is blocked by pi, a CLI, a platform, or the OS.

#### `grill_finish_output_phase`

Behavior:

- marks `outputPhase = false`,
- returns to read-only grill enforcement.

### Read-only Enforcement

While `active && !outputPhase`:

- block `edit` and `write`,
- block bash commands that appear mutating,
- allow read/search/inspection commands,
- allow checkpoint/output-selection/output-phase tools.

When `outputPhase` is true, the assistant may use tools required for the approved output step. If an approved mutating action is blocked by permissions/authentication (for example `gh issue create` requiring login or confirmation), the assistant should ask the user for the required permission, credentials, or plan change rather than bypassing the gate or claiming success.

## MVP Scope

The first working version implements:

- stateful `/grill` command,
- v1 config commands,
- prompt injection,
- persistent Markdown checkpoint,
- `grill_update_checkpoint`,
- checkpoint review/editing,
- Tab reply-selection alternatives for each question,
- read-only enforcement during interview,
- mandatory output-selection tools,
- output-phase tool for approved output production,
- status widget.

## Known Limitations / Future Work

- Automatic checkpoint quality depends on the model following tool-use instructions.
- Output-selection is now a typed phase, but output strategies are still free-text rather than separate structured strategy objects.
- GitHub issue creation is not wrapped by a dedicated tool yet; the assistant uses `gh` during approved output phase.
- Later versions could add richer structured state, custom strategy templates, issue-preview tools, and automatic diffing of checkpoint changes.
