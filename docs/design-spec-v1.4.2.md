# Design Specification: Norwegian HVAC / Heat Pump Field-Service Platform

**Version 1.4.2 — 2026-09-11 (frozen for the phase-0 prototype).** Changes are listed in Appendix D. Design expansion stops here; §13.4 lists the implementation gates the prototype must pass.

Working name: **Varmeflyt** (rename freely). Target users: heat pump installers, refrigeration ("kuldeanlegg") service companies, plumbers and electricians in Norway. Written so an LLM or developer can implement it directly. Norwegian UI (nb-NO) is the default; all labels are shown in Norwegian with the English concept in parentheses.

---

## 1. Guiding decisions (read this first)

| Decision | Choice | Why |
|---|---|---|
| Customization model | **Metadata-driven platform** (Salesforce-style): custom fields, custom objects, layouts, validation rules, list views and workflows are *data*, not code. | Eliminates the "one tenant asks → everyone gets a hidden field + a toggle" problem. |
| Language | **TypeScript end-to-end** (API, worker, web, shared rule engine). | Rules, validation and formulas must run identically on the server and *offline in the browser*. One language = one engine, one set of types. |
| Backend | Node 22 + **NestJS** (Fastify adapter) + **PostgreSQL 16** + Redis + BullMQ | Opinionated module structure that LLMs generate well; Postgres gives JSONB (custom fields), RLS (tenancy), pg_trgm (search). |
| Frontend | **Vue 3 + TypeScript + Vite**, Pinia, PrimeVue (accessible components) + Tailwind, vite-plugin-pwa | Single PWA for PC, tablet, mobile and TV. React is an acceptable substitute; everything below is framework-agnostic except component names. |
| Offline | **PowerSync** (open-source, self-hostable) syncing Postgres → SQLite in the browser (wa-sqlite/OPFS) with an upload queue. | Hand-rolled sync is the classic multi-year pit. PowerSync gives partial replication per user, conflict handling hooks and works in PWA + Capacitor. |
| Mobile | PWA first; optional **Capacitor** wrapper for App Store/Play (camera QR scanning, push). | Same codebase; you already ship PWA manifests. |
| Files | S3-compatible object storage in EU (Azure Blob Norway East, Hetzner Object Storage, or Cloudflare R2 EU) | GDPR / data residency. |
| PDF | Gotenberg (Chromium HTML→PDF) in Docker | Same HTML template renders on screen, in the public offer page and in the PDF. |
| Auth | OIDC via Keycloak (self-hosted) or Zitadel; passkeys + long-lived technician sessions with PIN re-lock; magic-link + optional Vipps Login for the customer portal | Elderly-friendly (no password gymnastics), Norway-standard. |
| Hosting | Docker Compose on 1–2 EU VMs + managed Postgres to start; Kubernetes later if needed | Small team, predictable cost. |
| Monorepo | pnpm workspaces + Turborepo: `packages/core`, `packages/ui`, `apps/api`, `apps/worker`, `apps/web` | Shared rule engine and types. |

### 1.1 Product principles
1. **Core stays small and fixed.** Core objects and their core fields never change per tenant. Everything else is tenant metadata.
2. **No tenant-specific code, ever.** A request is either (a) solvable by the tenant in *Tilpass* / *Oppsett* (§2.8), (b) an ordinary setting inside a module, (c) a new optional *module* or starter configuration, or (d) a core improvement for all. There is no (e).
3. **Three-tenant rule.** When ≥3 tenants build the same custom field/rule/workflow, product evaluates promoting it to core or to a shareable starter configuration — never as a code-level flag.
4. **Modules organise; settings decide inside them.** Optional functionality (Prosjekter, Servicekontrakter, Lager, HMS, Kundeportal, Tilbud) is an installable module. Inside a module, ordinary settings are legitimate ("Krev kundesignatur ved ferdigmelding" is a setting on a job type, not a module). What is banned is the *code-level feature flag* that exists for one tenant and a global list of hundreds of switches: settings live on the module (`tenant_modules.settings`) or on the job type, and are found where the feature is.
5. **Defaults first, extension second.** A new tenant picks a starter configuration and is productive on day one. A larger company extends the same engine; it never has to adopt a different product.
6. **Presentation and rules are separate.** Layouts decide what a screen shows; requirement rules decide what an operation needs (§2.9). Rules apply to mobile, import, integration and API alike.
7. **Mobile-first, elderly-first.** Every screen must be usable at 200 % zoom, one-handed, with gloves, in a dark basement. See §9.
8. **Offline is normal for data; commands are server-authoritative.** Technicians edit and record fully offline; completion, invoicing and other protected actions are queued requests the server accepts or returns with an explanation (§7).

---

## 2. The customization engine (solves the multi-tenant bloat problem)

This is the platform layer. Every module in §6 is built *on top of* it, including core objects.

### 2.1 Concepts (mirrors Salesforce, deliberately simplified)

| Concept | Norwegian UI name | Meaning |
|---|---|---|
| Object | Objekt | A record type: Kunde, Ordre, Enhet… or a tenant-created one (e.g. "Kuldemedielogg"). System objects have `is_system = true`, cannot be deleted, core fields locked. |
| Field | Felt | A property on an object. Core field (real column) or custom field (JSONB key). |
| Picklist | Valgliste | Ordered set of values for select fields; tenant-editable even on core fields where allowed (e.g. Ordretype, Ordrestatus). |
| Relationship | Relasjon | Lookup (many-to-one) or master-detail (child deleted with parent). |
| Layout | Sideoppsett | Which fields appear on a record page, in which sections/order, per profile and per device class. |
| List view | Listevisning | Saved columns/filters/sort per object; personal or shared. |
| Requirement rule | Krav | What must be present for an operation to be allowed (per stage: create, schedule, complete, invoice…), independent of any layout. See §2.9. |
| Validation rule | Valideringsregel | Expression that must be true for a record to be accepted at a given stage; else error message. Implemented as a requirement rule of kind `expression`. |
| Job type | Jobbtype | Configuration bundle for Montering, Service, Befaring… (fields, checklists, requirements, completion steps, report). See §2.10. |
| Formula field | Formelfelt | Read-only field computed from an expression. |
| Rollup field | Summeringsfelt | COUNT/SUM/MIN/MAX over child records (e.g. Adresse.antall_enheter_med_forfalt_service). |
| Workflow | Arbeidsflyt | Trigger → conditions → actions (§10). |
| Action/button | Handling | A button on a record: run workflow, open URL, create related record with prefilled fields. |
| Profile & permission set | Profil / Tilgangssett | Object-level CRUD + field-level read/edit + module access. |
| Module | Modul | Installable bundle of objects, fields, layouts, workflows, menu items. |

### 2.2 Storage model (canonical — every later section conforms to this)

```
tenants(id, name, org_number, plan, locale, timezone, metadata_version bigint NOT NULL DEFAULT 0, created_at)
tenant_modules(tenant_id, module_key, enabled, installed_version, settings jsonb)

objects(id, tenant_id NULL for system, api_name, label, label_plural, is_system, icon,
        record_name_field_id, storage 'table'|'custom', table_name, created_at, retired_at)
fields(id, tenant_id NULL for system, object_id, api_name (immutable), label, type, is_system,
       is_unique, is_indexed, default_value, help_text,
       picklist_id, lookup_object_id, lookup_on_delete 'restrict'|'set_null'|'cascade',
       formula text, rollup jsonb, number_scale, max_length, sort_order,
       classification 'public'|'internal'|'restricted'|'secret',          -- §4.3
       offline_policy 'allowed'|'online_only',                              -- may this field be stored on a device at all
       merge 'lww'|'append'|'protected'|'server_only',                      -- §7.3
       ai_description, ai_aliases text[], ai_visible bool,                   -- §14
       retired_at)
-- NOTE: there is no is_required on fields. Requiredness is expressed only by requirement_rules (§2.9).
picklists(id, tenant_id, api_name, label)
picklist_values(id, picklist_id, value, label, color, sort_order, is_default_for_meaning, is_active, retired_at,
                system_meaning NULL | one of the meanings defined per picklist in §5)   -- code branches on meaning, never on label
layouts(id, tenant_id, object_id, name, profile_id NULL, device_class 'any'|'desktop'|'mobile', definition jsonb, is_default)
list_views(id, tenant_id, object_id, owner_user_id NULL, name, definition jsonb, is_shared)
requirement_rules(...)                        -- §2.9; the only mechanism for required/validation
job_types(...)                                -- §2.10
workflows(id, tenant_id, object_id NULL, name, trigger jsonb, conditions jsonb, actions jsonb, is_active, version)
actions(id, tenant_id, object_id, label, icon, kind 'workflow'|'url'|'create_related', config jsonb, placement 'record'|'list')
profiles(id, tenant_id, name, is_admin, record_access jsonb {object_api_name: 'assigned'|'team'|'branch'|'all'})
object_permissions(profile_id, object_id, can_create, can_read, can_update, can_delete)
field_permissions(profile_id, field_id, can_read, can_edit)   -- absent row = no access for non-admin profiles; system fields get default rows per starter profile
metadata_changesets(...)                      -- §2.11
metadata_changes(id, tenant_id, changeset_id, user_id, entity, entity_id, before jsonb, after jsonb, at)
```

**Custom fields on core objects:** every core table has `custom_fields jsonb NOT NULL DEFAULT '{}'`. Key = field `api_name` (always prefixed `c_`, e.g. `c_enova_soknad`). When `is_indexed = true`, the API creates `CREATE INDEX CONCURRENTLY ix_<table>_<field> ON <table> ((custom_fields->>'c_x'))` (or a typed cast for numbers/dates).

**Sync projection of custom fields — two channels, no bypass.** Every core table has `custom_fields_sync jsonb NOT NULL DEFAULT '{}'`, which contains **only** fields whose `share_scope = 'all_employees'`: a publish-time computed flag that is true only when `offline_policy = 'allowed'`, classification is `public`/`internal`, *and every non-admin profile in the tenant has `can_read`* on the field. Any field that is restricted to some profiles, or later becomes restricted, has `share_scope = 'projection'` and is delivered exclusively as projection records (§7.4 `field_projections`) that are filtered by both record access and field permission. PostgreSQL generated columns cannot read other tables, so the column is written by the record API on every save. **Tightening is synchronous:** the publish transaction that flips a field to `projection` runs `UPDATE <table> SET custom_fields_sync = custom_fields_sync - 'c_x' WHERE tenant_id = …` and deletes the corresponding `sync_field_grants` rows in that same transaction, so no further delivery can happen after publish; only *widening* (adding a field to the shared JSON) is done by an asynchronous backfill. The same two-channel rule applies to **core fields**: the broad streams in §7.4 select only the *baseline* core fields — a fixed, documented set that system profiles cannot restrict (names, addresses, phone, email, sales price, statuses, dates); every other core field (`cost_price`, `access_notes`, `internal_notes`, margins) is projection-only.

**Custom objects:** stored in one generic table:
```
custom_records(id uuid, tenant_id, object_id, data jsonb, data_sync jsonb, name text,
               owner_user_id, created_by, created_at, updated_by, updated_at, deleted_at)
-- name is maintained by a BEFORE INSERT/UPDATE trigger that reads objects.record_name_field_id (triggers may read other tables; generated columns may not)
-- GIN index on data jsonb_path_ops; expression indexes on demand as above
```
Lookups to any record are stored as UUID strings; the `fields` row tells the engine which object to resolve.

**Metadata cache:** the API loads a tenant's full metadata bundle (objects, fields, picklists, layouts, job types, requirement rules) into Redis keyed by `(tenant_id, metadata_version)`. Clients download the bundle once and cache it (also offline). Publishing a changeset increments `metadata_version` in the same transaction as the metadata rows.

### 2.3 Field types
`text`, `textarea`, `richtext`, `number` (integer), `decimal(scale)`, `currency`, `percent`, `boolean`, `date`, `datetime`, `time`, `email`, `phone`, `url`, `select` (single picklist), `multiselect`, `lookup`, `file` (one or many attachments), `image`, `signature`, `geo` (lat/lng), `formula`, `rollup`, `autonumber` (pattern e.g. `ORD-{0000}`), `user` (lookup to users).

### 2.4 Expression language (used by formulas, validation, visibility, workflows)
A small, safe, Excel/Salesforce-like DSL. Implemented once in `packages/core/expr` with a tokenizer + Pratt parser + tree-walking evaluator. **Never `eval`.** Runs in browser and Node.

- Literals: `123`, `1.5`, `"tekst"`, `TRUE`, `FALSE`, `NULL`
- Record fields: `status`, `custom.c_enova`, related lookups one level: `customer.is_supplier`, `address.postal_code`
- Context: `$user.id`, `$user.profile`, `$now`, `$today`, `$old.status` (previous value in workflows)
- Operators: `+ - * / %`, `= <> < <= > >=`, `AND OR NOT`, `&` (concat)
- Functions: `IF, ISBLANK, ISNULL, ISNEW, ISCHANGED(field), CONTAINS, STARTSWITH, LEN, UPPER, LOWER, TRIM, TEXT, VALUE, ROUND, ABS, MIN, MAX, TODAY, NOW, DATEADD(date, n, "day"|"month"|"year"), DATEDIFF(a, b, unit), YEAR, MONTH, DAY, INCLUDES(multiselect, "value"), PRIORVALUE(field), REGEX(text, pattern)`
- **Collection predicates** over a related list (children or a many-to-many through table), the only way to reason about related records: `ANY(order_devices, device.serial_number <> NULL)`, `ALL(order_devices, NOT(ISBLANK(device.serial_number)))`, `COUNT(refrigerant_events, kind = "recover") > 0`, `SUM(material_uses, quantity)`. The first argument is a related-list name from metadata; inside the predicate, fields of the related record are addressed directly and one further lookup level is allowed (`device.serial_number`). Nesting collection predicates is not allowed. An empty collection makes `ALL` true and `ANY` false.
- Expressions are type-checked at publish time (unknown field, wrong type, unknown function, reference to a retired field → cannot publish). A runtime evaluation error (e.g. a related record is missing) is logged with the rule name; a *visibility* expression then evaluates as "show"; a *requirement/validation* expression blocks the protected action it belongs to with "Regelen «X» kunne ikke evalueres — kontakt administrator", while draft data is always kept locally and on the server.

Example requirement rule (stage `complete_order`, kind `expression`) on Ordre: `ALL(order_devices, NOT(ISBLANK(device.serial_number)))` → "Alle installerte enheter må ha serienummer før ordren kan ferdigmeldes." Example condition on a rule: `COUNT(refrigerant_events, kind = "recover") > 0` (recovery quantity is required only when a recovery was recorded).

### 2.5 Layout definition (JSON)
```json
{
  "header": { "title": "name", "subtitle": ["customer.name", "job_type"], "badges": ["work_status", "review_status"], "primaryAction": "complete_order" },
  "tabs": [
    { "key": "details", "label": "Detaljer", "sections": [
      { "label": "Ordre", "columns": 2, "fields": [
        { "field": "name" },
        { "field": "customer" },
        { "field": "address", "visibleIf": "NOT(ISBLANK(customer))" },
        { "field": "custom.c_enova_soknad", "visibleIf": "job_type.key = \"montering\"" }
      ]}
    ]},
    { "key": "lines", "label": "Ordrelinjer", "component": "OrderLines" },
    { "key": "devices", "label": "Enheter", "related": "order_devices" },
    { "key": "checklists", "label": "Sjekklister", "related": "checklist_instances" },
    { "key": "files", "label": "Dokumenter", "component": "Attachments" },
    { "key": "activity", "label": "Aktivitet", "component": "Timeline" }
  ],
  "mobile": { "quickActions": ["start_travel", "start_work", "add_photo", "complete_order"] }
}
```
`component` references a built-in Vue component; `related` renders a generic related list from metadata. On mobile, tabs render as a segmented control + accordion (§9.4). **Layouts contain no required flags.** The form asks the requirement engine (§2.9) which targets are required or recommended for the current stage and renders the markers; a layout can only choose *where* a field appears. Job types (§2.10) select the layout.

### 2.6 Setup UI ("Oppsett")
Replaces the old giant settings page. Navigation: **Objektbehandler** (objects → fields, picklists, layouts, validation rules, actions), **Arbeidsflyter**, **Brukere og profiler**, **Moduler** (install/enable), **Integrasjoner**, **Firma** (logo, org.nr, invoice texts, number series), **Maler** (PDF/email templates). Every change is audited in `metadata_changes` with "Angre" (undo) for the last change.

### 2.7 What the tenant admin can do without you
- Add a field to Kunde (e.g. "Kundegruppe" picklist) and show it only on the Montering job type.
- Require "Deres referanse" before invoicing for one customer, without affecting technicians.
- Create object "Kuldemedielogg" (child of Enhet) with fields kg fylt, kg tappet, dato, tekniker (most tenants will not need this — §5.2 ships a structured refrigerant log).
- Workflow: when an order is approved, email the customer the report PDF and create a follow-up order in 12 months.
- Save a list view "Mine besøk denne uken" and pin it to the mobile home screen.

### 2.8 Two entry points: "Tilpass" (common) and "Oppsett → Avansert"
Administrators should not need to understand an object manager. The common path is task-shaped:

> **Tilpass ordre** → *Legg til felt* → name, type → *Vis for jobbtyper* (checkboxes) → *Når må det fylles ut?* (Aldri / Ved opprettelse / Før planlegging / Før ferdigmelding / Før fakturering / Anbefalt) → *Vis i kunderapport?* → Lagre.

That single wizard writes a field, a layout placement per selected job type, a requirement rule and a report-template change — into the same metadata engine as the advanced tools.

| Vanlig tilpasning (Tilpass) | Avansert oppsett (Oppsett → Avansert) |
|---|---|
| Legg til felt eller seksjon på Ordre/Enhet/Kunde | Opprett egne objekter |
| Velg jobbtyper der feltet vises | Definer relasjoner mellom objekter |
| Krev noe før ferdigmelding/fakturering | Bygg formler, valideringsuttrykk og arbeidsflyter |
| Velg felter som vises i kunderapport | Styr tilganger, integrasjoner, nummerserier |
| Rediger sjekklister og jobbtyper | Metadata-endringssett, forhåndsvisning, publisering |

**Starter configurations ("Oppstartspakker").** On tenant creation (and later under Moduler) the admin picks one or more: *Boligvarmepumpe – montering og service*, *Service og vedlikehold (kuldeanlegg)*, *Kommersiell kjøl og frys*, *Rørlegger*, *Elektriker*, *HMS-grunnpakke*. Each installs job types, fields, sections, checklist templates, requirement rules, report templates and workflows — all editable. Every installed item carries `origin: "starter:residential-hp@1.2"`; a later starter update is offered as a diff and never applied silently to items the tenant has edited (§2.11).

### 2.9 Requirement rules — separate from layouts (the most important customization change)
A layout controls presentation. A requirement rule decides whether an operation is allowed, wherever the request comes from (mobile, office, import, integration, API, workflow).

```
requirement_rules(id, tenant_id, object_id, name, is_active, origin, version,
   stage        'create'|'schedule'|'start_visit'|'complete_visit'|'complete_order'|'submit_review'|'invoice',
   level        'required'|'recommended',
   criticality  'administrative'|'critical'|'invariant',        -- §2.11 decides how queued offline work is treated; invariant = system rules, not editable
   override_policy 'never'|'authorized_with_reason',            -- invariant and critical default to never
   follow_up_on_prior_version bool DEFAULT false,               -- §2.11: create a follow-up task when queued work is accepted under a prior version
   target_kind  'field'|'attachment'|'checklist'|'related'|'expression',
   target  jsonb   -- {"field":"their_reference"} | {"attachment_kind":"photo","min":2} | {"checklist_template_id":...,"status":"completed"} | {"related":"order_devices","min":1} | {"expression":"ALL(order_devices, NOT(ISBLANK(device.serial_number)))"}
   condition text  -- expression (§2.4); the rule applies only when true. Conditions are the exemption mechanism.
   scope   jsonb   -- {"job_type_ids":[...], "device_type_ids":[...], "customer_ids":[...], "service_contract_ids":[...]}   (empty = all)
   message text, message_key)
```
Examples: Adresse må være kjent — `schedule`/`field address_id`. Serienummer på installert utstyr — `complete_order`/`expression ALL(order_devices, NOT(ISBLANK(device.serial_number)))`, scope job type Montering, criticality critical. Deres referanse — `invoice`/`field their_reference`, scope customer A, administrative. Tappet mengde — `complete_visit`/`expression ALL(refrigerant_events, IF(kind = "recover", kg > 0, TRUE))`, critical. Før/etter-bilder — `complete_visit`/`attachment`, level recommended, scope Service.

**Semantics (simple on purpose).**
1. **All applicable `required` rules must pass** for a stage transition. Requirements are additive: a more specific rule never removes a general one. To exempt a customer or job type, the general rule gets a `condition` (e.g. `NOT(INCLUDES(customer.tags, "internal"))`).
2. **`recommended` rules are advisory**: shown in the completion summary, never block.
3. **Conditions determine applicability**; scope is a convenience filter compiled into the condition.
4. **Specificity affects presentation only**: when several applicable rules target the same field/attachment, the most specific rule's `message` is shown (customer/contract > job type + device type > job type > device type > unscoped). It never changes whether the transition is allowed.
5. **`invariant` rules are the system's own** (tenant, object, job type on create; a visit needs an order; an invoice needs an invoice customer). They cannot be edited, scoped or overridden.

**Draft creation.** A record may exist on the server as a draft with only the invariants satisfied; the `create` stage is therefore reserved for invariants. "Customer must be selected" is a `schedule` rule in the starter configurations (an order without a customer can be drafted, but not scheduled). Tenants may add `create`-stage rules, in which case the client keeps the record local ("Ufullstendig utkast — lagres når kunde er valgt") until they pass.

**Evaluation.** `GET /records/{object}/{id}/readiness?stage=complete_order` → `{ ok, missing: [{ ruleId, target, message, link, overridable }], recommended: [...], blockedByConfig: [...] }`. The same function runs offline in the client (`packages/core/requirements`) with the metadata version on the device; every protected command re-runs it server-side (§7.1) and **never trusts the client's result** — the client's `readinessSeen` is kept only for diagnostics.

**Guarantees.**
- Drafts may be saved incomplete at any time (subject to invariants); only stage transitions are gated.
- A required target that is hidden or read-only for every profile that must satisfy it fails *publish-time validation* ("Feltet «X» kreves før ferdigmelding, men vises ikke for Tekniker"). If it still happens at runtime (e.g. a permission changed), readiness reports it under `blockedByConfig`, the user sees "Kan ikke fullføres — administrator er varslet", and the admin gets a notification. A user is never trapped by an invisible field.
- The completion screen lists every missing requirement in plain language with a link that opens the field/checklist/upload directly.
- A record stores `rule_versions_applied` per stage transition; the applicable rule version for queued offline work is decided by §2.11. New or changed rules never retroactively invalidate completed or invoiced records, and reports show the requirements that applied at the time.
- Overrides: only rules with `override_policy = 'authorized_with_reason'` can be overridden, by users holding `override_requirements` (default: Kontor, Administrator); `requirement_overrides(record_id, rule_id, stage, user_id, reason, at)`; the reason is shown on the record, in the report and in the audit log. Invariants and `critical` compliance rules are never optional because someone has the office profile.

### 2.10 Job types as configuration bundles
"Ordretype" is no longer a picklist; it is an object that bundles behaviour:
```
job_types(id, tenant_id, key, label, icon, color, sort_order, is_active, origin, config jsonb)
config = {
  "layout_id": "...", "extra_sections": [...],
  "default_checklists": [{ "template_id": "...", "per": "order"|"device", "device_types": [...] }],
  "requirement_rule_ids": [...],                        -- in addition to rules scoped to this job type
  "default_duration_minutes": 240, "default_tasks": [...], "default_materials": [{ "product_id": "...", "qty": 1 }],
  "report_template_id": "...", "workflow_ids": [...],
  "completion_steps": ["checklists", "photos", "materials", "hours", "refrigerant", "signature"],
  "settings": { "requires_customer_signature": false, "track_travel": false, "allow_multiple_visits": true, "auto_create_device_on_install": true }
}
```
Montering, Service, Befaring and Reklamasjon therefore behave differently with zero tenant-specific code. Starter configurations ship sensible job types; tenants edit or add their own.

**Contextual completion instead of a fixed wizard.** "Ferdigmeld" opens a *completion summary*: the steps from the job type's `completion_steps`, filtered by readiness, with already-satisfied steps ticked. Travel tracking and customer signature appear only if the job type (or a rule) asks for them. The primary button reads "Ferdigmeld besøk" or "Ferdigmeld ordre" depending on context (§5.3).

### 2.11 Making customization changes safe over time
Setup changes are grouped in a **changeset** with a lifecycle **Utkast → Valider → Forhåndsvis → Publiser**:
```
metadata_changesets(id, tenant_id, status 'draft'|'validated'|'published'|'rolled_back', author_user_id, items jsonb, validation_report jsonb, impact_report jsonb, published_at, published_version)
```
- *Valider* runs: expression type-checks, dangling references, requirement rules whose targets are invisible to obligated profiles, picklist values still in use, sync-projection size limits (§7), report templates referencing removed fields.
- *Forhåndsvis* shows impact: affected layouts, job types, rules, workflows, report templates, list views, and record counts ("2 314 ordrer har verdi i feltet du vil pensjonere"), plus a phone-frame preview of changed layouts.
- *Publiser* bumps `tenant.metadata_version` atomically and records the diff. **Rollback** re-publishes the previous configuration; it never converts data. Anything that changes stored data (type conversion, merging picklist values) is a separate **data migration job** with dry-run report, progress and its own reversal plan; the UI says so explicitly. "Angre siste endring" therefore only exists for configuration.
- **Identifiers are immutable.** `fields.id` and `fields.api_name` never change; labels change freely. Fields and picklist values are **retired** (`retired_at`), never deleted: historical records keep their values, retired values render read-only with "(utgått)", filters can still find them, and the field disappears from layouts, wizards and sync projections for new data. A type change is implemented as "new field + conversion job + retire old".
- **Removing a picklist value** requires choosing: keep as retired, or map to a replacement (data migration).
- **Rule changes while technicians are offline — publication policy.** Each visit stores `metadata_version_at_start` (set when the visit is scheduled and again when the technician starts it); each order stores `metadata_version_at_assignment`. When a queued command arrives, the server **re-evaluates readiness itself** against *both* the prior version the work started under and the current version, and applies:

| Rule change since work started | Treatment of the queued command |
|---|---|
| New/changed `administrative` requirement | Accept under the prior version; record "Fullført under regelversjon N"; create a follow-up task if the rule's `follow_up_on_prior_version` flag is set |
| New/changed `critical` requirement | Preserve every recorded item (answers, photos, events, times) as *work recorded*; **hold** the protected completion in `review_status = awaiting_review` with the missing critical items listed; the office completes them or returns the visit |
| `invariant` violated (should not happen; indicates a client bug) | Reject the command, keep the data, alert engineering |
| Permission for the command revoked | Do not execute; keep the data; notify user and admin |
| `invoice` stage | Always current rules |
| Historical completed/approved record | Untouched; keeps its evidence and `rule_versions_applied` |

"Work recorded" and "completion approved" are always distinguishable in the data (`visits.completed_at` vs `orders.approved_at`) and in the UI.
- **Module / starter updates:** three-way merge. Items the tenant never edited are updated in place; edited items are left alone and the new default is offered side-by-side. Nothing is applied silently.
- **Custom fields are first-class everywhere** or "add your own field" will still generate development tickets: search (indexed fields join the trigram index), filters and list views, reports/dashboards, CSV/Excel export and import mapping, PDF and email merge fields (`{{custom.c_x}}`), the public API and OpenAPI schema (regenerated per tenant), field-level permissions, data classification, and the sync projection (§7). Every new field type must implement the `FieldTypeAdapter` interface (render, edit, validate, format, filter, index, export, merge) before it can be released.

---

## 3. Architecture

```
┌────────────────────────────── Clients ──────────────────────────────┐
│ PWA (PC / mobile / tablet)   TV kiosk mode (/tv)   Customer portal  │
│ Vue 3 + PowerSync SQLite (offline)   Public offer page (/tilbud/:t) │
└──────────────┬───────────────────────────────┬──────────────────────┘
               │ HTTPS REST/JSON (OpenAPI)     │ PowerSync protocol (websocket)
┌──────────────▼───────────────┐   ┌───────────▼───────────┐
│ apps/api  (NestJS)           │   │ PowerSync service     │◄── logical replication ── Postgres
│ auth, metadata engine,       │   │ (self-hosted, Docker) │
│ record API, integrations API,│   └───────────────────────┘
│ file signed-URLs, webhooks   │
└──────┬──────────────┬────────┘
       │ SQL (RLS)    │ jobs (BullMQ/Redis)
┌──────▼──────┐  ┌────▼──────────────────────────────┐
│ PostgreSQL  │  │ apps/worker: workflows, accounting │
│ 16 + pg_trgm│  │ sync, PDF (Gotenberg), email/SMS,  │
│ + RLS       │  │ push, scheduled service generation │
└─────────────┘  └───────────────────────────────────┘
        S3-compatible storage (attachments, PDFs)   ·   Keycloak (OIDC)
```

### 3.1 Repository layout
```
/packages/core        types for metadata + records, expression engine, validation, formatting (nb-NO), zod schemas
/packages/ui          design tokens, Vue components (FormRenderer, ListView, RecordPage, Planner…)
/apps/api             NestJS modules: auth, tenants, metadata, records, crm, orders, devices, checklists, planner,
                      offers, products, contracts, projects, hms, portal, integrations/{tripletex,fiken,...}, files, webhooks
/apps/worker          BullMQ processors (same domain packages as api)
/apps/web             Vue app: routes, PowerSync schema, offline queue UI
/infra                docker-compose, migrations (Drizzle), PowerSync sync-rules.yaml, Keycloak realm export
```

### 3.2 Request lifecycle for a record save (any object)
1. Client validates with the metadata bundle (types, readiness for the requested stage) → immediate feedback, works offline.
2. Write goes to local SQLite; PowerSync queues the upload.
3. `apps/api` receives the upload envelope (§7.2): sets `app.tenant_id` on the connection → RLS → checks permissions and, for commands, re-runs readiness → applies the field-class merge policy → writes core columns, `custom_fields` and `custom_fields_sync` → appends `audit_log` and an `outbox` row **in the same transaction** (§10).
4. The outbox relay publishes to Redis; the worker consumes at-least-once → runs matching workflows with durable action states → side effects (email, create record, accounting submissions).
5. Postgres change replicates to PowerSync → all online clients update live (office sees technician's progress).

---

## 4. Multi-tenancy, security, compliance

### 4.1 Tenancy and identities
- Single database, `tenant_id` on every tenant-scoped row, Postgres Row-Level Security as the last line of defence (not the only one; the API also filters explicitly).
- **Identities and memberships.** A person is one global identity that can hold memberships in several tenants (subcontractor electricians, franchise owners):
```
identities(id, email, name, phone, oidc_subject, pin_hash, created_at)                 -- never synced to clients
users(id, tenant_id, identity_id, display_name, profile_id, team_id, is_active, color, default_warehouse_id)   -- one membership
teams(id, tenant_id, name, branch_id NULL);  branches(id, tenant_id, name, address)
```
A session is bound to exactly one active tenant (`tenant_id` claim); switching tenant issues a new token and a separate local database. Small companies never see this.

### 4.2 RLS, done properly
- Database roles: `app_owner` (runs migrations, owns tables — **never used at runtime**), `app_runtime` (used by API and worker; `NOBYPASSRLS`, not a table owner), `powersync_repl` (logical replication only), `readonly_reporting`.
- Every tenant-scoped table: `ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t FORCE ROW LEVEL SECURITY;` with `CREATE POLICY tenant_isolation ON t USING (tenant_id = current_setting('app.tenant_id', true)::uuid)`. Each request runs in a transaction with `SET LOCAL app.tenant_id`; a missing setting yields zero rows, never all rows.
- CI tests: (1) connect as `app_runtime` with tenant A set and assert zero rows from tenant B on every table; (2) a schema test that fails if any table with a `tenant_id` column lacks a policy or `FORCE`; (3) a test that `app_runtime` cannot `SET ROLE` to an owner.
- Superusers and table owners bypass RLS by design; the runtime credentials are the only ones in application configuration.

### 4.3 Record access and permission enforcement
- Profiles carry object CRUD, field-level read/edit, and a **record-access mode** per object: `assigned` (participant/booked), `team`, `branch`, `all`. Technicians default to `assigned` for orders and `all` for devices/customers (they need to look things up), planners to `branch` or `all`.
- **One access policy, three inputs.** A field value reaches a user (screen, API, export, PDF, sync) only if (1) the profile has **record access** to the record (`record_access` mode: `assigned`/`team`/`branch`/`all`), (2) the profile has a **field permission** row with `can_read`, and (3) for offline storage, the field's `offline_policy = 'allowed'`. **Classification** (`public`/`internal`/`restricted`/`secret`) only sets *defaults* for those rows and for portal/export visibility; it is not itself an access check. `secret` fields (`pin_hash`, integration tokens, signing keys) never leave the server under any configuration. `restricted` is not one flag: "may see key-box codes" (`addresses.access_notes`) and "may see cost prices" (`products.cost_price`, `order_lines.cost_price`) are separate field permissions, and each is delivered to a device only through its own permission-gated sync stream (§7.4). Customer names, phone numbers and addresses are personal data even when `internal`; they are `offline_policy = 'allowed'` because technicians need them, and the offline session limits below bound the exposure.
- Enforcement matrix — the same permission check runs in: UI rendering, record API, search results, list views and reports, PDF/email merge, exports, workflow actions (workflows run as "system" but outbound actions respect classification: a workflow cannot email a `restricted` field to a customer), and **sync streams** (§7.4).
- **TV / kiosk mode** uses a device token bound to a profile "Skjerm" whose sync projection contains only the planner read model (names, times, customer name, city, job type, status) — no phone numbers, prices, notes or addresses beyond city. Token shown once as QR; revocable from Oppsett → Skjermer.
- **Device QR codes** (`/d/:public_code`) are identifiers, not permissions. Resolution requires an employee session in the owning tenant or a portal session for the owning/service customer; anyone else sees a login page that preserves the code. Nothing about the device or customer is returned before authentication.
- **Offline sessions and revocation.** An offline device cannot learn about a revocation until it reconnects, so authorisation is time-bound: the local database is usable for at most `max_offline_days` (tenant setting, default 14, max 30) since the last successful server contact; after that the app **locks** and requires reconnection. Two protections are stated separately and honestly: (a) the *application lock* (the app refuses to open the local database — this is not encryption); (b) *encryption at rest* of the local database, available in Capacitor builds via the platform keystore and not guaranteed in the pure PWA — tenants with strict requirements deploy the Capacitor build. Refresh tokens live at most `max_offline_days`. **Revocation sequence** (a revoked/deactivated user or lost device reconnecting): 1) the server rejects normal sync and API access; 2) the client offers a narrowly scoped **quarantine transfer** — its queued operations and pending files are posted to `POST /recovery/quarantine` with a recovery token, under the tenant's `recovery_policy` (`allow`, `admin_approval`, `deny`); the server stores them in `quarantined_uploads` without applying them; 3) on durable acknowledgement the client deletes its local database and queue; 4) if the transfer is denied or fails, the client still wipes after the lock period expires, and the UI states plainly that the unsynced work was **not** preserved. An administrator reviews quarantined uploads in Oppsett and can apply or discard them through the normal command path.

### 4.4 Audit, GDPR, secrets
- **Audit log** `audit_log(id, tenant_id, object_id, record_id, user_id, action, changes jsonb, at, source 'ui'|'api'|'sync'|'workflow'|'integration'|'migration')` on every write, including losing values from sync merges (§7.3).
- **GDPR**: data processor agreement per tenant; per-tenant export (JSON + files); customer anonymisation action that scrubs PII but keeps device/service history; retention policy job. Data stored in EU only.
- Secrets (accounting API tokens) encrypted at rest with a per-tenant key (KMS / libsodium sealed box); never included in exports or logs.
- Rate limiting per tenant and per API key; public offer/portal pages use opaque 32-byte tokens with expiry and view logging.

---

## 5. Core data model

All core tables carry: `id uuid`, `tenant_id`, `custom_fields jsonb`, `owner_user_id`, `created_by/at`, `updated_by/at`, `deleted_at` (soft delete), `external_ids jsonb` (`{"tripletex": "1234"}`), `sync_version bigint`. Below, only domain columns are listed. Picklist-backed fields are marked `[pl]` and are tenant-editable.

```
identities / users / teams / branches — see §4.1
certificates(id, user_id, kind [pl: F-gass kategori I|II|III|IV|Elektro-fagbrev|Varme arbeider|Fallsikring|Truck|...],
             certificate_number, issued_at, expires_at, issuer, file_id, verified_by, verified_at)
```
Certificates are structured records (not one expiry field per user); requirement rules and the HMS round reference them ("Har ansatte gyldig F-gass sertifikat?" is answered from data), and a workflow warns 60 days before expiry.

### 5.1 CRM
```
customers(id, name, kind 'person'|'organisation', org_number, customer_number, phone, email, invoice_email,
          invoice_method [pl: email|ehf|paper], is_customer, is_supplier, is_active,
          billing_address jsonb {street, postal_code, city, country},
          primary_address_id → addresses, primary_contact_id → contacts, payment_terms_days, notes)
contacts(id, customer_id, first_name, last_name, email, phone, title, is_primary, portal_access bool,
         portal_last_login_at)
addresses(id, customer_id, label ('Hjem','Hytte','Avd. Lillestrøm'), street, postal_code, city,
          municipality, lat, lng, is_primary, access_notes (restricted), floor_or_unit, notes)
```
Rules: org.nr lookup via Brønnøysund on create (autofill name/address); postal_code → city autofill (Bring/Kartverket); customer_number assigned from tenant number series or from accounting system after sync (see §8).

### 5.2 Devices ("Enheter"), systems and refrigerant circuits
Residential heat pumps must stay simple (one card); commercial refrigeration, multi-split and VRF need structure. Both use one model with optional layers:

```
addresses = sites (see §5.1) + site_contact_id → contacts, access_notes (restricted)
systems(id, address_id, name, kind [pl: split|multisplit|VRF|væskekjøler|kjølerom|fryserom|ventilasjon|annet], notes)        -- optional
devices(id, name, address_id, system_id NULL, parent_device_id NULL (component of),
        owner_customer_id, service_customer_id (operator / who orders service), invoice_customer_id NULL (default = service customer),
        device_type [pl], device_category [pl], manufacturer [pl], model, serial_number, public_code (QR), status [pl, meanings: active|retired|not_installed],
        installed_at, warranty_until, location_description, notes,
        maintenance_interval_months, maintenance_due_at, next_action_at (derived, see below))
device_ownership_history(id, device_id, owner_customer_id, service_customer_id, from_at, to_at, changed_by)
refrigerant_circuits(id, system_id NULL, device_id NULL, name, refrigerant_type_id, charge_kg, co2e_tonnes (derived),
        has_leak_detection_system, leak_detection_system_checked_at, leak_check_interval_months (derived), leak_check_due_at,
        last_leak_check_at, rule_version_id_applied)
```
- A basic split system is one `devices` row; the app creates one implicit circuit from the model's refrigerant/charge and hides the circuit UI until a second circuit or a system is added. Indoor/outdoor units of a residential split can be recorded as two child devices with their own serial numbers when the tenant wants that (starter setting `split_units_as_components`).
- Owner, operator/service customer, invoice recipient and site contact are separate relations (landlord / tenant / property manager / invoice recipient). Defaults: all = the customer that created the device, so residential users never touch them. Device history survives an ownership change (history row + the device keeps its id); a service contract may cover devices at several sites (§5.8).

**Two due dates, not one.** Maintenance (contractual) and leak checks (regulatory) are separate obligations with separate completion dates:
- `maintenance_due_at` = last accepted `visit_activities` row of kind `maintenance` with outcome `done` + `maintenance_interval_months` (from contract or device type default). Only that activity moves it; creating an order does not.
- `leak_check_due_at` per circuit = last accepted `leak_check` activity/event + interval derived from the compliance rule in force.
- `next_action_at` = **earliest** outstanding obligation across the device and its circuits; the UI shows each obligation with its own state (green > 60 d, yellow ≤ 60 d, red overdue).

**Refrigerant reference data and compliance rules are versioned, system-managed data**, not tenant settings:
```
refrigerant_types(id, code 'R32', gwp, gwp_source 'AR4'|'AR5', effective_from, effective_to, is_hfc, flammability_class)
compliance_rules(id, jurisdiction 'NO', version, effective_from, effective_to, source_url, applicability jsonb, thresholds jsonb, exceptions jsonb)
```
Shipped defaults (to be reviewed against Miljødirektoratet guidance before release, with the source and date recorded): leak-check every 12 months at ≥ 5 t CO2e, 6 months at ≥ 50 t, 3 months at ≥ 500 t; interval doubled with a functioning leak-detection system; hermetically sealed equipment < 10 t exempt. A tenant may **shorten** any interval (`tenant_compliance_overrides`, min-guarded) but can never lengthen a legally required one; the UI says which value is regulatory and which is the tenant's stricter choice.

**Refrigerant events (the log the regulation actually asks for):**
```
refrigerant_events(id, circuit_id, device_id, order_id, visit_id, at,
   kind 'install_charge'|'top_up'|'recover'|'leak_check'|'leak_detection_system_check'|'repair'|'disposal'|'transfer',
   refrigerant_type_id, kg, result 'ok'|'leak_found'|'repaired_and_verified'|'follow_up_required',
   leak_location, leak_cause [pl: vibrasjon|korrosjon|loddefeil|ventil|mekanisk skade|ukjent], repair_description, follow_up_due_at,
   recovered_to_container_id, disposal_destination, disposal_receipt_file_id,
   technician_user_id, certificate_id (snapshot of the certificate used), company_org_number,
   rule_version_id, circuit_snapshot jsonb, notes)
refrigerant_containers(id, tenant_id, label, refrigerant_type_id, tare_kg, current_kg, warehouse_id)
```
Completing a `leak_check` event updates `last_leak_check_at` / `leak_check_due_at` using the rule version in force and stores that version on the event, so historical entries remain interpretable when rules change. Annual reporting exports (kg by refrigerant type in/out) come from this table.

Device page: header (name, model, status, next action in colour), tabs Detaljer / Obligasjoner / Ordrer / Sjekklister / Kuldemedium / Dokumenter. QR label PDF (A6 sticker sheets, Brother sizes) from `public_code`; access after scanning per §4.3.

### 5.3 Orders ("Ordrer"), visits and resource bookings
An **order** is the scope and the commercial agreement. A **visit** is one scheduled attendance at a location. A **resource booking** is a person or resource assigned for an interval. This represents a three-day installation, a return after spare parts, an electrician joining for two hours, two technicians with different times, and one visit completed while the order stays open.

```
orders(id, order_number (server-assigned), name, customer_id (service customer), invoice_customer_id NULL, address_id, contact_id,
       leader_user_id, team_id, job_type_id → job_types,
       work_status_id     [pl, meanings: draft|scheduled|in_progress|completed|cancelled],
       review_status_id   [pl, meanings: not_submitted|awaiting_review|approved|returned],
       billing_status     'not_invoiced'|'partially_invoiced'|'invoiced'|'credited'   (derived from invoices, not editable),
       payment_status     'unknown'|'unpaid'|'partially_paid'|'paid'|'overdue'        (read-only, pulled from accounting when supported),
       our_reference, their_reference, project_id, service_contract_id, offer_id, description, internal_notes, priority [pl],
       completed_at, submitted_at, approved_at, approved_by, returned_reason, rule_versions_applied jsonb,
       metadata_version_at_assignment bigint)                                   -- set when the first booking is created; §2.11
visits(id, order_id, visit_no, address_id (default order address),
       planned_start, planned_end, all_day,   -- the customer appointment window; independent of bookings (see rule below)
       status_id [pl, meanings: planned|in_progress|completed|cancelled], purpose, notes,
       arrived_at, left_at, completed_at, completed_by, customer_signature_file_id, signed_by_name, signed_at,
       metadata_version_at_start bigint)                                         -- set at scheduling and again at start_visit; §2.11
resources(id, tenant_id, name, kind 'vehicle'|'lift'|'tool'|'other', is_active)
resource_bookings(id, visit_id NULL, appointment_id NULL, user_id NULL, resource_id NULL, start_at, end_at, role 'lead'|'technician'|'apprentice'|'subcontractor')
order_devices(order_id, device_id, notes)                                     -- scope only; what was done is in visit_activities
visit_activities(id, visit_id, device_id NULL, circuit_id NULL, kind 'maintenance'|'leak_check'|'repair'|'installation'|'inspection'|'decommission',
                 outcome 'done'|'partial'|'not_done', notes, performed_by, at, checklist_instance_id NULL, refrigerant_event_id NULL)
                 -- only an accepted activity of the right kind updates the matching due date (§5.2): maintenance → maintenance_due_at, leak_check → circuit.leak_check_due_at
material_uses(id, visit_id, order_line_id, product_id, serial_unit_id NULL, quantity, warehouse_id, location_id NULL, recorded_by, at,
              stock_movement_id NULL, corrects_material_use_id NULL)         -- posting a material use produces exactly one stock movement (§5.7)
order_lines(id, order_id, line_no, kind 'material'|'hours'|'service'|'text'|'package', product_id, package_line_id NULL (component of),
            used_quantity (derived: Σ material_uses.quantity for the line, corrections applied), reserved_for_invoicing_quantity, confirmed_invoiced_quantity (derived, §5.11),
            description, quantity, unit, unit_price, cost_price (restricted), discount_pct, vat_rate,
            source 'manual'|'offer'|'package'|'timesheet'|'stock', is_invoiceable, invoiced_quantity (derived))
time_entries(id, order_id, visit_id NULL, user_id, started_at, ended_at, kind 'work'|'travel', minutes, is_billable, notes)
order_events(id, order_id, visit_id NULL, kind, payload jsonb, user_id, at)     -- append-only timeline
status_transitions(tenant_id, dimension 'work'|'review'|'visit', from_meaning, to_meaning, allowed_profile_ids[], requires_stage NULL)
```
- **Visit window vs bookings.** `planned_start/planned_end` is the window agreed with the customer and is **never changed by moving a booking**. Dragging a booking outside the window keeps the agreement, marks the booking "Utenfor avtalt tid" (planner stripe + visit badge) and offers a separate explicit action "Endre avtalt tid…", which writes the new window and keeps the previous one in `visit_window_history(visit_id, planned_start, planned_end, changed_by, reason, at)`. Normal jobs show one time range; the distinction only appears when a booking differs. A visit with zero bookings is *unassigned* and appears in the planner's "Til fordeling" list regardless of date.
- **Small jobs stay small.** Creating an order with a date creates visit 1 and one booking per chosen technician automatically; the "Besøk" tab appears only when the user adds a second visit or when the job type allows multiple visits and the office clicks "Nytt besøk". Everything a technician does (arrive, checklists, photos, sign, complete) happens on a visit; the last visit's completion offers "Ferdigmeld ordre" if readiness for `complete_order` passes.
- **Three status dimensions, one meaning table.** Tenants rename statuses and may define several statuses with the same meaning (e.g. two "completed" variants for reporting); the value flagged `is_default_for_meaning` is the one automation selects. Transitions are validated per dimension against `status_transitions`. A technician's device only ever writes `visits.status` and `work_status`; review and billing are changed by office actions and by the invoicing flow, so a late offline status upload can never undo a commercial state.
- Materials and activities belong to visits: technicians record `material_uses` (what was taken from which stock, on this visit) and `visit_activities` (what was done to which device/circuit). Order lines remain the commercial view; `material_uses` roll up into line quantities (`used_quantity`) and drive stock, so a three-day installation consumes only what each visit used, once.
- Order ↔ visit completion: completing a visit runs `complete_visit` readiness; completing the order runs `complete_order`; submitting for review runs `submit_review` (office or automatic per job type setting); "Send til regnskap" runs `invoice` (§8.1).
- Order page tabs: Detaljer, Besøk (when relevant), Ordrelinjer (materials + hours, running total, "Legg til fra lager"), Enheter, Sjekklister, Dokumenter, Aktivitet. Contextual completion per §2.10.

### 5.4 Checklists (engine used by orders, devices, HMS)
```
checklist_templates(id, name, scope [pl: order|device|order_device|hms_round|hms_equipment], version, is_active,
                    definition jsonb, on_deviation_create_hms bool, pdf_template_id)
checklist_instances(id, revision int DEFAULT 1, supersedes_instance_id NULL, template_id, template_version, definition_snapshot jsonb, order_id NULL, visit_id NULL, device_id NULL,
                    hms_equipment_id NULL, status 'open'|'completed', answers jsonb, completed_by, completed_at,
                    signature_file_id, pdf_file_id)
```
Template definition:
```json
{ "sections": [ { "title": "Elektrisk sikkerhet", "items": [
   { "key": "el_1", "label": "Er elektrisk utstyr og verktøy i god stand uten synlige skader?",
     "type": "tristate", "options": ["OK","Avvik","N/A"], "required": true, "noteOnDeviation": true, "photoOnDeviation": true }
]}]}
```
Item types: `tristate`, `yesno`, `text`, `number` (unit, min, max → out-of-range warning), `select`, `multiselect`, `photo`, `signature`, `date`, `info` (read-only text), `measurement_pair` (e.g. inn/ut temperatur). A device-scoped checklist filled on an order is linked to both `order_id` and `device_id` and appears on both pages. Completed instances render to PDF (rapport) and can be emailed via workflow.

### 5.5 Planner ("Ressursplanlegger")
```
appointments(id, title, kind [pl: ferie|kurs|internt|sykdom|annet], start_at, end_at, all_day, notes, color)   -- occupies time via resource_bookings
```
The planner's only source of truth is `resource_bookings` (visits and appointments). Read model `GET /planner?from&to&team&branch` returns
`{ bookingId, kind:'visit'|'appointment', userId|resourceId, start, end, orderId, visitId, title, subtitle(customer, city), jobType, workStatus, visitStatus, color, geo }`
plus two side lists: `unassigned: [visits with no bookings at all, any date, plus orders with work_status draft|scheduled and no visits]` (shown as "Til fordeling") and `outside_range_count` (work scheduled outside the visible period — a count with a link, never mixed into "Til fordeling"). Moving a block moves that booking; moving a whole visit moves all its bookings (context menu offers both). Vehicles/lifts are rows like people when the tenant enables resources.

### 5.6 Offers ("Tilbud")
```
offers(id, offer_number, name, customer_id, address_id, contact_id, status [pl meaning: draft|sent|viewed|accepted|declined|expired],
       valid_until, intro_text richtext, terms_text richtext, total_excl_vat, total_vat, total_incl_vat,
       public_token, sent_at, first_viewed_at, accepted_at, accepted_by_name, accepted_signature_file_id, decline_reason,
       order_id (created on accept), pdf_file_id)
offer_lines(id, offer_id, line_no, product_id, description, quantity, unit, unit_price, discount_pct, vat_rate,
            is_optional bool, is_selected bool, package_snapshot jsonb)
offer_addon_groups(id, offer_id, offer_line_id (the package line), title, min_select, max_select, sort_order)
offer_addons(id, addon_group_id, product_id, description, quantity, unit_price, vat_rate, is_default, is_selected)
offer_views(id, offer_id, viewed_at, ip_hash, user_agent)
```
Public offer page `/tilbud/:token` (no login): company logo, greeting, intro, device/package card with image, included components list, **addon groups as large checkboxes/radios with prices**, optional lines, live total incl. mva, terms, "Godta tilbud" (name + drawn signature, optionally Vipps Login), "Still spørsmål" (comment → office notification), "Avslå" with reason. Acceptance snapshots selected addons into offer lines, sets `accepted`, and (via default workflow) creates an Ordre with lines from the offer and sends confirmation email + PDF. Office can regenerate PDF at any state. Reminder workflow: 7 days before `valid_until` if status = sent.

### 5.7 Products & stock ("Produkter og lager")
```
products(id, sku, name, description, kind 'item'|'service'|'hours'|'package'|'text', unit, cost_price (restricted), sales_price,
         vat_rate, supplier_id → customers(is_supplier), manufacturer, category [pl], image_file_id,
         track_stock bool, is_active, barcode, accounting_product_external_id, min_level NULL)
package_components(id, package_product_id, component_product_id, quantity, is_serialized_slot bool)   -- innedel, utedel, rør
package_addon_groups(id, package_product_id, title, min_select, max_select, sort_order)              -- "Tilbehør utedel"
package_addons(id, addon_group_id, product_id, quantity, price_override, is_default)
warehouses(id, name, kind 'main'|'vehicle'|'external', user_id NULL, resource_id NULL)
warehouse_locations(id, warehouse_id, code 'A-03-2', kind 'shelf'|'vehicle', user_id NULL, resource_id NULL)
stock_movements(id, material_use_id NULL UNIQUE, product_id, serial_unit_id NULL, from_warehouse_id, from_location_id, to_warehouse_id, to_location_id, quantity,
                kind 'receipt'|'issue'|'transfer'|'adjustment'|'count'|'return', order_id, order_line_id, supplier_order_id, user_id, at, note)  -- authoritative ledger, append-only
stock_balances(product_id, warehouse_id, location_id, on_hand, reserved, available)   -- derived; maintained by trigger from movements + reservations, rebuildable
stock_reservations(id, order_line_id, product_id, warehouse_id, location_id, quantity, status 'reserved'|'consumed'|'released', at)
supplier_orders(id, supplier_id, status [pl], ordered_at, expected_at)
supplier_order_lines(id, supplier_order_id, product_id, ordered_qty, received_qty, unit_cost)         -- partial receipts create receipt movements
stock_counts(id, warehouse_id, status, started_by); stock_count_lines(count_id, product_id, location_id, expected, counted) -- posting creates 'count' movements
serial_units(id, product_id, serial_number, warehouse_id, location_id, status 'in_stock'|'reserved'|'installed'|'returned', device_id NULL)
```
- **Movements are the ledger; balances are derived.** Reserve when a line is added to a planned order (setting); **consume by posting `material_uses`** (§5.3) — each posted use creates exactly one `issue` movement referencing it, so partial use across visits is exact and re-posting is impossible (`stock_movements.material_use_id` unique); release on cancellation; return via `return` movement. A correction is a new `material_uses` row with `corrects_material_use_id` producing an offsetting movement; nothing is edited in place. Balances can be rebuilt from movements at any time.
- **One canonical stock position** = `(warehouse_id, location_id NULL)`. Locations must belong to their warehouse (FK + check); `stock_balances` are keyed on the pair. Both vehicle modes resolve to this pair.
- **Vehicle stock — two models, one setting.** Tenant setting `vehicle_stock_mode`: `warehouse` (each servicebil is its own warehouse; transfers between warehouses) or `location` (one main warehouse; "Servicebil Per" and "Servicebil Thomas" are locations with quantities, e.g. 2 and 3). Both `warehouses` and `warehouse_locations` can carry `user_id`/`resource_id`, so "Min bil", "Flytt til bil", counting and the technician's offline stock projection resolve to whichever the tenant uses. Accounting sync usually only sees the warehouse total, which is why some tenants prefer the location model. **Switching mode after stock activity exists is a data migration** (§2.11: dry-run report, moves balances between warehouse/location pairs, re-points open reservations), not a toggle; the setting is read-only in the UI once movements exist and is changed through the migration wizard.
- **Packages keep the accepted price.** `package_price_mode`: `fixed` (offer/accepted price is the package line; components expand as child lines with `package_line_id`, price 0, quantity for stock) or `sum_of_components`. When the accounting system needs revenue per line, an allocation setting distributes the package price across components proportionally to list price (rounding to the last line) so totals, discounts and VAT match the accepted offer exactly and nothing is billed twice. Addons are always priced separately.
- Serialized components: scanning a serial at installation moves the `serial_unit` to `installed`, links it to the device (creating the device and its child components per job-type setting) and records the serial on the order line.

### 5.8 Service contracts ("Servicekontrakter") — module
```
service_contracts(id, name, customer_id, invoice_customer_id NULL, status [pl], starts_at, ends_at, interval_months, lead_days,
                  mode 'auto_create_order'|'notify', job_type_id, default_leader_user_id, price_per_visit, contract_file_id, notes,
                  grouping 'per_site'|'per_due_date'|'per_contract'|'per_device')          -- how generated work is grouped
service_contract_devices(contract_id, device_id)                                          -- devices may sit at several sites
service_occurrences(id, contract_id, occurrence_no, due_at, group_key (site id / date / contract / device),
                    status 'planned'|'generated'|'fulfilled'|'cancelled'|'overdue', generated_order_id NULL, fulfilled_by_visit_id NULL,
                    fulfilled_at, notes, UNIQUE(contract_id, occurrence_no, group_key))
```
Two concepts, not one date:
- **Next occurrence to generate.** A worker job materialises occurrences ahead of time from `starts_at + n × interval_months`, one per `group_key` according to `grouping`. Generating an order for an occurrence is idempotent on the unique key: retries cannot create a second order.
- **Outstanding service obligation.** Creating an order does *not* fulfil an occurrence. An occurrence becomes `fulfilled` only when a `visit_activities` row of kind `maintenance` with outcome `done` is accepted for its devices (via the generated order or any other order); that same activity updates `maintenance_due_at` on the device. Late completion fulfils the overdue occurrence and does not shift the next one (interval anchored on schedule, tenant setting `anchor 'schedule'|'completion'`). A cancelled generated order returns the occurrence to `planned` with a notification; a cancelled contract cancels its future occurrences only.

### 5.9 Projects ("Prosjekter") — module
```
projects(id, project_number, name, customer_id, status [pl], starts_at, ends_at, leader_user_id, budget, accounting_project_external_id)
```
Orders link to a project; project page aggregates orders, hours, materials, invoiced amount.

### 5.10 HMS — module (built with checklists + custom-object machinery, but shipped as system objects)
```
hms_deviations(id, deviation_number, title, description, category [pl: skade|nestenulykke|farlig forhold|kvalitet|miljø],
               severity [pl: lav|middels|høy], reported_by_user_id, occurred_at, address_id, order_id, device_id,
               status [pl meaning: new|in_progress|closed], responsible_user_id, due_at, root_cause, corrective_action,
               closed_at, closed_by_user_id)
hms_chemicals(id, name, supplier_id, sds_file_id (sikkerhetsdatablad), sds_revision_date, hazard_pictograms multiselect
              [GHS01..GHS09], storage_location, usage_description, ppe_required multiselect, risk_assessment text,
              substitution_considered bool, next_review_at, is_active)                        -- "Stoffkartotek"
hms_equipment(id, name, kind [pl: stige|stillas|fallsikring|lekkasjesøker|vakuumpumpe|manometer|truck|...],
              serial_number, warehouse_id/user_id (who has it), control_interval_months, last_control_at, next_control_at,
              checklist_template_id, responsible_user_id, status [pl: ok|utgår|sperret])   -- "Internt utstyr"
hms_documents(id, title, category [pl: prosedyre|instruks|risikovurdering|beredskap|annet], version, file_id,
              requires_read_confirmation bool, valid_until)
hms_document_reads(document_id, user_id, read_at)
hms_rounds(id, date, location/address_id, participants user_ids[], checklist_instance_id, summary, next_round_date,
           signatures jsonb {verneombud, hms_ansvarlig, leder})                                 -- "Vernerunde"
```
HMS dashboard: open deviations by severity, equipment with overdue control, chemicals needing SDS review, documents not read by all, next vernerunde. The attached *HMS Vernerunde Sjekkliste – Varmepumpebedrift* is shipped as the default `hms_round` checklist template (Appendix B). A `tristate = Avvik` answer with `on_deviation_create_hms` creates a `hms_deviations` record prefilled with section, item text, note and photo.

### 5.11 Invoices and integration submissions
```
invoices(id, order_id, kind 'invoice'|'credit_note', status 'draft'|'submitting'|'submitted'|'confirmed'|'failed'|'sent'|'paid'|'credited',
         invoice_customer_id, external_id, invoice_number, currency, total_excl_vat, total_vat, total_incl_vat, issued_at, due_at,
         credits_invoice_id NULL (for credit notes: the original; several credit notes may reference one invoice), replaces_invoice_id NULL,
         submission_key text UNIQUE (stable across retries: '{tenant}:{invoice_id}'), snapshot jsonb (lines as sent))
invoice_allocations(invoice_id, order_line_id, quantity, amount)          -- signs: invoice rows positive, credit-note rows negative; amounts in minor units
integration_submissions(id, tenant_id, provider, kind 'invoice'|'customer'|'product'|'project'|'supplier_invoice', local_id,
         idempotency_key (= submission_key for invoices), attempt_no, status 'pending'|'sent'|'confirmed'|'unknown'|'failed'|'needs_review',
         request_hash, response jsonb, error, provider_reference, at)
```
- **Two derived quantities per order line, not one.** `reserved_for_invoicing_quantity` = Σ allocations of invoices whose submission is `draft`/`submitting`/`submitted`/`unknown`; `confirmed_invoiced_quantity` = Σ allocations of `confirmed` invoices adjusted by confirmed credit notes (negative). Available to invoice = `quantity − reserved − confirmed`. `billing_status` derives from *confirmed* quantities only, so drafts never make an order look invoiced; `unknown` submissions keep their reservation until reconciled. Rounding: allocations in minor units (øre), remainder on the last allocated line so Σ allocations = invoice total exactly.
- **Amount-only credits.** `invoice_allocations.quantity` may be 0 with a negative `amount` (price reduction after installation); such a credit reduces revenue without returning quantity to "available to invoice". A quantity credit (goods returned) sets both.
- **Concurrency:** creating or submitting an invoice takes `SELECT … FOR UPDATE` on the order's lines and checks *both* reserved and confirmed sums in that transaction; an allocation exceeding the available quantity fails, so two pending invoices cannot reserve the same remainder.
- **Retry contract:** the `submission_key` is generated once per logical invoice and reused on every retry; it is sent to the provider as its idempotency key / external reference where supported. Outcome `unknown` (timeout, lost response) → the reconciliation job looks the document up by provider reference (or, for providers without reliable search, by our invoice number within the customer's recent documents); if found → `confirmed`; if not found after the provider's own consistency window → `failed` and eligible for retry with the **same** key; if the provider cannot be queried reliably at all → `needs_review` with a manual "Bekreft at fakturaen finnes / Send på nytt" action. Only `confirmed` sets `external_id` and advances `billing_status`.
- Credit notes and replacements are separate `invoices` rows; a partial credit is a credit note with partial (negative) allocations; multiple partial credits against one original are ordinary rows referencing the same `credits_invoice_id`.

### 5.12 Issued documents (versions)
```
documents(id, tenant_id, kind 'offer'|'order_report'|'checklist_report'|'invoice_pdf'|'hms_round', record_id, version, file_id,
          issued_at, issued_by, supersedes_document_id NULL, snapshot jsonb, is_customer_visible)
```
Every issued PDF is immutable and versioned; a corrected report is a new version that references the one it supersedes. The public offer page shows the version the customer accepted, with the accepted selection snapshot.

### 5.13 Attachments, notifications, misc
```
files(id, tenant_id, object_id, record_id, kind 'document'|'photo'|'signature'|'pdf'|'sds', filename, mime, size, storage_key,
      thumbnail_key, taken_at, lat, lng, uploaded_by, is_customer_visible bool)
notifications(id, user_id, kind, title, body, link, read_at, channel_sent jsonb)
tasks(id, title, due_at, assignee_user_id, related_object_id, related_record_id, status)
number_series(tenant_id, key 'order'|'offer'|'customer'|'deviation', prefix, next_value, pad)
email_templates / pdf_templates(id, tenant_id, key, subject, html (Handlebars), is_default)
```

---

## 6. Module behaviour details (beyond the schema)

### 6.1 Kunder (CRM)
- List: search box with pg_trgm + unaccent over name, address, phone, org.nr (Norwegian characters normalised). Default views: Alle, Kunder, Leverandører, Inaktive. Card layout on mobile.
- Record page: header with call/SMS/email buttons; tabs Detaljer, Adresser, Kontakter, Enheter (across all addresses), Ordrer, Tilbud, Kontrakter, Dokumenter.
- "Ny ordre" from the customer picks the primary address by default; "Ny adresse" supports labels and map pin.

### 6.2 Adresser
- Address page is the *service hub for kuldeanlegg customers*: table of devices at this address with columns Enhet, Modell, Siste service, Neste service (colour: green >60 d, yellow ≤60 d, red overdue), Siste sjekkliste.
- Bulk actions: select devices → **"Opprett ordre med valgte enheter"** (prefills customer, address, devices, and attaches device-type checklist templates); "Opprett ordre for alle med forfalt service".
- Map view of all addresses with overdue devices (planner feature "Ruteplanlegging light": sort day's orders by distance).

### 6.3 Enheter
- Creation from an order (technician installs a package → scans serials → device auto-created at the order's address).
- Import from CSV/Excel with mapping UI (tenants migrating from spreadsheets).
- QR label printing (Avery-style sheets and Brother label sizes).

### 6.4 Ordrer
- Board view by `work_status`; separate **office review queue** (review_status = awaiting_review) with the readiness report inline: approve, or return with a reason (the technician gets a notification with the exact missing items).
- Statuses drive planner colours; `system_meaning` lets code branch without hardcoding labels.
- Contextual completion (§2.10); "Nytt besøk" for return visits; "Kopier ordre", "Opprett oppfølgingsordre".
- Corrections after approval create revisions (§5.12): re-issued reports and credit/re-invoice flows are explicit, never silent edits.
- Photos are geotagged and timestamped; before/after pairs supported. Customer signature is captured on the visit when the job type or a rule asks for it.

### 6.5 Sjekklister
- Template builder in Oppsett: drag sections/items, item types from §5.4, preview on phone frame.
- Runtime: one item per row, large tristate buttons (OK / Avvik / N/A) with colour and icon, note + photo expand inline on Avvik; progress bar; autosave every answer locally; "Fullfør" requires all required items.
- Device-type → default templates mapping so the right checklist attaches automatically (e.g. luft-luft service).

### 6.6 Tilbud
- Builder: pick customer/address/contact, add lines by product search, add package → addon groups pre-populated from product definition (editable per offer), optional lines, intro/terms from templates with merge fields.
- "Send" → email with public link (+ PDF attached), status `sent`; opening the page logs a view → status `viewed` + office notification.
- After acceptance the page is read-only and shows the confirmed selection.

### 6.7 Produkter og lager
- Product list with stock per warehouse; vehicle warehouses per technician; "Flytt til bil" transfer; low-stock notification per warehouse from `products.min_level`.
- Counting sheet on mobile: scan barcode → counted quantity.
- Package editor: components + addon groups; preview of what the customer sees on the offer page.

### 6.8 Kundeportal — module
- Contacts with `portal_access` log in via magic link (email) or Vipps Login. They see: addresses → devices → service history and reports (checklist PDFs), open/closed orders, offers (same public page), documents marked `is_customer_visible`, and "Bestill service" (creates an order with `work_status` meaning `draft` (label "Til fordeling"), a visit without bookings, and a notification to the office). Nothing else. Very large text by default.

---

## 7. Offline & sync — the contract

### 7.1 Two kinds of writes
| | Editable data | Commands (protected actions) |
|---|---|---|
| Examples | field edits, checklist answers, photos, time entries, refrigerant events, order lines, notes | complete visit, complete order, submit for review, accept offer, send to accounting, approve, cancel, status transitions with side effects |
| Path | local-first: written to local SQLite, uploaded in the background | **queued request**: recorded locally as `pending_commands`, executed by the server on upload, which may accept or return it |
| Offline UX | "Lagret på enheten" | "Ferdigmelding er lagt i kø — sendes når du er på nett" |
| Downstream effects (PDF, emails, invoicing, follow-up orders) | none | only after the server accepts *and* required attachments have finished uploading |

An offline "Ferdigmeld besøk" therefore: saves the local status as `completing`, queues the command with the readiness result computed on the device, and shows the visit as "Venter på synkronisering". The report PDF and customer email are produced by the server after acceptance.

### 7.2 Upload envelope
Every upload — data change or command — is an operation:
```json
{ "opId": "01J…", "kind": "update"|"insert"|"delete"|"command", "object": "visits", "recordId": "…",
  "baseVersion": 1187, "metadataVersion": 42, "clientTime": "…", "deviceId": "…",
  "changes": { "notes": "…" }, "command": { "name": "complete_visit", "args": {…}, "readinessSeen": {…} },
  "dependsOn": ["01J… (photo upload)", "01J… (checklist answers)"] }
```
`baseVersion` is the record's `sync_version` the client last saw; `dependsOn` lets the server hold a completion until its photos have landed. `readinessSeen` is diagnostic only — the server always re-evaluates readiness (§2.9). Operations are applied in order per record; a failed operation never blocks unrelated ones. This is the same mechanism the REST API uses (§11), so `If-Match` and merge policy are one thing.

### 7.3 Conflict policy by field class
Every field declares `merge: 'lww'|'append'|'protected'|'server_only'` in metadata (defaults per type):
- **lww** (free text, most custom fields): last write wins per field; the losing value goes to `audit_log` and is shown in the record's "Endringer" tab. Not silent.
- **append** (time entries, order_events, refrigerant events, material uses, photos): new rows never conflict. Mistakes are fixed by **corrections, not edits**: each of these tables has `corrects_id` / `reverses_id`; a correction is a new row that supersedes the original (the original stays, marked superseded, and is shown struck through). Editing a row that supports a completed visit, a signed report or a posted stock movement is refused; only a correction is possible.
- **checklist answers** are merged **per item key**: two technicians answering *different* items merge automatically; *different values for the same item* are a conflict (both values shown, resolved like protected fields). Answers belonging to a checklist instance that is completed or referenced by an issued report cannot be replaced: a correction creates a **new revision** of the instance (`checklist_instances.revision`, `supersedes_instance_id`), and any issued report is re-issued as a new document version (§5.12).
- **protected** (prices, discounts, quantities on order lines, any status, signatures, `completed_at`, completed checklist instances, invoice recipient): the upload must match `baseVersion`; otherwise the server stores the operation as a **conflict**, keeps the server value, and the user gets it in **"Krever oppfølging"** with both versions and choices "Bruk min", "Bruk serverens", "Slå sammen" (office may resolve on the user's behalf). **"Bruk min" is not a bypass**: it submits a *new* operation with the current `baseVersion`, which goes through the same permission checks, state validation and command handlers; if the server state has moved on (e.g. the visit was approved meanwhile), that new operation is rejected with the reason.
- **server_only** (autonumbers, derived statuses, balances, `billing_status`): clients never write them.
- **Deletes stay effective.** An offline edit to a record deleted online is stored as a recoverable conflict (the edit is visible with "Posten er slettet — gjenopprett?" for users with delete permission); records are never silently resurrected.

### 7.4 What is synced — PowerSync Sync Streams with explicit projections
PowerSync's **Sync Streams** (`config: edition: 3`; beta, production-ready and recommended for new projects — the older Sync Rules are legacy) are used. Streams support `INNER JOIN`, CTEs (`with:`) and `IN (subquery)`, but every query selects columns **from one table only**, and we always list columns explicitly — `SELECT *` is forbidden by a CI lint on `sync_streams.yaml`.

**Parameters are not interchangeable.** `auth.user_id()` / `auth.parameter('…')` are verified JWT claims; `connection.parameter()` and `subscription.parameter()` are **client-supplied and untrusted** and may only *narrow* a stream that is already authorised by auth claims and server-side membership tables. The service's `accept_potentially_dangerous_queries` stays `false`. Tenant, user, profile and team therefore always come from `auth.*`; assignment and record access come from tables the client cannot write (`resource_bookings`, `users`, `field_permissions`), never from parameters.

```yaml
# infra/sync_streams.yaml (excerpt — verify against the pinned PowerSync version in infra/VERSIONS)
config:
  edition: 3
streams:
  reference:                        # small shared reference data; no personal data, no prices beyond sales price
    auto_subscribe: true
    priority: 0
    queries:
      - SELECT id, picklist_id, value, label, color, sort_order, is_active, system_meaning FROM picklist_values WHERE tenant_id = auth.parameter('tenant_id')
      - SELECT id, key, label, icon, color, config FROM job_types WHERE tenant_id = auth.parameter('tenant_id') AND is_active = true
      - SELECT id, display_name, color, team_id, is_active FROM users WHERE tenant_id = auth.parameter('tenant_id')
      - SELECT id, sku, name, unit, sales_price, vat_rate, kind, barcode, track_stock FROM products WHERE tenant_id = auth.parameter('tenant_id') AND is_active = true

  crm:                              # lookup data every field user needs offline (offline_policy = allowed); no restricted fields
    auto_subscribe: true
    priority: 1
    queries:
      - SELECT id, name, kind, customer_number, phone, email, primary_address_id, is_customer, is_supplier, custom_fields_sync FROM customers WHERE tenant_id = auth.parameter('tenant_id') AND deleted_at IS NULL
      - SELECT id, customer_id, label, street, postal_code, city, lat, lng, site_contact_id, custom_fields_sync FROM addresses WHERE tenant_id = auth.parameter('tenant_id') AND deleted_at IS NULL
      - SELECT id, name, address_id, system_id, owner_customer_id, service_customer_id, device_type, model, serial_number, public_code, status, maintenance_due_at, next_action_at, custom_fields_sync FROM devices WHERE tenant_id = auth.parameter('tenant_id') AND deleted_at IS NULL

  field_projections:                # ALL restricted / projection-only values, core and custom, as their own rows (never as extra columns of a shared row)
    auto_subscribe: true
    queries:
      - SELECT id, object_key, record_id, field_key, value FROM field_projections
        WHERE tenant_id = auth.parameter('tenant_id')
          AND field_key IN (SELECT field_key FROM sync_field_grants WHERE user_id = auth.parameter('user_id'))
          AND record_id IN (SELECT record_id FROM sync_record_grants WHERE user_id = auth.parameter('user_id') AND object_key = field_projections.object_key)
          AND deleted_at IS NULL

  my_work:                          # visits I am booked on, ±30/+60 days, and everything hanging off them
    auto_subscribe: true
    priority: 1
    with:
      my_visits: SELECT visit_id FROM resource_bookings WHERE user_id = auth.parameter('user_id') AND start_at BETWEEN date('now', '-30 days') AND date('now', '+60 days')
      my_orders: SELECT order_id FROM visits WHERE id IN my_visits
    queries:
      - SELECT id, order_id, visit_no, address_id, planned_start, planned_end, all_day, status_id, purpose, notes, arrived_at, completed_at FROM visits WHERE tenant_id = auth.parameter('tenant_id') AND id IN my_visits
      - SELECT id, order_number, name, customer_id, address_id, contact_id, job_type_id, work_status_id, description, custom_fields_sync FROM orders WHERE tenant_id = auth.parameter('tenant_id') AND id IN my_orders
      - SELECT id, order_id, line_no, kind, product_id, package_line_id, description, quantity, unit, unit_price, discount_pct, vat_rate, source FROM order_lines WHERE tenant_id = auth.parameter('tenant_id') AND order_id IN my_orders
      - SELECT id, order_id, visit_id, device_id, template_id, template_version, definition_snapshot, status, answers, completed_at, revision FROM checklist_instances WHERE tenant_id = auth.parameter('tenant_id') AND order_id IN my_orders
      - SELECT id, visit_id, order_line_id, product_id, serial_unit_id, quantity, warehouse_id, location_id, at FROM material_uses WHERE tenant_id = auth.parameter('tenant_id') AND visit_id IN my_visits
      - SELECT id, order_id, visit_id, user_id, started_at, ended_at, kind, minutes FROM time_entries WHERE tenant_id = auth.parameter('tenant_id') AND user_id = auth.parameter('user_id')

  my_vehicle_stock:
    auto_subscribe: true
    queries:
      - SELECT id, product_id, warehouse_id, location_id, on_hand, reserved, available FROM stock_balances   -- id = deterministic uuid5(product_id, warehouse_id, coalesce(location_id))
        WHERE tenant_id = auth.parameter('tenant_id')
          AND (warehouse_id IN (SELECT id FROM warehouses WHERE user_id = auth.parameter('user_id')) OR location_id IN (SELECT id FROM warehouse_locations WHERE user_id = auth.parameter('user_id')))

  order_detail:                     # on demand: an order the user opens that is outside my_work — still authorised by record access, not by the parameter
    queries:
      - SELECT id, order_number, name, customer_id, address_id, contact_id, job_type_id, work_status_id, description, custom_fields_sync FROM orders
        WHERE tenant_id = auth.parameter('tenant_id')
          AND id = subscription.parameter('order_id')
          AND id IN (SELECT record_id FROM sync_record_grants WHERE user_id = auth.parameter('user_id') AND object_key = 'orders')
```
**JWT claims.** `sub` (= `auth.user_id()`) is the **global identity id**; the token also carries `tenant_id` and `user_id` (the **membership** id, §4.1). All grant tables and booking checks are keyed on the membership `user_id`, so streams use `auth.parameter('user_id')`, never `auth.user_id()`.

`field_projections(id, tenant_id, object_key, record_id, field_key, value jsonb, deleted_at)` holds every projection-only value (core and custom) as **separate rows**, maintained by the record API on every save; `sync_field_grants(user_id, field_key)` and `sync_record_grants(user_id, object_key, record_id)` are **server-maintained** tables derived from profiles, field permissions and record-access mode (`assigned`/`team`/`branch`/`all`), rebuilt synchronously on every permission change (inside the publish transaction) and on booking changes; the client cannot write any of them. Restricted values are therefore never delivered as additional columns of a row that a shared stream also delivers — no assumption is made about how the pinned PowerSync version merges different column sets for the same row; the prototype (§13.4) verifies the version's behaviour before any stream design relies on it.

**Acceptance tests (these define the boundary; the lint is only hygiene):**
1. Client (connection/subscription) parameters may only **narrow** the records returned; no parameter value can expand the authorised set of records or fields, or change tenant, user or profile.
2. Subscribing to `order_detail` with an order the user has no record access to returns no rows.
3. A projection-only field (core `access_notes`/`cost_price`, or an ordinary custom field restricted to office profiles) is received only by users with the corresponding `sync_field_grants` row; removing a technician's permission to an ordinary custom field makes it unretrievable through **any** stream, including the shared JSON, from the moment of publish.
4. No `secret` field and no `offline_policy = online_only` field appears in any stream (schema test over `sync_streams.yaml` against `fields`).
5. A user with `record_access = assigned` never receives another technician's visits.

Metadata bundle, email/PDF templates and the readiness engine's rule set are fetched via REST and cached in IndexedDB with `metadata_version`. Office users use the same streams with wider windows (profile-driven `with` CTEs); setup screens, reports and exports are online-only and say so.

### 7.5 Client behaviour
- IDs are client-generated UUID v7. Autonumbers (`order_number`) are server-assigned; an offline-created order shows "Ordre (venter nummer)".
- Photos/signatures are written to the Origin Private File System with a queue row; uploaded in the background (Background Sync API where available), with retry, per-file progress, and client-side thumbnails. Commands that depend on them wait (`dependsOn`).
- **Explicit sync states** on every record and in the global indicator: **Lagret på enheten** (not yet uploaded), **Venter på synkronisering** (queued, online but not confirmed), **Synkronisert**, **Krever oppfølging** (conflict/returned command/rule mismatch — with a plain-language reason and a link). A count of items needing follow-up is shown on Hjem; nothing is hidden behind an icon.
- Readiness for a command is computed on the device with its `metadataVersion` and re-evaluated on the server with the current one; the difference handling is defined in §2.11.
- Session revocation and local wipe per §4.3. Local database is encrypted at rest where the platform supports it (Capacitor builds); the web PWA relies on the projection excluding sensitive data.

---

## 8. Integrations

### 8.1 Accounting adapter pattern
One interface, one adapter per system, configured per tenant in *Oppsett → Integrasjoner* (OAuth or token, mapping of number series, VAT codes, default accounts).

```ts
interface AccountingProvider {
  key: 'tripletex' | 'fiken' | 'poweroffice' | 'visma_eaccounting' | 'visma_net' | '24seven' | 'unimicro' | 'xledger';
  testConnection(): Promise<void>;
  listCustomers(since?: Date): AsyncIterable<ExtCustomer>;        // pull
  upsertCustomer(c: Customer): Promise<{ externalId: string; customerNumber?: string }>;   // push
  listSuppliers(since?), upsertSupplier(...)
  listProducts(since?), upsertProduct(...)
  getStockLevels?(): AsyncIterable<{ externalProductId, quantity }>;   // optional capability
  listProjects?(), upsertProject?(...)
  createInvoice(inv: InvoiceDraft): Promise<{ externalId; invoiceNumber; pdfUrl? }>;  // from order lines
  createOrder?(...)          // some systems want an order before invoice
  registerSupplierInvoice?(...)
  getInvoiceStatus(externalId): Promise<'draft'|'sent'|'paid'|'overdue'|'credited'>;
  capabilities(): Set<'stock'|'projects'|'ehf'|'webhooks'|'supplier_invoices'>;
}
```
- Mapping tables: `integration_links(tenant_id, provider, local_object, local_id, external_id, last_synced_at, hash)` to make every sync **idempotent** (compare hash before pushing).
- Direction settings per entity: `pull_only | push_only | two_way (accounting wins | app wins)`. Default: customers two-way (accounting wins on number), products pull, invoices push, projects two-way.
- Scheduled pulls (every 15 min) + webhooks where supported; manual "Synkroniser nå".
- Error surfaces: an *Integrasjonslogg* per tenant with human-readable messages ("Tripletex: kundenummer 1005 finnes allerede — velg å koble eller opprett nytt"), since number-range collisions are a real failure mode. A "Koble til eksisterende" resolver UI for duplicates.
- Invoicing: "Send til regnskap" runs `invoice` readiness, creates an `invoices` row (draft) with allocations to order lines (full or partial), then an `integration_submissions` row whose idempotency key is the invoice's stable `submission_key` (`{tenant}:{invoice_id}`, §5.11) sent as the provider's external reference / order number. On timeout or lost response the submission is marked `unknown` and a reconciliation job queries the provider by that reference before any retry; only `confirmed` submissions set `external_id` and advance `billing_status`. Credit notes and replacement invoices are new `invoices` rows referencing the original. Payment status is pulled where the provider supports it.

### 8.2 Norwegian public data
- **Brønnøysundregistrene** (Enhetsregisteret REST, free): org.nr lookup → name, address, NACE, bankruptcy flag.
- **Kartverket / Geonorge address search** (free): address autocomplete + coordinates; **Bring/Posten** postal code → city.
- **Enova** support schemes: link/notes only (changes yearly); tenants add a custom field if they track applications.

### 8.3 Communication & signing
- Email: Postmark or Scaleway TEM (EU) with DKIM per tenant domain optional; SMS: a Norwegian gateway (e.g. Sveve, LinkMobility) via a `SmsProvider` interface; Push: Web Push (VAPID) + FCM/APNs via Capacitor.
- E-signature: drawn signature by default; optional Vipps Login identity on offer acceptance; BankID-level signing via Signicat/Idfy can be added as an `SignatureProvider` later.

### 8.4 Outbound API and webhooks
- Full REST API with per-tenant API keys; OpenAPI generated from the code; generic `/records/:object` endpoints expose custom objects too.
- Outbound webhooks configurable per object event, HMAC-signed, with retries and a delivery log.

---

## 9. UI / UX system

### 9.1 Accessibility baseline (elderly users, gloves, sunlight, basements)
- WCAG 2.2 AA throughout; contrast ≥ 4.5:1 text, ≥ 3:1 UI; no colour-only meaning (always icon + text, e.g. "● Forfalt").
- Base font 18 px on mobile, 16 px desktop; user-selectable text size in the profile menu: **Normal / Stor / Ekstra stor** (rem scaling, persisted). Layout must survive 200 % browser zoom without horizontal scroll.
- Touch targets ≥ 48×48 px, ≥ 8 px spacing; primary action is a full-width bottom button on mobile ("sticky action bar").
- Keyboard navigable, visible focus rings, `aria-*` on all custom components, screen-reader labels in Norwegian.
- Plain Bokmål, no English jargon: "Lagre", "Avbryt", "Ferdigmeld ordre". Numbers formatted `1 234,50 kr`, dates `07.09.2026`, times `08:30`.
- Confirm destructive actions with a sheet that names the object ("Slette ordre ORD-1042?"), and offer "Angre" toast for 8 s after most actions.
- Never hover-only; no double-tap; no gesture-only functionality (drag-and-drop in the planner always has a "Flytt…" menu equivalent).
- Errors are inline, next to the field, in words, with the field highlighted; the first error is scrolled into view and announced.
- Light theme default with an optional high-contrast and dark theme; system-preference aware.

### 9.2 Design tokens (Tailwind config + CSS variables)
```
--color-primary: #0B5FA5   (buttons/links)   --color-primary-contrast: #FFFFFF
--color-success: #1E7F3E   --color-warning: #B26A00   --color-danger: #B3261E   --color-info: #2F5F8F
--color-surface: #FFFFFF   --color-surface-2: #F3F5F7   --color-border: #C9D1D9   --color-text: #1A1F24   --color-text-muted: #4A5560
--radius: 12px   --space: 4px scale   --font: "Inter", system-ui   --font-size-base: 18px (mobile) / 16px (desktop)
Status colours are taken from picklist_values.color but are always paired with the label text.
```

### 9.3 Navigation model
- **Desktop (≥1024 px):** left sidebar with module icons + labels (collapsible), top bar with global search (⌘K) and "+ Ny" menu, content area with list/record split possible.
- **Tablet (768–1023):** sidebar collapses to icons; record pages single column.
- **Mobile (<768):** bottom navigation with max 5 items — *Hjem*, *Ordrer*, *Kalender*, *Søk*, *Mer*. "Mer" opens the module list. Home = "I dag": today's orders as big cards (time, customer, address, type, status), pending sync, notifications.
- Every module: **List → Record → Related** hierarchy, identical everywhere, so learning one module teaches all.

### 9.4 Standard screen types (implement once, drive by metadata)
1. **ListView**: search, filter chips, saved views dropdown, column picker (desktop table / mobile cards), bulk select, export.
2. **RecordPage**: header (title, subtitle, status badge, primary action, "…" menu), tabs (desktop) → segmented control + collapsible sections (mobile), form rendered from layout JSON with `FormRenderer`.
3. **FormRenderer**: one column on mobile, two on desktop; labels above fields; required marked with text "(må fylles ut)"; field types map to accessible PrimeVue inputs; lookups use a searchable picker with recent items and "Opprett ny".
4. **RelatedList**: generic table/cards of child records with "Legg til".
5. **Completion summary** (Ferdigmelding): contextual step list from the job type + readiness (§2.10); satisfied steps ticked, missing ones link straight to the field/checklist/upload; each step is a normal screen, so partial progress is just saved data.
6. **Board**: kanban by picklist (orders by status, deviations by status).
7. **Planner** (§9.5).
8. **Public pages**: offer page and portal — no app chrome, extra-large text, single column.

### 9.5 Resource planner design
- **Desktop:** resource timeline — rows = people (grouped by team), columns = hours of the day (day view) or days (week view); order blocks show customer + city + type icon; colour = status; unscheduled orders ("Til fordeling") in a right-hand panel; drag from panel onto a person/time to plan; drag to move/resize; multi-assign by dropping onto a second person; conflicts (overlap, holiday appointment) shown with a warning stripe; right-click / "…" menu offers the same actions as drag. Filter by team, order type, status. Week and month views for overview. Implementation: FullCalendar with the resource-timeline plugin (commercial licence) or Schedule-X (open source) — both support drag/drop and resources.
- **Mobile:** agenda list per day for the logged-in user ("I dag", "I morgen", swipe for next day); planners (office) get a person picker on top; moving an order is done via "Flytt…" → date/time/person picker (no drag). Map button opens the address in Google/Apple Maps.
- **TV mode** `/tv?team=X`: fullscreen, no navigation, huge text (≥ 32 px), auto-refresh via live sync, today's timeline for all technicians plus a right column "Ikke fordelt" and a footer ticker of orders `in_progress` with the technician's name; rotates teams every 30 s if several; dark theme for hall displays; login via a device token QR shown once.
- Appointments (ferie, kurs, sykdom) are created directly in the planner with the same interaction as orders.

### 9.6 Key screens to build first (acceptance description for a coder)
- Hjem (I dag) mobile; Ordreliste; Ordreside with Ferdigmelding wizard; Sjekkliste runtime; Enhetsside + QR scan landing; Adresseside with device table and bulk order creation; Planner desktop + mobile agenda + TV; Tilbudsbygger + public offer page; Oppsett → Objektbehandler (fields, picklists, layouts, validation).

---

## 10. Workflow / automation engine ("Arbeidsflyter")

Kept at "when / if / then" complexity (Zapier-like), not BPMN. Each workflow is JSON:
```json
{
  "name": "Godkjent ordre → rapport til kunde",
  "object": "orders",
  "trigger": { "type": "record_updated", "when": "ISCHANGED(review_status) AND review_status.system_meaning = \"approved\"" },
  "conditions": "NOT(ISBLANK(customer.email))",
  "actions": [
    { "type": "generate_pdf", "template": "order_report", "saveAs": "report_pdf" },
    { "type": "send_email", "to": "{{customer.email}}", "template": "order_done", "attachments": ["report_pdf"] },
    { "type": "create_record", "object": "orders", "values": { "name": "Service {{DATEADD($today,12,\"month\")}}", "customer": "{{customer}}", "address": "{{address}}", "job_type": "service", "visits": [{ "planned_start": "{{DATEADD(completed_at,12,\"month\")}}" }], "work_status": "draft" } },
    { "type": "notify_user", "user": "{{leader_user_id}}", "title": "Rapport sendt til {{customer.name}}" }
  ]
}
```
- Trigger types: `record_created`, `record_updated`, `record_deleted`, `field_changed`, `scheduled` (cron, with a record filter, e.g. daily "devices where next_service_at < today+30"), `button` (manual action), `webhook_in`, `offer_accepted`, `checklist_completed`, `sync_error`.
- Action types: `update_record`, `create_record`, `delete_record`, `send_email`, `send_sms`, `notify_user`, `create_task`, `generate_pdf`, `call_webhook`, `run_integration` (e.g. push invoice), `wait` (delay in days/hours, resumable), `branch` (if/else with nested actions).
- Execution: **transactional outbox**. Every record write appends to `outbox(id, tenant_id, event_id, event_type, record_id, payload, causation_chain jsonb, created_at, published_at)` in the same transaction; a relay publishes to a Redis stream; the worker consumes with at-least-once delivery. `workflow_runs(id, workflow_id, event_id, record_id, status, started_at, finished_at)` has a unique `(workflow_id, event_id)`, so a redelivered event never starts a second run — it **resumes** the existing one. Every action has a **stable action path** (`actions[2].branch.then[0]`, assigned ids at publish time, stable across edits) and a durable state row:
```
workflow_action_states(run_id, action_path, status 'pending'|'in_progress'|'succeeded'|'failed'|'unknown'|'needs_review', attempt, external_ref, started_at, finished_at, error)
```
A resumed run skips `succeeded` actions, retries `pending`/`failed`, and treats `in_progress` older than the action's timeout as `unknown`. Unknown outcomes are resolved per action type: `send_email`/`send_sms` use the provider's idempotency key (`{run_id}:{action_path}`) where supported and otherwise query the provider's message log by that key before resending; `create_record` uses a unique `(origin_run_id, origin_action_path)` on the created record, so one event may legitimately create several records; `run_integration` goes through `integration_submissions` with the same key discipline (§5.11); `call_webhook` sends the key in a header and expects idempotent receivers. Actions that cannot be reconciled land in `needs_review` in Oppsett with a manual resolve. **Cycle detection:** each emitted event carries `causation_chain` (workflow ids that led to it); a workflow already in the chain is skipped and logged, and chain depth is capped at 5. Runs are visible in Oppsett with retry.
- Builder UI: vertical list of cards "Når … / Hvis … / Gjør …", each action a form; expression fields have a helper that inserts field names; "Test på en post" runs in dry-run mode showing what would happen.
- Shipped default workflows (per module, editable): offer accepted → create order; order approved → send report; service contract due → create order; checklist Avvik → create HMS deviation; device next service ≤ 30 days → notify owner; equipment control overdue → notify HMS-ansvarlig.

---

## 11. API conventions

- `Authorization: Bearer <JWT>` (OIDC) or `X-Api-Key`. Tenant derived from token; never from the URL.
- Generic: `GET /api/v1/records/{object}?view=&q=&filter=&sort=&cursor=` · `GET /api/v1/records/{object}/{id}?expand=customer,address` · `POST /api/v1/records/{object}` · `PATCH .../{id}` (partial; `If-Match: <sync_version>` is the `baseVersion` of the upload envelope — the server applies the field-class merge policy of §7.3: `lww` fields merge, `protected` fields require a matching version or return `409` with both versions) · `DELETE` (soft). Commands: `POST /api/v1/records/{object}/{id}/commands/{name}` with the same envelope; readiness at `GET .../readiness?stage=`. Filter syntax: `filter=work_status.system_meaning eq 'scheduled' and visits.planned_start ge 2026-09-01` (one level of related-list traversal with `any` semantics).
- Typed endpoints for behaviours: `POST /orders/{id}/complete`, `POST /orders/{id}/invoice`, `POST /offers/{id}/send`, `POST /offers/public/{token}/accept`, `GET /planner`, `POST /checklists/{id}/complete`, `POST /files/sign-upload`, `POST /devices/{id}/qr.pdf`.
- Metadata: `GET /api/v1/metadata` (bundle, ETag), `PUT /api/v1/metadata/objects/...` etc.
- Errors: RFC 9457 problem+json with `errors[{field, message}]` in Norwegian, and a stable `code`.
- Pagination: cursor-based; max 200 per page. All timestamps ISO-8601 UTC; display converts to Europe/Oslo.

---

## 12. Non-functional requirements

| Area | Requirement |
|---|---|
| Performance | List views < 300 ms server-side for 100k-row tenants (indexes on tenant_id + common filters; GIN on custom_fields). Planner day/week query < 200 ms. PWA cold start < 3 s on a mid-range Android. |
| Availability | Single-region EU; daily encrypted backups + PITR (WAL); restore drill quarterly. Attachments versioned in object storage. |
| Observability | OpenTelemetry traces (API + worker), structured logs with tenant_id, Sentry for web/API; per-tenant integration log. |
| Testing | `packages/core` expression engine: 100 % branch coverage with a table-driven test file. API: contract tests from OpenAPI; RLS tests per §4.2. Sync-projection tests: for each profile, assert that no `restricted`/`secret` column appears in any stream and that a technician's streams contain only assigned visits. Web: component tests + Playwright flows for Ferdigmelding, offer acceptance, offline round-trip (go offline → edit → reconnect → verify). Accessibility: axe checks in CI; manual test at 200 % zoom and with TalkBack/VoiceOver. |
| i18n | Keys with nb-NO default and en fallback; nn-NO later. Never hardcode Norwegian in components. |
| Security | OWASP ASVS L2; signed upload URLs; CSP; secrets in vault; dependency scanning; penetration test before launch. |
| Data migration | Import wizard (CSV/Excel with mapping and dry-run report) for customers, addresses, devices, products; scripted migration from the legacy app database with a mapping document per collection and an idempotent re-run. |

---

## 13. Delivery process & roadmap

### 13.1 Ways of working
- Trunk-based development with short-lived branches; CI on every PR (lint, typecheck, unit, RLS, axe); preview environment per PR; weekly release to a pilot tenant.
- Architecture Decision Records in `/docs/adr`; the metadata schema and expression grammar are ADR-001/002 and frozen early (everything depends on them).
- **Usability sessions every second sprint with 2–3 real technicians, at least one over 60**, on their own phones. Findings become tickets before new features.
- A "demo" tenant seeded with realistic Norwegian data (Daikin/Mitsubishi/Panasonic models, Akershus addresses, sample vernerunde) for every environment.
- Definition of done includes: works offline where applicable, passes axe, has Norwegian labels, layout-driven (no hardcoded form), audit-logged.

### 13.2 Phases (each ends in something a pilot company can use)
The foundation is built **through one vertical slice**, not as a platform first:

> *Add an installation requirement in Tilpass → schedule a visit → complete its checklist offline → reconnect → office review → issue a report.*

| Phase | Scope | Exit criteria |
|---|---|---|
| 0 Slice (6–8 wk, 2–3 devs) | Monorepo, identities/memberships, tenancy + RLS roles, custom fields on **core objects only**, picklists, layouts, requirement rules of kinds `field`/`checklist`/`attachment` (no `expression` yet), one job type, changeset publish with basic preview (no impact analysis yet), FormRenderer/ListView/RecordPage, Kunder/Adresser/Enheter (basic)/Ordrer with one visit and bookings, checklist runtime, upload envelope + command queue, outbox + action states, Sync Streams with the §7.4 acceptance tests, versioned report PDF, office review queue. **Deferred:** custom objects, formulas, rollups, expression rules, module three-way merge, workflow builder, AI. | The slice above works on a pilot technician's phone, offline, end to end |
| 1 Field service (8–10 wk) | Devices with circuits and obligations, multiple visits, `expression` rules + collection predicates, job types complete, starter configuration "Boligvarmepumpe", photos/signature, refrigerant events, **help knowledge base + Hjelp assistant (§14.9)**, **minimal products + order lines + supplier links** (name, sku, unit, sales price, quantities — no packages/pricing logic), material uses + vehicle stock (basic), **CSV/Excel import wizard**, basic planner (desktop timeline + mobile agenda), notifications/push | Pilot company runs all field work in the app; legacy app read-only for field |
| 2 Money + first assistant (7–9 wk) | Products complete, packages/addons, hours, Tilbud + public offer page, invoices + submissions, **first accounting adapter (Tripletex)**, Brønnøysund/Kartverket, messaging (templates, delivery ledger), **AI query primitive + service-reminder assistant (§14.3)** | Invoice created in accounting from a completed order without re-typing |
| 3 Platform depth (6–7 wk) | Custom objects, formulas/rollups, impact preview + data migrations, second and third accounting adapters, service contracts with occurrences, planner polish (resources, conflicts), supplier price import engine + **supplier-mapping assistant (§14.4)**, **Sett opp mode of the help assistant (§14.9)** | Tenants self-serve customisations; contracts generate work |
| 4 Modules (5–6 wk) | HMS (deviations, stoffkartotek, equipment, documents, vernerunde), Prosjekter, Kundeportal, stock counts/supplier orders, **TV mode** | HMS-ansvarlig runs a vernerunde on a tablet; hall TV live |
| 5 Automation (ongoing) | Workflow builder UI, remaining adapters, dashboards, legacy migration tooling, Capacitor store apps, Markedsføring module + **campaign assistant (§14.5)** | Legacy app switched off |

Estimates assume 2–3 experienced developers and will move with the unresolved sync work in phase 0; treat them as ordering, not commitments.

### 13.3 Implementation gates for the prototype (must pass before the next phase starts)
1. **Sync boundary** (§7.4): the five acceptance tests, plus: (a) verify on the pinned PowerSync version what happens when two streams deliver the same row id with different column sets — if it is not a documented merge, keep the `field_projections` design and add a lint that forbids any two streams selecting the same table; (b) revoke a technician's permission to an ordinary custom field and prove it disappears from every stream at publish; (c) a client that tampers with connection/subscription parameters receives a subset, never a superset.
2. **Command path** (§7.1–7.3): offline complete-visit with photos → reconnect → server re-evaluates readiness under prior and current rule versions → outbox → workflow with a crashed worker mid-action → resume without duplicate report emails.
3. **Billing** (§5.11): two office users invoicing the same line concurrently; an `unknown` submission reconciled to `confirmed`; a partial amount-only credit; billing status never advanced by a draft.
4. **Import/undo** (§14.4): a supplier file with leading-zero SKUs, decimal commas and a duplicate SKU; undo after a manual edit leaves the manual edit intact.
5. **AI boundary** (§14.7): the model cannot execute, approve or authorise anything; an approval on version N does not execute version N+1; execution-time rechecks drop an unsubscribed recipient.
6. **Help assistant** (§14.9): the three representative interactions pass — grounded steps with a working Vis meg action; a readiness diagnosis that matches the engine's own result and links to the missing item; a validated changeset draft whose preview lists field, placement, requirement, visibility, report inclusion and effect on existing work — plus a stale tenant note contradicting live configuration is reported as a conflict, and a technician's field-visibility question does not reveal the permission matrix.

### 13.4 Guardrails against re-bloat
- Product owner reviews every "can you add a field" request against §1.1: answer with a *Tilpass* guide, a setting on the module/job type, a starter configuration, a module, or a core change — never a code-level flag.
- Quarterly metadata report: which custom fields/workflows exist across tenants → candidates for core or for shareable "pakker" (installable templates a tenant can adopt with one click, e.g. "Enova-søknad felt", "Kuldemedielogg").
- Core object field count is capped (e.g. ≤ 40 per object); adding a core field requires an ADR.

---

## 14. AI assistants ("Assistent") — plan with the model, execute with the application

### 14.1 Principle
Token cost must not scale with the tenant's data. The model's job is to **understand a request and produce a small, structured plan**; the application's job is **searching, calculating, bulk processing, sending and tracking**. The model never sees a customer list, a 50 000-row price file or an email history — it sees column headings, counts, a handful of examples and action ids. Every AI feature is therefore: *interpret → prepared action → preview in the normal UI → one approval → deterministic execution through the existing command/outbox path (§7, §10)*.

Consequences that fall out of the existing architecture:
- Execution reuses `commands` + `integration_submissions`/`outbox` idempotency, so a timeout never sends twice or applies a price update twice.
- A prepared action the user wants "every month" is saved as an ordinary **workflow** (§10, `scheduled` trigger) and runs with zero model tokens unless wording generation is part of it.
- Tools run under the current user's session: tenant from the JWT, profile permissions, field classification (§4.3). The model never chooses a tenant and never sees `restricted`/`secret` fields.
- Live AI is **online-only** (bulk assistants in the office UI; help and diagnosis on desktop *and* mobile when connected). The offline technician app is untouched by AI, but ships **cached help articles** clearly labelled as offline help, not live assistance.

### 14.2 One reusable primitive, three bounded assistants
Do not start with a general agent. Build one primitive — **natural language → validated filter/action over metadata** — and three assistants on top of it. The primitive is what makes every future assistant cheap.

**Primitive: `resolve_query(text) → { object, filter, fields }`.** The model outputs a filter in the app's own filter syntax (§11, e.g. `device_type.value eq 'varmepumpe' and maintenance_due_at ge 2026-09-01 and maintenance_due_at lt 2026-10-01 and status.system_meaning ne 'retired'`). The application validates it against the tenant's metadata bundle (unknown field/value → clarifying question), runs it, and returns **counts** and a saved-list-view id. The result renders as a normal ListView — data shown to the user never passes through the model. "Lagre som listevisning" is one click; this alone replaces most "can you add a report" requests.

**Field context the model sees.** Each field may carry `ai_description` and `ai_aliases` (tenant-editable in *Tilpass*), and `ai_visible` (default true for `public`/`internal`, false for `restricted`/`secret`). A request is answered with the *relevant slice* of metadata (the objects mentioned plus their lookups — typically 20–60 fields, not the whole schema, never layouts or workflows). Where two fields could mean the same thing ("anbefalt servicedato" → `maintenance_due_at` or a circuit's `leak_check_due_at`), the assistant asks once and the answer is stored as a **concept binding** (`ai_concept_bindings(tenant_id, concept 'recommended_service_date', field_id, decided_by, at)`); it is never guessed silently, and the UI says which one was used. Routine maintenance and regulatory leak checks are always distinguished.

```
prepared_actions(id, tenant_id, kind 'service_reminders'|'price_update'|'campaign'|'bulk_update', created_by, status 'draft'|'approved'|'executing'|'done'|'failed'|'expired',
                 spec jsonb (the structured plan), preview jsonb (counts + sample), audience_snapshot_id (the exact recipient/change set, frozen), metadata_version, expires_at, approved_by, approved_at, executed_command_id, result jsonb)
ai_conversations(id, tenant_id, user_id, messages_compact jsonb, decisions jsonb)      -- store decisions and action ids, not tool results
ai_usage(id, tenant_id, feature, model, input_tokens, output_tokens, cached_tokens, cost_estimate, at)
```

### 14.3 Assistant 1 — Service reminders
"Send en servicepåminnelse til alle varmepumper med anbefalt dato denne måneden."
1. Model → `prepare_service_reminders({ equipment_filter, due_concept: "recommended_service_date", period: "this_month", template: "service_reminder", channel: "email"|"sms" })` (a few hundred tokens in, ~100 out).
2. Application resolves the period in the tenant's timezone, binds the concept to a field, runs the filter, then applies business rules that live in code, not prompts: exclude retired devices; exclude devices with a planned visit for that obligation; skip obligations already reminded within N days (`reminder_log`); group several devices per contact into one message; choose the contact (site contact → primary contact → customer email); collect "missing contact" rows.
3. Returns a compact summary to the model and the user: `{ prepared_action_id, equipment_count: 184, recipient_count: 126, already_booked: 21, missing_contact: 7 }`. The recipient table renders from the backend with the merge-field preview of one message.
4. User approves once **in the application UI** (not through the model); the application executes the approved version as a command; sending uses the frozen template version with merge fields (126 sends, zero model calls); delivery is tracked in `message_log` and the device's obligation gets `last_reminded_at`.
5. "Gjør dette hver måned" converts the spec into a scheduled workflow. Optional: "Skriv ny tekst" generates wording once per run, not per recipient.
Also expose the same thing as a **button** ("Lag servicepåminnelser") on the devices list and on the HMS/obligations dashboard — the button path costs zero tokens and is what most users will use after the first time.

### 14.4 Assistant 2 — Supplier price files (the strongest differentiator)
"Jeg har en prisfil fra Brødrene Dahl — oppdater produktene mine."
```
supplier_import_profiles(id, tenant_id, supplier_id, name, file_signature (hash of normalised header row + delimiter + encoding), column_mapping jsonb,
                         parsing jsonb {delimiter, encoding, decimal_comma, header_row, sheet}, unit_rules jsonb, version, verified_by, verified_at, last_used_at)
pricing_policies(id, tenant_id, supplier_id NULL, name, rules jsonb, is_default)
product_supplier_links(id, product_id, supplier_id, supplier_sku, pack_qty, unit, is_preferred)
product_supplier_prices(id, product_supplier_link_id, supplier_list_price, discount_pct, purchase_cost, currency, valid_from, valid_to NULL,
                        source 'import'|'manual'|'accounting', import_run_id NULL, at)      -- history; current = latest valid row per link
-- products.cost_price is DERIVED: the current purchase_cost of the *preferred* supplier link (converted to NOK at import rate); changing the preferred supplier or its price re-derives it and is audited
import_runs(id, tenant_id, profile_id, file_id, status, stats jsonb, change_report jsonb, prepared_action_id)
```
Flow:
1. The parser (deterministic: encoding detection, delimiter, decimal comma, header row, sheet selection) reads the file and computes a `file_signature`.
2. Known signature → reuse the profile; **no model call**. Structure changed → go to step 3 for the changed columns only.
3. Unknown file → the model receives *only* the column headings, 5–10 representative rows, and per-column statistics (type, fill rate, unique count, min/max, sample values) — a few thousand tokens regardless of file size. It proposes a mapping to canonical targets (`supplier_sku`, `ean`, `name`, `supplier_list_price`, `purchase_cost`, `discount_pct`, `unit`, `pack_qty`, `currency`, `vat_basis`, `ignore`) with a confidence per column and explicit questions for ambiguities ("Kolonnen «Pris» — er dette netto innkjøpspris eller veiledende pris?").
4. The user confirms the mapping in a table UI; it is saved as a profile under tenant + supplier + signature.
5. The **import engine** processes every row: product numbers as strings (leading zeros preserved), matching by `supplier_sku` first, then EAN, then *suggested* matches from pg_trgm shown for review — never auto-created products; pack quantity and unit conversion; VAT basis and currency normalisation; duplicate product numbers flagged; missing prices and unusual changes (> ±30 %, configurable) flagged; unmatched rows listed.
6. A **pricing policy** decides what "oppdater prisene" means, stored per tenant/supplier, e.g. *update supplier list price and purchase cost; keep manually maintained sales prices; recalculate sales price only for products with a pricing formula (`cost × markup` or `list − discount`)*. The model may propose a policy on first use; the user confirms it once.
7. The change report (rows: product, old → new per price field, action) is a prepared action; the user approves in the UI → the application applies the changes in **batches** (per-row status, retries, resumable) with a full audit trail. **"Angre importen"** restores a value only if the current value still equals what the import wrote (expected-value check); rows changed since are listed as "Ikke angret — endret manuelt etterpå".
Matching is by exact identifiers; similarity only suggests. The model is escalated only for the ambiguous columns and, optionally, for a handful of unmatched rows the user asks about.

### 14.5 Assistant 3 — Campaign emails (module "Markedsføring")
"Lag en ny kampanje-e-post basert på de forrige og send til kundene."
```
company_writing_profile(tenant_id, tone, language 'nb-NO'|'nn-NO', structure_notes, signature, banned_claims text[])
campaigns(id, tenant_id, subject, preview_text, body_html, tags text[], audience_filter, sent_at, stats jsonb, embedding vector)   -- pgvector
audiences(id, tenant_id, name, filter, snapshot_count); suppressions(tenant_id, email, reason 'unsubscribed'|'bounced'|'complaint', at)
message_log(id, tenant_id, category 'transactional'|'service'|'marketing', recipient, template_or_campaign_id, status, provider_message_id, at)
```
1. Retrieval, not history-stuffing: the 2–3 most relevant previous campaigns (pgvector similarity + tags + recency), truncated to subject + first ~1 500 characters each, plus the writing profile.
2. The model receives the **facts for this campaign** from the application — selected products with *current approved prices*, validity dates, target audience description, offer conditions. Old emails are style examples only; they are explicitly marked as untrusted content and must not be a source of prices or promises.
3. Output: subject, preview text, body with merge fields, call-to-action, and optionally 2–3 audience-segment variants (e.g. eier av luft-luft > 8 år, servicekontraktkunder). One generation per segment, never per recipient.
4. The application builds the audience from a filter (§14.2), applies suppressions, deduplicates per contact, enforces marketing-consent rules (marketing to existing customers vs. requiring consent, unsubscribe link in every message — legal review required), and sends through the email provider with tracking. Service reminders and marketing are separate categories with separate sending policies and separate sender identities.
5. Preview in the normal campaign editor; the user edits, test-sends to themselves, approves. Sending 5 000 emails is one prepared action.

### 14.6 Tool set exposed to the model (small, bulk, permission-checked)
```
resolve_query(text)                                   → { object, filter, count, list_view_id, questions[] }
prepare_service_reminders(criteria)                   → summary + prepared_action_id
analyze_supplier_file(file_id, supplier_id)           → { profile_id | proposed_mapping, questions[] }
prepare_product_price_update(profile_id, policy_id)   → change report summary + prepared_action_id
find_campaign_examples(topic, limit=3)                → [{ id, subject, date, excerpt }]
prepare_campaign(audience_id, content)                → preview + prepared_action_id
get_action_status(id)                                 → status + counts (read-only)
ask_user(question, options[])                         → (renders a question in the UI; the model stops)
```
There is deliberately **no execute tool**: the assistant prepares, the user approves through the application, the application executes (§14.7). Each assistant is given **only its own tools** (4–6 definitions), not the union. Tool results are counts, ids and short samples; anything larger is rendered by the UI directly from the backend. Tool calling and structured JSON output use the provider's native tool-use API (for Claude: https://docs.claude.com/en/api/overview); the application validates every tool call against a JSON schema and the tenant's metadata before running it.

### 14.7 Safety
- **Untrusted content:** uploaded files, previous emails, product descriptions and customer notes are data. They are wrapped and labelled as content in the prompt; instructions found inside them ("send this to all customers") are ignored, and the model has no tool that sends anything — only `prepare_*` tools, which always end in a human approval (or a pre-authorised recurring workflow set up by an administrator).
- **Approval is an application boundary, not a field.** `prepared_action_versions(id, prepared_action_id, version, content_hash, spec, audience_snapshot, template_version_id, merge_data_snapshot, policies_snapshot)` is immutable; `prepared_action_approvals(version_id, approved_by, approved_at, permission_checked)` is written only by the UI approval endpoint under the approving user's session. Any material edit creates a new version and invalidates the approval. **Recurring automations** require `automation_authorizations(workflow_id, authorized_by (admin), scope, expires_at)` created by an administrator in Oppsett; neither the model nor a prepared action can create one. The model has no tool that writes to any of these tables.
- **Execution-time rechecks** (a frozen preview is not a guarantee):

| Action | At execution |
|---|---|
| Any | Recheck the approving user's permissions and that the approved `content_hash` is unchanged; otherwise stop with a reason |
| Campaign | Recheck suppressions and eligibility; drop newly ineligible recipients; never add recipients |
| Service reminders | Recheck bookings and the duplicate-reminder window; drop, never add |
| Price update | Compare each row's expected old value/version; conflicting rows are reported, not overwritten |
| Any bulk job | Executed in batches with per-row/per-recipient status and retries; not one transaction |

Frozen with the version: template/message version, merge data, recipient or change set, and the policies applied — not only ids. Prepared actions also expire (24 h) as a coarse backstop.
- Permissions: the assistant can never reach data the user cannot see in a list view; `ai_visible=false` fields are absent from prompts and results. Administrators can disable AI per tenant or per profile (module setting).
- Rate limits and per-tenant monthly token budgets from `ai_usage`, with a plain "Assistenten er brukt opp for denne måneden" message rather than a silent failure.

### 14.8 Token optimisation, in priority order
| # | Optimisation | Effect |
|---|---|---|
| 1 | Bulk data never enters prompts (counts, ids, samples only) | Cost independent of record count |
| 2 | Reuse: import profiles, concept bindings, templates, saved workflows, buttons | Removes the model from repeat runs entirely |
| 3 | Small per-assistant tool sets; compact JSON results | Fewer tokens per turn |
| 4 | Metadata slice, not whole schema; 2–3 retrieved examples, not history | Bounded context |
| 5 | Model tiers: a small model for intent/filter extraction with structured output; a stronger model for column mapping and campaign writing; measured on real Norwegian requests and real supplier files (cost per *successfully completed* task, correction rate, latency — not price per token) | Right-sized cost |
| 6 | Prompt caching of the stable prefix (instructions + tool definitions + writing profile) where the provider supports it (Claude: see https://docs.claude.com/en/api/overview) | Lower cost/latency on repeat calls; cached tokens still occupy context |
| 7 | Compact conversation state: store decisions and action ids in `ai_conversations`, not raw tool results | Long sessions stay cheap |
| 8 | Prompt language chosen by measurement on the tenant's real requests (English and Norwegian prompts both tested); templates hold the Norwegian boilerplate | Correct interpretation first; token difference is secondary |

### 14.9 Assistant 4 — In-app help, diagnosis and configuration ("Hjelp og oppsett"; support-ticket deflection)
One assistant interface (a persistent "?" button that knows the current screen, selected record and the user's profile) with **four internal paths**: *explain*, *diagnose*, *propose configuration*, *escalate*. Available on desktop and mobile when online; configuration paths gated by permission, not by surface.

**Source authority (fixed order — tenant notes never override live behaviour).**

| Source | Establishes | Loaded |
|---|---|---|
| 1. Live state: the user's permissions, tenant configuration, diagnostics of the record at hand | What this user can do *now* | Always, before retrieval (also used to filter articles) |
| 2. Documentation for the deployed release (`help_articles`) | How the implemented feature works | Retrieved: filter by tenant modules, visibility and app version first, then keyword + vector ranking |
| 3. Published tenant procedures (`tenant_help_notes`) | How this company wants employees to work | Retrieved; business guidance only |

If 3 contradicts 1 or 2 the assistant says so: "Bedriftens veiledning sier at signatur er valgfritt, men Montering er nå konfigurert til å kreve signatur. Be administrator gjennomgå innstillingen eller veiledningen."

**Path 1 — Explain.** Grounded answer with citations, using the tenant's own labels and the user's profile level. Where an article carries a `ui_action_id`, offer **"Vis meg"**: the model returns `{ action_id: "address.add_device", context: "current_address" }` from a **registered action catalogue** (never a URL or selector); the frontend resolves it to the right screen and control for the device and the user's permissions, opens and highlights it, and never submits anything. Disabled modules are not presented as available, but are named when relevant: "Dette støttes i Servicekontrakter, som ikke er aktivert for bedriften."

**Path 2 — Diagnose.** Read-only tools backed by the application's own logic — the answer comes from the engine, not from the model's reading of documentation:
```
diagnose_readiness(object, record_id, stage)   → readiness result (§2.9): missing items with links     "Besøket mangler bilde av utedelen — kreves for jobbtypen Montering. Åpne bilder."
diagnose_field_visibility(object, field, record_id) → layout placement, job type, profile field permission, record access
diagnose_workflow(record_id)                    → workflow runs + action states + delivery result (§10)
diagnose_planner(order_id)                      → visits, bookings, assignment, date window, access mode
diagnose_import(import_run_id)                  → row status and conflicts (§14.4)
diagnose_sync(user)                             → items in "Krever oppfølging", last sync, pending uploads
```
Every diagnostic runs under the asking user's permissions and returns only what that user may see: a technician asking why a field is hidden gets "Feltet er ikke tilgjengelig for din rolle — kontakt administrator", not the permission matrix. Record diagnostics are fetched only when the question is about a record; the selected record is never sent wholesale.

**Path 3 — Propose configuration.** A natural-language front to the Tilpass wizard (§2.8). Permissions `configuration.propose` (draft a changeset) and `configuration.publish` are separate; ordinary users without either may still describe a wish, which becomes a *configuration request* for an administrator (no configuration access granted). Flow: understand → inspect existing configuration (dedupe: "Du har allerede feltet «Enova-søknad» — bruke det?") → draft changeset → **validate** → repair validation errors (max 2 rounds) → present preview → an administrator publishes. Tools (draft-only; validation and preview are read-only with respect to active configuration; there is no publish tool):
```
lookup_object(text) / lookup_capability(text)
propose_field(object, label, type, { picklist_values?, help_text?, ai_description?, default?, classification: 'internal', offline_policy: 'allowed', report_inclusion: 'excluded'|'customer_report'|'internal_report' })
propose_layout_placement(field, { job_types[] | 'all', section, position: 'end' })
propose_requirement_rule(target, stage, { level: 'required'|'recommended', criticality: 'administrative', override_policy: 'authorized_with_reason', scope, condition?, message })
propose_picklist_values(picklist, values[], { position: 'end' })
propose_job_type_setting(job_type, setting, value)        -- only settings listed in the capability manifest as configurable_by_assistant
validate_changeset(id)                                     → errors, warnings (read-only)
preview_changeset(id)                                      → impact summary (read-only)
create_feature_request(description, context) / create_support_ticket(summary)
```
Defaults are supplied by the platform, not invented by the model; each `propose_*` uses the **same trusted code path as Tilpass**, so a new field gets the same default field-permission rows as a field created in the wizard (absent row = no access would otherwise let the assistant create a field nobody can use). The preview always states: field and type; where it appears (objects, job types, section); requirement stage and level; which profiles see it; report inclusion; effect on existing work (records that will now be incomplete at that stage). v1 scope is the "Vanlig tilpasning" column of §2.8; no retire/delete, no permissions, no integrations, no custom objects, no workflows, and never generated code — the assistant composes capabilities the platform already implements. Formulas and workflows can be added later through their validated languages.

**Path 4 — Escalate and capability states.** `lookup_capability` reads a **capability manifest** (`capabilities.yaml`: capability ids, module, documentation slugs, supported configuration operations, `ui_action_id`s) and returns one of: `available`, `configurable_by_assistant`, `configurable_manually`, `module_disabled`, `permission_required`, `blocked_by_record_state`, `known_issue`, `unsupported`, `unknown`. A missing manifest entry is `unknown`, never proof of impossibility; only `unsupported` (and `unknown` after a clarifying question) becomes a feature request. `feature_requests(id, tenant_id, user_id, description, sanitized_description, module_key, context jsonb, cluster_id)` are clustered across tenants on the sanitised description only, counting distinct tenants, so one company's notes are never visible to another. For support tickets the user **reviews the summary before sending**: diagnostics, source references and relevant transcript excerpts — not every customer detail in the conversation.

**Definition of "add functions".**

| Request | Behaviour |
|---|---|
| Add a field, requirement or picklist option | Prepare supported configuration (path 3) |
| Enable an existing job-type behaviour (signature, travel, multiple visits) | Propose the permitted setting |
| An existing supported calculation or automation | `configurable_manually`: point to Oppsett → Avansert; draft later when formula/workflow tools exist |
| New integration or behaviour the platform does not implement | Explain the limitation; prepare a feature request |

**Knowledge base as maintained product content.** `help_articles(id, slug, title, body_md, module_key, profiles[], app_version_from, app_version_to, capability_ids[], ui_action_ids[], status 'draft'|'published'|'retired', owner, last_reviewed_at, embedding)`; `tenant_help_notes` carry the same lifecycle fields and `visibility` (profiles). A release that changes a workflow updates its article and re-verifies its `ui_action_ids` as part of the same work item (CI checks that every referenced action id exists). Historical support tickets are a *question* source only: their old answers describe the legacy app and are rewritten against the current implementation before entering the knowledge base. Evaluation questions are kept separate from the examples used to build articles and include renamed fields, disabled modules, missing permissions, stale tenant notes, ambiguous requests and genuinely unsupported features. Versioned documentation chunks and the tenant metadata context are cached with the prompt prefix; conversation history is kept compact (§14.8).

**Measurement — resolved problems, not generated answers.** `assistant_sessions(id, tenant_id, user_id, path, question, retrieved_sources, outcome, helpful bool, action_completed bool, changeset_id, changeset_published bool, escalated bool, reopened_within_7d bool, at)` with outcomes `answer_provided`, `user_confirmed_helped`, `action_completed`, `changeset_published`, `escalated`, `reopened`, `abandoned`. Reported measures: verified resolution rate (confirmed or action completed), repeat contact for the same issue, configuration publication success, human support time per tenant; incorrect instructions and incorrect configuration proposals are explicit quality metrics reviewed weekly.

**Safety.** Tenant notes and retrieved content are data, not instructions; diagnostics and configuration tools run under the user's permissions; the model cannot publish, change permissions or touch integrations; one open changeset per conversation; every proposed item is marked "Foreslått av assistenten" in the changeset audit.

**Phasing and prototype.** Explain + diagnose (readiness and field visibility first) in phase 1–2, with the technician scenario "Hvordan legger jeg til et bilde her?" among the first supported; configuration path with Tilpass in phase 3; feature-request intake from day one. The three prototype interactions (§13.3 gate 6) are: (1) "Hvordan legger jeg til en enhet på denne adressen?" → grounded steps + Vis meg; (2) "Hvorfor kan jeg ikke ferdigmelde dette besøket?" → readiness diagnosis with a direct link to the missing requirement; (3) "Legg til Enova-søknadsnummer på Montering, påkrevd før fakturering." → validated draft and administrator preview.

### 14.10 Delivery
AI is the differentiator, so each assistant ships as soon as its deterministic workflow exists rather than all at the end (§13.2): the help assistant (§14.9, Hjelp mode) in phase 1–2 and its Sett opp mode in phase 3; the query primitive and the service-reminder assistant in phase 2 (right after messaging and obligation filtering), the supplier-mapping assistant in phase 3 (right after the ordinary import engine), campaigns in phase 5 (needs the Markedsføring module, consent handling and legal review). Each ships with: a button path that needs no chat, a preview, an audit trail, an evaluation set of ≥ 50 real Norwegian requests / ≥ 10 real supplier files with expected outcomes, and cost dashboards per tenant.

---

## 15. Glossary (nb-NO → en)
Kunde customer · Leverandør supplier · Kontaktperson contact · Adresse address · Enhet device · Varmepumpe heat pump · Kuldeanlegg refrigeration plant · Kuldemedium refrigerant · Ordre work order · Ordrelinje order line · Befaring site survey · Montering installation · Service service · Reklamasjon warranty claim · Ferdigmelding job completion · Ressursplanlegger resource planner · Avtale appointment · Tilbud offer/quote · Pakke package/bundle · Tilbehør addon · Lager warehouse/stock · Telling stock count · Servicekontrakt service contract · Prosjekt project · HMS health/safety/environment · Avvik deviation · Stoffkartotek chemical register · Sikkerhetsdatablad safety data sheet (SDS) · Vernerunde safety inspection round · Verneombud safety representative · Internkontroll internal control · Oppsett setup · Objektbehandler object manager · Arbeidsflyt workflow · Mva VAT · Org.nr organisation number · EHF Norwegian e-invoice format.

---

## Appendix A — Seed picklists (per new tenant, editable)

- **Arbeidsstatus** (work, meanings): Utkast (draft), Til fordeling (draft, `is_default_for_meaning=false`), Planlagt (scheduled), Pågår (in_progress), Ferdig (completed), Kansellert (cancelled).
- **Besøksstatus**: Planlagt (planned), Pågår (in_progress), Fullført (completed), Avlyst (cancelled).
- **Gjennomgang** (review): Ikke sendt (not_submitted), Til gjennomgang (awaiting_review), Godkjent (approved), Returnert (returned).
- Billing and payment statuses are derived/read-only and not picklists.
- **Jobbtyper** (from starter configuration, editable): Befaring, Montering, Service, Reklamasjon, Feilsøking, Demontering — each with its own completion steps and requirement rules.
- **Enhetstype**: Varmepumpe, Kjøleanlegg, Fryseanlegg, Væskekjøler, Ventilasjon, Varmtvannsbereder, El-anlegg, Annet.
- **Enhetskategori**: Luft-luft, Luft-vann, Væske-vann, Avtrekk, Kommersiell kjøl, Kommersiell frys, Industriell.
- **Produsent**: Daikin, Mitsubishi Electric, Panasonic, Toshiba, Fujitsu, LG, Samsung, NIBE, Bosch, CTC, Annet.
- **Kuldemedium** (with GWP meta): R32 (675), R410A (2088), R290 (3), R744 (1), R134a (1430), R407C (1774), R454B (466), R1234ze (7).
- **Tilbudsstatus**: Utkast, Sendt, Sett, Akseptert, Avslått, Utløpt.
- **Avtaletype**: Ferie, Kurs, Internt møte, Sykdom, Annet.
- **HMS-avvikskategori**: Personskade, Nestenulykke, Farlig forhold, Kvalitetsavvik, Miljø, Utstyr.
- **HMS-utstyrstype**: Stige, Stillas, Fallsikring, Lekkasjesøker, Vakuumpumpe, Manometersett, Truck/jekketralle, Brannslokker, Førstehjelpsutstyr, Annet.

Default profiles: Administrator, Kontor (office/planner), Tekniker, Lesetilgang, HMS-ansvarlig.

## Appendix B — Seeded checklist template: "HMS vernerunde – varmepumpebedrift" (scope `hms_round`)

Header fields (instance-level): Dato (date), Avdeling/Sted (text or address lookup), Deltakere (multi-user). Every item is `tristate` (OK / Avvik / N/A) with `noteOnDeviation: true` ("Merknad/Tiltak") and `on_deviation_create_hms: true`. Footer: "Oppsummering av avvik og tiltak" (textarea, auto-filled from Avvik items), signatures Verneombud / HMS-ansvarlig / Leder, "Neste vernerunde planlagt dato" (date → creates a task).

1. **Elektrisk sikkerhet** — Er elektrisk utstyr og verktøy i god stand uten synlige skader? · Er jordingsutstyr tilgjengelig og i bruk ved behov? · Er elektriske skap og sikringsskap låst/sikret? · Er kabelhåndtering ryddig uten snublefare? · Er isolasjonstestere og måleapparater kalibrert?
2. **Kuldemedier og F-gasser** — Har ansatte gyldig F-gass sertifikat? · Er lekkasjeutstyr og detektorer tilgjengelig og fungerende? · Er det god ventilasjon i arbeidsområdet? · Er kuldemedier lagret forskriftsmessig? · Er nøddusj og øyeskylling tilgjengelig ved arbeid med kuldemedier? · Er gassflasker sikret mot velt?
3. **Løfting og ergonomi** — Er løfteutstyr (truck, jekketralle) i god stand? · Er tunge komponenter merket med vekt? · Er det tilstrekkelig bemanning ved tunge løft? · Brukes riktig løfteteknikk? · Er arbeidsstasjoner ergonomisk tilrettelagt?
4. **Arbeid i høyden** — Er stiger og stillaser i god stand og godkjent? · Er fallsikringsutstyr tilgjengelig og kontrollert? · Er tak og arbeidsplattformer sikret mot fall? · Er stigesikring/fotfeste i orden? · Er området under arbeidsplass avsperret ved behov?
5. **Personlig verneutstyr (PVU)** — Er vernebriller tilgjengelig og i bruk? · Er vernehansker tilgjengelig i riktig type? · Er vernesko påbudt og i bruk? · Er hørselsvern tilgjengelig ved støyende arbeid? · Er åndedrettsvern tilgjengelig ved behov? · Er arbeidstøy i god stand og uten skader?
6. **Verktøy og maskiner** — Er håndverktøy i god stand uten slitasje? · Er elektrisk verktøy jordet og med intakt ledning? · Er vakuumpumper og manometre kalibrert? · Er lodde- og sveiseutstyr i orden? · Er trykkluftverktøy kontrollert og godkjent? · Er verneanordninger på maskiner intakte?
7. **Kjemikalier og farlige stoffer** — Er sikkerhetsdatablad tilgjengelig for alle kjemikalier? · Er kjemikalier lagret i godkjente beholdere med merking? · Er kjemikalieskap i orden og med avtrekk ved behov? · Er det rutiner for håndtering av kjemisk avfall? · Er førstehjelpsutstyr for kjemikalieeksponering tilgjengelig?
8. **Kjøretøy og transport** — Er servicebiler i forskriftsmessig stand? · Er lastsikring av utstyr og materialer i orden? · Er verktøyinnredning sikret mot forskyvning? · Er førstehjelpsutstyr i kjøretøy komplett? · Er brannslokker i kjøretøy kontrollert?
9. **Brann og beredskap** — Er brannslokkere kontrollert og lett tilgjengelig? · Er rømningsveier frie og godt merket? · Er brannvarsling og alarmsystem testet? · Er varmt arbeid-prosedyrer kjent og fulgt? · Er nødutganger fri for hindringer? · Er førstehjelpsskap komplett og tilgjengelig?
10. **Generelt arbeidsmiljø** — Er arbeidsplassen ryddig og ren? · Er belysningen tilstrekkelig? · Er ventilasjonen god? · Er temperaturforholdene akseptable? · Er støynivået akseptabelt? · Er avfallshåndtering i orden? · Er HMS-tavle oppdatert og synlig?

Cross-links that make the checklist "live" in the app: item 2.1 is answered from `certificates` (kind F-gass, `expires_at`; the workflow warns 60 days before expiry); items 1.5, 6.3, 4.2, 8.5, 9.1 map to `hms_equipment` control dates (the round shows overdue equipment inline); item 7.1 shows chemicals in `hms_chemicals` without an SDS.

## Appendix C — Metadata JSON schema (abridged, for `packages/core`)
```ts
type FieldType = 'text'|'textarea'|'richtext'|'number'|'decimal'|'currency'|'percent'|'boolean'|'date'|'datetime'|'time'|'email'|'phone'|'url'|'select'|'multiselect'|'lookup'|'file'|'image'|'signature'|'geo'|'formula'|'rollup'|'autonumber'|'user';
interface FieldDef { id: string; apiName: string; label: string; type: FieldType; isSystem: boolean; unique?: boolean; indexed?: boolean;
  classification: 'public'|'internal'|'restricted'|'secret'; offlinePolicy: 'allowed'|'online_only'; merge: 'lww'|'append'|'protected'|'server_only';
  aiDescription?: string; aiAliases?: string[]; aiVisible?: boolean; retiredAt?: string;
  default?: unknown; helpText?: string; picklistId?: string; lookupObject?: string; onDelete?: 'restrict'|'set_null'|'cascade';
  formula?: string; rollup?: { child: string; field?: string; fn: 'count'|'sum'|'min'|'max'; where?: string }; scale?: number; maxLength?: number; }
interface ObjectDef { apiName: string; label: string; labelPlural: string; isSystem: boolean; storage: 'table'|'custom'; nameField: string; fields: FieldDef[]; }
interface LayoutDef { header: {...}; tabs: TabDef[]; mobile?: { quickActions: string[] } }   // see §2.5
type Stage = 'create'|'schedule'|'start_visit'|'complete_visit'|'complete_order'|'submit_review'|'invoice';
interface RequirementRule { id: string; name: string; object: string; stage: Stage; level: 'required'|'recommended'; criticality: 'administrative'|'critical'|'invariant';
  overridePolicy: 'never'|'authorized_with_reason'; targetKind: 'field'|'attachment'|'checklist'|'related'|'expression'; target: Record<string, unknown>;
  condition?: string; scope?: { jobTypeIds?: string[]; deviceTypeIds?: string[]; customerIds?: string[]; serviceContractIds?: string[] }; message: string; version: number }
interface Readiness { ok: boolean; missing: { ruleId: string; target: unknown; message: string; link: string; overridable: boolean }[]; recommended: unknown[]; blockedByConfig: unknown[] }
interface Workflow { name: string; object?: string; trigger: Trigger; conditions?: string; actions: Action[]; version: number }
interface MetadataBundle { version: number; objects: ObjectDef[]; picklists: Picklist[]; layouts: LayoutDef[]; jobTypes: JobType[]; rules: RequirementRule[]; permissions: {...} }
```

## Appendix D — Changes in 1.1 (2026-09-10) and what was deliberately not adopted

Adopted after external review:
1. *Tilpass* common path + starter configurations; modules organise, settings decide (§1.1, §2.8).
2. Requirement rules separated from layouts, with stages, precedence, readiness API, publish-time trap detection, rule-version snapshots and permissioned overrides (§2.9).
3. Job types as configuration bundles; contextual completion summary instead of a fixed wizard (§2.10).
4. Order / visit / resource booking split; planner driven by bookings (§5.3, §5.5).
5. Separate work / review / billing / payment status dimensions with protected meanings and default-per-meaning (§5.3, Appendix A).
6. Optional site → system → device/component → circuit hierarchy; separate owner, service customer, invoice recipient, site contact; ownership history (§5.2).
7. Fixed the due-date error (earliest obligation, separate maintenance and leak-check dates); structured refrigerant events; versioned refrigerant reference data and compliance rules; structured certificates; tenants may only shorten regulatory intervals (§5.2).
8. Metadata changeset lifecycle, immutable identifiers, retire-not-delete, configuration rollback vs data migration, module three-way updates, custom fields first-class everywhere (§2.11).
9. Offline contract rewritten: data vs commands, upload envelope, per-field-class merge policy, deletes stay effective, explicit sync states, Sync Streams instead of legacy Sync Rules with explicit column projections (§7).
10. Permissions enforced in sync projections; RLS runtime roles and CI tests; data classification; kiosk profile; QR authorization; offline revocation; identities with memberships (§4).
11. Invoice records with allocations and submission ledger with idempotency and reconciliation; movements as the stock ledger with derived balances and reservations; package price preservation and allocation; versioned issued documents; transactional outbox and idempotent, cycle-checked workflows (§5.7, §5.11, §5.12, §8.1, §10).
12. Vehicle stock as either warehouses or locations via one tenant setting (§5.7).

Not adopted, or scoped down on purpose:
- A general multi-jurisdiction compliance engine: rules are versioned with `jurisdiction`, but only `NO` ships and no rule-authoring UI exists; rule content is maintained by the product team with sources.
- Fully separate "site" object: addresses already are sites; a separate object would force residential users through an extra level. Systems and circuits are optional layers instead.
- Multi-tenant *sessions*: identities can hold several memberships, but a session is bound to one tenant and one local database to keep sync and RLS simple.

### 1.3 — consistency pass (same day)
Adopted from the second external review:
- §7.4 rewritten: `auth.*` (verified JWT claims) for tenant/user; client parameters may only narrow; server-maintained `sync_field_grants`/`sync_record_grants` authorise restricted fields and on-demand records; five acceptance tests define the boundary.
- §4.3: one access policy (record access + field permission + `offline_policy`); classification only sets defaults; per-field restricted grants instead of one flag; `secret` never leaves the server; time-bound offline authorisation (`max_offline_days`) and quarantine of uploads on revocation.
- §2.2 canonical schema: `is_required` and `validation_rules` removed; `tenants.metadata_version` defined; `custom_fields_sync` maintained by the API + backfill (not a generated column); `custom_records.name` by trigger; §2.4, §3.2, §6.7, §6.8, §11, Appendix B and C updated to the current model.
- §2.9: additive semantics; specificity affects presentation only; `criticality` and `override_policy`; draft policy (`create` = invariants, customer required at `schedule`); collection predicates `ANY/ALL/COUNT/SUM` added to the expression language; server never trusts client readiness.
- §2.11: publication policy table for rule changes vs queued offline work.
- §7.3: checklist per-item conflicts; corrections/reversals for append-only tables; "Bruk min" resubmits a validated operation.
- §5.3/§5.7: `material_uses` per visit drive stock (one movement per use); `visit_activities` replace `service_performed` and are the only thing that updates due dates; visit window vs bookings defined; vehicle-stock mode change is a migration.
- §5.5/§5.8: "Til fordeling" = unassigned visits (any date); `service_occurrences` separate generation from obligation, idempotent on a unique key, with grouping for multi-site contracts.
- §5.11/§10: stable `submission_key`, allocation signs and øre rounding, `FOR UPDATE` against double invoicing, many-to-one credit notes, reconciliation fallbacks; durable `workflow_action_states` with stable action paths and resume semantics.
- §13.2: foundation delivered as one vertical slice; custom objects, formulas, rollups and module merging deferred; imports and the first accounting adapter before TV mode and secondary modules.
- §14 was already present in 1.2 (the review was of 1.1); its supporting records (`product_supplier_links`, import profiles, pricing policies, prepared actions, delivery ledger) are in place.

### 1.4 — final pre-prototype pass (same day; design frozen)
- §2.2/§7.4: custom-field bypass closed — shared JSON holds only fields readable by every non-admin profile (`share_scope`), everything else via `field_projections` rows filtered by record *and* field grants; tightening is synchronous in the publish transaction; baseline core-field set defined; JWT `sub` = identity, `user_id` claim = membership; stream fixes (`record_id`, `stock_balances.id`, deletion filter); acceptance test 1 reworded to narrow-only; column-merge behaviour of the pinned PowerSync version made a prototype gate.
- §14: `execute_prepared_action` removed from the model's tools; immutable action versions + UI-only approvals + admin-only automation authorisations; execution-time recheck table; frozen template/merge data; expected-value undo; batched execution; prompt language by measurement; assistants pulled forward to phases 2, 3 and 5.
- §4.3: revocation sequence (block → quarantine transfer under `recovery_policy` → acknowledgement → wipe), application lock and encryption described separately.
- §5.11/§8.1: reserved vs confirmed invoice quantities, amount-only credits, one `submission_key` contract.
- §5.3: agreed visit window never moved by bookings; `visit_window_history`; missing columns added (`revision`, `supersedes_instance_id`, `material_use_id`, `used_quantity`, `metadata_version_at_*`, `follow_up_on_prior_version`); layout example uses current statuses; cache key includes tenant id; `product_supplier_prices` with derived `cost_price` from the preferred supplier.
- §13: minimal products/order lines moved into phase 1; §13.3 implementation gates added.

### 1.4.1 — added §14.9 (in-app help and configuration assistant: Hjelp / Sett opp / feature-request intake, draft-only changeset tools, capability manifest, deflection KPI, legacy tickets as evaluation set); phases 1–3 updated accordingly.

### 1.4.2 — §14.9 strengthened per review: diagnose path with read-only engine-backed tools; source authority live state > release docs > tenant procedures with conflict reporting; capability states instead of supported/unsupported; validate/preview tools allowed (publish still not); complete propose_* signatures with platform defaults and Tilpas-equivalent default access; `configuration.propose`/`publish` permissions; Vis meg via registered action ids; help on mobile with cached offline articles (§14.1 corrected); knowledge-base lifecycle; resolution-based metrics; user-reviewed escalation summaries; sanitised cross-tenant clustering; §13.3 gate 6 added.
