# Skill 知识库索引

> 自动生成于 2026-09-11 15:47 UTC，共 **252** 个 skill，分 12 组。
>
> 重新生成：`./knowledge/scripts/sync-skills.sh`

## Agent 使用说明

1. **先在本索引定位 skill 名**，再读它的 `SKILL.md`，不要全库扫描。
2. 需要细节时再读同目录 `references/` 下的文件。
3. skill 根目录通常在 `vault/<分类>/<skill名>/`。
4. 隔离清单见 `_quarantine.txt`——那些文件含凭据，未复制、需要时回源目录读。

## 01-sent2x-增长（12）

| skill | 参考文档 | 描述 |
|---|---|---|
| `proma-coach` | 0 | Proma 使用顾问，主动把用户在 Proma/Agent/Skill/Chat 工具/项目里的摩擦、疑惑、重复解释和低效流程，转成更顺手的使用方式或合适的知识维护动作。触发要积极：用户表达不满、困惑、重复提醒、"为什么没用/不会自动/又要我说"、"算了，我自己来"、"你上次不是说..."、"你又忘了"、"以后都这样/能不能记住/少让我选/下次自动"、询问 Proma 怎么用更好、某事能不能固化、该用 Agent 还是 Chat 工具、… |
| `sent2x-backlink-watch` | 0 | 每天 9:30 看守外链战役：到期动作提醒 + 各目录 listing 外链是否真上线（只读+更新文档，不代发） |
| `sent2x-bip-replies` | 0 | Use Grok to find popular #buildinpublic posts on X, generate thoughtful English replies in a learner tone, and schedule them via Sent2X CLI. Combines grok-ai-proxy for research + Sent2X CLI for execution. |
| `sent2x-bot-knowledge` | 0 | > 维护 sent2x.com 官网客服机器人（ConnectBot）的知识库 public/bot-knowledge.md， 并把它同步进机器人。触发：「更新机器人知识库」「bot 知识库」「客服 bot 回答不对」 「/bot-knowledge」，或产品价格 / 限额 / 安装流程 / 功能有变化时。 |
| `sent2x-cold-email` | 0 | Sent2X 外联日常。补过审核库存、写 X 私信稿（Lucy 自己发）、她开口后才在 zzalex Gmail 起草定时。含 SocialData 核 7 天、邮箱 provenance、PECR、产品边界、UTM、ledger。Lucy 说「今日冷邮件」「今天发信」「outreach」「补库存」「私信稿」时使用。 |
| `sent2x-geo-blog-daily` | 0 | 每天 6:43 刷新 sent2x.com 的权威 GEO 页（优先改写，禁止互抢新文）并 IndexNow 提交 |
| `sent2x-growth-daily` | 0 | 每天 8:17 出 Sent2X 数据日报 + GEO 博客核查（只读，不发布任何内容） |
| `sent2x-ih-daily` | 0 | Sent2X Indie Hackers daily drafts and sending. Local ego-lite research, English drafts in chat, then agent clicks Reply/Post to send. Use when Lucy says 今日 IH, Indie Hackers 草稿, IH 评论稿, 帮我发, posted, 发了, or the IH daily a… |
| `sent2x-pitch` | 0 | Draft an English X reply in Alex Echo's voice that answers 'what are you building?' or naturally plugs his projects (Sent2X, digital resources site) into a thread. Use when Alex shares a tweet/thread/screenshot and wants… |
| `sent2x-reddit-daily` | 0 | Sent2X 每日增长闭环。用 ego-lite 只读找 Reddit 买家帖、写评论稿和每周一篇自贴稿、更新中文排期、每周读数。目标是资料页 / 落地页 / GitHub 的点击和 Free 注册，不是每天发一条。不代发、不 push。Lucy 说「今日 Reddit」「增长工作流」「给我今天的评论稿」时使用。 |
| `sent2x-seo-audit` | 0 | > Sent2X 官网增长闭环（sent2x.com）。目标是可归因的 Free 注册和付费，不是 SEO 分数。 每天一个能上线的主活（转化 > 落地页 > snippet），每周一做深度核对（GSC 90 天、剪页、全站审计、商店词、提案）。 触发：本地 Cursor Automation，或聊天 /blog seo-audit、/sent2x-seo-audit、「今天检查一下 SEO」。 不写重叠的 X-scheduler 文章… |
| `sent2x-site-growth` | 0 | Daily Sent2X website growth — raise popularity, CTR, and AI/search exposure via GEO page refresh, IndexNow, crawler access, and cannibalization gates. Use whenever the user mentions Sent2X SEO, GEO, 曝光, 点击率, 流量, llms.txt… |

## 02-alexsignal-博客（1）

| skill | 参考文档 | 描述 |
|---|---|---|
| `alexsignal-daily-blog` | 0 | Daily local job for alexsignal.com, run manually by Lucy. Read GSC, GA4, Bing AI Performance and the Sent2X admin stats through ego lite first, harvest clicks and playbook conversions on pages Google already shows, fix c… |

## 03-小红书-内容（4）

| skill | 参考文档 | 描述 |
|---|---|---|
| `baoyu-xhs-images` | 22 | Generates Xiaohongshu (Little Red Book) infographic series with 11 visual styles and 8 layouts. Breaks content into 1-10 cartoon-style images optimized for XHS engagement. Use when user mentions "小红书图片", "XHS images", "R… |
| `psych-lesson-pack` | 0 | >- Deprecated name. Use pptgen. Builds a sellable Chinese mental-health lesson PPT pack. Triggers: 心理课, 心理健康课, 开学心理第一课, 团体辅导课件, 备课热点, remaking a teacher PPT, 课堂资料包, PPT资源包, 商品运营包, 小红书运营资料. |
| `xhs-banhui-scan` | 0 | 搜小红书课件热点并给出可跟单选品。浏览器首选 ego lite（macOS）；没有 ego 时用用户贴的数字/截图或 Cursor 内置浏览器。不用 OpenClaw、不用 Playwright。用户提到搜索热点、跟单、主题班会ppt、班会课件、班干部、家长会、开学第一课、备课热销、发布商品、商品贴纸时必须使用。目的是找正在热的班主任课件场景，交给 pptgen 做成课件包上架。选品看收藏和评论，不看赞。未登录只提醒扫码。" user-… |
| `xiaohongshu-ops` | 0 | 小红书相关操作，覆盖账号定位、选题研究、内容生产、发布执行与复盘修复的小红书全链路运营技能。凡是小红书的浏览/搜索/发布/评论任务，默认必须使用 OpenClaw 内置浏览器流程并指定 profile=\"openclaw\"；除非用户明确要求，否则不要使用系统 open 或外部浏览器。 |

## 04-App-Store-iOS（17）

| skill | 参考文档 | 描述 |
|---|---|---|
| `app-store-optimization` | 2 | Optimize App Store product pages for search visibility and conversion. Use for App Store Optimization (ASO), keyword research, app name/subtitle/keyword-field strategy, conversion-focused descriptions and promotional tex… |
| `app-store-review` | 2 | Audits App Store submission readiness and rejection risk across current review guidelines, PrivacyInfo.xcprivacy and required-reason APIs, privacy labels, ATT, StoreKit payments, metadata, entitlements, widgets, and Live… |
| `app-store-screenshots` | 0 | Use when building App Store or Google Play screenshot pages, generating exportable marketing screenshots for iOS and/or Android apps, or scaffolding a screenshot editor with Next.js. Triggers on app store, play store, sc… |
| `apple-business-connect` | 0 | When the user wants to optimize their Apple Maps listing, set up Apple Business Connect, or improve visibility in Apple's ecosystem. Also use when the user mentions "Apple Maps," "Apple Business Connect," "Siri local," "… |
| `apple-design` | 0 | Apple's approach to interface design and fluid, physical motion, translated for the web. Use when building or reviewing gesture-driven UI, spring animations, drag/swipe/sheet interactions, momentum and interruptible tran… |
| `appllama-app-design-skill` | 5 | Build native-feeling, benchmark-quality mobile app screens (Expo / React Native). Use when designing or implementing any mobile UI — screens, flows, onboarding, paywalls, tab bars, sheets, settings, empty states — or whe… |
| `asc-cli-usage` | 0 | Guidance for using asc cli in this repo (flags, output formats, pagination, auth, and discovery). Use when asked to run or design asc commands or interact with App Store Connect via the CLI. |
| `asc-localize-metadata` | 0 | Automatically translate and sync App Store metadata (description, keywords, what's new, subtitle) to multiple languages using LLM translation and asc CLI. Use when asked to localize an app's App Store listing, translate … |
| `asc-metadata-sync` | 0 | Sync, validate, and apply App Store metadata with the current asc canonical metadata workflow. Use when updating metadata, localizations, keywords, or migrating legacy fastlane metadata. |
| `asc-release-flow` | 1 | Orchestrate App Store releases with asc, including staging a version, uploading or building an artifact, publishing, and submitting for review. Use when the user wants to prepare or execute a release. Keep Game Center it… |
| `asc-signing-setup` | 0 | Set up bundle IDs, capabilities, signing certificates, provisioning profiles, and encrypted signing sync with the asc cli. Use when onboarding a new app, rotating signing assets, or sharing them across a team. |
| `asc-submission-health` | 3 | Diagnose App Store submission blockers and operate review health with asc, including readiness validation, repair routing, status monitoring, cancellation, and retry decisions. Use when validation fails, a version is not… |
| `improve-animations` | 0 | Survey a codebase's animation and motion code as a senior motion advisor, then produce a prioritized audit and self-contained implementation plans for other agents (or cheaper models) to execute. Read-only on source code… |
| `iosship` | 0 | >- Ship an iOS or Mac app to the App Store, Lucy's way. iOS ship flow: Appllama reference study, Emil apple-design interaction, SwiftUI Agent code, then App Store listing, screenshots, cover, pricing, and review submit. … |
| `review-animations` | 0 | Reviews animation and motion code against a high craft bar derived from Emil Kowalski's design engineering philosophy. Default to flagging; approval is earned. disable-model-invocation: true |
| `swiftui-pro` | 9 | Comprehensively reviews SwiftUI code for best practices on modern APIs, maintainability, and performance. Use when reading, writing, or reviewing SwiftUI projects. |
| `write-swift` | 0 | How to write modern Swift well — modeling with value types, Swift 6 data-race safety and approachable concurrency (@concurrent, main-actor-by-default, actors, task groups), protocols and generics (some vs any), API desig… |

## 05-博客写作包（34）

| skill | 参考文档 | 描述 |
|---|---|---|
| `blog` | 22 | > Full-lifecycle blog engine with 31 sub-skills, 12 templates, 100-point scoring, and 5 agents. Routes requests to the right sub-skill: writing, rewriting, analysis, outlines, audits, schema, charts, images, repurposing,… |
| `blog-analyze` | 0 | > Audit and score blog posts on a 5-category 100-point scoring system covering content quality, SEO optimization, E-E-A-T signals, technical elements, and AI citation readiness. Includes advisory editorial style diagnost… |
| `blog-audio` | 1 | > Generate audio narration of blog posts using Google Gemini TTS. Supports summary narration, full article read-aloud, and two-speaker podcast/dialogue mode with 30 voice options. Outputs MP3 with HTML5 audio embed code.… |
| `blog-audit` | 0 | > Full-site blog health assessment scanning all blog files for quality scores, orphan pages, topic cannibalization, stale content, and AI citation readiness. Runs canonical batch analysis before site-wide checks. Produce… |
| `blog-brand` | 0 | > Establish durable brand and voice context for cross-skill consumption. Generates BRAND.md (audience, positioning, do/don't editorial rules, taboo phrases, competitor differentiation) and VOICE.md (existing persona JSON… |
| `blog-brief` | 0 | > Generate detailed content briefs for blog posts with target keywords, content outlines, competitive analysis, recommended statistics, image and chart suggestions, word count targets, internal linking architecture, temp… |
| `blog-calendar` | 0 | > Generate editorial calendars for blogs with topic clusters, publishing schedules, material-change reviews, update plans, seasonal opportunities, content mix formula, template integration, and distribution scheduling. P… |
| `blog-cannibalization` | 0 | > Detect keyword cannibalization across blog posts by extracting primary keywords from titles and headings, clustering semantically similar targets, and flagging posts competing for the same search intent. Supports local… |
| `blog-chart` | 0 | > Generate dark-mode-compatible inline SVG data visualization charts for blog posts. Supports horizontal bar, grouped bar, donut, line, lollipop, area, and radar charts with automatic platform detection (HTML vs JSX/MDX)… |
| `blog-cluster` | 3 | > Semantic topic cluster planning and automated execution engine for claude-blog. Performs SERP-based keyword research, groups keywords by search intent and SERP overlap, builds a hub-and-spoke cluster architecture, gene… |
| `blog-decay` | 0 | Detect content decay from Google Search Console exports by comparing current and previous page performance, flagging quarter-over-quarter traffic drops, dropped pages, and refresh, consolidate, prune, or query-shift acti… |
| `blog-discourse` | 0 | > Research what people are actually saying about a topic in the last 30 days across Reddit, X / Twitter, YouTube, Hacker News, dev.to, Medium, and other public discourse platforms. API-free; uses WebSearch with platform-… |
| `blog-factcheck` | 0 | > Verify statistics and claims in blog posts by fetching cited source URLs and checking if the claimed data actually appears on the page. Extracts all load-bearing claims (statistics, product or policy claims, ranking an… |
| `blog-flow` | 33 | > FLOW framework integration for bloggers. Evidence-led content workflow using the Find, Optimize, Win loop with stage-specific AI prompts from the FLOW knowledge base (30 blog-applicable prompts, CC BY 4.0). Use when us… |
| `blog-geo` | 0 | > AI citation readiness audit as part of SEO, covering classic Google search and AI search surfaces together. Use whenever the user wants their content to rank or be cited in ChatGPT, Perplexity, Claude, Gemini, Copilot,… |
| `blog-google` | 4 | > Google API integration for blog performance: PageSpeed Insights, CrUX Core Web Vitals with 25-week history, Search Console performance, URL Inspection, Indexing API, GA4 organic traffic, NLP entity analysis for E-E-A-T… |
| `blog-image` | 3 | > AI image generation and editing for blog content powered by Gemini via MCP. Generates hero images, inline illustrations, social preview cards, and OG images, and edits existing ones. Supports 6 domain modes (Editorial,… |
| `blog-locale-audit` | 0 | > Audit a directory of multilingual blog content for completeness, consistency, hreflang correctness, meta-tag parity, and freshness. Builds a translation coverage matrix, flags stale translations, validates hreflang and… |
| `blog-localize` | 0 | > Deep cultural adaptation of translated blog posts. Run after blog-translate completes. Goes beyond translation to swap brand examples, adapt CTAs, substitute legal references, localize statistic sources where possible,… |
| `blog-multilingual` | 0 | > One-command multilingual blog creation. Writes a blog post, translates it into user-specified languages, applies cultural adaptation, and emits hreflang tags, sitemap entries, and a CMS-ready language map. The complete… |
| `blog-notebooklm` | 2 | > Query Google NotebookLM notebooks for source-grounded, citation-backed answers from user-uploaded documents. Manages notebook library, handles Google authentication, and supports smart discovery. Works standalone via /… |
| `blog-outline` | 0 | > SERP-informed outline generation with H2/H3 heading hierarchy, competitive content gap analysis, section-by-section word count targets, chart and image placement markers, optional FAQ question planning, and internal li… |
| `blog-persona` | 0 | > Create and manage writing personas with NNGroup 4-dimension tone framework (Funny-Serious, Formal-Casual, Respectful-Irreverent, Enthusiastic-Matter-of-fact). Personas define readability targets, sentence length distri… |
| `blog-repurpose` | 0 | > Repurpose blog posts for social media, email, video, podcast, and community channels. Generates Twitter/X threads, LinkedIn posts and articles, Threads, Bluesky, TikTok, Instagram, YouTube Shorts and long-form scripts,… |
| `blog-rewrite` | 0 | > Rewrite and optimize existing blog posts for Google SEO (May 2026 Core Update, E-E-A-T) and AI citation visibility as one SEO discipline. For AI-citation-only audit (no Google work), use blog-geo instead. Replaces fabr… |
| `blog-schema` | 0 | > Generate complete JSON-LD schema markup for blog posts with Article/BlogPosting, Person, Organization, BreadcrumbList, ImageObject, and optional FAQPage. Validates against Google requirements and warns about deprecated… |
| `blog-seo-check` | 0 | > Post-writing SEO validation with pass/fail checklist covering title tag length and keyword placement, meta description quality, heading hierarchy and keyword density, internal/external link audit with anchor text analy… |
| `blog-strategy` | 0 | > Blog strategy development including topic cluster architecture with hub-and-spoke design, audience mapping, competitive landscape analysis, AI citation surface strategy across ChatGPT/Perplexity/AI Overviews, distribut… |
| `blog-style` | 0 | Learn author writing style from 5 to 10 existing blog posts and generate a voice profile for /blog style learn, VOICE.md, blog-persona, and blog-write when users ask to infer tone, analyze author voice, learn style, or b… |
| `blog-taxonomy` | 0 | > Extract, suggest, and sync tags and categories for blog posts across all major CMS platforms. Supports WordPress REST API, Shopify GraphQL, Ghost Content API, Strapi REST/GraphQL, and Sanity GROQ. Generates tag suggest… |
| `blog-translate` | 2 | > Translate existing blog posts into one or more target languages with SEO-optimized localization. Produces native-quality translations that preserve markdown structure, frontmatter, schema JSON-LD, image and chart embed… |
| `blog-write` | 1 | > Write new blog articles from scratch optimized for Google rankings and AI citations. Generates full articles with template selection, answer-first formatting, Key Takeaways summary box, information gain markers, eviden… |
| `brief` | 0 | Manages persistent work state (briefs) for local SEO engagements. Automatically load this skill when starting work on a specific business or location, when a user says "resume," "continue," "pick up where we left off," o… |
| `claude-blog-brain` | 22 | > Scaffold and operate Claude Blog Brain, a source-cited Obsidian brain for blog content creation, optimization, and management dual-optimized for Google rankings (E-E-A-T, the 2026 core updates) and AI citations (GEO/AE… |

## 06-SEO-GEO-本地（81）

| skill | 参考文档 | 描述 |
|---|---|---|
| `ahrefs-tool` | 0 | When the user wants backlink analysis, link gap analysis, competitor link profiles, referring domain data, or link building research. Trigger on "backlinks," "who links to," "link profile," "referring domains," "link gap… |
| `ai-local-search` | 0 | When the user wants to optimize for AI-powered local search results including Google AI Overviews, AI Mode, ChatGPT, Gemini, Perplexity, or Grok. Also use when the user mentions "AI Overviews," "AI search local," "ChatGP… |
| `bing-places` | 0 | When the user wants to optimize their Bing Maps listing, set up Bing Places for Business, or improve visibility in Microsoft's search ecosystem. Also use when the user mentions "Bing Places," "Bing Maps," "Bing local," "… |
| `brightlocal-tool` | 0 | When the user wants citation audits, citation building, review monitoring across platforms, GBP audit scoring, or white-label local SEO reports. Trigger on "citation audit," "check my citations," "NAP consistency," "wher… |
| `client-deliverables` | 0 | > When the user needs to create a client-facing document such as an SEO audit, proposal, scope of work, competitive analysis report, onboarding document, or market intelligence report. Also use when the user mentions "au… |
| `dataforseo-tool` | 0 | When the user needs bulk SERP data, local pack data at scale, keyword volumes for hundreds of terms at once, Google Maps business data programmatically, or is building custom local SEO tools/dashboards. Trigger on "bulk … |
| `dispatch` | 0 | Quick-reference for which skills to load together based on what the user is asking. Load this FIRST when a local SEO request comes in and you're unsure which skills to activate. This prevents loading all skills when you … |
| `gbp-api-automation` | 0 | When the user wants to programmatically manage Google Business Profiles at scale via API, automate GBP updates, build GBP management tools, or integrate GBP data into their systems. Also use when the user mentions "GBP A… |
| `gbp-optimization` | 0 | When the user wants to set up, optimize, or manage a Google Business Profile, or improve visibility in Google's local map pack. Also use when the user mentions "GBP," "Google Business Profile," "Google My Business," "GMB… |
| `gbp-posts` | 0 | When the user wants to create, schedule, or optimize Google Business Profile posts. Also use when the user mentions "GBP posts," "Google posts," "GMB updates," "business profile posts," "what should I post on Google," or… |
| `gbp-suspension-recovery` | 0 | When the user's Google Business Profile has been suspended, disabled, or is under review. Also use when the user mentions "suspended," "GBP suspension," "listing disabled," "profile removed," "reinstatement," "Google sus… |
| `geo` | 0 | > GEO-first SEO analysis tool. Optimizes websites for AI-powered search engines (ChatGPT, Claude, Perplexity, Gemini, Google AI Overviews) while maintaining traditional SEO foundations. Performs full GEO audits, citabili… |
| `geo-audit` | 0 | Full website GEO+SEO audit with parallel subagent delegation. Orchestrates a comprehensive Generative Engine Optimization audit across AI citability, platform analysis, technical infrastructure, content quality, and sche… |
| `geo-brand-mentions` | 0 | Brand mention and authority scanner for AI visibility. Analyzes brand presence across platforms that AI models rely on for entity recognition and citation decisions. Produces a Brand Authority Score (0-100) with platform… |
| `geo-citability` | 0 | AI citability scoring and optimization. Analyzes web page content to determine how likely AI systems (ChatGPT, Claude, Perplexity, Gemini) are to cite or quote passages from the page. Provides a citability score (0-100) … |
| `geo-cold-start` | 3 | Generate blog posts, articles, guides, and FAQ pages optimized for AI citation (ChatGPT, Perplexity, Gemini, AI Overviews). Optimizes for citation share, not keyword rank. Also handles llms.txt generation, site-level GEO… |
| `geo-compare` | 0 | > Monthly delta tracking and progress reporting for GEO clients. Compares two GEO audits (baseline vs. current), calculates score improvements across all categories, tracks action item completion, and generates a "here's… |
| `geo-content` | 0 | Content quality and E-E-A-T assessment for AI citability — evaluate experience, expertise, authoritativeness, trustworthiness, and content structure |
| `geo-crawlers` | 0 | AI crawler access analysis. Checks robots.txt, meta tags, and HTTP headers to determine which AI crawlers can access the site. Provides a complete access map and recommendations for maximizing AI visibility while maintai… |
| `geo-llmstxt` | 0 | Analyzes and generates llms.txt files -- the emerging standard for helping AI systems understand website structure and content. Can validate existing llms.txt files or generate new ones from scratch by crawling the site.… |
| `geo-platform-optimizer` | 0 | Platform-specific AI search optimization — audit and optimize for Google AI Overviews, ChatGPT, Perplexity, Gemini, and Bing Copilot individually |
| `geo-proposal` | 0 | > Auto-generate a professional, client-ready GEO service proposal from audit data. Creates a full proposal in markdown and PDF including executive summary, findings, recommended service packages (Basic/Standard/Premium),… |
| `geo-prospect` | 0 | > CRM-lite for managing GEO agency prospects and clients. Track leads through the full sales pipeline: Lead → Qualified → Proposal Sent → Won → Lost. Store audit history, notes, deal values, and generate pipeline summari… |
| `geo-report` | 0 | Generate a professional, client-facing GEO report combining all audit results into a single deliverable with scores, findings, and prioritized actions |
| `geo-report-pdf` | 0 | Generate a professional PDF report from a GEO audit using pandoc + Chrome headless. Converts GEO-AUDIT-REPORT.md into a styled, client-ready PDF with a cover page, color-coded score tables, severity-tagged findings, and … |
| `geo-schema` | 0 | Schema.org structured data audit and generation optimized for AI discoverability — detect, validate, and generate JSON-LD markup |
| `geo-technical` | 0 | Technical SEO audit with GEO-specific checks — crawlability, indexability, security, performance, SSR, and AI crawler access |
| `geo-update` | 0 | Pull the latest GEO-SEO skill updates from the upstream repository. Compares installed files against the latest release, shows what changed, and updates all skills, agents, scripts, and schema templates in place. allowed… |
| `geogrid-analysis` | 0 | When the user wants to analyze local ranking data using geogrid scans, interpret map pack rankings across a geographic area, or understand ARP/ATRP/SoLV metrics. Also use when the user mentions "geogrid," "rank grid," "l… |
| `google-analytics-tool` | 0 | When the user wants traffic data, conversion tracking, user behavior on location pages, GBP traffic attribution, or geographic traffic patterns. Trigger on "Google Analytics," "GA4," "traffic," "conversions," "how many l… |
| `google-search-console-tool` | 0 | When the user wants to know what queries drive traffic to their site, which pages are indexed, click-through rates, organic search performance, or technical indexing issues. Trigger on "Search Console," "GSC," "what keyw… |
| `local-citations` | 0 | When the user wants to build citations, fix NAP inconsistencies, manage business directory listings, or audit citation presence. Also use when the user mentions "citations," "NAP consistency," "business directories," "li… |
| `local-competitor-analysis` | 0 | When the user wants to analyze local search competitors, benchmark against map pack rivals, or understand why competitors outrank them. Also use when the user mentions "competitor analysis," "who's outranking me," "compe… |
| `local-content-briefs` | 0 | Generate complete semantic content briefs for local SEO content — location pages, service pages, blog posts, FAQ content, and pillar pages. Use this skill when the user needs a content brief for any piece of local SEO co… |
| `local-content-strategy` | 0 | Build a complete local content strategy from keyword research output. Use this skill when the user has completed keyword research and needs to organize keywords into concept clusters, assign each cluster to the right con… |
| `local-falcon-tool` | 0 | When the user wants to run a geogrid scan, check existing scan reports, track ranking trends over time, monitor GBP changes via Falcon Guard, or analyze reviews. Also use when the user says "run a scan," "check my rankin… |
| `local-keyword-research` | 0 | When the user wants to research keywords for a local business, find local search opportunities, build a keyword map for location pages, or understand local search intent. Also use when the user mentions "local keywords,"… |
| `local-landing-pages` | 0 | When the user wants to create location pages, service-area pages, city pages, or locally-relevant content for SEO. Also use when the user mentions "location pages," "city pages," "service area pages," "local landing page… |
| `local-link-building` | 0 | When the user wants to build local backlinks, earn links from community organizations, or develop a local link building strategy. Also use when the user mentions "local links," "local backlinks," "community links," "spon… |
| `local-ppc-ads` | 0 | When the user wants to run geographically targeted Google Ads (PPC) campaigns for a local business. Also use when the user mentions "local PPC," "geotargeted ads," "radius targeting," "Google Ads for local business," "lo… |
| `local-reporting` | 0 | When the user wants to create local SEO reports, track local ranking performance, set up reporting dashboards, or communicate results to clients. Also use when the user mentions "local SEO report," "client reporting," "l… |
| `local-schema` | 0 | When the user wants to implement LocalBusiness structured data, location schema, or local-specific JSON-LD markup. Also use when the user mentions "local schema," "LocalBusiness schema," "structured data for local," "JSO… |
| `local-search-ads` | 0 | When the user wants to run ads that appear inside the Google Maps local pack / map pack results. Also use when the user mentions "local search ads," "map pack ads," "ads in the map results," "local pack ads," "Google Map… |
| `local-seo-audit` | 0 | When the user wants to audit, review, or diagnose a business's local search presence. Also use when the user mentions "local SEO audit," "why am I not showing up on Google Maps," "local search issues," "local ranking pro… |
| `localseodata-tool` | 0 | When the user wants to pull local SEO data — SERP results, local pack rankings, business profile data, reviews, citations, audits, geogrid scans, keyword research, AI visibility, competitor analysis, or any local search … |
| `lsa-ads` | 0 | When the user wants help with Google Local Services Ads (LSAs), the pay-per-lead ad format with Google Guaranteed or Google Screened badges. Also use when the user mentions "LSA," "Local Services Ads," "Google Guaranteed… |
| `lsa-spy-tool` | 0 | When the user wants to check Local Services Ads rankings, see who's ranking in LSA results, monitor LSA competitive landscape, or track LSA ranking changes. Trigger on "LSA rankings," "Local Services Ads," "Google Guaran… |
| `mk-competitors` | 2 | When the user wants to create competitor comparison or alternative pages for SEO and sales enablement. Also use when the user mentions 'alternative page,' 'vs page,' 'competitor comparison,' 'comparison page,' '[Product]… |
| `mk-cro` | 2 | When the user wants to optimize, improve, or increase conversions on any marketing page or form — including homepage, landing pages, pricing pages, feature pages, lead capture forms, or contact forms. Also use when the u… |
| `multi-location-seo` | 0 | When the user manages SEO across multiple business locations (10-500+). Also use when the user mentions "multi-location," "franchise SEO," "enterprise local SEO," "managing multiple GBPs," "chain store SEO," "location at… |
| `review-management` | 0 | When the user wants to generate more reviews, respond to reviews, build a review strategy, or manage online reputation. Also use when the user mentions "reviews," "reputation management," "review generation," "review res… |
| `screaming-frog-tool` | 0 | When the user wants a technical site audit, crawl data analysis, location page quality checks, duplicate content detection, schema validation at scale, or internal linking analysis. Trigger on "Screaming Frog," "site cra… |
| `semrush-tool` | 0 | When the user wants keyword research with search volume, competitive keyword analysis, site audit data, position tracking, or competitor organic analysis. Trigger on "keyword research," "search volume," "keyword difficul… |
| `seo` | 13 | Comprehensive SEO analysis for any website or business type. Full site audits, single-page analysis, technical SEO (crawlability, indexability, Core Web Vitals with INP), schema markup, content quality (E-E-A-T), image o… |
| `seo-audit` | 0 | Full website SEO audit with parallel subagent delegation. Crawls up to 500 pages, detects business type, delegates to up to 15 specialists (8 always + 7 conditional), generates health score. Use when user says audit, ful… |
| `seo-backlinks` | 0 | Backlink profile analysis: referring domains, anchor text distribution, toxic link detection, competitor gap analysis. Works with free APIs (Moz, Bing Webmaster, Common Crawl) and DataForSEO extension. Use when user says… |
| `seo-cluster` | 3 | > SERP-based semantic topic clustering for content architecture planning. Groups keywords by actual Google SERP overlap (not text similarity), designs hub-and-spoke content clusters with internal link matrices, and gener… |
| `seo-competitor-pages` | 0 | > Generate SEO-optimized competitor comparison and alternatives pages. Covers "X vs Y" layouts, "alternatives to X" pages, feature matrices, schema markup, and conversion optimization. Use when user says "comparison page… |
| `seo-content` | 0 | > Content quality and E-E-A-T analysis with AI citation readiness assessment. Use when user says "content quality", "E-E-A-T", "content analysis", "readability check", "thin content", or "content audit". user-invocable: … |
| `seo-content-brief` | 3 | > Generate competitive SEO content briefs with per-section word counts, competitor scoring, keyword density guidance, and page-type templates. Supports both new page briefs and improve-existing-page briefs. Use when user… |
| `seo-dataforseo` | 2 | > Live SEO data via DataForSEO MCP server: SERP analysis, keyword research (volume, difficulty, intent, trends), backlink profiles, on-page analysis, competitor and content analysis, business listings, AI visibility (LLM… |
| `seo-drift` | 1 | > SEO drift monitoring: capture baselines of SEO-critical elements, detect changes, and track regressions over time. Git for SEO: baseline, diff, and track changes to your on-page SEO. Use when user says "SEO drift", "ba… |
| `seo-ecommerce` | 2 | > E-commerce SEO analysis: Google Shopping visibility, Amazon marketplace intelligence, product schema validation, competitor pricing analysis, and marketplace keyword gaps. Combines on-page product SEO with marketplace … |
| `seo-flow` | 44 | > FLOW framework integration: evidence-led SEO using the Find → Leverage → Optimize → Win loop. Surfaces stage-specific AI prompts from the FLOW knowledge base (41 prompts, CC BY 4.0). Use when user says "FLOW", "FLOW fr… |
| `seo-geo` | 2 | > Optimize content for AI Overviews (formerly SGE), ChatGPT web search, Perplexity, and other AI-powered search experiences. Generative Engine Optimization (GEO) analysis including brand mention signals, AI crawler acces… |
| `seo-google` | 11 | > Google SEO APIs: Search Console (Search Analytics, URL Inspection, Sitemaps), PageSpeed Insights v5, CrUX field data with 25-week history, Indexing API v3, and GA4 organic traffic. Provides real Google field data for C… |
| `seo-hreflang` | 4 | > Hreflang and international SEO audit, validation, and generation. Detects common mistakes, validates language/region codes, and generates correct hreflang implementations. Use when user says "hreflang", "i18n SEO", "in… |
| `seo-image-gen` | 7 | AI image generation for SEO assets: OG/social preview images, blog hero images, schema images, product photography, infographics. Powered by Gemini via nanobanana-mcp. Requires banana extension installed. Use when user s… |
| `seo-images` | 0 | > Image optimization analysis for SEO and performance. Checks alt text, file sizes, formats, responsive images, lazy loading, CLS prevention, image SERP rankings (via DataForSEO), and image file optimization (WebP/AVIF c… |
| `seo-local` | 0 | > Local SEO analysis covering Google Business Profile optimization, NAP consistency, citation health, review signals, local schema markup, location page quality, multi-location SEO, and industry-specific recommendations.… |
| `seo-maps` | 0 | > Maps intelligence for local SEO: geo-grid rank tracking, GBP profile auditing via API, review intelligence across Google/Tripadvisor/Trustpilot, cross-platform NAP verification, competitor radius mapping, and LocalBusi… |
| `seo-page` | 0 | > Deep single-page SEO analysis covering on-page elements, content quality, technical meta tags, schema, images, and performance. Use when user says "analyze this page", "check page SEO", "single URL", "check this page",… |
| `seo-plan` | 0 | > Strategic SEO planning for new or existing websites. Industry-specific templates, competitive analysis, content strategy, and implementation roadmap. Use when user says "SEO plan", "SEO strategy", "SEO planning", "cont… |
| `seo-programmatic` | 0 | > Programmatic SEO planning and analysis for pages generated at scale from data sources. Covers template engines, URL patterns, internal linking automation, thin content safeguards, and index bloat prevention. Use when u… |
| `seo-schema` | 1 | > Detect, validate, and generate Schema.org structured data. JSON-LD format preferred. Use when user says "schema", "structured data", "rich results", "JSON-LD", or "markup". user-invocable: true argument-hint: "[url] |
| `seo-sitemap` | 0 | > Analyze existing XML sitemaps or generate new ones with industry templates. Validates format, URLs, and structure. Use when user says "sitemap", "generate sitemap", "sitemap issues", or "XML sitemap". user-invocable: t… |
| `seo-sxo` | 4 | > Search Experience Optimization: reads Google SERPs backwards to detect page-type mismatches, derives user stories from search intent signals, and scores pages from multiple persona perspectives. Identifies why well-opt… |
| `seo-technical` | 1 | > Technical SEO audit across 9 categories: crawlability, indexability, security, URL structure, mobile, Core Web Vitals, structured data, JavaScript rendering, and IndexNow protocol. Use when user says "technical SEO", "… |
| `serpapi-tool` | 0 | When the user wants to check live SERP results for a keyword, see what's in the local pack right now, check People Also Ask, see AI Overviews, verify SERP features, or do a quick spot-check of local search results. Trigg… |
| `service-area-seo` | 0 | When the user operates a service-area business (SAB) without a public storefront. Also use when the user mentions "service area business," "SAB," "no storefront," "hide my address," "mobile business," "home-based busines… |
| `whitespark-tool` | 0 | When the user wants citation gap analysis, managed citation building, review generation campaigns, or local rank tracking. Trigger on "Whitespark," "citation finder," "where are my competitors listed," "citation gap," "b… |

## 07-视频-PPT-设计（49）

| skill | 参考文档 | 描述 |
|---|---|---|
| `baoyu-article-illustrator` | 29 | Analyzes article structure, identifies positions requiring visual aids, generates illustrations with Type × Style two-dimension approach. Use when user asks to "illustrate article", "add images", "generate images for art… |
| `baoyu-comic` | 32 | Knowledge comic creator supporting multiple art styles and tones. Creates original educational comics with detailed panel layouts and sequential image generation. Use when user asks to create "知识漫画", "教育漫画", "biography c… |
| `baoyu-compress-image` | 0 | Compresses images to WebP (default) or PNG with automatic tool selection. Use when user asks to "compress image", "optimize image", "convert to webp", or reduce image file size. |
| `baoyu-cover-image` | 32 | Generates article cover images with 5 dimensions (type, palette, rendering, text, mood) combining 10 color palettes and 7 rendering styles. Supports cinematic (2.35:1), widescreen (16:9), and square (1:1) aspects. Use wh… |
| `baoyu-danger-gemini-web` | 0 | Generates images and text via reverse-engineered Gemini Web API. Supports text generation, image generation from prompts, reference images for vision input, and multi-turn conversations. Use when other skills need image … |
| `baoyu-danger-x-to-markdown` | 1 | Converts X (Twitter) tweets and articles to markdown with YAML front matter. Uses reverse-engineered API requiring user consent. Use when user mentions "X to markdown", "tweet to markdown", "save tweet", or provides x.co… |
| `baoyu-format-markdown` | 1 | Formats plain text or markdown files with frontmatter, titles, summaries, headings, bold, lists, and code blocks. Use when user asks to "format markdown", "beautify article", "add formatting", or improve article layout. … |
| `baoyu-image-gen` | 2 | AI image generation with OpenAI, Azure OpenAI, Google, OpenRouter, DashScope, MiniMax, Jimeng, Seedream and Replicate APIs. Supports text-to-image, reference images, aspect ratios, and batch generation from saved prompt … |
| `baoyu-imagine` | 2 | AI image generation with OpenAI, Azure OpenAI, Google, OpenRouter, DashScope, MiniMax, Jimeng, Seedream and Replicate APIs. Supports text-to-image, reference images, aspect ratios, and batch generation from saved prompt … |
| `baoyu-infographic` | 44 | Generates professional infographics with 21 layout types and 20 visual styles. Analyzes content, recommends layout×style combinations, and generates publication-ready infographics. Use when user asks to create "infograph… |
| `baoyu-markdown-to-html` | 0 | Converts Markdown to styled HTML with WeChat-compatible themes. Supports code highlighting, math, PlantUML, footnotes, alerts, infographics, and optional bottom citations for external links. Use when user asks for "markd… |
| `baoyu-post-to-wechat` | 3 | Posts content to WeChat Official Account (微信公众号) via API or Chrome CDP. Supports article posting (文章) with HTML, markdown, or plain text input, and image-text posting (贴图, formerly 图文) with multiple images. Markdown arti… |
| `baoyu-post-to-weibo` | 0 | Posts content to Weibo (微博). Supports regular posts with text, images, and videos, and headline articles (头条文章) with Markdown input via Chrome CDP. Use when user asks to "post to Weibo", "发微博", "发布微博", "publish to Weibo"… |
| `baoyu-post-to-x` | 2 | Posts content and articles to X (Twitter). Supports regular posts with images/videos and X Articles (long-form Markdown). Uses real Chrome with CDP to bypass anti-automation. Use when user asks to "post to X", "tweet", "… |
| `baoyu-slide-deck` | 29 | Generates professional slide deck images from content. Creates outlines with style instructions, then generates individual slide images. Use when user asks to "create slides", "make a presentation", "generate deck", "sli… |
| `baoyu-translate` | 6 | Translates articles and documents between languages with three modes - quick (direct), normal (analyze then translate), and refined (analyze, translate, review, polish). Supports custom glossaries and terminology consist… |
| `baoyu-url-to-markdown` | 1 | Fetch any URL and convert to markdown using baoyu-fetch CLI (Chrome CDP with site-specific adapters). Built-in adapters for X/Twitter, YouTube transcripts, Hacker News threads, and generic pages via Defuddle. Handles log… |
| `baoyu-youtube-transcript` | 0 | Downloads YouTube video transcripts/subtitles and cover images by URL or video ID. Supports multiple languages, translation, chapters, and speaker identification. Caches raw data for fast re-formatting. Use when user ask… |
| `embedded-captions` | 15 | > Add captions or subtitles to an existing single-subject talking-head video without editing the footage. Use for plain verbatim captions, cinematic captions embedded behind the subject, VFX captions, “炸/特效/酷炫字幕,” or a n… |
| `faceless-explainer` | 4 | Turn arbitrary text — an article, notes, a topic, a brief — into a faceless explainer video: there is no site or footage to capture, so the visuals are invented per scene (typography, abstract graphics, diagrams, data-vi… |
| `figma` | 0 | Import Figma content into a HyperFrames composition — rendered assets, brand tokens, components, storyboard sections → reconstructed motion (frames read as states, not slides) (REST/CLI), connector-assisted motion when a… |
| `general-video` | 0 | > Author or edit a custom HyperFrames composition when no specialized workflow fits, or when BRIEF.md sets flow: companion. Use for longer or multi-scene pieces, brand and sizzle reels, montages, static loops, static tit… |
| `gptimage2` | 0 | Generate images via gpt-image-2 on ai-proxy.cc (async task API). Supports 15 aspect ratios, 3 resolution tiers (1k/2k/4k), and image-to-image with reference images. Use when user asks to generate, create, or draw an imag… |
| `higgsfield-generate` | 12 | \| Generate images/videos/3D assets/audio via Higgsfield AI. Defaults: GPT Image 2 for image/design/text, Seedance 2.0 for video, Nano Banana 2/Pro for character/reference images, Marketing Studio for ads, Sonilo/Mirelo f… |
| `higgsfield-marketplace-cards` | 0 | \| Generate marketplace product image cards through Higgsfield: compliant main image, secondary product images, and A+ style content modules. Use when the user asks for marketplace listing images, product detail cards, se… |
| `higgsfield-product-photoshoot` | 0 | \| Generate brand-quality product images through Higgsfield product-photoshoot prompt enhancement on GPT Image 2 / gpt_image_2. Entry point for professional brand/product visuals. Use when: "product photo", "studio shot",… |
| `higgsfield-soul-id` | 2 | \| Train a Soul Character — a personalized model on a person's face that Higgsfield uses for identity-faithful image and video generation. Use when: "create my Soul", "train my face", "make my digital twin", "build me an … |
| `hyperframes` | 16 | > Mandatory entry point: read this first for any request to make, create, edit, animate, or render a video, animation, or motion graphic, including a promo, explainer, captioned clip, title card, overlay, slideshow or in… |
| `hyperframes-animation` | 0 | All animation knowledge for HyperFrames — atomic motion rules, multi-phase scene blueprints, scene transitions, broader motion-design techniques, AND the seven runtime adapters (GSAP default, plus Lottie, Three.js, Anime… |
| `hyperframes-cli` | 10 | > Use the HyperFrames CLI development loop: init, add, catalog, capture, lint, check, snapshot, compare, grade-compare, preview, play, present, beats, keyframes, single or batch render, publish, cloud, cloudrun, feedback… |
| `hyperframes-core` | 17 | The HyperFrames composition contract — build one renderable project. Use for composition structure, the `data-*` timing attributes, `class="clip"`, tracks, sub-compositions, variables, framework-owned media playback, det… |
| `hyperframes-creative` | 15 | Non-animation creative direction for HyperFrames videos. Use for design spec (frame.md / design.md) handling, palettes, typography, narration, beat planning, audio-reactive visuals, composition patterns, and brand / styl… |
| `hyperframes-keyframes` | 1 | > Use when a HyperFrames composition needs seek-safe 2D/3D keyframes, GSAP timelines, CSS keyframes, Anime.js, WAAPI, FLIP, paths, masks, SVG morph/draw, text trails, 3D depth, or `hyperframes keyframes` diagnostics. Don… |
| `hyperframes-registry` | 7 | Install, discover, and wire registry blocks and components into HyperFrames compositions. Use when running hyperframes add or hyperframes catalog, installing one item or every block matching a tag, wiring an installed it… |
| `media-use` | 10 | Agent Media OS, the single skill for every media need in a HyperFrames project. Resolve BGM, SFX, image, icon, brand logo, voice, color grade, or LUT into a frozen local file or paste-ready block + ledger record (one ver… |
| `motion-graphics` | 3 | > A short, design-led motion graphic where motion is the message — kinetic typography, stat count-up, chart/data-viz hit, logo sting / brand lockup, lower-third / callout / social overlay, animated map (highlight regions… |
| `music-to-video` | 7 | Turn a music track (an audio file, a video to pull audio from, or a track generated from a mood brief) into a beat-synced video — lyric video, slideshow, or kinetic promo. The music drives all pacing; any user-supplied i… |
| `open-montage` | 0 | \| AI 驱动的视频制作系统 (OpenMontage)。当用户要制作视频、创建动画、做解说视频、剪辑视频、制作短视频、视频配音、制作预告片、做播客剪辑、制作教程录屏、做数据可视化动画等任何视频内容创作需求时使用。支持 12 种制作流水线（解说动画、电影级剪辑、对口播、播客二创、屏幕录制、角色动画等）、52 个工具、自动配乐和字幕。即使用户只是说"做个视频"也应触发。 |
| `ppt-master` | 117 | > AI-driven presentation workflow for generating editable PPTX decks and slides, reconstructing page visuals, creating reusable Brand/Style/Layout/Deck workspaces, filling native PPTX templates, and enhancing finished PP… |
| `ppt-source-plan` | 0 | >- Now a stage inside pptgen. Turns source PPT or screenshots into 逐字稿, style prompt, and a ~21-page plan, then generates the deck from those files. Use when the user sends PPT资料, 图文, 课件截图, or asks for 逐字稿, 风格提示词, PPT制作方… |
| `pptgen` | 0 | >- Builds sellable Chinese teacher courseware packs for Xiaohongshu: pick a classroom scenario (班干部竞选/培训/聘任, 立规矩, 开学第一课, 家长会, 心理健康课, 安全教育, 节日班会, 品德励志, 教师成长分享), research demand (ego lite if present; otherwise an interacti… |
| `pptx` | 0 | Use this skill any time a .pptx file is involved in any way — as input, output, or both. This includes: creating slide decks, pitch decks, or presentations; reading, parsing, or extracting text from any .pptx file (even … |
| `pr-to-video` | 5 | Turn a GitHub pull request (a PR URL, owner/repo#N, or 'this PR' in a checked-out repo) into a code-change explainer video — changelog, feature reveal, fix, or refactor walkthrough built from the diff, commits, and files… |
| `product-launch-video` | 4 | Turn a product or marketing URL, pasted script, or brief into a product launch / promo video — SaaS promos, feature reveals, product demos, app and company launches. Use when the user wants to market, launch, promote, or… |
| `remotion-to-hyperframes` | 11 | Port an existing Remotion (React) composition''s source to HyperFrames HTML. Use ONLY on an explicit ask to port/convert/migrate/translate a Remotion source — one-way, Remotion-only. A passing Remotion mention, reference… |
| `slideshow` | 1 | > Author a HyperFrames slideshow — a presentation, pitch deck, or interactive deck with discrete slides, fragment reveals, branching, hotspot navigation, and built-in presenter mode with speaker notes; also converts an e… |
| `talking-head-recut` | 1 | Package an existing talking-head / interview / podcast video with timed, designed GRAPHIC OVERLAY cards — kinetic titles, lower-thirds, data callouts, quotes, side panels, picture-in-picture — synced to the transcript, o… |
| `yt-novel-series` | 4 | Turn a novel into a faceless YouTube anime-style series — adapt chapters into a spoken script with per-character voices and reference-image-locked character art, then batch-generate art, multi-character voiceover, covers… |
| `yt-story-script` | 4 | Generate complete timestamped narration scripts for a faceless YouTube story/documentary channel, plus per-timestamp image prompts ready for batch image generation. Use whenever the user wants to script a YouTube story v… |

## 08-浏览器-自动化（13）

| skill | 参考文档 | 描述 |
|---|---|---|
| `ai-website-cloner-template` | 0 | Bootstrap and operate the JCodesMore ai-website-cloner-template workflow to reverse-engineer websites into a Next.js app. Use this when the user asks to set up, install, or work from the ai-website-cloner-template GitHub… |
| `applescript` | 0 | Universal AppleScript automation for macOS. Control Chrome, Finder, Mail, Calendar, Messages, Music, Terminal, and any scriptable app. Use when asked to automate macOS apps, control browsers, manage files, send messages,… |
| `browser-use` | 0 | Direct browser control via CDP for web interaction: automation, scraping, testing, screenshots, and site/app work. |
| `ego-browser` | 3 | When you need a browser, read this Skill by default. Use it to open and operate websites, fill forms, click buttons, take screenshots, extract page data, sign in, and perform other browser automation tasks, as well as we… |
| `last30days` | 0 | Deep research engine covering the last 30 days across 10+ sources - Reddit, X/Twitter, YouTube, TikTok, Instagram, Hacker News, Polymarket, Bluesky, Truth Social, web. AI synthesizes findings into grounded, cited reports… |
| `last30days` | 0 | Alias wrapper for the parent last30days skill definition. |
| `mouse-click` | 0 | Use this skill when a Proma or coding agent needs to perform a real macOS mouse action at screen coordinates, such as clicking a desktop app, clicking a point from a screenshot, checking the current mouse position, or dr… |
| `open` | 4 | Research topics, manage watchlists, get briefings, query history. Also triggered by 'last30'. Sources: Reddit, X, YouTube, web." argument-hint: 'last30 AI video tools, last30 watch my competitor every week, last30 give m… |
| `playwright` | 2 | Use when the task requires automating a real browser from the terminal (navigation, form filling, snapshots, screenshots, data extraction, UI-flow debugging) via `playwright-cli` or the bundled wrapper script. |
| `playwright-interactive` | 0 | Persistent browser and Electron interaction through `js_repl` for fast iterative UI debugging. |
| `scrapegraph` | 0 | AI-powered web scraping using ScrapeGraphAI + DeepSeek V4 Pro via ai-proxy.cc. Extracts structured data from any URL or local HTML/JSON/XML file using natural language prompts. Use when user asks to scrape, extract, or p… |
| `screenshot` | 0 | Use when the user explicitly asks for a desktop or system screenshot (full screen, specific app or window, or a pixel region), or when tool-specific capture capabilities are unavailable and an OS-level capture is needed. |
| `webdown-static` | 0 | Turn a public http/https URL into a local static webpage folder containing index.html and downloaded assets. Use this whenever the user wants to save, archive, mirror, freeze, download, or clone a live webpage into plain… |

## 09-Cloudflare-工程（13）

| skill | 参考文档 | 描述 |
|---|---|---|
| `agents-sdk` | 19 | Build AI agents on Cloudflare Workers using the Agents SDK. Load when creating stateful agents, durable workflows, real-time WebSocket apps, scheduled tasks, MCP servers, chat applications, voice agents, or browser autom… |
| `cloudflare` | 319 | Comprehensive Cloudflare platform skill covering Workers, Pages, storage (KV, D1, R2), AI (Workers AI, Vectorize, Agents SDK), feature flags (Flagship), networking (Tunnel, Spectrum), security (WAF, DDoS), and infrastruc… |
| `cloudflare-email-service` | 5 | Send and receive transactional emails with Cloudflare Email Service (Email Sending + Email Routing). Use when building email sending (Workers binding or REST API), email routing, Agents SDK email handling, or integrating… |
| `cloudflare-one` | 0 | Guides Cloudflare One Zero Trust and SASE work across Access, Gateway, WARP, Tunnel, Cloudflare WAN, DLP, CASB, device posture, and identity. Use when designing, configuring, troubleshooting, or reviewing Cloudflare One … |
| `cloudflare-one-migrations` | 0 | Plans migrations from Zscaler ZIA/ZPA, Palo Alto, legacy VPN, SWG, or SASE stacks to Cloudflare One. Use for migration assessments, policy mapping, rollout plans, and parity/gap analysis. |
| `durable-objects` | 3 | Create and review Cloudflare Durable Objects. Use when building stateful coordination (chat rooms, multiplayer games, booking systems), implementing RPC methods, SQLite storage, alarms, WebSockets, or reviewing DO code f… |
| `sandbox-migrate-to-next` | 0 | Use when porting a Cloudflare Sandbox app from stable @cloudflare/sandbox to @cloudflare/sandbox@next (Sandbox SDK 1.0 preview), or when the user asks to migrate or upgrade to Sandbox 1.0 / @next. Not for day-to-day stab… |
| `sandbox-next` | 2 | Use when building or changing Cloudflare Sandbox apps on @cloudflare/sandbox@next (Sandbox SDK 1.0 preview)—code execution, AI runners, interpreters, CI-like jobs, terminals, files, mounts, tunnels, preview URLs, lifecyc… |
| `sandbox-stable` | 0 | Use when building or changing Cloudflare Sandbox apps on the current stable @cloudflare/sandbox package (default npm tag)—commands, sessions, files, ports, tunnels, terminals, bridge, production, or deprecated-API cleanu… |
| `turnstile-spin` | 6 | Set up Cloudflare Turnstile end-to-end in a project. Scan the codebase, create the widget via the Cloudflare API, embed it where user requests need bot verification (form submissions, SPA actions, API endpoints, download… |
| `web-perf` | 0 | Analyzes web performance using Chrome DevTools MCP. Measures Core Web Vitals (LCP, INP, CLS) and supplementary metrics (FCP, TBT, Speed Index), identifies render-blocking resources, network dependency chains, layout shif… |
| `workers-best-practices` | 2 | Reviews and authors Cloudflare Workers code against production best practices. Load when writing new Workers, reviewing Worker code, configuring wrangler.jsonc, or checking for common Workers anti-patterns (streaming, fl… |
| `wrangler` | 0 | Cloudflare Workers CLI for deploying, developing, and managing Workers, KV, R2, D1, Vectorize, Hyperdrive, Workers AI, Containers, Queues, Workflows, Pipelines, and Secrets Store. Load before running wrangler commands to… |

## 10-支付-Dodo（17）

| skill | 参考文档 | 描述 |
|---|---|---|
| `better-auth-integration` | 0 | Guide only for applications using @dodopayments/better-auth, covering authenticated customer sync, checkout, portal access, usage ingestion, and verified webhook callbacks. |
| `billing-sdk` | 0 | Guide for building billing UI with BillingSDK - the open-source React component library for pricing tables, subscription management, usage meters, invoice history, and customer portal flows wired to Dodo Payments. |
| `checkout-integration` | 0 | Guide for starting hosted Checkout Sessions, payment links, and overlay or inline checkout for one-time and recurring products; use subscription-integration for post-checkout lifecycle management. |
| `credit-based-billing` | 0 | Complete guide for giving customers included, free, prepaid, promotional, or top-up credits using grants, balances, ledger deductions, rollover, expiry, alerts, and overage. |
| `customer-management` | 0 | Guide for managing customer records, saved payment methods, monetary wallets, and hosted customer-portal sessions; subscription lifecycle and custom billing UI are covered separately. |
| `discounts-and-promotions` | 0 | Guide for implementing discount codes and promotional pricing with Dodo Payments, including CRUD operations, eligibility rules, stacking, subscription-cycle limits, and plan-change preservation. |
| `dodo-best-practices` | 0 | Guide for initial Dodo Payments setup, including SDK installation, test and live environments, API keys, and the canonical checkout-to-webhook architecture. |
| `framework-adapters` | 0 | Guide for mounting official @dodopayments/* checkout, portal, and verified-webhook route handlers in supported web frameworks; use domain skills for payment and lifecycle logic. |
| `license-keys` | 0 | Guide for implementing license key management with Dodo Payments - activation, validation, and access control for software products. |
| `localized-pricing` | 0 | Guide for implementing localized pricing, adaptive currency, and purchasing power parity with Dodo Payments |
| `mobile-checkout` | 0 | Guide for implementing mobile in-app checkout with Dodo Payments across React Native, Flutter, iOS, and Android platforms. |
| `product-catalog-management` | 0 | Guide for creating and managing products, pricing, add-ons, product collections, images, and digital product delivery |
| `refunds-and-disputes` | 0 | Guide for issuing refunds, handling disputes and chargebacks, and reconciling customer access with Dodo Payments |
| `subscription-integration` | 0 | Guide for managing recurring subscriptions after checkout, including trials, lifecycle states, plan changes, cancellation, failed-payment recovery, proration, mandates, and on-demand charges. |
| `testing-and-go-live` | 0 | Guide for test-mode payment scenarios, renewal simulation, local webhook delivery tests, test and live catalog migration, and production launch checks. |
| `usage-based-billing` | 0 | Guide for charging directly per measured API call, token, storage unit, or other consumption using meters, stable usage events, aggregation, free thresholds, and metered subscriptions. |
| `webhook-integration` | 0 | Complete guide for setting up and handling Dodo Payments webhooks for real-time payment event notifications. |

## 11-skill工具（2）

| skill | 参考文档 | 描述 |
|---|---|---|
| `skill-creator` | 1 | Create new skills, modify and improve existing skills, and measure skill performance. Use when users want to create a skill from scratch, edit, or optimize an existing skill, run evals to test a skill, benchmark skill pe… |
| `skill-installer` | 0 | Install Codex skills into $CODEX_HOME/skills from a curated list or a GitHub repo path. Use when a user asks to list installable skills, install a curated skill, or install a skill from another repo (including private re… |

## 12-其他（9）

| skill | 参考文档 | 描述 |
|---|---|---|
| `docx` | 0 | Use this skill whenever the user wants to create, read, edit, or manipulate Word documents (.docx files). Triggers include: any mention of 'Word doc', 'word document', '.docx', or requests to produce professional documen… |
| `executing-plans` | 0 | Use when you have a written implementation plan to execute in a separate session with review checkpoints |
| `find-skills` | 0 | Helps users discover and install agent skills when they ask questions like "how do I do X", "find a skill for X", "is there a skill that can...", or express interest in extending capabilities. This skill should be used w… |
| `follow-builders` | 0 | AI builders digest — monitors top AI builders on X and YouTube podcasts, remixes their content into digestible summaries. Use when the user wants AI industry insights, builder updates, or invokes /ai. No API keys or depe… |
| `guizang-ppt-skill` | 9 | 生成横向翻页网页 PPT（单 HTML 文件），含 WebGL 背景、章节幕封、数据大字报、图片网格等模板。提供两种风格：① "电子杂志 × 电子墨水"（衬线 + 流体背景 + 暖色） ② "瑞士国际主义"（无衬线 + 网格点阵 + IKB/柠檬黄/柠檬绿/安全橙高亮）。当用户需要制作分享 / 演讲 / 发布会风格的网页 PPT，或提到"杂志风 PPT"、"瑞士风 PPT"、"Swiss Style"、"horizontal swipe… |
| `pdf` | 0 | Use this skill whenever the user mentions a PDF file or asks to produce/edit one. For read-only tasks such as reading, summarizing, extracting plain text, or answering questions from a PDF, follow this skill's read-only … |
| `tool-builder` | 0 | 交互式创建和管理 Chat 模式的自定义 HTTP 工具。当用户想要创建新的 API 工具、配置 Chat 工具、添加自定义工具、管理自定义工具、或说"帮我创建一个 XX 工具"时使用此 Skill。也适用于调试、修复或删除已有的自定义工具。 |
| `writing-plans` | 0 | Use when you have a spec or requirements for a multi-step task, before touching code |
| `xlsx` | 0 | Use this skill any time a spreadsheet file is the primary input or output. This means any task where the user wants to: open, read, edit, or fix an existing .xlsx, .xlsm, .csv, or .tsv file (e.g., adding columns, computi… |

## 已做凭据打码的文件

共 14 个文件。这些文件里疑似凭据的长串已被替换为 `***MASKED***`，**键名和正文保留**，因此内容仍然可用。

需要真实值时，回源目录读：`~/Desktop/skill-knowledge-base/<路径>`。

- `10-支付-Dodo/framework-adapters/SKILL.md`
- `10-支付-Dodo/billing-sdk/SKILL.md`
- `07-视频-PPT-设计/baoyu-post-to-wechat/SKILL.md`
- `12-其他/follow-builders/SKILL.md`
- `08-浏览器-自动化/last30days/docs/plans/2026-03-09-fix-bluesky-auth-opt-in-plan.md`
- `08-浏览器-自动化/last30days/docs/plans/2026-03-03-feat-tiktok-apify-source-plan.md`
- `09-Cloudflare-工程/cloudflare/references/secrets-store/api.md`
- `09-Cloudflare-工程/cloudflare/references/snippets/configuration.md`
- `09-Cloudflare-工程/cloudflare/references/stream/configuration.md`
- `09-Cloudflare-工程/cloudflare/references/argo-smart-routing/configuration.md`
- `09-Cloudflare-工程/cloudflare/references/turn/configuration.md`
- `09-Cloudflare-工程/cloudflare/references/turnstile/gotchas.md`
- `09-Cloudflare-工程/cloudflare/references/waf/configuration.md`
- `09-Cloudflare-工程/turnstile-spin/references/sveltekit.md`
