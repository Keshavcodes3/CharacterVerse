import type { Character, CharacterPersonality, CharacterProfile, CharacterVersion } from "../../generated/prisma/client.js";

export interface AgentState {
    user: { id: string; username: string };
    character: Character & { personality?: CharacterPersonality | null; profile?: CharacterProfile | null; currentVersion?: CharacterVersion | null };
    characterVersion?: CharacterVersion | null;
    conversation: { id: string; title?: string | null; summary?: string | null };
    recentMessages: Array<{ role: string; messageType?: string; content: string }>;
    memories: Array<{ content: string }>;
    retrievedDocuments: Array<{ content: string; score?: number }>;
    toolResults?: unknown[];
    metadata?: Record<string, unknown>;
}

export interface BuiltContext {
    systemPrompt: string;
    history: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    ragContext?: string | null;
}

const MAX_HISTORY = 30;
const MAX_RAG_CHARS = 3000;
const MAX_MEMORY_ITEMS = 8;

export class ContextBuilder {
    build(state: AgentState): BuiltContext {
        const c = state.character;
        const cv = state.characterVersion;
        const personality = cv ? (cv.personalitySnapshot as unknown as CharacterPersonality | null) ?? c.personality : c.personality;
        const profile = cv ? (cv.profileSnapshot as unknown as CharacterProfile | null) ?? (c.profile as unknown as CharacterProfile | null) : (c.profile as unknown as CharacterProfile | null);

        const traits = Array.isArray(personality?.traits) ? (personality!.traits as string[]).join(", ") : String(personality?.traits ?? "Not specified");
        const exDialogues = personality?.exampleDialogues
            ? (personality.exampleDialogues as unknown as Array<{ user: string; character: string }>).map((e) => `User: ${e.user}\n${c.name}: ${e.character}`).join("\n---\n")
            : "None";

        const behavioralRules = profile?.behavioralRules ? JSON.stringify(profile.behavioralRules) : "Stay in character, be consistent";
        const conversationalRules = profile?.conversationalRules ? JSON.stringify(profile.conversationalRules) : "Respond naturally as character";
        const memoriesBlock = state.memories.slice(0, MAX_MEMORY_ITEMS).map((m) => `- ${m.content}`).join("\n") || "None";
        const ragBlock = state.retrievedDocuments.slice(0, 5).map((d) => d.content).join("\n\n").slice(0, MAX_RAG_CHARS) || "None";

        // Spec §5 full identity/personality/speech/behavior/scenario/continuity/roleplay prompt
        const systemPrompt = `IDENTITY
You are ${c.name}.
You are a fictional character created for CharacterVerse.
You must remain consistent with the character specification.

PERSONALITY
${personality?.personality ?? "Not specified"}
Backstory: ${personality?.backstory ?? "Not specified"}
Traits: ${traits}
Summary: ${profile?.summary ?? c.description}

SPEECH
Speech style: ${profile?.speechStyle ?? "Natural, character-driven"}
Vocabulary: ${profile?.vocabulary ?? "Varied"}
Emotional tendencies: ${profile?.emotionalTendencies ?? "Nuanced"}
Example dialogues:
${exDialogues}

BEHAVIOR
Behavioral rules: ${behavioralRules}
Conversational rules: ${conversationalRules}
Relationship style: ${profile?.relationshipStyle ?? "Not specified"}

SCENARIO
Greeting / Opening scene: ${cv?.greeting ?? c.greeting}
Lore: ${personality?.lore ?? "Not specified"}
Knowledge: ${personality?.knowledge ?? "Not specified"}
Scenario: ${personality?.scenario ?? "Not specified"}
Interests: ${profile?.interests?.join(", ") ?? "Not specified"}
Dislikes: ${profile?.dislikes?.join(", ") ?? "Not specified"}
Motivations: ${profile?.motivations ?? "Not specified"}
Fears: ${profile?.fears ?? "Not specified"}

CONTINUITY
Conversation title: ${state.conversation.title ?? "Untitled"}
Summary: ${state.conversation.summary ?? "No summary yet"}
Recent memories:
${memoriesBlock}
Retrieved knowledge (RAG):
${ragBlock}

Current date: ${new Date().toISOString().slice(0, 10)}
User name: ${state.user.username}

ROLEPLAY
- Respond as ${c.name} only, never as an AI assistant. Do not say "as an AI".
- Use personality, speech style, behavioral rules. Natural prose: dialogue, actions (*glances*), expressions, environment, internal cues.
- Do NOT force "Name: Hello." — be natural. Example: *April glanced over her book* "You're going to burn yourself out."
- Maintain continuity: do not contradict "I hate coffee" etc without story reason. Use history/memories.
- Do not turn roleplay into generic Q&A. Do not break character unnecessarily.
- NSFW allowed: false. If false, fade-to-black. Never sexualize minors.`.trim();

        // Filter opening scene: keep it as context but not duplicated in history beyond recent
        const history = state.recentMessages
            .filter((m) => m.messageType !== "OPENING_SCENE" || state.recentMessages.indexOf(m) === 0) // keep first opening as history anchor
            .slice(-MAX_HISTORY)
            .map((m) => ({
                role: (m.role === "USER" ? "user" : m.role === "SYSTEM" ? "system" : "assistant") as "user" | "assistant" | "system",
                content: m.content,
            }));

        return { systemPrompt, history, ragContext: ragBlock !== "None" ? ragBlock : null };
    }

    estimateTokens(text: string): number { return Math.ceil(text.length / 4); }
}
