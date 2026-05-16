import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { CustomEditor, DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import {
	Markdown,
	matchesKey,
	Text,
	truncateToWidth,
	type AutocompleteItem,
	type AutocompleteProvider,
	type EditorOptions,
	type EditorTheme,
	type TUI,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";

type Intent = "auto" | "plan" | "learn" | "research" | "content" | "decide";
type Intensity = "gentle" | "standard" | "hard" | "adversarial";
type ResearchMode = "off" | "ask" | "auto";
type GrillPhase = "interview" | "output-selection" | "output";

interface GrillAlternative {
	value: string;
	label: string;
	description?: string;
}

interface GrillState {
	active: boolean;
	topic: string;
	intent: Intent;
	intensity: Intensity;
	outputPreference: string;
	researchMode: ResearchMode;
	checkpoint: string;
	phase: GrillPhase;
	outputPhase: boolean;
	outputSelection?: {
		readinessRationale: string;
		recommendedOutputs: string;
		recommendedStrategy: string;
		question: string;
	};
	approvedOutputPlan?: string;
	alternatives: GrillAlternative[];
	currentQuestion?: string;
	updatedAt: number;
	lastChangeSummary?: string;
}

const STATE_ENTRY_TYPE = "grill-me-state";
const LEGACY_DEFAULT_OUTPUT_PREFERENCE = "design-doc by default; adapt/recommend near readiness";

const DEFAULT_STATE: GrillState = {
	active: false,
	topic: "",
	intent: "auto",
	intensity: "standard",
	outputPreference: "",
	researchMode: "auto",
	checkpoint: "",
	phase: "interview",
	outputPhase: false,
	outputSelection: undefined,
	approvedOutputPlan: undefined,
	alternatives: [],
	currentQuestion: undefined,
	updatedAt: Date.now(),
};

const INTENTS = ["auto", "plan", "learn", "research", "content", "decide"] as const;
const INTENSITIES = ["gentle", "standard", "hard", "adversarial"] as const;
const RESEARCH_MODES = ["off", "ask", "auto"] as const;

const OUTPUT_DESTINATION_OPTIONS = [
	{ label: "GitHub issues", value: "github-issues", description: "Issue titles/bodies/labels for implementation slices, research tasks, tutorial chapters, or milestones." },
	{ label: "Design doc", value: "design-doc", description: "A structured design proposal with goals, constraints, architecture, tradeoffs, risks, and rollout." },
	{ label: "README.md", value: "readme", description: "A README or README update covering setup, usage, behavior, examples, and caveats." },
	{ label: "ADR", value: "adr", description: "Architecture Decision Record(s) documenting decision context, options, choice, and consequences." },
	{ label: "PRD", value: "prd", description: "Product requirements, user stories, scope, acceptance criteria, and non-goals." },
	{ label: "Implementation plan", value: "implementation-plan", description: "Step-by-step engineering plan, milestones, sequencing, dependencies, and validation." },
	{ label: "Research brief", value: "research-brief", description: "Open questions, investigation plan, evidence to gather, and decision criteria." },
	{ label: "Summary / decision memo", value: "summary", description: "Concise summary of the checkpoint, decisions, assumptions, and next actions." },
	{ label: "Tutorial / content outline", value: "content-outline", description: "Chapters, lesson flow, examples, exercises, or publishing outline." },
	{ label: "Test plan / QA checklist", value: "test-plan", description: "Acceptance tests, manual QA steps, edge cases, and regression coverage." },
	{ label: "Changelog / release notes", value: "release-notes", description: "User-facing change summary, migration notes, and release caveats." },
] as const;

function cloneState(state: GrillState): GrillState {
	return { ...state };
}

function describeOutputPreference(state: GrillState): string {
	const preference = typeof state.outputPreference === "string" ? state.outputPreference.trim() : "";
	return preference || "(none set; explicitly ask for one or more outputs before production)";
}

function outputDestinationOptionsMarkdown(): string {
	return OUTPUT_DESTINATION_OPTIONS.map((option) => `- ${option.label} (${option.value}): ${option.description}`).join("\n");
}

function outputDestinationOptionNames(): string {
	return OUTPUT_DESTINATION_OPTIONS.map((option) => option.label).join(", ");
}

function currentPhase(state: GrillState): GrillPhase {
	if (state.outputPhase) return "output";
	return state.phase ?? "interview";
}

function phaseLabel(state: GrillState): string {
	const phase = currentPhase(state);
	if (phase === "output") return "output production; approved mutations allowed";
	if (phase === "output-selection") return "mandatory output selection; choose final outputs/continue/stop";
	return "interview; read-only enforcement active";
}

function initialCheckpoint(topic: string, state: GrillState): string {
	return `# Shared Understanding\n\n## Topic\n\n${topic}\n\n## Current Understanding\n\nWe are starting a grill-me session to reach shared understanding before producing outputs or implementation work.\n\n## Working Configuration\n\n- Intent: ${state.intent}\n- Intensity: ${state.intensity}\n- Research mode: ${state.researchMode}\n- Output preference: ${describeOutputPreference(state)}\n\n## Decisions\n\n- Grill mode should adapt to the subject rather than force hardcoded interview phases.\n- A hardcoded output-selection phase is mandatory at the end of the interview before output production or stopping.\n- Grill mode must not assume a default output. The assistant must explicitly ask which output(s) to produce.\n\n## Assumptions\n\n- The checkpoint should evolve as meaningful understanding changes.\n\n## Risks / Unknowns\n\n- The user's desired outcome mode and output set may still be ambiguous.\n\n## Open Questions\n\n- What outcome is the user ultimately trying to achieve with this topic?\n- Which output artifact(s) should be produced, if any, once shared understanding is sufficient?\n\n## Explicit Output Destination Options\n\n${outputDestinationOptionsMarkdown()}\n`;
}

function statusMarkdown(state: GrillState): string {
	return `# Grill Status\n\n- Active: ${state.active ? "yes" : "no"}\n- Topic: ${state.topic || "(none)"}\n- Intent: ${state.intent}\n- Intensity: ${state.intensity}\n- Research: ${state.researchMode}\n- Phase: ${phaseLabel(state)}\n- Output preference: ${describeOutputPreference(state)}\n${state.outputSelection ? `- Output selection rationale: ${state.outputSelection.readinessRationale}\n- Recommended outputs: ${state.outputSelection.recommendedOutputs}\n- Recommended strategy: ${state.outputSelection.recommendedStrategy}\n` : ""}${state.approvedOutputPlan ? `- Approved output plan: ${state.approvedOutputPlan}\n` : ""}- Current question: ${state.currentQuestion || "(none)"}\n- Tab alternatives: ${state.alternatives.length ? state.alternatives.map((a) => a.label).join(" | ") : "(none set)"}\n- Checkpoint last updated: ${state.updatedAt ? new Date(state.updatedAt).toLocaleString() : "never"}\n${state.lastChangeSummary ? `- Last checkpoint change: ${state.lastChangeSummary}\n` : ""}`;
}

function normalizeAlternatives(alternatives: GrillAlternative[]): GrillAlternative[] {
	return alternatives
		.map((alt) => ({
			value: String(alt.value ?? "").trim(),
			label: String(alt.label ?? alt.value ?? "").trim(),
			description: alt.description ? String(alt.description).trim() : undefined,
		}))
		.filter((alt) => alt.value && alt.label)
		.slice(0, 6);
}

function comparableReplyText(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

function nextAlternativeIndexForText(text: string, alternatives: GrillAlternative[], direction: 1 | -1): number {
	if (alternatives.length === 0) return -1;

	const current = comparableReplyText(text);
	if (!current) return direction > 0 ? 0 : alternatives.length - 1;

	const exactIndex = alternatives.findIndex((alt) => comparableReplyText(alt.value) === current);
	if (exactIndex >= 0) return (exactIndex + direction + alternatives.length) % alternatives.length;

	// Let Tab accept a short typed filter, but avoid replacing a free-form sentence.
	if (/\s/.test(current)) return -1;

	const query = current.toLowerCase();
	return alternatives.findIndex((alt) => alt.label.toLowerCase().includes(query) || alt.value.toLowerCase().includes(query));
}

class GrillReplyEditor extends CustomEditor {
	constructor(
		tui: TUI,
		theme: EditorTheme,
		private readonly grillKeybindings: KeybindingsManager,
		private readonly getGrillState: () => GrillState,
		options?: EditorOptions,
	) {
		super(tui, theme, grillKeybindings, options);
	}

	override handleInput(data: string): void {
		if (!this.isShowingAutocomplete()) {
			if (this.grillKeybindings.matches(data, "tui.input.tab") && this.cycleGrillAlternative(1)) return;
			if (matchesKey(data, "shift+tab") && this.cycleGrillAlternative(-1)) return;
		}

		super.handleInput(data);
	}

	private cycleGrillAlternative(direction: 1 | -1): boolean {
		const activeState = this.getGrillState();
		if (!activeState.active || activeState.alternatives.length === 0) return false;

		const nextIndex = nextAlternativeIndexForText(this.getText(), activeState.alternatives, direction);
		if (nextIndex < 0) return false;

		this.setText(activeState.alternatives[nextIndex].value);
		this.tui.requestRender();
		return true;
	}
}

function createGrillAutocompleteProvider(current: AutocompleteProvider, getState: () => GrillState): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options) {
			const activeState = getState();
			if (!activeState.active || activeState.alternatives.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const line = lines[cursorLine] ?? "";
			const beforeCursor = line.slice(0, cursorCol);
			const afterCursor = line.slice(cursorCol);
			const tokenMatch = beforeCursor.match(/([^\s]*)$/);
			const token = tokenMatch?.[1] ?? "";
			const textBeforeToken = beforeCursor.slice(0, beforeCursor.length - token.length);
			const onlyTypingReply = lines.slice(0, cursorLine).join("\n").trim() === "" && textBeforeToken.trim() === "" && afterCursor.trim() === "" && lines.slice(cursorLine + 1).join("\n").trim() === "";
			if (!onlyTypingReply) return current.getSuggestions(lines, cursorLine, cursorCol, options);

			const query = token.toLowerCase();
			const items = activeState.alternatives
				.filter((alt) => !query || alt.label.toLowerCase().includes(query) || alt.value.toLowerCase().includes(query))
				.map((alt): AutocompleteItem => ({ value: alt.value, label: alt.label, description: alt.description }));
			if (items.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, options);
			return { prefix: token, items };
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

function extractTextFromMessage(message: any): string {
	const content = message?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.filter((part) => part?.type === "text" && typeof part.text === "string")
			.map((part) => part.text)
			.join("\n");
	}
	return "";
}

function inferTopic(ctx: ExtensionContext): string {
	const branch = ctx.sessionManager.getBranch();
	const chunks: string[] = [];
	for (let i = branch.length - 1; i >= 0 && chunks.join("\n").length < 1600; i--) {
		const entry: any = branch[i];
		if (entry?.type !== "message") continue;
		const role = entry.message?.role;
		if (role !== "user" && role !== "assistant") continue;
		const text = extractTextFromMessage(entry.message).trim();
		if (!text || text.startsWith("/grill")) continue;
		chunks.unshift(`${role}: ${text}`);
	}
	const inferred = chunks.join("\n\n").trim();
	return inferred ? `Current conversation context:\n\n${inferred}` : "";
}

function parseArgs(args: string): { flags: Record<string, string | true>; rest: string } {
	const tokens = args.match(/(?:[^\s"]+|"[^"]*")+/g) ?? [];
	const flags: Record<string, string | true> = {};
	const rest: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i].replace(/^"|"$/g, "");
		if (token.startsWith("--")) {
			const eq = token.indexOf("=");
			if (eq > 2) {
				flags[token.slice(2, eq)] = token.slice(eq + 1);
			} else {
				const key = token.slice(2);
				const next = tokens[i + 1]?.replace(/^"|"$/g, "");
				if (next && !next.startsWith("--")) {
					flags[key] = next;
					i++;
				} else {
					flags[key] = true;
				}
			}
		} else {
			rest.push(token);
		}
	}
	return { flags, rest: rest.join(" ").trim() };
}

function asIntent(value: unknown): Intent | undefined {
	return typeof value === "string" && (INTENTS as readonly string[]).includes(value) ? (value as Intent) : undefined;
}

function asIntensity(value: unknown): Intensity | undefined {
	return typeof value === "string" && (INTENSITIES as readonly string[]).includes(value) ? (value as Intensity) : undefined;
}

function asResearchMode(value: unknown): ResearchMode | undefined {
	return typeof value === "string" && (RESEARCH_MODES as readonly string[]).includes(value) ? (value as ResearchMode) : undefined;
}

function firstWord(text: string): string {
	return text.trim().split(/\s+/, 1)[0]?.toLowerCase() ?? "";
}

function shellSegments(command: string): string[] {
	return command
		.split(/&&|\|\||;|\n/) // pipelines are handled separately to avoid flagging read-only grep pipelines as mutating.
		.map((s) => s.trim())
		.filter(Boolean);
}

function isReadOnlyGit(args: string[]): boolean {
	const sub = args[1];
	return ["status", "log", "diff", "show", "branch", "grep", "ls-files", "remote", "rev-parse", "describe"].includes(sub);
}

function isReadOnlyGh(args: string[]): boolean {
	const sub = args[1];
	const sub2 = args[2];
	if (["status", "auth", "repo", "pr", "issue", "label", "milestone"].includes(sub) === false) return false;
	if (sub === "repo") return [undefined, "view", "list"].includes(sub2);
	if (sub === "issue") return [undefined, "list", "view", "status"].includes(sub2);
	if (sub === "pr") return [undefined, "list", "view", "status", "diff", "checks"].includes(sub2);
	if (sub === "label" || sub === "milestone") return [undefined, "list", "view"].includes(sub2);
	return true;
}

function isProbablyReadOnlyBash(command: string): boolean {
	const trimmed = command.trim();
	if (!trimmed) return true;

	// Redirection and common write helpers are mutations even if the command itself is read-only.
	if (/(^|[^<])>(>|&)?\s*\S/.test(trimmed) || /\btee\b/.test(trimmed)) return false;

	const definitelyMutating = /\b(rm|mv|cp|mkdir|rmdir|touch|chmod|chown|sudo|kill|pkill|reboot|shutdown|curl\s+.*\|\s*(sh|bash)|wget\s+.*\|\s*(sh|bash))\b/;
	if (definitelyMutating.test(trimmed)) return false;

	const unsafePhrases = [
		"git add",
		"git commit",
		"git push",
		"git checkout",
		"git switch",
		"git reset",
		"git merge",
		"git rebase",
		"npm install",
		"npm i",
		"npm add",
		"pnpm install",
		"pnpm add",
		"yarn add",
		"yarn install",
		"pip install",
		"cargo install",
		"cargo add",
		"gh issue create",
		"gh issue edit",
		"gh issue close",
		"gh pr create",
		"gh pr edit",
	];
	const lower = trimmed.toLowerCase();
	if (unsafePhrases.some((phrase) => lower.includes(phrase))) return false;

	for (const segment of shellSegments(trimmed)) {
		const args = segment.split(/\s+/);
		const cmd = args[0];
		if (!cmd) continue;
		if (["cat", "head", "tail", "less", "more", "grep", "rg", "find", "fd", "ls", "pwd", "tree", "wc", "sort", "uniq", "cut", "awk", "sed", "date", "whoami", "uname", "which", "where", "echo"].includes(cmd)) {
			continue;
		}
		if (["npm", "pnpm", "yarn"].includes(cmd)) {
			if (["list", "outdated", "view", "info", "why"].includes(args[1])) continue;
			return false;
		}
		if (cmd === "git") {
			if (isReadOnlyGit(args)) continue;
			return false;
		}
		if (cmd === "gh") {
			if (isReadOnlyGh(args)) continue;
			return false;
		}
		// Unknown commands may mutate; block in grill interview mode.
		return false;
	}
	return true;
}

export default function grillMeExtension(pi: ExtensionAPI): void {
	let state: GrillState = cloneState(DEFAULT_STATE);

	function persist(): void {
		state.updatedAt = Date.now();
		pi.appendEntry(STATE_ENTRY_TYPE, cloneState(state));
	}

	function updateUi(ctx: ExtensionContext): void {
		if (!state.active) {
			ctx.ui.setStatus("grill-me", undefined);
			ctx.ui.setWidget("grill-me", undefined);
			return;
		}

		const phase = currentPhase(state);
		const status = phase === "output" ? "🔥 grill: output" : phase === "output-selection" ? "🔥 grill: select output" : "🔥 grill";
		ctx.ui.setStatus("grill-me", ctx.ui.theme.fg(phase === "output" ? "warning" : phase === "output-selection" ? "success" : "accent", status));

		const topic = state.topic.length > 90 ? `${state.topic.slice(0, 87)}...` : state.topic;
		const lines = [
			ctx.ui.theme.fg("accent", `🔥 Grill Me: ${topic || "active"}`),
			ctx.ui.theme.fg("muted", `intent=${state.intent} intensity=${state.intensity} research=${state.researchMode}`),
			ctx.ui.theme.fg("dim", `Phase: ${phaseLabel(state)}`),
		];
		if (state.alternatives.length > 0) {
			lines.push(ctx.ui.theme.fg("accent", "Tab: fill/cycle replies • Shift+Tab previous • Enter sends"));
			for (const alternative of state.alternatives) {
				const description = alternative.description ? ` — ${alternative.description}` : "";
				lines.push(ctx.ui.theme.fg("muted", `  • ${alternative.label}${description}`));
			}
		}
		ctx.ui.setWidget("grill-me", lines, { placement: "belowEditor" });
	}

	function startSession(topic: string, ctx: ExtensionContext, partial: Partial<GrillState> = {}): void {
		state = {
			...cloneState(DEFAULT_STATE),
			...partial,
			active: true,
			topic,
			phase: "interview",
			outputPhase: false,
			outputSelection: undefined,
			approvedOutputPlan: undefined,
		};
		state.checkpoint = initialCheckpoint(topic, state);
		state.lastChangeSummary = "Started grill session";
		persist();
		updateUi(ctx);

		pi.sendUserMessage(`Start a Grill Me session for this topic:\n\n${topic}\n\nBegin by updating the checkpoint if needed, then call grill_set_alternatives with 2-5 concrete answer choices and ask the first focused Socratic question. Mention that Tab fills/cycles suggested replies and Enter sends the selected or edited reply. When the interview is ready to end, the mandatory hardcoded output-selection phase must be entered with grill_enter_output_selection_phase before producing outputs or stopping.`);
	}

	async function showCheckpointOverlay(ctx: ExtensionContext): Promise<"edit" | undefined> {
		if (!ctx.hasUI) {
			pi.sendMessage({ customType: "grill-me-checkpoint", content: state.checkpoint, display: true });
			return undefined;
		}

		return await ctx.ui.custom<"edit" | undefined>(
			(tui, theme, _keybindings, done) => {
				const border = new DynamicBorder((s: string) => theme.fg("accent", s));
				const markdown = new Markdown(state.checkpoint, 1, 0, getMarkdownTheme());
				let scrollOffset = 0;
				let cachedWidth = 0;
				let cachedBody: string[] = [];
				const maxBodyLines = 16;

				function bodyLines(width: number): string[] {
					if (cachedWidth !== width || cachedBody.length === 0) {
						cachedWidth = width;
						cachedBody = markdown.render(width);
					}
					return cachedBody;
				}

				function maxOffset(): number {
					return Math.max(0, cachedBody.length - maxBodyLines);
				}

				function move(delta: number): void {
					scrollOffset = Math.max(0, Math.min(maxOffset(), scrollOffset + delta));
					tui.requestRender();
				}

				return {
					render(width: number) {
						const body = bodyLines(width);
						scrollOffset = Math.min(scrollOffset, maxOffset());
						const visible = body.slice(scrollOffset, scrollOffset + maxBodyLines);
						const range = body.length > maxBodyLines ? `lines ${scrollOffset + 1}-${Math.min(scrollOffset + maxBodyLines, body.length)} of ${body.length}` : "full checkpoint";
						return [
							...border.render(width),
							truncateToWidth(theme.fg("accent", theme.bold("🔥 Grill Me Checkpoint")), width),
							truncateToWidth(theme.fg("dim", `${range} • ↑↓/PgUp/PgDn scroll • e edit • Enter/Esc close`), width),
							...visible.map((line) => truncateToWidth(line, width, "")),
							...border.render(width),
						];
					},
					invalidate() {
						border.invalidate();
						markdown.invalidate();
						cachedWidth = 0;
						cachedBody = [];
					},
					handleInput(data: string) {
						if (matchesKey(data, "escape") || matchesKey(data, "enter")) done(undefined);
						else if (matchesKey(data, "e")) done("edit");
						else if (matchesKey(data, "up")) move(-1);
						else if (matchesKey(data, "down")) move(1);
						else if (matchesKey(data, "pageUp")) move(-maxBodyLines);
						else if (matchesKey(data, "pageDown")) move(maxBodyLines);
					},
				};
			},
			{
				overlay: true,
				overlayOptions: { anchor: "center", width: "80%", minWidth: 50, maxHeight: "80%", margin: 2 },
			},
		);
	}

	async function showCheckpoint(ctx: ExtensionContext, mode?: string): Promise<void> {
		if (!state.checkpoint.trim()) {
			ctx.ui.notify("No grill checkpoint yet.", "warning");
			return;
		}

		const selected = mode?.trim().toLowerCase() || "overlay";
		if (selected.includes("edit")) {
			const edited = await ctx.ui.editor("Edit Grill Me checkpoint", state.checkpoint);
			if (edited !== undefined) {
				state.checkpoint = edited.trim() || state.checkpoint;
				state.lastChangeSummary = "Checkpoint edited by user";
				persist();
				updateUi(ctx);
				ctx.ui.notify("Grill checkpoint updated.", "info");
			}
			return;
		}

		if (selected.includes("chat")) {
			pi.sendMessage({ customType: "grill-me-checkpoint", content: state.checkpoint, display: true });
			return;
		}

		const action = await showCheckpointOverlay(ctx);
		if (action === "edit") {
			await showCheckpoint(ctx, "edit");
		}
	}

	pi.registerCommand("checkpoint", {
		description: "Show the current Grill Me checkpoint in an overlay",
		handler: async (args, ctx) => {
			await showCheckpoint(ctx, args.trim());
		},
	});

	pi.registerCommand("grill", {
		description: "Start or control a Socratic Grill Me planning session",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			const command = firstWord(trimmed);
			const rest = trimmed.slice(command.length).trim();

			if (command === "help") {
				pi.sendMessage({
					customType: "grill-me-help",
					content: `# Grill Me commands\n\n- /grill <topic>\n- /grill stop\n- /checkpoint [edit|chat]\n- /grill checkpoint [edit|chat]\n- /grill status\n- /grill intensity gentle|standard|hard|adversarial\n- /grill intent auto|plan|learn|research|content|decide\n- /grill output <one or more outputs> (preference only; approval still required)\n- /grill research off|ask|auto\n\nThe assistant must use the hardcoded output-selection phase before ending the interview, producing outputs, or stopping without outputs.`,
					display: true,
				});
				return;
			}

			if (command === "stop") {
				state.active = false;
				state.phase = "interview";
				state.outputPhase = false;
				state.outputSelection = undefined;
				state.approvedOutputPlan = undefined;
				state.currentQuestion = undefined;
				state.alternatives = [];
				state.lastChangeSummary = "Stopped grill session";
				persist();
				updateUi(ctx);
				ctx.ui.notify("Grill mode stopped.", "info");
				return;
			}

			if (command === "status") {
				pi.sendMessage({ customType: "grill-me-status", content: statusMarkdown(state), display: true });
				return;
			}

			if (command === "checkpoint") {
				await showCheckpoint(ctx, rest);
				return;
			}

			if (command === "intensity") {
				const value = asIntensity(rest);
				if (!value) {
					ctx.ui.notify(`Usage: /grill intensity ${INTENSITIES.join("|")}`, "warning");
					return;
				}
				state.intensity = value;
				state.lastChangeSummary = `Intensity set to ${value}`;
				persist();
				updateUi(ctx);
				ctx.ui.notify(`Grill intensity: ${value}`, "info");
				return;
			}

			if (command === "intent") {
				const value = asIntent(rest);
				if (!value) {
					ctx.ui.notify(`Usage: /grill intent ${INTENTS.join("|")}`, "warning");
					return;
				}
				state.intent = value;
				state.lastChangeSummary = `Intent set to ${value}`;
				persist();
				updateUi(ctx);
				ctx.ui.notify(`Grill intent: ${value}`, "info");
				return;
			}

			if (command === "output") {
				if (!rest) {
					ctx.ui.notify("Usage: /grill output <one or more outputs, e.g. design-doc,issues>", "warning");
					return;
				}
				state.outputPreference = rest;
				state.lastChangeSummary = `Output preference set to ${rest}`;
				persist();
				updateUi(ctx);
				ctx.ui.notify(`Grill output preference: ${rest}. This is not approval; Grill Me will still ask/confirm before producing outputs.`, "info");
				return;
			}

			if (command === "research") {
				const value = asResearchMode(rest);
				if (!value) {
					ctx.ui.notify(`Usage: /grill research ${RESEARCH_MODES.join("|")}`, "warning");
					return;
				}
				state.researchMode = value;
				state.lastChangeSummary = `Research mode set to ${value}`;
				persist();
				updateUi(ctx);
				ctx.ui.notify(`Grill research mode: ${value}`, "info");
				return;
			}

			const parsed = parseArgs(trimmed);
			const partial: Partial<GrillState> = {};
			const intent = asIntent(parsed.flags.intent);
			const intensity = asIntensity(parsed.flags.intensity);
			const researchMode = asResearchMode(parsed.flags.research);
			if (intent) partial.intent = intent;
			if (intensity) partial.intensity = intensity;
			if (researchMode) partial.researchMode = researchMode;
			if (typeof parsed.flags.output === "string") partial.outputPreference = parsed.flags.output;

			let topic = parsed.rest;
			if (!topic) {
				const inferred = inferTopic(ctx);
				if (!ctx.hasUI) {
					topic = inferred || "Current conversation";
				} else {
					const edited = await ctx.ui.editor("What should I grill you about?", inferred || "");
					if (!edited?.trim()) {
						ctx.ui.notify("Cancelled grill start.", "info");
						return;
					}
					topic = edited.trim();
				}
			}

			startSession(topic, ctx, partial);
		},
	});

	pi.registerTool({
		name: "grill_update_checkpoint",
		label: "Update Grill Checkpoint",
		description: "Replace the Grill Me shared-understanding checkpoint. Use before asking the next grill question whenever meaningful understanding changes.",
		promptSnippet: "Persist the evolving Grill Me shared-understanding Markdown checkpoint",
		promptGuidelines: [
			"Use grill_update_checkpoint before asking the next question whenever an active Grill Me session reaches a meaningful new decision, clarification, assumption, risk, or open question.",
		],
		parameters: Type.Object({
			markdown: Type.String({ description: "The full replacement Markdown checkpoint." }),
			changeSummary: Type.String({ description: "Brief visible summary of what changed." }),
		}),
		async execute(_toolCallId, params) {
			if (!state.active) {
				return {
					content: [{ type: "text", text: "No active Grill Me session. Start one with /grill <topic>." }],
					details: { checkpoint: state.checkpoint, changeSummary: "No active session", updatedAt: state.updatedAt },
				};
			}
			state.checkpoint = params.markdown;
			state.lastChangeSummary = params.changeSummary;
			persist();
			return {
				content: [{ type: "text", text: `Recorded checkpoint update: ${params.changeSummary}` }],
				details: { checkpoint: state.checkpoint, changeSummary: params.changeSummary, updatedAt: state.updatedAt },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("grill_update_checkpoint ")) + theme.fg("muted", args.changeSummary ?? ""), 0, 0);
		},
		renderResult(result, _options, theme) {
			const summary = (result.details as any)?.changeSummary;
			const text = summary ? `✓ ${summary}` : result.content[0]?.type === "text" ? result.content[0].text : "Checkpoint updated";
			return new Text(theme.fg("success", text), 0, 0);
		},
	});

	pi.registerTool({
		name: "grill_set_alternatives",
		label: "Set Grill Alternatives",
		description: "Set the visible Grill Me answer alternatives offered to the user via Tab autocomplete for the next question or readiness choice.",
		promptSnippet: "Present answer alternatives through the Grill Me Tab autocomplete UX",
		promptGuidelines: [
			"Before asking each grill question, call grill_set_alternatives with 2-5 concise, concrete alternatives the user can accept or edit with Tab autocomplete.",
			"Include one recommended alternative and make it clear in the label or description.",
			"Use alternatives that are useful defaults, not exhaustive menus; the user can still type a custom answer.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question these alternatives answer." }),
			alternatives: Type.Array(
				Type.Object({
					value: Type.String({ description: "The exact reply inserted into the user's editor when selected." }),
					label: Type.String({ description: "Short visible label for the alternative." }),
					description: Type.Optional(Type.String({ description: "Brief explanation or recommendation note." })),
				}),
				{ description: "2-5 suggested replies. Include a recommended/default option." },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!state.active) {
				return {
					content: [{ type: "text", text: "No active Grill Me session. Start one with /grill <topic>." }],
					details: { alternatives: [] },
				};
			}
			state.currentQuestion = params.question;
			state.alternatives = normalizeAlternatives(params.alternatives as GrillAlternative[]);
			state.lastChangeSummary = `Set ${state.alternatives.length} Tab alternatives`;
			persist();
			if (ctx) updateUi(ctx);
			return {
				content: [{ type: "text", text: `Tab alternatives updated: ${state.alternatives.map((a) => a.label).join(", ")}` }],
				details: { question: state.currentQuestion, alternatives: state.alternatives },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("grill_set_alternatives ")) + theme.fg("muted", args.question ?? ""), 0, 0);
		},
		renderResult(result, _options, theme) {
			const alternatives = ((result.details as any)?.alternatives ?? []) as GrillAlternative[];
			const text = alternatives.length ? `✓ Tab alternatives: ${alternatives.map((a) => a.label).join(" | ")}` : "No alternatives set";
			return new Text(theme.fg(alternatives.length ? "success" : "warning", text), 0, 0);
		},
	});

	pi.registerTool({
		name: "grill_enter_output_selection_phase",
		label: "Enter Grill Output Selection",
		description: `Enter the mandatory hardcoded output-selection phase at the end of the Grill Me interview before stopping or producing outputs. The phase must explicitly mention available output destinations: ${outputDestinationOptionNames()}.`,
		promptSnippet: "Start the mandatory Grill Me output-selection phase",
		promptGuidelines: [
			"Use grill_enter_output_selection_phase after the final checkpoint update when the Grill Me interview is ready to end.",
			"Do not stop a Grill Me interview, claim the work is complete, or enter output production until grill_enter_output_selection_phase has been called and the user has selected what happens next.",
			`In the output-selection chat response, explicitly list these output destination options before asking for a choice: ${outputDestinationOptionNames()}.`,
		],
		parameters: Type.Object({
			readinessRationale: Type.String({ description: "Why shared understanding is sufficient to leave interview mode." }),
			recommendedOutputs: Type.String({ description: `One or more recommended output destinations/formats from the explicit catalog (${outputDestinationOptionNames()}), or 'none' if no artifact is recommended.` }),
			recommendedStrategy: Type.String({ description: "Recommended output strategy, distinct from destination/format." }),
			question: Type.String({ description: "The explicit output-selection question to ask the user. It should name concrete output options rather than saying only 'outputs'." }),
			alternatives: Type.Array(
				Type.Object({
					value: Type.String({ description: "The exact reply inserted into the user's editor when selected." }),
					label: Type.String({ description: "Short visible label for the alternative." }),
					description: Type.Optional(Type.String({ description: "Brief explanation or recommendation note." })),
				}),
				{ description: "2-5 choices covering produce output(s), continue grilling, review checkpoint, or stop with no output as appropriate." },
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!state.active) {
				return {
					content: [{ type: "text", text: "No active Grill Me session. Start one with /grill <topic>." }],
					details: { phase: currentPhase(state) },
				};
			}
			state.phase = "output-selection";
			state.outputPhase = false;
			state.outputSelection = {
				readinessRationale: params.readinessRationale,
				recommendedOutputs: params.recommendedOutputs,
				recommendedStrategy: params.recommendedStrategy,
				question: params.question,
			};
			state.approvedOutputPlan = undefined;
			state.currentQuestion = params.question;
			state.alternatives = normalizeAlternatives(params.alternatives as GrillAlternative[]);
			state.lastChangeSummary = "Entered mandatory output-selection phase";
			persist();
			if (ctx) updateUi(ctx);
			return {
				content: [
					{
						type: "text",
						text: `Output-selection phase is active. In the chat response, explicitly show these output destination options:\n${outputDestinationOptionsMarkdown()}\n\nThen ask the user to choose one or more, customize the set, continue grilling, review the checkpoint, or stop without output. Alternatives: ${state.alternatives.map((a) => a.label).join(", ")}`,
					},
				],
				details: { phase: currentPhase(state), outputSelection: state.outputSelection, outputDestinationOptions: OUTPUT_DESTINATION_OPTIONS, alternatives: state.alternatives },
			};
		},
		renderCall(args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("grill_enter_output_selection_phase ")) + theme.fg("muted", args.question ?? ""), 0, 0);
		},
		renderResult(result, _options, theme) {
			const selection = (result.details as any)?.outputSelection;
			const text = selection ? `✓ Output selection: ${selection.recommendedOutputs}` : result.content[0]?.type === "text" ? result.content[0].text : "Output selection phase updated";
			return new Text(theme.fg(selection ? "success" : "warning", text), 0, 0);
		},
	});

	pi.registerTool({
		name: "grill_finish_output_selection_phase",
		label: "Finish Grill Output Selection",
		description: "Resolve the mandatory output-selection phase without entering output production, either by continuing the interview or stopping with no outputs.",
		promptSnippet: "Resolve Grill Me output selection without output production",
		promptGuidelines: [
			"Use grill_finish_output_selection_phase when the user responds to the mandatory output-selection phase by choosing to continue grilling or stop without producing outputs.",
			"If the user approves concrete output production, use grill_enter_output_phase instead.",
		],
		parameters: Type.Object({
			outcome: Type.String({ description: "Either 'continue-grilling' or 'stop-without-output'." }),
			summary: Type.Optional(Type.String({ description: "Brief summary of the user's output-selection decision." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!state.active) {
				return {
					content: [{ type: "text", text: "No active Grill Me session." }],
					details: { phase: currentPhase(state), active: state.active },
				};
			}
			if (currentPhase(state) !== "output-selection") {
				return {
					content: [{ type: "text", text: "No active output-selection phase. Call grill_enter_output_selection_phase before resolving output selection." }],
					details: { phase: currentPhase(state), active: state.active },
				};
			}

			const outcome = String(params.outcome ?? "").trim().toLowerCase();
			if (outcome === "continue-grilling" || outcome === "continue" || outcome === "grill") {
				state.phase = "interview";
				state.outputPhase = false;
				state.outputSelection = undefined;
				state.currentQuestion = undefined;
				state.alternatives = [];
				state.lastChangeSummary = params.summary ? `Output selection resolved: ${params.summary}` : "Output selection resolved: continue grilling";
				persist();
				if (ctx) updateUi(ctx);
				return {
					content: [{ type: "text", text: "Returned to Grill Me interview mode. Ask the next Socratic question with grill_set_alternatives." }],
					details: { phase: currentPhase(state), active: state.active, outcome },
				};
			}

			if (outcome === "stop-without-output" || outcome === "stop" || outcome === "no-output" || outcome === "none") {
				state.active = false;
				state.phase = "interview";
				state.outputPhase = false;
				state.outputSelection = undefined;
				state.approvedOutputPlan = undefined;
				state.currentQuestion = undefined;
				state.alternatives = [];
				state.lastChangeSummary = params.summary ? `Stopped after output selection: ${params.summary}` : "Stopped after output selection without outputs";
				persist();
				if (ctx) updateUi(ctx);
				return {
					content: [{ type: "text", text: state.lastChangeSummary }],
					details: { phase: currentPhase(state), active: state.active, outcome },
				};
			}

			return {
				content: [{ type: "text", text: "Unsupported outcome. Use 'continue-grilling' or 'stop-without-output'. If outputs were approved, call grill_enter_output_phase instead." }],
				details: { phase: currentPhase(state), active: state.active, outcome },
			};
		},
	});

	pi.registerTool({
		name: "grill_enter_output_phase",
		label: "Enter Grill Output Phase",
		description: "Mark that the user approved output production after mandatory output selection, allowing the assistant to use tools required to create the approved artifacts.",
		promptSnippet: "Enter approved Grill Me output-production phase",
		promptGuidelines: [
			"Use grill_enter_output_phase only after grill_enter_output_selection_phase has run and the user explicitly approves a concrete output plan or preview during an active Grill Me session.",
			"During output phase, do not refuse approved mutating output work merely because it mutates state, such as creating GitHub issues. If a tool, CLI, platform, or pi permission/authentication gate blocks the mutation, stop and ask the user for the needed permission, confirmation, credentials, or plan change; do not bypass it or broaden scope.",
		],
		parameters: Type.Object({
			outputPlan: Type.String({ description: "The approved output plan, including one or more outputs/artifacts/files/issues and intended tool use." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!state.active) {
				return {
					content: [{ type: "text", text: "No active Grill Me session." }],
					details: { phase: currentPhase(state), outputPhase: false, outputPlan: params.outputPlan },
				};
			}
			if (currentPhase(state) !== "output-selection" && !state.outputPhase) {
				return {
					content: [{ type: "text", text: "Output production requires the mandatory output-selection phase first. Call grill_enter_output_selection_phase, ask the user to choose/approve outputs, then call grill_enter_output_phase." }],
					details: { phase: currentPhase(state), outputPhase: false, outputPlan: params.outputPlan },
				};
			}
			state.phase = "output";
			state.outputPhase = true;
			state.approvedOutputPlan = params.outputPlan;
			state.lastChangeSummary = "Entered approved output phase";
			persist();
			if (ctx) updateUi(ctx);
			return {
				content: [{ type: "text", text: `Output phase enabled for approved plan:\n${params.outputPlan}` }],
				details: { phase: currentPhase(state), outputPhase: true, outputPlan: params.outputPlan },
			};
		},
	});

	pi.registerTool({
		name: "grill_finish_output_phase",
		label: "Finish Grill Output Phase",
		description: "Return an active Grill Me session to read-only interview/planning enforcement after output production.",
		promptSnippet: "Return Grill Me to read-only interview mode after output production",
		parameters: Type.Object({
			summary: Type.Optional(Type.String({ description: "Brief summary of outputs created." })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			state.phase = "interview";
			state.outputPhase = false;
			state.outputSelection = undefined;
			state.approvedOutputPlan = undefined;
			state.lastChangeSummary = params.summary ? `Finished output phase: ${params.summary}` : "Finished output phase";
			persist();
			if (ctx) updateUi(ctx);
			return {
				content: [{ type: "text", text: state.lastChangeSummary }],
				details: { phase: currentPhase(state), outputPhase: false, summary: params.summary },
			};
		},
	});

	pi.on("tool_call", async (event) => {
		if (!state.active || state.outputPhase) return;

		if (event.toolName === "edit" || event.toolName === "write") {
			return {
				block: true,
				reason: "Grill Me is read-only until the mandatory output-selection phase runs and the user approves a concrete output plan. Call grill_enter_output_selection_phase first, then grill_enter_output_phase before writing artifacts.",
			};
		}

		if (event.toolName === "bash") {
			const command = String((event.input as any)?.command ?? "");
			if (!isProbablyReadOnlyBash(command)) {
				return {
					block: true,
					reason: `Grill Me read-only mode blocked a potentially mutating command. Run the mandatory output-selection phase with grill_enter_output_selection_phase, get output approval, then call grill_enter_output_phase first.\nCommand: ${command}`,
				};
			}
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (!state.active) return;

		const intensityGuidance: Record<Intensity, string> = {
			gentle: "Use a warm, beginner-friendly Socratic style. Still challenge ambiguity, but softly.",
			standard: "Be relentless but collaborative. Challenge vague answers, surface contradictions, and keep momentum.",
			hard: "Be skeptical and demanding. Push on assumptions, feasibility, constraints, and tradeoffs.",
			adversarial: "Act like a tough reviewer. Search for failure modes and weak evidence while staying useful and respectful.",
		};

		const researchGuidance: Record<ResearchMode, string> = {
			off: "Do not proactively inspect files or research. Ask the user instead unless they explicitly provide context.",
			ask: "If a question could be answered by inspecting files/code/research, ask permission before doing so.",
			auto: "For coding/project contexts, if a question can be answered by inspecting available files/code, inspect instead of asking. Use read-only tools during interview mode.",
		};

		const phase = currentPhase(state);
		const outputPhaseGuidance =
			phase === "output"
				? "You are in approved output phase. Use the tools required to create only the approved output(s). If multiple outputs were approved, produce all of them according to the approved plan. Do not refuse approved mutating output work merely because it mutates state, such as creating GitHub issues. If a tool, CLI, platform, or pi permission/authentication gate blocks an approved mutation, stop and ask the user for the needed permission, confirmation, credentials, or plan change; do not bypass it, fake completion, or broaden scope. When done, call grill_finish_output_phase."
				: phase === "output-selection"
					? "You are in the mandatory output-selection phase. Do not ask new interview questions unless the user chooses to continue grilling. Ask the user to choose outputs/continue/review/stop from the active output-selection alternatives. If they approve concrete output production, call grill_enter_output_phase. If they choose to continue or stop without output, call grill_finish_output_selection_phase."
					: "You are in read-only interview mode. Do not implement, write files, create issues, install packages, run mutating commands, or stop the Grill Me work. When ready to end the interview, first update the checkpoint if needed, then call grill_enter_output_selection_phase to enter the mandatory hardcoded output-selection phase before output production or stopping.";

		const outputSelectionSummary = state.outputSelection
			? `\n\nActive output selection:\n- Rationale: ${state.outputSelection.readinessRationale}\n- Recommended outputs: ${state.outputSelection.recommendedOutputs}\n- Recommended strategy: ${state.outputSelection.recommendedStrategy}\n- Question: ${state.outputSelection.question}`
			: "";

		const prompt = `\n\n[GRILL ME EXTENSION ACTIVE]\nTopic:\n${state.topic}\n\nConfiguration:\n- Intent preset: ${state.intent}\n- Intensity: ${state.intensity}\n- Research mode: ${state.researchMode}\n- Output preference: ${describeOutputPreference(state)}\n- Phase: ${phase}\n- Output phase: ${state.outputPhase ? "yes" : "no"}${outputSelectionSummary}\n\nCurrent checkpoint:\n${state.checkpoint || "(No checkpoint yet.)"}\n\nCurrent Tab alternatives:\n${state.alternatives.length ? state.alternatives.map((a) => `- ${a.label}: ${a.value}${a.description ? ` (${a.description})` : ""}`).join("\n") : "(None set.)"}\n\nBehavior:\n- Apply the Socratic method to reach shared understanding of the topic.\n- Avoid hardcoded interview phases. Adapt the dimensions you explore to the subject and to the user's expertise.\n- The output-selection phase is the one hardcoded terminal phase: it is mandatory before stopping the Grill Me work, stopping without outputs, or producing outputs.\n- Treat desired outcome mode as important: learning, building, researching, content/tutorial creation, decision review, etc.\n- Do not set or assume a default output mode for the session. A missing output preference means no output has been chosen yet, not design-doc or any other default.\n- Treat /grill output as a preference only, not production approval. Always explicitly ask/confirm which output(s) to produce before output production.\n- Support 1..n outputs in one approved output plan; for example, a design doc AND uploaded GitHub issues.\n- The output-selection phase must explicitly mention concrete output destinations by name. Use this catalog and allow custom combinations:\n${outputDestinationOptionsMarkdown()}\n- Ask mostly one focused question at a time. Small grouped questions are allowed only when inseparable.\n- Every grill question must present 2-5 concrete answer alternatives. Before asking the question, call grill_set_alternatives so the user can fill/cycle those alternatives with Tab and send the selected or edited reply with Enter. Also show the same alternatives briefly in chat.\n- Include your recommended answer by default with each grill question and mark it as recommended.\n- ${intensityGuidance[state.intensity]}\n- ${researchGuidance[state.researchMode]}\n- ${outputPhaseGuidance}\n\nCheckpoint rule:\n- The checkpoint is the source of durable shared understanding.\n- Whenever the user's answer meaningfully changes shared understanding, call grill_update_checkpoint with a full replacement Markdown checkpoint and a concise changeSummary BEFORE asking the next grill question.\n- The checkpoint should be adaptive Markdown. Add/remove sections as appropriate for the topic.\n- If there is no meaningful change, you may ask the next question without updating.\n\nReadiness/output rule:\n- When you think shared understanding is good enough, do not merely present a prompt-only readiness gate. First call grill_enter_output_selection_phase with the rationale, recommended output destination(s), recommended strategy, explicit output-selection question, and 2-5 alternatives.\n- The mandatory output-selection phase must explicitly ask the user which output(s) to produce, even if you have a recommendation or /grill output preference. In the chat response, name the concrete options from the catalog above, including GitHub issues, design doc, README.md, ADR, PRD, implementation plan, research brief, summary/decision memo, tutorial/content outline, test plan/QA checklist, and changelog/release notes.\n- Offer useful single-output and multi-output alternatives where appropriate, and make clear the user can choose 1..n outputs or customize the list.\n- Output-selection alternatives should include continue grilling and/or review checkpoint when useful, and stop-without-output when producing no artifact is a reasonable choice.\n- Output destination and strategy are separate. For example, GitHub issues can be implementation slices, tutorial chapters, research investigations, content installments, or prototype experiments.\n- For file outputs, draft before writing. For GitHub issues, preview titles/bodies/labels before creating. For multiple outputs, preview the full set and dependencies/order before creation.\n- Mutating output actions require explicit user approval of the concrete output set/plan, an active output-selection phase, and grill_enter_output_phase first.\n- During approved output phase, do not refuse approved mutating output actions merely because they mutate state. If a permission/authentication/tool gate blocks an approved mutation (for example gh issue create), ask the user for permission, confirmation, credentials, or a revised plan instead of bypassing the gate.\n- If the user chooses to continue grilling or stop without output during output selection, call grill_finish_output_selection_phase with that outcome.\n[/GRILL ME EXTENSION ACTIVE]`;

		return { systemPrompt: event.systemPrompt + prompt };
	});

	pi.on("session_start", async (_event, ctx) => {
		ctx.ui.setEditorComponent((tui, theme, keybindings) => new GrillReplyEditor(tui, theme, keybindings, () => state));
		ctx.ui.addAutocompleteProvider((current) => createGrillAutocompleteProvider(current, () => state));
		state = cloneState(DEFAULT_STATE);
		const entries = ctx.sessionManager.getBranch();
		for (const entry of entries as any[]) {
			if (entry?.type === "custom" && entry.customType === STATE_ENTRY_TYPE && entry.data) {
				state = { ...cloneState(DEFAULT_STATE), ...entry.data };
				if (state.outputPreference === LEGACY_DEFAULT_OUTPUT_PREFERENCE) state.outputPreference = "";
				if (!state.phase) state.phase = state.outputPhase ? "output" : "interview";
				if (state.phase !== "output") state.outputPhase = false;
			}
		}
		updateUi(ctx);
	});
}
