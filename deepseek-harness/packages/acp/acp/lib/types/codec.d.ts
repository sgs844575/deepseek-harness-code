/**
 * Pure translation between the harness lifecycle and the automation-only ACP wire.
 * @module @deepseek-ai/dsh-acp/codec
 */
import type { ContentBlock as AcpContentBlock, StopReason } from '@agentclientprotocol/sdk';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
/**
 * Map a harness turn ending to ACP's terminal reason vocabulary.
 * @param reason - harness turn outcome.
 * @returns the closest legal ACP stop reason.
 */
export declare function turnEndToStopReason(reason: TurnEndReason): StopReason;
/**
 * Flatten an ACP prompt's baseline blocks to text. Text blocks concatenate
 * verbatim; resource links become explicit textual references so a baseline
 * client can point at files without the bridge silently dropping that context.
 * @param prompt - supported ACP prompt blocks.
 * @returns text in wire order, with resource links rendered as bracketed references.
 */
export declare function acpPromptToText(prompt: readonly AcpContentBlock[]): string;
/**
 * Whether a prompt carries content beyond the ACP baseline. The spec requires
 * every agent to accept `text` and `resource_link`; richer inline payloads
 * (image, audio, embedded resource) are optional capabilities this bridge does
 * not advertise, so they are rejected rather than silently dropped.
 * @param prompt - ACP prompt blocks to inspect.
 * @returns `true` when any block is neither `text` nor `resource_link`.
 */
export declare function promptHasUnsupportedContent(prompt: readonly AcpContentBlock[]): boolean;
//# sourceMappingURL=codec.d.ts.map