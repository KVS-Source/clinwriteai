// Social publish adapter — one interface for pushing atomised card
// content to a social channel (LinkedIn, X/Twitter, Meta, blog).
//
// Mirrors the Email + SMS adapter pattern. Ships with three dry-run
// impls (noop default, log, console) + a provider-stub registry for
// LinkedIn / X / Meta that documents the OAuth + API shape each real
// provider will need. No message actually reaches any platform until
// the real adapters land; the audit chain + PublishRecord row is the
// current source of truth.
//
// Selection: `SOCIAL_PUBLISH_PROVIDER` env var. Unset or 'noop' ⇒ noop.
// A deploy running `SOCIAL_PUBLISH_PROVIDER=log` will write every
// outgoing payload to the Fastify logger — useful for QA soak runs.

export type SocialChannel =
  | 'linkedin'
  | 'twitter'
  | 'blog'
  | 'email'
  | 'hcp'
  | 'medical_affairs'
  | 'instagram'
  | 'facebook'

export interface SocialPublishMessage {
  channel:   SocialChannel
  /** Plain-text body that will be posted. Caller is responsible for
   *  channel-specific formatting (markdown stripping for Twitter,
   *  HTML for blog, etc.) */
  body:      string
  /** Optional title for channels that have one (blog, email, LinkedIn
   *  long-form). Twitter doesn't use it; adapter will ignore. */
  title?:    string
  /** UTM params to merge into any link the channel renders. */
  utm?:      Record<string, string>
  /** SEO metadata for channels with metadata surfaces (blog especially). */
  seoMetadata?: Record<string, unknown>
  /** URLs of image / video assets the post embeds. */
  assetUrls?: string[]
  /** Optional caller tag for the log — e.g. 'launch_campaign',
   *  'kol_amplification'. */
  reason?:   string
}

export interface SocialPublishResult {
  adapter:         'noop' | 'log' | 'console' | 'linkedin' | 'twitter' | 'meta' | 'blog_cms'
  delivered:       boolean
  externalId:      string | null
  externalUrl:     string | null
  /** Channel-side identifier of the account/user that posted (when the
   *  adapter can report it — real providers always can). */
  externalAuthor?: string | null
}

export interface SocialPublishAdapter {
  publish(message: SocialPublishMessage): Promise<SocialPublishResult>
}

// --- validation helper -----------------------------------------------

const MAX_BODY_CHARS = 10_000                              // soft cap; real limits enforced by providers (280 X, 3000 LI, etc.)

function assertMessage(m: SocialPublishMessage): void {
  if (!m.channel || typeof m.channel !== 'string') throw new Error('social.channel required')
  if (!m.body || typeof m.body !== 'string')       throw new Error('social.body required')
  if (m.body.length > MAX_BODY_CHARS)               throw new Error(`social.body exceeds ${MAX_BODY_CHARS} chars`)
}

// --- dry-run impls ---------------------------------------------------

export class NoopSocialPublishAdapter implements SocialPublishAdapter {
  async publish(m: SocialPublishMessage): Promise<SocialPublishResult> {
    assertMessage(m)
    return { adapter: 'noop', delivered: false, externalId: null, externalUrl: null }
  }
}

export class LoggingSocialPublishAdapter implements SocialPublishAdapter {
  constructor(private readonly log: { info: (obj: object, msg: string) => void }) {}
  async publish(m: SocialPublishMessage): Promise<SocialPublishResult> {
    assertMessage(m)
    this.log.info({
      channel:      m.channel,
      reason:       m.reason,
      bodyChars:    m.body.length,
      hasTitle:     !!m.title,
      assetCount:   m.assetUrls?.length ?? 0,
      utmKeys:      m.utm ? Object.keys(m.utm) : [],
    }, 'social.publish (log adapter — no platform call)')
    return { adapter: 'log', delivered: false, externalId: null, externalUrl: null }
  }
}

export class ConsoleSocialPublishAdapter implements SocialPublishAdapter {
  async publish(m: SocialPublishMessage): Promise<SocialPublishResult> {
    assertMessage(m)
    process.stdout.write(
      `--- social publish (console adapter — no platform call) ---\n` +
      `channel: ${m.channel}\n` +
      (m.title  ? `title:   ${m.title}\n`   : '') +
      (m.reason ? `reason:  ${m.reason}\n` : '') +
      `assets:  ${m.assetUrls?.length ?? 0}\n` +
      `---\n${m.body}\n---\n`,
    )
    return { adapter: 'console', delivered: false, externalId: null, externalUrl: null }
  }
}

// --- provider stubs ---------------------------------------------------
//
// Each stub documents the real API's shape without making the call.
// Wire them one at a time as OAuth + API-app registration completes
// for that platform.

export class LinkedInStubAdapter implements SocialPublishAdapter {
  constructor(private readonly log?: { warn: (obj: object, msg: string) => void }) {}
  async publish(m: SocialPublishMessage): Promise<SocialPublishResult> {
    assertMessage(m)
    // Real: POST https://api.linkedin.com/v2/ugcPosts
    //   Headers: Authorization: Bearer <access_token>, LinkedIn-Version: YYYYMM
    //   Body:    { author, lifecycleState, specificContent }
    //   Returns: { id: 'urn:li:ugcPost:...' } → externalId + build URL
    this.log?.warn({ channel: m.channel }, 'social.publish (linkedin stub — adapter not yet implemented)')
    return { adapter: 'linkedin', delivered: false, externalId: null, externalUrl: null }
  }
}

export class TwitterStubAdapter implements SocialPublishAdapter {
  constructor(private readonly log?: { warn: (obj: object, msg: string) => void }) {}
  async publish(m: SocialPublishMessage): Promise<SocialPublishResult> {
    assertMessage(m)
    // Real: POST https://api.twitter.com/2/tweets (OAuth 2.0 user context)
    //   Body text ≤ 280 chars; adapter chunks or truncates.
    //   Returns: { data: { id } } → externalUrl = twitter.com/i/status/<id>
    if (m.body.length > 280) {
      this.log?.warn({ bodyChars: m.body.length }, 'social.publish (twitter stub — body > 280 chars; real adapter will truncate or chunk)')
    }
    this.log?.warn({ channel: m.channel }, 'social.publish (twitter stub — adapter not yet implemented)')
    return { adapter: 'twitter', delivered: false, externalId: null, externalUrl: null }
  }
}

export class MetaStubAdapter implements SocialPublishAdapter {
  constructor(private readonly log?: { warn: (obj: object, msg: string) => void }) {}
  async publish(m: SocialPublishMessage): Promise<SocialPublishResult> {
    assertMessage(m)
    // Real: Meta Graph API — Page feed for Facebook, /me/media for
    //   Instagram. Business verification required; permissions
    //   vary by platform. Both return { id } for the posted object.
    this.log?.warn({ channel: m.channel }, 'social.publish (meta stub — adapter not yet implemented)')
    return { adapter: 'meta', delivered: false, externalId: null, externalUrl: null }
  }
}

// --- factory ---------------------------------------------------------

export interface CreateSocialPublishAdapterOpts {
  provider?: string
  log?:      {
    info: (obj: object, msg: string) => void
    warn: (obj: object, msg: string) => void
  }
}

export function createSocialPublishAdapter(opts: CreateSocialPublishAdapterOpts = {}): SocialPublishAdapter {
  const provider = (opts.provider ?? '').toLowerCase().trim()
  const logs = opts.log ?? { info: () => undefined, warn: () => undefined }
  switch (provider) {
    case 'log':
      return new LoggingSocialPublishAdapter(logs)
    case 'console':
      return new ConsoleSocialPublishAdapter()
    case 'linkedin':
      return new LinkedInStubAdapter(logs)
    case 'twitter':
    case 'x':
      return new TwitterStubAdapter(logs)
    case 'meta':
    case 'facebook':
    case 'instagram':
      return new MetaStubAdapter(logs)
    case 'noop':
    case '':
    default:
      return new NoopSocialPublishAdapter()
  }
}
