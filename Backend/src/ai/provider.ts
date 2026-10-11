import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { aiProposalOutputSchema, type ChangeReport } from './schemas.js';
import { redactText } from '../security/redact.js';

/**
 * Provider-agnostic interface for "give me a constrained proposal for this
 * change report". Implementations must return raw (unvalidated) output; the
 * service validates it. They must never throw provider errors with secrets
 * in them: `ProviderFailure` carries a category and a redacted message.
 */

export type ProviderErrorCategory = 'TIMEOUT' | 'RATE_LIMITED' | 'AUTH' | 'BAD_REQUEST' | 'OVERLOADED' | 'CONNECTION' | 'REFUSED' | 'MALFORMED_OUTPUT' | 'UNKNOWN';

export class ProviderFailure extends Error {
  constructor(
    public readonly category: ProviderErrorCategory,
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(redactText(message).slice(0, 500));
    this.name = 'ProviderFailure';
  }
}

export interface ProposalRequest {
  report: ChangeReport;
  systemPrompt: string;
  userPrompt: string;
  timeoutMs: number;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ProposalResponse {
  /** Parsed JSON as returned by the provider's structured-output API; validated again by the service. */
  output: unknown;
  provider: string;
  model: string;
  requestId: string | null;
  usage: { inputTokens: number; outputTokens: number } | null;
  stopReason: string | null;
}

export interface AiProposalProvider {
  readonly name: string;
  readonly model: string;
  propose(request: ProposalRequest): Promise<ProposalResponse>;
}

// ---------------------------------------------------------------------------
// Anthropic (official SDK, structured outputs)
// ---------------------------------------------------------------------------

export interface AnthropicProviderOptions {
  model: string;
  apiKey?: string;
  /** Injectable for tests. */
  client?: Anthropic;
}

export class AnthropicProposalProvider implements AiProposalProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(options: AnthropicProviderOptions) {
    this.model = options.model;
    // maxRetries 0: the service owns bounded retries so attempts are observable.
    this.client = options.client ?? new Anthropic({ ...(options.apiKey ? { apiKey: options.apiKey } : {}), maxRetries: 0 });
  }

  async propose(req: ProposalRequest): Promise<ProposalResponse> {
    const message = await (async () => {
      try {
        return await this.client.messages.parse(
        {
          model: this.model,
          max_tokens: req.maxOutputTokens,
          system: [{ type: 'text', text: req.systemPrompt, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: req.userPrompt }],
          output_config: { format: zodOutputFormat(aiProposalOutputSchema), effort: 'high' },
        },
        { timeout: req.timeoutMs, ...(req.signal ? { signal: req.signal } : {}) },
      );
      } catch (err) {
        throw classifyAnthropicError(err);
      }
    })();
    if (message.stop_reason === 'refusal') {
      const category = message.stop_details && 'category' in message.stop_details ? String(message.stop_details.category) : 'unspecified';
      throw new ProviderFailure('REFUSED', `model declined to answer (${category})`, false);
    }
    if (message.stop_reason === 'max_tokens') throw new ProviderFailure('MALFORMED_OUTPUT', 'output truncated at max_tokens', false);
    if (message.parsed_output === null || message.parsed_output === undefined) {
      throw new ProviderFailure('MALFORMED_OUTPUT', 'structured output could not be parsed', false);
    }
    return {
      output: message.parsed_output,
      provider: this.name,
      model: message.model,
      requestId: message._request_id ?? null,
      usage: { inputTokens: message.usage.input_tokens, outputTokens: message.usage.output_tokens },
      stopReason: message.stop_reason,
    };
  }
}

function classifyAnthropicError(err: unknown): ProviderFailure {
  if (err instanceof ProviderFailure) return err;
  // Most specific first; APIConnectionError is a subclass of APIError in this SDK.
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) return new ProviderFailure('AUTH', 'provider rejected the credential', false, err.status);
  if (err instanceof Anthropic.RateLimitError) return new ProviderFailure('RATE_LIMITED', 'provider rate limit', true, err.status);
  if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError || err instanceof Anthropic.UnprocessableEntityError) return new ProviderFailure('BAD_REQUEST', `provider rejected the request: ${err.message}`, false, err.status);
  if (err instanceof Anthropic.InternalServerError) {
    const status = typeof err.status === 'number' ? err.status : undefined;
    return new ProviderFailure(status === 529 ? 'OVERLOADED' : 'UNKNOWN', `provider error ${status ?? ''}`, true, status);
  }
  if (err instanceof Anthropic.APIConnectionTimeoutError) return new ProviderFailure('TIMEOUT', 'provider request timed out', true);
  if (err instanceof Anthropic.APIUserAbortError) return new ProviderFailure('TIMEOUT', 'provider request aborted', false);
  if (err instanceof Anthropic.APIConnectionError) return new ProviderFailure('CONNECTION', 'could not reach provider', true);
  if (err instanceof Anthropic.APIError) {
    const status = typeof err.status === 'number' ? err.status : undefined;
    return new ProviderFailure('UNKNOWN', `provider error: ${err.message}`, (status ?? 500) >= 500, status);
  }
  if (err instanceof Error && err.name === 'AbortError') return new ProviderFailure('TIMEOUT', 'provider request aborted', false);
  return new ProviderFailure('UNKNOWN', err instanceof Error ? err.message : String(err), false);
}

// ---------------------------------------------------------------------------
// Mock (tests, demos without a key)
// ---------------------------------------------------------------------------

export type MockBehaviour =
  | { kind: 'output'; output: unknown; requestId?: string }
  | { kind: 'error'; failure: ProviderFailure }
  | { kind: 'hang' }
  | { kind: 'script'; fn: (req: ProposalRequest, attempt: number) => unknown };

export class MockProposalProvider implements AiProposalProvider {
  readonly name = 'mock';
  readonly model: string;
  readonly requests: ProposalRequest[] = [];
  private queue: MockBehaviour[] = [];
  private attempts = 0;

  constructor(model = 'mock-model') {
    this.model = model;
  }

  /** Queue behaviours in order; the last one repeats. */
  respondWith(...behaviours: MockBehaviour[]): void {
    this.queue.push(...behaviours);
  }
  reset(): void {
    this.queue = [];
    this.requests.length = 0;
    this.attempts = 0;
  }

  async propose(req: ProposalRequest): Promise<ProposalResponse> {
    this.requests.push(req);
    this.attempts += 1;
    const behaviour = this.queue.length > 1 ? (this.queue.shift() as MockBehaviour) : (this.queue[0] ?? defaultBehaviour(req));
    switch (behaviour.kind) {
      case 'error':
        throw behaviour.failure;
      case 'hang':
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, req.timeoutMs + 5_000);
          timer.unref();
          req.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new ProviderFailure('TIMEOUT', 'mock provider aborted', false));
          });
        });
        throw new ProviderFailure('TIMEOUT', 'mock provider hung', true);
      case 'script': {
        const output = await behaviour.fn(req, this.attempts);
        return { output, provider: this.name, model: this.model, requestId: `mock-${this.attempts}`, usage: { inputTokens: 100, outputTokens: 50 }, stopReason: 'end_turn' };
      }
      case 'output':
        return { output: behaviour.output, provider: this.name, model: this.model, requestId: behaviour.requestId ?? `mock-${this.attempts}`, usage: { inputTokens: 100, outputTokens: 50 }, stopReason: 'end_turn' };
    }
  }
}

/** Without scripted behaviour the mock derives a plausible proposal from the report (demo mode). */
function defaultBehaviour(req: ProposalRequest): MockBehaviour {
  const c = req.report.structuralChanges;
  const removed = c.removed[0];
  const added = c.added[0];
  const baseField = req.report.baseMapping.find((m) => m.from === (removed ?? '').replace(/\[\]/g, ''));
  if (removed && added && baseField) {
    return {
      kind: 'output',
      output: {
        summary: `Field ${removed} appears to have been renamed to ${added}.`,
        change_type: 'field_renamed',
        transformation: { type: 'rename_field', rename_field: { from: removed, renamed_to: added, internal_field: baseField.internalField, expected_type: baseField.expectedType }, field_path_mapping: null, enum_mapping: null },
        fields_affected: [removed, added],
        assumptions: ['The new field carries the same value as the old one.'],
        ambiguities: [],
        evidence: [{ claim: `${added} is present in the new sample where ${removed} was`, sample: 'both', path: added }],
        suggested_tests: [{ name: 'renamed payload normalises', input_description: `payload with ${added}`, expected_outcome: `internal ${baseField.internalField} populated` }],
        unsafe_reasons: ['Name similarity is not proof of identical semantics.'],
        confidence: 'medium',
      },
    };
  }
  return {
    kind: 'output',
    output: {
      summary: 'The change cannot be mapped with a supported transformation from the samples given.',
      change_type: 'unknown',
      transformation: { type: 'none', rename_field: null, field_path_mapping: null, enum_mapping: null },
      fields_affected: [],
      assumptions: [],
      ambiguities: ['No clear correspondence between removed and added fields.'],
      evidence: [],
      suggested_tests: [],
      unsafe_reasons: ['Guessing a mapping could silently corrupt data.'],
      confidence: 'low',
    },
  };
}
