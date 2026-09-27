'use client'

// Every screen here reads and writes localStorage and is driven by user interaction,
// so the whole module is a client component. Routing comes from Next: the file tree
// under app/ owns the URLs, and this module only consumes the current route.
import React, { useState, useCallback, useRef, useMemo, useEffect } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ThemeProvider, createTheme, CssBaseline, Typography, Chip, TextField, MenuItem, Alert, InputAdornment, Divider } from '@mui/material'
import { IconSun, IconMoon, IconSparkles, IconBriefcase, IconLink, IconFileText, IconArrowLeft, IconSearch, IconPlus, IconCheck, IconX, IconTrash, IconUpload, IconDownload, IconAlertCircle, IconStar, IconColumns, IconLayoutList, IconBuilding, IconClipboardCheck, IconTag, IconExternalLink, IconCirclePlus, IconChevronDown } from '@tabler/icons-react'

const STORAGE_KEY = 'job-tracker-data'
const MAX_FILE_SIZE = 2 * 1024 * 1024

// The toggles a job application actually needs, offered as one-click presets so the
// common ones are not retyped for every company. Picking one calls the same
// addCustomFieldNamed() that the free-text box uses, so nothing here is a special
// case, and presets already on the company are hidden.
//
// `type` decides which input the field renders, so a date gets a date picker and a
// status gets a dropdown rather than everything being a bare text box. Storage is
// unchanged either way -- customFields stays a flat { [name]: string } map, so
// records written before types existed still load, and a field typed by hand in the
// free-text box simply falls back to 'text'.
// Example: clicking 'Applied Date' on a company whose customFields are
//          { Recruiter: 'Sam' } yields { Recruiter: 'Sam', 'Applied Date': '' },
//          rendered as <input type="date">.
const PRESET_TOGGLES = [
  { name: 'Status', type: 'select', options: ['Applied', 'Phone Screen', 'Interviewing', 'Take-home', 'Offer', 'Rejected', 'On Hold'] },
  { name: 'Priority', type: 'select', options: ['High', 'Medium', 'Low'] },
  { name: 'Applied Date', type: 'date' },
  { name: 'Interview Date', type: 'date' },
  { name: 'Offer Deadline', type: 'date' },
  { name: 'Role', type: 'text' },
  { name: 'Location', type: 'text' },
  { name: 'Salary', type: 'text' },
  { name: 'Recruiter', type: 'text' },
  { name: 'Referral', type: 'text' },
  { name: 'Contact Email', type: 'email' },
  { name: 'Portal Login', type: 'url' },
  { name: 'Next Step', type: 'multiline' },
  { name: 'Notes', type: 'multiline' },
]

const TOGGLE_BY_NAME = Object.fromEntries(PRESET_TOGGLES.map((t) => [t.name, t]))

const DEFAULT_ROLE_TITLE = 'General application'

// How a role's contents are laid out. Saved on the role itself, so switching between
// two applications also switches to the layout each one was last read in.
//   compact  - one section at a time behind the sub-tab strip (the original layout)
//   detailed - every section stacked on one page, no tabs
//   table    - all toggles as a dense two-column table, links listed underneath
// A fourth option, 'All roles', is not a role view at all: it is a page mode that
// compares every role side by side, so it lives in component state, not on a role.
// Example: role.view = 'table' -> selecting that role renders the table layout.
const ROLE_VIEWS = [
  { id: 'compact', label: 'Compact', icon: 'list' },
  { id: 'detailed', label: 'Detailed', icon: 'columns' },
  { id: 'table', label: 'Table', icon: 'clipboardCheck' },
]
const DEFAULT_ROLE_VIEW = 'compact'

// A company is not one application. The same employer can be interviewing you for two
// roles, each with its own recruiter, status, dates, salary, job links and CV -- which
// company-level fields cannot hold: a second recruiter overwrites the first, and one
// links list cannot say which posting belongs to which role. Toggles, links and the
// resume therefore all live on a ROLE, and a company owns a list of roles.
//
// Records written before roles existed carry customFields on the company itself, so
// they are migrated on read into one role rather than being lost or needing a
// separate storage version.
// Example: { name: 'Anthropic', customFields: { Role: 'PM', Recruiter: 'Sam' } }
//          -> roles: [{ id, title: 'PM', customFields: { Role: 'PM', Recruiter: 'Sam' } }]
//          and a company with neither gets one empty 'General application' role.
function normaliseRoles(company) {
  if (Array.isArray(company.roles) && company.roles.length > 0) {
    // A role written before links/resume moved onto it still needs the fields present.
    return company.roles.map((r) => ({
      links: [],
      resume: null,
      customFields: {},
      // Each role remembers how it wants to be shown, so one application can be a
      // dense table while another is a full detail page.
      view: DEFAULT_ROLE_VIEW,
      ...r,
    }))
  }
  const legacy = company.customFields || {}
  return [{
    id: `${company.id}-role-1`,
    title: legacy.Role || DEFAULT_ROLE_TITLE,
    links: company.links || [],
    resume: company.resume ?? null,
    customFields: legacy,
    view: DEFAULT_ROLE_VIEW,
  }]
}

// Every link across every role, for the dashboard's company-level counts.
// Example: roles with 2 and 1 links -> allLinks(company).length === 3
// Single place that builds a new company, so every entry point -- the search box, the
// bulk form -- produces the same shape.
// Example: makeCompany('Stripe') -> one 'General application' role, no links, no CV.
function makeCompany(name, role = {}) {
  return {
    id: crypto.randomUUID(),
    name,
    roles: [{
      id: crypto.randomUUID(),
      title: DEFAULT_ROLE_TITLE,
      links: [],
      resume: null,
      customFields: {},
      view: DEFAULT_ROLE_VIEW,
      ...role,
    }],
  }
}

// One button, five variants. Before this the app had a dozen different button shapes
// -- three radii, two heights, pills next to rectangles, some with borders and some
// without -- because each was styled where it was written. Everything routes through
// here now, so a button cannot drift from its neighbours.
//
//   primary   the one action a screen is for (Add, Add link, Save all)
//   secondary the default: a surface with a hairline border
//   selected  a toggle that is currently on -- a light accent wash, not a solid slab
//   ghost     low emphasis, no border until hover
//   danger    destructive, red on hover
//
// Example: <Btn variant="primary" icon="add">Add</Btn>
const SEG_WRAP = 'inline-flex rounded-lg border border-[var(--border)] overflow-hidden'
const SEG_BASE = 'inline-flex items-center justify-center gap-1.5 h-9 px-3 text-sm font-medium whitespace-nowrap transition-colors border-r border-[var(--border)] last:border-r-0'
const SEG_ON = 'bg-[var(--accent-soft)] text-[var(--accent)]'
const SEG_OFF = 'bg-[var(--surface-1)] text-[var(--text-secondary)] hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]'

const BTN_BASE = 'inline-flex items-center justify-center gap-2 h-9 px-3 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:pointer-events-none'

const BTN_VARIANTS = {
  primary: 'bg-[var(--accent)] text-[var(--on-accent)] hover:bg-[var(--accent-hover)] border border-transparent',
  secondary: 'bg-[var(--surface-1)] text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-2)]',
  selected: 'bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent-border)]',
  ghost: 'bg-transparent text-[var(--text-secondary)] border border-transparent hover:bg-[var(--surface-2)] hover:text-[var(--text-primary)]',
  danger: 'bg-transparent text-[var(--text-muted)] border border-transparent hover:text-red-600 hover:bg-[var(--surface-2)]',
}

function Btn({ variant = 'secondary', icon, iconSize = '16', className = '', children, ...rest }) {
  return (
    <button type="button" className={`${BTN_BASE} ${BTN_VARIANTS[variant] || BTN_VARIANTS.secondary} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={iconSize} />}
      {children}
    </button>
  )
}

// An icon-only button. Square, so a row of them lines up with the text buttons beside
// them instead of being narrower.
// Example: <IconBtn variant="danger" icon="trash" aria-label="Remove Stripe" />
function IconBtn({ variant = 'ghost', icon, iconSize = '16', className = '', ...rest }) {
  return (
    <button type="button" className={`${BTN_BASE} ${BTN_VARIANTS[variant] || BTN_VARIANTS.ghost} w-9 px-0 ${className}`} {...rest}>
      <Icon name={icon} size={iconSize} />
    </button>
  )
}

// Lets the tab strip show a count without reaching into the role twice.
// Example: roleLinkCount({ links: [a, b] }) === 2
const roleLinkCount = (role) => role?.links?.length ?? 0

const allLinks = (company) => normaliseRoles(company).flatMap((r) => r.links || [])

// True when ANY role at this company has a resume attached.
// Example: one role with a CV and one without -> true
const hasAnyResume = (company) => normaliseRoles(company).some((r) => r.resume)

// Companies as the UI should see them: every company guaranteed to have at least one
// role. Applied once on read so no component has to remember to migrate.
// Example: withRoles([{ id: 'a', name: 'A', customFields: {} }])[0].roles.length === 1
const withRoles = (companies) => companies.map((c) => ({ ...c, roles: normaliseRoles(c) }))

// Dashboard chip colours, keyed by the exact option strings in PRESET_TOGGLES above.
// A value with no entry (or no value at all) falls back to the neutral grey below,
// so a hand-edited Status never breaks the table.
// Example: STATUS_STYLES['Offer'] -> green chip; STATUS_STYLES['Maybe'] -> undefined
//          -> the neutral fallback is used.
// Each entry carries both themes: a pale tint on white, and a translucent tint with a
// lifted text colour on charcoal. The light pastels alone glare against the dark
// surface, so every chip needs its dark counterpart rather than inheriting.
// Example: 'Offer' is green-50/green-600 in light, green-500/10 with green-400 in dark.
// These keep their hues on purpose. The accent went graphite precisely so that colour
// is free to carry meaning, and a status chip is the one place in the app where the
// colour IS the information -- green reads as an offer before the word is read.
// Each entry carries both themes: a pale tint on white, a translucent one on charcoal.
// Example: 'Offer' is green-50/green-600 in light, green-500/15 with green-300 in dark.
const STATUS_STYLES = {
  'Applied': 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300',
  'Phone Screen': 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  'Interviewing': 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  'Take-home': 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  'Offer': 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  'Rejected': 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  'On Hold': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
}

const PRIORITY_STYLES = {
  'High': 'bg-rose-50 text-rose-700 dark:bg-rose-500/10 dark:text-rose-300',
  'Medium': 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  'Low': 'bg-zinc-100 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300',
}

const NEUTRAL_CHIP = 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'


// One chip per ROLE, because a company can have several applications in flight and a
// single chip would only ever show the first one's status. With one role it reads
// exactly as before; with more, each role's value is listed and titled with the role
// name so the column stays readable at a glance.
// Example: two roles at Offer and Interviewing -> two chips, tooltips naming each role.
function RoleChips({ company, field, styles }) {
  const roles = normaliseRoles(company)
  const values = roles.map((r) => ({ title: r.title, value: r.customFields?.[field] }))
  if (values.every((v) => !v.value)) return <span className="text-xs text-[var(--text-muted)]">&mdash;</span>
  return (
    <div className="flex flex-wrap gap-1">
      {values.filter((v) => v.value).map((v) => (
        <span
          key={v.title}
          title={roles.length > 1 ? `${v.title}: ${v.value}` : v.value}
          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium truncate max-w-full ${styles[v.value] || NEUTRAL_CHIP}`}
        >
          {v.value}
        </span>
      ))}
    </div>
  )
}

// Realistic seed data covering every toggle type at least once, so the dashboard
// columns and each field renderer can be exercised without hand-entering anything:
// select (Status, Priority), date (Applied/Interview Date, Offer Deadline), email,
// url, multiline (Next Step, Notes), plain text, plus a company with NO custom
// fields at all to prove the empty path renders.
// Example: loading this gives 4 companies, 6 links, 1 resume, and a dashboard with
//          Offer / Interviewing / Rejected / unset in the Status column.
// Sample companies carry stable, recognisable ids; anything the user created has a
// crypto.randomUUID() id. That is what lets the loader refresh the samples in place
// without touching a single real company.
// Example: isSampleCompany({ id: 'sample-stripe' }) === true
const SAMPLE_ID_PREFIX = 'sample-'
const isSampleCompany = (c) => typeof c.id === 'string' && c.id.startsWith(SAMPLE_ID_PREFIX)

const SAMPLE_COMPANIES = [
  {
    id: 'sample-anthropic',
    name: 'Anthropic',
    // Two applications at the same employer, each with its own recruiter, stage AND
    // job links -- the case company-level fields could not represent.
    roles: [
      { id: 'sample-role-pe', title: 'Product Engineer',
        links: [
          { id: 'sample-l1', label: 'Careers page', url: 'https://www.anthropic.com/careers' },
          { id: 'sample-l2', label: 'Referral form', url: 'https://example.com/referral' },
        ],
        resume: null,
        customFields: {
      'Status': 'Offer',
      'Priority': 'High',
      'Applied Date': '2026-08-14',
      'Interview Date': '2026-09-02',
      'Offer Deadline': '2026-10-01',
      'Role': 'Product Engineer',
      'Location': 'San Francisco, CA',
      'Salary': '$180k + equity',
      'Recruiter': 'Sam Okafor',
      'Referral': 'Priya Nair (eng)',
      'Contact Email': 'sam.okafor@example.com',
      'Portal Login': 'https://jobs.example.com/login',
      'Next Step': 'Sign and return the offer letter before the deadline.',
      'Notes': 'Team works on developer tooling. Strong culture fit signals in round 3.',
      } },
      { id: 'sample-role-re', title: 'Research Engineer',
        links: [{ id: 'sample-l7', label: 'Research roles', url: 'https://example.com/research-roles' }],
        resume: null,
        customFields: {
        'Status': 'Phone Screen',
        'Priority': 'Medium',
        'Applied Date': '2026-09-10',
        'Role': 'Research Engineer',
        'Location': 'London, UK',
        'Recruiter': 'Dana Whitfield',
        'Contact Email': 'dana.whitfield@example.com',
        'Next Step': 'Recruiter screen booked for next Tuesday.',
      } },
    ],
  },
  {
    id: 'sample-stripe',
    name: 'Stripe',
    roles: [{ id: 'sample-role-stripe', title: 'Full-stack Engineer',
      links: [
        { id: 'sample-l3', label: 'Job post', url: 'https://stripe.com/jobs' },
        { id: 'sample-l4', url: 'https://example.com/stripe-take-home' },
      ],
      resume: null,
      customFields: {
      'Status': 'Interviewing',
      'Priority': 'High',
      'Applied Date': '2026-09-01',
      'Interview Date': '2026-09-20',
      'Role': 'Full-stack Engineer',
      'Location': 'Remote (US)',
      'Next Step': 'Prepare the systems design round.',
      } }],
  },
  {
    id: 'sample-figma',
    name: 'Figma',
    roles: [{ id: 'sample-role-figma', title: 'Product Designer',
      links: [{ id: 'sample-l5', label: 'Application portal', url: 'https://example.com/figma-portal' }],
      resume: null,
      customFields: {
      'Status': 'Rejected',
      'Priority': 'Low',
      'Applied Date': '2026-07-22',
      'Notes': 'Rejected at the recruiter screen. Worth retrying in six months.',
      } }],
  },
  {
    id: 'sample-linear',
    name: 'Linear',
    roles: [{ id: 'sample-role-linear', title: 'General application',
      links: [{ id: 'sample-l6', label: 'Careers', url: 'https://linear.app/careers' }],
      resume: null,
      customFields: {} }],
  },
]

// Everything the sample data demonstrates, one feature per row, with the value that
// proves it. Pulled from SAMPLE_COMPANIES so the panel can never claim a sample the
// Load button does not actually insert.
// Example: the 'Status toggle' row reads 'Offer' straight off the Anthropic sample.
function buildFeatureSamples() {
  const [anthropic, stripe, figma, linear] = SAMPLE_COMPANIES
  // Anthropic now carries two roles, so read the toggles off the first one rather
  // than a company-level customFields map that no longer exists.
  const roleA = normaliseRoles(anthropic)[0]
  const roleB = normaliseRoles(anthropic)[1]
  const cf = roleA.customFields
  const statusOf = (c) => normaliseRoles(c)[0].customFields.Status
  const priorityOf = (c) => normaliseRoles(c)[0].customFields.Priority
  return [
    { group: 'Dashboard', feature: 'Companies tracked', sample: SAMPLE_COMPANIES.map((c) => c.name).join(', ') },
    { group: 'Dashboard', feature: 'Status column', sample: `${statusOf(anthropic)} · ${statusOf(stripe)} · ${statusOf(figma)} · (unset for ${linear.name})` },
    { group: 'Dashboard', feature: 'Priority column', sample: `${priorityOf(anthropic)} · ${priorityOf(stripe)} · ${priorityOf(figma)} · (unset for ${linear.name})` },
    { group: 'Dashboard', feature: 'Links applied', sample: `${SAMPLE_COMPANIES.reduce((n, c) => n + allLinks(c).length, 0)} links across ${SAMPLE_COMPANIES.length} companies` },
    { group: 'Dashboard', feature: 'Card styles', sample: 'Compact and Detailed' },
    { group: 'Dashboard', feature: 'Job Links Tracker toggle', sample: 'Hide / Show the table independently of the cards' },
    { group: 'Dashboard', feature: 'Dark mode', sample: 'Light and dark, remembered between visits' },
    { group: 'Dashboard', feature: 'Search and add', sample: 'One box filters as you type and adds on Enter' },
    { group: 'Dashboard', feature: 'Delete a company', sample: 'Bin icon on each card, behind a confirm prompt' },
    { group: 'Company page', feature: 'Job links', sample: roleA.links.map((l) => l.label || l.url).join(', ') },
    { group: 'Company page', feature: 'Resume upload', sample: 'PDF or document up to 2 MB' },
    { group: 'Company page', feature: 'Multiple roles per company', sample: `${anthropic.name}: ${normaliseRoles(anthropic).map((r) => r.title).join(' + ')}` },
    { group: 'Company page', feature: 'Separate recruiter per role', sample: `${roleA.customFields.Recruiter} (${roleA.title}) vs ${roleB.customFields.Recruiter} (${roleB.title})` },
    { group: 'Company page', feature: 'Separate status per role', sample: `${roleA.customFields.Status} (${roleA.title}) vs ${roleB.customFields.Status} (${roleB.title})` },
    { group: 'Company page', feature: 'Separate job links per role', sample: `${roleA.links.length} for ${roleA.title}, ${roleB.links.length} for ${roleB.title}` },
    { group: 'Company page', feature: 'Separate resume per role', sample: 'Each role carries its own tailored CV' },
    { group: 'Toggle — dropdown', feature: 'Status', sample: cf.Status },
    { group: 'Toggle — dropdown', feature: 'Priority', sample: cf.Priority },
    { group: 'Toggle — date', feature: 'Applied Date', sample: cf['Applied Date'] },
    { group: 'Toggle — date', feature: 'Interview Date', sample: cf['Interview Date'] },
    { group: 'Toggle — date', feature: 'Offer Deadline', sample: cf['Offer Deadline'] },
    { group: 'Toggle — text', feature: 'Role', sample: cf.Role },
    { group: 'Toggle — text', feature: 'Location', sample: cf.Location },
    { group: 'Toggle — text', feature: 'Salary', sample: cf.Salary },
    { group: 'Toggle — text', feature: 'Recruiter', sample: cf.Recruiter },
    { group: 'Toggle — text', feature: 'Referral', sample: cf.Referral },
    { group: 'Toggle — email', feature: 'Contact Email', sample: cf['Contact Email'] },
    { group: 'Toggle — url', feature: 'Portal Login', sample: cf['Portal Login'] },
    { group: 'Toggle — multi-line', feature: 'Next Step', sample: cf['Next Step'] },
    { group: 'Toggle — multi-line', feature: 'Notes', sample: cf.Notes },
    { group: 'Toggle — custom', feature: 'Any name you type', sample: 'Falls back to a plain text box' },
  ]
}

const FEATURE_SAMPLES = buildFeatureSamples()

// Bulk entry: one form that fills every section of a company page in a single submit
// -- the role, its job links, and any of the preset toggles -- instead of creating the
// company, then opening it, then adding links, then adding toggles one at a time.
//
// Links are typed free-form, one per line, optionally "Label | url", because pasting a
// handful of postings is the common case and a repeating field set would be slower.
// Example: "Careers | https://x.com/jobs" on line 1 and a bare URL on line 2 produces
//          two links, the second labelled by its own URL.
function parseLinkLines(text) {
  return (text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawLabel, rawUrl] = line.includes('|') ? line.split('|') : [null, line]
      const url = (rawUrl ?? '').trim()
      if (!url) return null
      const full = /^https?:\/\//i.test(url) ? url : `https://${url}`
      return { id: crypto.randomUUID(), label: rawLabel?.trim() || undefined, url: full }
    })
    .filter(Boolean)
}

// Memoised so a keystroke in the company, role or links box does not re-render all
// fourteen toggle inputs. Without this, typing a URL dropped and reordered characters
// under load because every character re-rendered the whole form.
// Example: typing in the links box re-renders only that field.
const BulkToggleGrid = React.memo(function BulkToggleGrid({ fields, setField }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {PRESET_TOGGLES.map((t) => (
        <div key={t.name} className="flex items-center gap-2">
          <span className="text-sm text-[var(--text-secondary)] min-w-[110px] shrink-0">{t.name}</span>
          <CustomFieldInput name={t.name} value={fields[t.name]} onChange={(v) => setField(t.name, v)} />
        </div>
      ))}
    </div>
  )
})

function BulkAddPanel({ companies, onSubmit, onClose }) {
  const [companyName, setCompanyName] = useState('')
  const [roleTitle, setRoleTitle] = useState('')
  const [linksText, setLinksText] = useState('')
  const [fields, setFields] = useState({})
  const [error, setError] = useState('')

  // Stable identity, so the memoised grid is not invalidated on every render.
  const setField = React.useCallback((name, value) => setFields((f) => ({ ...f, [name]: value })), [])

  const submit = (e) => {
    e.preventDefault()
    const name = companyName.trim()
    if (!name) { setError('Company name is required'); return }
    const links = parseLinkLines(linksText)
    // Only non-empty toggles are written, so an untouched field does not create an
    // empty row on the company page.
    const customFields = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => String(v ?? '').trim() !== '')
    )
    setError('')
    onSubmit({ companyName: name, roleTitle: roleTitle.trim(), links, customFields })
  }

  const existing = companies.find((c) => c.name.toLowerCase() === companyName.trim().toLowerCase())

  return (
    <motion.form
      onSubmit={submit}
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 bg-[var(--surface-1)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
        <Icon name="clipboardCheck" size="18" />
        <Typography variant="subtitle2" className="font-semibold text-[var(--text-primary)] flex-1">
          Add everything at once
        </Typography>
        <Btn variant="primary" type="submit">Save all</Btn>
        <IconBtn icon="x" onClick={onClose} aria-label="Close bulk add" />
      </div>

      <div className="p-4 space-y-4">
        {error && <Alert severity="error">{error}</Alert>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            size="small" fullWidth label="Company" value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            helperText={existing ? `Adds a role to the existing "${existing.name}"` : 'A new company will be created'}
          />
          <TextField
            size="small" fullWidth label="Role title" value={roleTitle}
            onChange={(e) => setRoleTitle(e.target.value)}
            placeholder={DEFAULT_ROLE_TITLE}
            helperText="Leave blank to use the role title from the Role field, if set"
          />
        </div>

        <TextField
          size="small" fullWidth multiline minRows={3} label="Job links"
          value={linksText}
          onChange={(e) => setLinksText(e.target.value)}
          placeholder={'One per line\nCareers | https://example.com/jobs\nhttps://example.com/posting'}
          helperText="One per line. Optionally &quot;Label | url&quot;."
        />

        <div>
          <Typography variant="caption" className="text-[var(--text-secondary)] block mb-2">
            Other info — fill in whatever you have
          </Typography>
          <BulkToggleGrid fields={fields} setField={setField} />
        </div>
      </div>
    </motion.form>
  )
}

// The panel behind the sparkles icon: every feature with the sample data that shows
// it off, grouped, plus a button to load that data into the tracker.
// Example: <SampleDataPanel onLoad={loadSampleData} onClose={...} />
function SampleDataPanel({ onLoad, onClose }) {
  const groups = FEATURE_SAMPLES.reduce((acc, row) => {
    (acc[row.group] = acc[row.group] || []).push(row)
    return acc
  }, {})

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mb-8 bg-[var(--surface-1)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
        <Icon name="sparkles" size="18" />
        <Typography variant="subtitle2" className="font-semibold text-[var(--text-primary)] flex-1">
          Sample data for every feature
        </Typography>
        <Btn variant="primary" onClick={onLoad}>Load it</Btn>
        <IconBtn icon="x" onClick={onClose} aria-label="Close sample data" />
      </div>
      <div className="max-h-[420px] overflow-y-auto">
        {Object.entries(groups).map(([group, rows]) => (
          <div key={group}>
            <div className="px-4 py-2 bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border)]">
              {group}
            </div>
            {rows.map((row) => (
              <div key={row.feature} className="grid grid-cols-12 gap-3 px-4 py-2.5 border-b border-[var(--border)] items-start">
                <div className="col-span-4 text-sm font-medium text-[var(--text-primary)] truncate">{row.feature}</div>
                <div className="col-span-8 text-sm text-[var(--text-secondary)] break-words">{row.sample}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </motion.div>
  )
}


// One input for every custom field, on both the Add Custom panel and the field's own
// tab, so the two can never drift apart. A name with no preset -- anything typed into
// the free-text box -- renders as plain text.
// Example: <CustomFieldInput name="Status" value="Offer" onChange={fn} /> renders a
//          dropdown; name="Referral Bonus" renders a text box.
function CustomFieldInput({ name, value, onChange }) {
  const spec = TOGGLE_BY_NAME[name] || { type: 'text' }
  const common = { size: 'small', fullWidth: true, value: value || '', onChange: (e) => onChange(e.target.value) }

  if (spec.type === 'select') {
    return (
      <TextField {...common} select slotProps={{ inputLabel: { shrink: true } }}>
        <MenuItem value=""><em>Not set</em></MenuItem>
        {spec.options.map((o) => <MenuItem key={o} value={o}>{o}</MenuItem>)}
      </TextField>
    )
  }
  if (spec.type === 'date') {
    // Date inputs ignore placeholder text, so the label has to be pinned open.
    return <TextField {...common} type="date" slotProps={{ inputLabel: { shrink: true } }} />
  }
  if (spec.type === 'multiline') {
    return <TextField {...common} multiline minRows={2} placeholder={`Enter ${name}...`} />
  }
  return <TextField {...common} type={spec.type === 'text' ? 'text' : spec.type} placeholder={`Enter ${name}...`} />
}

const companySchema = z.object({ name: z.string().min(1).max(100) })
const linkSchema = z.object({ label: z.string().optional(), url: z.string().url('Invalid URL') })



function loadCompanies() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? withRoles(JSON.parse(raw)) : []
  } catch { return [] }
}
function persist(companies) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(companies)); return true } catch { return false }
}

const THEME_KEY = 'job-tracker-theme'

// One theme factory for both modes, so the accent and shape stay identical and only
// the surface colours change.
// Example: buildTheme('dark').palette.background.default === '#0f1117'
// MUI is told to resolve its own colours, radius and control height from the same
// tokens the hand-written controls use, so an <input> and a <button> beside it read as
// one family instead of two. Without these overrides MUI brings its own 12px radius,
// its own border colour and a taller control, which is what made the rows look mixed.
// Example: a MUI TextField and a plain <button> next to it are both 36px, 8px radius.
const buildTheme = (mode) => createTheme({
  palette: mode === 'dark'
    ? { mode: 'dark', primary: { main: '#fafafa' }, background: { default: '#0b0b0e', paper: '#17171a' } }
    : { mode: 'light', primary: { main: '#18181b' }, background: { default: '#f7f7f8', paper: '#ffffff' } },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 14,
    button: { textTransform: 'none', fontWeight: 500 },
  },
  components: {
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 'var(--ui-radius)',
          backgroundColor: 'var(--surface-1)',
          fontSize: 14,
          '& .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border)' },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--border-strong)' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: 'var(--accent)', borderWidth: 1 },
        },
        input: { paddingTop: 8, paddingBottom: 8 },
      },
    },
    MuiInputBase: { styleOverrides: { root: { color: 'var(--text-primary)' } } },
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 'var(--ui-radius)', minHeight: 'var(--control-h)', boxShadow: 'none' },
        contained: { backgroundColor: 'var(--accent)', color: 'var(--on-accent)', '&:hover': { backgroundColor: 'var(--accent-hover)', boxShadow: 'none' } },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 500, borderColor: 'var(--border)' },
      },
    },
    MuiFormHelperText: { styleOverrides: { root: { marginLeft: 2 } } },
    MuiMenuItem: { styleOverrides: { root: { fontSize: 14 } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 'var(--ui-radius)' } } },
  },
})

const ThemeModeContext = React.createContext({ mode: 'light', toggleMode: () => {} })
const useThemeMode = () => React.useContext(ThemeModeContext)

// Reads the saved choice, falling back to the OS preference on a first visit.
// Wrapped because storage can throw in a private window.
// Example: no saved value + OS in dark mode -> 'dark'.
function readThemeMode() {
  try {
    const saved = localStorage.getItem(THEME_KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch { /* storage unavailable */ }
  try {
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch { return 'light' }
}

// Owns the mode, mirrors it onto <html class="dark"> for Tailwind's dark: variant and
// onto App.css's own .dark rules, and persists the choice.
// Example: toggleMode() from 'light' -> <html class="dark"> and THEME_KEY = 'dark'.
export function ThemeModeProvider({ children }) {
  // Starts at the same value the server rendered, then adopts the saved preference on
  // mount. Reading localStorage during the first render made the server's HTML and the
  // client's first pass disagree, which is a hydration mismatch -- the page recovered,
  // but React discarded and re-rendered the tree to do it. The inline script in
  // app/layout.jsx has already set the class before paint, so there is no flash while
  // this catches up.
  // One piece of state, so adopting the saved preference is a single update.
  const [themeState, setThemeState] = React.useState({ mode: 'light', hydrated: false })
  const { mode, hydrated } = themeState

  // The extra render IS the point: the first render has to match what the server sent,
  // and only then can the saved preference be adopted. It happens once, on mount.
  // oxlint-disable-next-line react/set-state-in-effect
  React.useEffect(() => { setThemeState({ mode: readThemeMode(), hydrated: true }) }, [])

  React.useEffect(() => {
    if (!hydrated) return
    document.documentElement.classList.toggle('dark', mode === 'dark')
    try { localStorage.setItem(THEME_KEY, mode) } catch { /* storage unavailable */ }
  }, [mode, hydrated])

  const value = React.useMemo(() => ({
    mode,
    toggleMode: () => setThemeState((t) => ({ ...t, mode: t.mode === 'dark' ? 'light' : 'dark' })),
  }), [mode])

  const theme = React.useMemo(() => buildTheme(mode), [mode])

  return (
    <ThemeModeContext.Provider value={value}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext.Provider>
  )
}

const ToastContext = React.createContext()

function ToastContainer({ toasts, onDismiss }) {
  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 40 }} className={`px-4 py-3 rounded-lg text-white text-sm shadow-lg min-w-[220px] max-w-[360px] overflow-hidden text-ellipsis whitespace-nowrap ${t.type === 'success' ? 'bg-green-600' : 'bg-orange-500'}`}>
            <span>{t.message}</span>
            <button onClick={() => onDismiss(t.id)} className="ml-2 opacity-70 hover:opacity-100">&times;</button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const counterRef = useRef(0)
  const showToast = useCallback((message, type = 'success') => {
    const id = ++counterRef.current
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3000)
  }, [])
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])
  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  )
}

function useToast() { return React.useContext(ToastContext) }

function useCompanies() {
  const { data: companies, isLoading } = useQuery({ queryKey: ['companies'], queryFn: loadCompanies, staleTime: Infinity, gcTime: Infinity })
  const qc = useQueryClient()
  const setCompanies = useCallback((updater) => {
    const current = loadCompanies()
    const next = typeof updater === 'function' ? updater(current) : updater
    persist(next)
    qc.invalidateQueries({ queryKey: ['companies'] })
  }, [qc])
  return { companies: companies || [], isLoading, setCompanies }
}

const iconMap = {
  briefcase: IconBriefcase,
  link: IconLink,
  fileText: IconFileText,
  arrowLeft: IconArrowLeft,
  search: IconSearch,
  add: IconPlus,
  check: IconCheck,
  x: IconX,
  trash: IconTrash,
  upload: IconUpload,
  download: IconDownload,
  alertCircle: IconAlertCircle,
  star: IconStar,
  columns: IconColumns,
  list: IconLayoutList,
  building2: IconBuilding,
  clipboardCheck: IconClipboardCheck,
  tag: IconTag,
  externalLink: IconExternalLink,
  plusCircle: IconCirclePlus,
  chevronDown: IconChevronDown,
  sun: IconSun,
  moon: IconMoon,
  sparkles: IconSparkles,
}

function Icon({ name, size = 16, color, className }) {
  const Comp = iconMap[name]
  if (!Comp) return null
  return <Comp size={size} color={color} className={className} />
}

function CompanyCard({ company, onRemove, onEdit, cardStyle, index }) {
  const [editing, setEditing] = useState(false)
  const [editName, setEditName] = useState(company.name)
  const saveEdit = () => {
    const t = editName.trim()
    if (!t || t === company.name) { setEditing(false); return }
    onEdit(company.id, { name: t })
    setEditing(false)
  }
  const companyLinks = allLinks(company)
  const companyResume = normaliseRoles(company).find((r) => r.resume)?.resume || null
  const previewLinks = companyLinks.slice(0, 2)

  // Two styles, not four. 'default' and 'compact' both rendered .card-compact and
  // differed only in which hover class they carried; 'detailed' and 'featured' both
  // rendered the same link-preview block and differed only in gradient. Each pair is
  // merged into one style that keeps the better half of both:
  //   compact  <- default + compact   (dense row, numbered badge, resume chip)
  //   detailed <- detailed + featured (roomy card, accent border, preview chips,
  //                                    corner dots, resume block)
  // Example: styleClasses['compact'] is applied for the dense list view.
  const styleClasses = {
    compact: 'card card-compact card-hover',
    detailed: 'card card-featured card-hover',
  }

  const cardVariants = {
    hidden: { opacity: 0, y: 20, rotateY: 5, rotateX: 2 },
    visible: { opacity: 1, y: 0, rotateY: 0, rotateX: 0, transition: { duration: 0.5, type: 'spring', stiffness: 100 } },
    hover: { scale: 1.01, rotateY: -1, rotateX: 0.5, transition: { duration: 0.3, type: 'spring', stiffness: 300 } },
  }

  return (
    <Link href={`/company/${company.id}`} className="card-link block">
      <motion.div layout variants={cardVariants} initial="hidden" animate="visible" whileHover="hover" transition={{ duration: 0.3 }} className={`w-full ${styleClasses[cardStyle] || styleClasses.compact}`}>
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0">
            {cardStyle === 'compact' ? (
              <span className="compact-number">{index + 1}</span>
            ) : (
              <span className="inline-flex items-center justify-center w-6 h-6 border border-[var(--border-strong)] rounded text-[var(--text-secondary)] text-xs font-bold">{index + 1}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <TextField size="small" value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveEdit()} onBlur={saveEdit} autoFocus className="w-full" />
            ) : (
              <span className="inline-flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] cursor-text truncate" onDoubleClick={() => { setEditName(company.name); setEditing(true) }}>
                <Icon name="briefcase" size="16" /> {company.name}
              </span>
            )}
            {/* A compact row used to be a name with a bare count chip under it, which
                left most of the row empty and said nothing about the application. It
                now carries what you would actually scan for: the stage of each role,
                how many links, and whether a CV is attached.
                Example: "Anthropic · Offer · Phone Screen · 3 links · CV" */}
            <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-[var(--text-secondary)]">
              {normaliseRoles(company).map((r) => (
                r.customFields?.Status ? (
                  <span key={r.id} title={r.title} className={`px-2 py-0.5 rounded-full font-medium ${STATUS_STYLES[r.customFields.Status] || NEUTRAL_CHIP}`}>
                    {r.customFields.Status}
                  </span>
                ) : null
              ))}
              {normaliseRoles(company).length > 1 && (
                <span className="text-[var(--text-muted)]">{normaliseRoles(company).length} roles</span>
              )}
              <span>{companyLinks.length} {companyLinks.length === 1 ? 'link' : 'links'}</span>
              {companyResume && <span className="text-[var(--text-muted)]">CV</span>}
            </div>
          </div>
          {/* removeCompany was fully implemented in HomePage -- confirm dialog, toast
              and all -- and passed down as onRemove, but no control ever called it,
              so there was no way to delete a company anywhere in the UI. The whole
              card is wrapped in a <Link>, so this stops the click turning into a
              navigation to /company/:id before the confirm dialog can open.
              Example: click the bin -> confirm "Remove \"Stripe\"?" -> row disappears,
              and the card does NOT navigate. */}
          <IconBtn
            variant="danger"
            icon="trash"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(company.id) }}
            aria-label={`Remove ${company.name}`}
            className="flex-shrink-0"
          />
        </div>
        {cardStyle === 'detailed' && (
          <Typography variant="caption" className="text-[var(--text-secondary)] block mb-2 text-xs leading-tight masked-text" data-text={`${companyLinks.length} link${companyLinks.length !== 1 ? 's' : ''} · ${companyResume ? 'Resume uploaded' : 'No resume'}`}>
            <span>{companyLinks.length} link{companyLinks.length !== 1 ? 's' : ''} · {companyResume ? 'Resume uploaded' : 'No resume'}</span>
          </Typography>
        )}
        {cardStyle === 'detailed' && previewLinks.length > 0 && (
          <div className="flex flex-wrap gap-2 my-2">
            {previewLinks.map((l) => (
              <Chip key={l.id} size="small" icon={<Icon name="link" size="12" />} label={l.label || l.url} variant="outlined" />
            ))}
            {companyLinks.length > 2 && <Chip size="small" label={`+${companyLinks.length - 2} more`} variant="outlined" />}
          </div>
        )}
        {cardStyle === 'detailed' && companyResume && (
          <motion.div initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }} className="mt-2 p-2 bg-[var(--surface-1)] rounded-lg flex items-center gap-2">
            <Icon name="fileText" size="16" color="#ef4444" />
            <Typography variant="caption" className="text-xs truncate block max-w-full masked-text" data-text={companyResume.name}><span>{companyResume.name}</span></Typography>
          </motion.div>
        )}
        {cardStyle === 'compact' && companyResume && (
          <Chip size="small" icon={<Icon name="fileText" size="12" />} label={companyResume.name} className="mt-2" color="error" variant="outlined" />
        )}
      </motion.div>
    </Link>
  )
}

export function HomePage() {
  const { companies, setCompanies } = useCompanies()
  const [query, setQuery] = useState('')
  const [cardStyle, setCardStyle] = useState('compact')
  const { showToast } = useToast()
  // The single field does double duty: `query` filters the list as you type AND is
  // the name submitted when you add, so it is validated directly here.
  // Previously this ran react-hook-form over a `name` field that was never wired to
  // the input via register(), so handleSubmit always received name: '', failed
  // companySchema's .min(1), and silently swallowed every add with no feedback.
  // Example: query = 'Stripe' -> parses -> company appended and the box clears.
  //          query = '   '    -> fails  -> warning toast, nothing added.
  const onSubmit = (e) => {
    e?.preventDefault()
    const parsed = companySchema.safeParse({ name: query.trim() })
    if (!parsed.success) { showToast('Enter a company name (1-100 characters)', 'warn'); return }
    const t = parsed.data.name
    if (companies.find((c) => c.name.toLowerCase() === t.toLowerCase())) { showToast('Company already exists', 'warn'); return }
    setCompanies((prev) => [...prev, makeCompany(t)])
    setQuery('')
    showToast(`"${t}" added`, 'success')
  }

  // Seeds the tracker with SAMPLE_COMPANIES so every toggle type and both new
  // dashboard columns can be seen without typing anything in. Deep-cloned so editing
  // a sample never mutates the module-level constant behind it.
  // Example: empty tracker -> 4 companies, 6 links, Status column showing
  //          Offer / Interviewing / Rejected / dash.
  const loadSampleData = () => {
    // Replaces the sample companies and keeps everything else.
    //
    // Two failure modes to avoid, both of which have actually happened here. Assigning
    // SAMPLE_COMPANIES straight over the list destroyed every company the user had
    // added. Merging by NAME instead fixed that but created the opposite trap: once
    // samples existed, the button refused with "already loaded", so anyone who loaded
    // them before the sample data changed could never get the current version.
    //
    // Matching on the stable `sample-` id does both jobs: samples are dropped and
    // re-inserted with today's definitions, and anything the user created is untouched
    // because it carries a crypto.randomUUID() id.
    // Example: ['My Own Company', old sample Anthropic] -> ['My Own Company', fresh
    //          Anthropic with its two roles, Stripe, Figma, Linear].
    const mine = companies.filter((c) => !isSampleCompany(c))
    const hadSamples = companies.length !== mine.length
    setCompanies([...mine, ...structuredClone(SAMPLE_COMPANIES)])
    showToast(
      hadSamples
        ? `Refreshed ${SAMPLE_COMPANIES.length} sample companies`
        : `Added ${SAMPLE_COMPANIES.length} sample companies`,
      'success',
    )
  }

  // Writes a whole application in one go: creates the company if it is new, appends a
  // role to it if it already exists, and fills that role's links and toggles together.
  // Every section of the company page is populated by this single submit.
  // Example: { companyName: 'Stripe', roleTitle: 'Backend', links: [2 links],
  //            customFields: { Status: 'Applied' } }
  //          -> Stripe gains a 'Backend' role carrying both links and the Status toggle.
  const bulkAdd = ({ companyName, roleTitle, links, customFields }) => {
    const title = roleTitle || customFields.Role || DEFAULT_ROLE_TITLE
    const existing = companies.find((c) => c.name.toLowerCase() === companyName.toLowerCase())

    if (!existing) {
      setCompanies((prev) => [...prev, makeCompany(companyName, { title, links, resume: null, customFields })])
      showToast(`"${companyName}" added with ${links.length} ${links.length === 1 ? 'link' : 'links'}`, 'success')
      setShowBulk(false)
      return
    }

    const roles = normaliseRoles(existing)
    if (roles.some((r) => r.title.toLowerCase() === title.toLowerCase())) {
      showToast(`"${companyName}" already has a "${title}" role`, 'warn')
      return
    }
    const newRole = { id: crypto.randomUUID(), title, links, resume: null, customFields, view: DEFAULT_ROLE_VIEW }
    setCompanies((prev) => prev.map((c) => (c.id === existing.id ? { ...c, roles: [...normaliseRoles(c), newRole] } : c)))
    showToast(`Role "${title}" added to ${existing.name}`, 'success')
    setShowBulk(false)
  }

  const removeCompany = (id) => {
    const c = companies.find((co) => co.id === id)
    if (!window.confirm(`Remove "${c?.name}"?`)) return
    setCompanies((prev) => prev.filter((co) => co.id !== id))
    showToast('Removed', 'warn')
  }

  const editCompany = (id, updates) => {
    setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, ...updates } : c))
    showToast('Updated', 'success')
  }

  const filtered = query.trim() ? companies.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())) : companies

  const stats = useMemo(() => ({
    total: companies.length,
    totalLinks: companies.reduce((n, c) => n + allLinks(c).length, 0),
    withResume: companies.filter(hasAnyResume).length,
  }), [companies])
  const [collapsed, setCollapsed] = useState(false)
  // Separate from `collapsed`, which hides the company cards. The tracker table and
  // the card list are independent views of the same data, so each gets its own
  // toggle rather than one control hiding both.
  // Example: showTracker false -> the table is hidden, the cards below stay visible.
  const [showTracker, setShowTracker] = useState(true)
  const [showSamples, setShowSamples] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  // Focus mode: the tracker table and nothing else. Off on arrival -- it is a way to
  // concentrate on the table, not the shape the dashboard should open in.
  const [trackerOnly, setTrackerOnly] = useState(false)
  const { mode, toggleMode } = useThemeMode()

  return (
    <div className="min-h-screen page-bg page-dashboard py-10 px-4">
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <Icon name="building2" size="24" />
            <h1 className="text-3xl font-semibold tracking-tight text-[var(--text-primary)]">Job Tracker</h1>
          </div>
          <p className="text-[var(--text-secondary)] text-sm">Track every application, every link, every resume</p>
        </div>
      </motion.div>

      <motion.form onSubmit={onSubmit} className="mb-6 flex items-center gap-2" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
        {/* MUI v9 removed the top-level `InputProps` prop. It fell through to the DOM
            as inputprops="[object Object]" and BOTH adornments -- the search icon and
            the Add button -- were silently dropped, which is why there was no button
            to click. slotProps.input is the v9 replacement.
            `size` only accepts 'small' | 'medium'; "large" produced a
            MuiInputBase-sizeLarge class with no styles behind it.
            The Add button is type="submit" so the click and the Enter key both run
            the form's onSubmit exactly once. */}
        <TextField
          fullWidth
          size="medium"
          placeholder="Add or search companies..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          /* Kept even though Add is now a direct child of the form and implicit
             submission would work: MUI's TextField can swallow the key in some
             configurations, and this makes Enter's behaviour explicit and testable.
             Example: type 'Linear', press Enter -> onSubmit runs -> company added. */
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onSubmit(e) } }}
          slotProps={{
            input: {
              startAdornment: <InputAdornment position="start"><IconSearch /></InputAdornment>,
            },
          }}
          className="flex-1 min-w-0"
        />
        {/* Add sits beside the field, not inside its endAdornment. An adornment is
            laid out by MUI inside the input's own box, so the button inherited the
            input's padding rather than the button spec -- it came out a pixel taller
            than every other button and crowded the field's rounded edge. As a sibling
            it is the same Btn as the rest of the app. */}
        <Btn variant="primary" type="submit" icon="add">Add</Btn>
      </motion.form>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex flex-wrap items-center justify-center gap-2 mb-8">
        <span className="text-sm text-[var(--text-secondary)] font-medium mr-2">Card Style:</span>
        {[
          { id: 'compact', label: 'Compact', icon: 'list' },
          { id: 'detailed', label: 'Detailed', icon: 'columns' },
        ].map((s) => (
          <Btn key={s.id} variant={cardStyle === s.id ? 'selected' : 'secondary'} icon={s.icon} iconSize="14" aria-pressed={cardStyle === s.id} onClick={() => setCardStyle(s.id)}>
            {s.label}
          </Btn>
        ))}
      </motion.div>

      {query && (
        <div className="flex justify-between items-center px-2 mb-4">
          <span className="text-sm text-[var(--text-secondary)]">{filtered.length} {filtered.length === 1 ? 'company' : 'companies'} found</span>
          <button className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]" onClick={() => setQuery('')}>Clear</button>
        </div>
      )}

      {/* Rendered even with no companies, so the sample-data and dark-mode controls
          are reachable on a first visit; only the list-specific toggles are gated. */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex gap-2 mb-5 flex-wrap">
        {stats.total > 0 && (
          <Btn icon="chevronDown" onClick={() => setCollapsed(!collapsed)}>
            {collapsed ? 'Show all' : 'Collapse list'}
          </Btn>
        )}
        {/* Sparkles opens a catalogue of every feature with the sample value that
            demonstrates it, and can load that data in one click. Always available,
            unlike the empty-state button, so the samples can be reviewed at any time.
            Example: click -> panel lists "Status column: Offer · Interviewing · ...". */}
        <Btn
          variant={showSamples ? 'selected' : 'secondary'}
          icon="sparkles"
          aria-pressed={showSamples}
          aria-label="Show sample data for every feature"
          onClick={() => setShowSamples((v) => !v)}
        >
          Sample data
        </Btn>
          {/* One form for a whole application -- company, role, its job links and any
            toggles -- so a new application does not have to be built section by
            section. Example: paste three postings and set Status in one submit. */}
        <Btn
          variant={showBulk ? 'selected' : 'secondary'}
          icon="clipboardCheck"
          aria-pressed={showBulk}
          aria-label="Add everything at once"
          onClick={() => setShowBulk((v) => !v)}
        >
          Bulk add
        </Btn>
        {/* Sun/moon swaps the whole app between light and dark. The choice is saved,
              so a reload keeps it; a first visit follows the OS preference.
              Example: in light mode this shows a moon and switches to dark. */}
          <Btn
          icon={mode === 'dark' ? 'sun' : 'moon'}
          aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-pressed={mode === 'dark'}
          onClick={toggleMode}
        >
          {mode === 'dark' ? 'Light mode' : 'Dark mode'}
        </Btn>
        {stats.total > 0 && (
          <Btn
            variant={showTracker ? 'selected' : 'secondary'}
            icon="list"
            aria-pressed={showTracker}
            onClick={() => setShowTracker(!showTracker)}
          >
            {showTracker ? 'Hide tracker' : 'Show tracker'}
          </Btn>
        )}
        {/* Turning it on also turns the table on, so the mode can never leave an
            empty screen. */}
        {stats.total > 0 && (
          <Btn
            variant={trackerOnly ? 'selected' : 'secondary'}
            icon="columns"
            aria-pressed={trackerOnly}
            aria-label="Show only the Job Links Tracker"
            onClick={() => { const next = !trackerOnly; setTrackerOnly(next); if (next) setShowTracker(true) }}
          >
            Tracker only
          </Btn>
        )}
      </motion.div>

      {!trackerOnly && !collapsed && stats.total > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 }} className="flex gap-4 mb-5 flex-wrap items-baseline">
          {[
            { label: 'Companies', value: stats.total },
            { label: 'Links', value: stats.totalLinks },
            { label: 'Resumes', value: stats.withResume }
          ].map((s) => (
            <div key={s.label} className="flex items-baseline gap-1.5">
              <span className="text-sm font-medium text-[var(--text-primary)]">{s.value}</span>
              <span className="text-sm text-[var(--text-secondary)]">{s.label.toLowerCase()}</span>
            </div>
          ))}
        </motion.div>
      )}

      {!trackerOnly && showBulk && (
        <BulkAddPanel companies={companies} onSubmit={bulkAdd} onClose={() => setShowBulk(false)} />
      )}

      {!trackerOnly && showSamples && (
        <SampleDataPanel
          onLoad={() => { loadSampleData(); setShowSamples(false) }}
          onClose={() => setShowSamples(false)}
        />
      )}

      {companies.length > 0 && showTracker && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-6">
          <div className="bg-[var(--surface-1)] rounded-xl border border-[var(--border)] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[var(--border)] flex items-center gap-2">
              <Icon name="list" size="18" />
              <Typography variant="subtitle2" className="font-semibold text-[var(--text-primary)]">Job Links Tracker</Typography>
            </div>
            <div className="grid grid-cols-12 gap-2 px-4 py-2 bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border)]">
              <div className="col-span-1">SR No</div>
              <div className="col-span-3">Company</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Priority</div>
              <div className="col-span-2">Links Applied</div>
              <div className="col-span-2">Note</div>
            </div>
            {companies.map((c, i) => (
              <motion.div key={c.id} className="grid grid-cols-12 gap-2 px-4 py-2.5 items-center border-b border-[var(--border)] hover:bg-[var(--accent-soft)]/30 transition-colors" whileHover={{ scale: 1.01 }}>
                <div className="col-span-1"><span className="inline-flex items-center justify-center w-6 h-6 border border-[var(--border-strong)] rounded text-[var(--text-secondary)] text-xs font-bold">{i + 1}</span></div>
                <div className="col-span-3 truncate">
                  <span className="font-medium text-[var(--text-primary)] text-sm">{c.name}</span>
                </div>
                {/* These two read straight off the Status and Priority toggles. They
                    replace the old derived Active/Pending chip, which only ever said
                    whether links.length > 0 -- information the Links Applied column
                    already carries, so nothing was lost by the swap.
                    Example: customFields.Status = 'Offer' -> green "Offer" chip;
                             no Status set -> a grey dash. */}
                <div className="col-span-2 min-w-0">
                  <RoleChips company={c} field="Status" styles={STATUS_STYLES} />
                </div>
                <div className="col-span-2 min-w-0">
                  <RoleChips company={c} field="Priority" styles={PRIORITY_STYLES} />
                </div>
                <div className="col-span-2">
                  <span className={`inline-flex items-center gap-1.5 text-sm ${allLinks(c).length > 0 ? 'text-[var(--text-primary)]' : 'text-[var(--text-muted)]'}`}>
                    <Icon name="link" size="14" /> {allLinks(c).length} {allLinks(c).length === 1 ? 'link' : 'links'}
                  </span>
                </div>
                <div className="col-span-2 text-xs text-[var(--text-secondary)] truncate">
                  {allLinks(c).length > 0 ? `Last: ${allLinks(c).at(-1).label || allLinks(c).at(-1).url}` : 'No links yet'}
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>
      )}

      {!trackerOnly && !collapsed && (
      <AnimatePresence mode="popLayout">
        {filtered.length === 0 ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-center py-16">
            <Icon name="briefcase" size="64" color="#d1d5db" />
            <p className="text-xl text-[var(--text-muted)] mt-4">{query ? 'No matching companies.' : 'Add a company to get started'}</p>
            <p className="text-sm text-[var(--text-muted)] mt-1">Double-click a company name to edit it</p>
            {/* Only offered on a genuinely empty tracker, never while a search is
                filtering everything out -- otherwise this would look like an action
                on the search result and could bury real data under samples.
                Example: 0 companies -> button shown; 4 companies filtered to 0 by the
                query 'zzz' -> button hidden. */}
            {!query && companies.length === 0 && (
              <Btn variant="primary" icon="plusCircle" onClick={loadSampleData} className="mt-6">
                Load sample data
              </Btn>
            )}
          </motion.div>
        ) : (
          <motion.div key="grid" data-testid="company-grid" className="grid grid-cols-1 gap-3">
            {filtered.map((c, i) => (
              <CompanyCard key={c.id} company={c} onRemove={removeCompany} onEdit={editCompany} cardStyle={cardStyle} index={i} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
      )}

      {!trackerOnly && companies.length > 0 && (
          <motion.footer initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5 }} className="mt-8">
            <Divider />
            <div className="text-center py-4">
              <Typography variant="body2" color="text.secondary"><Icon name="clipboardCheck" size="16" /> {companies.length} {companies.length === 1 ? 'company' : 'companies'} tracked</Typography>
            </div>
          </motion.footer>
        )}

        {!trackerOnly && companies.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.6 }} className="bg-[var(--surface-1)] rounded-xl border border-[var(--border)] p-4">
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-8 h-8 bg-[var(--accent-soft)] rounded-lg flex items-center justify-center"><Icon name="fileText" size="18" /></div>
              <div>
                <Typography variant="subtitle2" className="font-semibold text-[var(--text-primary)] mb-1">Quick Notes</Typography>
                <p className="text-sm text-[var(--text-secondary)] leading-relaxed">Track your applications with the SR No and Status tracker above. Double-click any company name to edit inline. Use the card style toggle to switch between Default, Compact, Detailed, and Featured views. Upload resumes to each company for easy tracking.</p>
              </div>
            </div>
          </motion.div>
        )}
    </div>
  )
}

function CompanyLinks({ role, addLink, editingLink, setEditingLink, editLabel, setEditLabel, editUrl, setEditUrl, updateLink, removeLink }) {
  const { control: linkControl, handleSubmit: handleLinkSubmit, reset: resetLink } = useForm({ resolver: zodResolver(linkSchema), defaultValues: { label: '', url: '' } })

  // Controller already owns each field's value. The previous code ALSO kept local
  // `label`/`url` state and passed it as `value=`, which shadowed the form state, so
  // clearing the form left the visible inputs untouched -- after adding a link both
  // boxes stayed filled with the previous entry. Resetting the instance that is
  // actually rendered (this one, not CompanyPage's) is what clears them.
  // Example: submit { label: 'Backend Engineer', url: 'https://example.com/job' }
  //          -> link appended, then both boxes return to ''.
  const onAddLink = (data) => {
    addLink(data)
    resetLink({ label: '', url: '' })
  }

  return (
    <div className="">
      <motion.form onSubmit={handleLinkSubmit(onAddLink)} className="flex flex-row gap-2 items-center mb-6" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.01 }}>
        <Controller name="label" control={linkControl} render={({ field }) => (
          <TextField {...field} label="Job title" size="small" className="flex-1" />
        )} />
        <Controller name="url" control={linkControl} render={({ field, fieldState: { error } }) => (
          <TextField {...field} label="https://..." error={!!error} helperText={error?.message} size="small" className="flex-1" />
        )} />
        <Btn variant="primary" type="submit" icon="link" iconSize="18">Add Link</Btn>
      </motion.form>
      {role.links.length > 0 && (
        <motion.ul className="space-y-3" style={{ listStyle: 'none', padding: 0, margin: 0 }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}>
          {role.links.map((link) => (
            <motion.li key={link.id} className="bg-[var(--surface-1)] rounded-xl border border-[var(--border)] p-4" layout whileHover={{ scale: 1.005 }}>
              {editingLink === link.id ? (
                <div className="flex gap-2 items-center">
                  <TextField size="small" placeholder="Label" value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="w-32" />
                  <TextField size="small" placeholder="URL" value={editUrl} onChange={(e) => setEditUrl(e.target.value)} className="w-40" />
                  <Btn variant="primary" icon="check" iconSize="18" onClick={() => updateLink(link.id)} aria-label="Save link" />
                  <Btn icon="x" iconSize="18" onClick={() => { setEditingLink(null); setEditLabel(''); setEditUrl('') }} aria-label="Cancel edit" />
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[200px] text-[var(--text-primary)] no-underline hover:underline flex items-center gap-2 text-sm overflow-hidden text-ellipsis whitespace-nowrap" onDoubleClick={() => { setEditingLink(link.id); setEditLabel(link.label || ''); setEditUrl(link.url) }}>
                    <Icon name="externalLink" size="14" /> {link.label || link.url}
                  </a>
                  <IconBtn variant="danger" icon="trash" iconSize="18" onClick={() => removeLink(link.id)} aria-label="Remove link" />
                </div>
              )}
            </motion.li>
          ))}
        </motion.ul>
      )}
    </div>
  )
}

function CompanyResume({ role, setResume, handleDownload, handleFileChange, fileError }) {
  return (
    <div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      {role.resume ? (
        <motion.div whileHover={{ scale: 1.02 }} className="flex items-center gap-3 p-4 bg-[var(--surface-1)] rounded-xl border border-[var(--border)]">
          <Icon name="fileText" size="24" color="#ef4444" />
          <span className="flex-1 text-sm truncate masked-text" data-text={role.resume.name}><span>{role.resume.name}</span></span>
          <Btn icon="download" onClick={handleDownload}>Download</Btn>
          <IconBtn variant="danger" icon="x" onClick={() => setResume(null)} aria-label="Remove resume" />
        </motion.div>
      ) : (
        /* The <input type="file"> used to sit INSIDE a <motion.button>. A button
           swallows the click and a label never activates a control nested in one, so
           the picker never opened and resume upload was dead. The label is now the
           clickable target itself, with the input as its direct child.
           Example: click anywhere on the dashed area -> the file picker opens. */
        <motion.label
          htmlFor="resume-upload"
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="block w-full py-4 bg-[var(--surface-1)] border-2 border-dashed border-[var(--border-strong)] rounded-xl text-center text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-all cursor-pointer flex items-center justify-center gap-2"
        >
          <Icon name="upload" size="20" /> Upload Resume
          <input id="resume-upload" type="file" accept=".pdf,.doc,.docx,.txt,.md" className="sr-only" onChange={handleFileChange} />
        </motion.label>
      )}
      {fileError && <Alert severity="error" className="mt-2">{fileError}</Alert>}
      </motion.div>
    </div>
  )
}

function CompanyCustom({ customFields, customNames, showCustomInput, customName, setCustomName, setShowCustomInput, updateCustomField, addCustomField, addCustomFieldNamed }) {
  // Only offer presets this company does not already have.
  // Example: customFields = { Salary: '90k' } -> 'Salary' drops out of the chips.
  const availablePresets = PRESET_TOGGLES.filter((t) => customFields[t.name] === undefined)

  return (
    <div>
      <AnimatePresence>
      {customNames.map((cn) => (
          <motion.div key={cn} className="flex items-center gap-3 mb-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} whileHover={{ scale: 1.01 }}>
            <span className="text-sm font-semibold text-[var(--text-primary)] min-w-[140px] truncate masked-text" data-text={cn}><span>{cn}</span>:</span>
            <CustomFieldInput name={cn} value={customFields[cn]} onChange={(v) => updateCustomField(cn, v)} />
          </motion.div>
      ))}
      {!showCustomInput && availablePresets.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mb-4">
          <Typography variant="caption" className="text-[var(--text-secondary)] block mb-2">Quick add</Typography>
          <div className="flex flex-wrap gap-2">
            {availablePresets.map((preset) => (
              <Btn key={preset.name} icon="plusCircle" iconSize="14" className="h-8 px-2.5 text-xs" onClick={() => addCustomFieldNamed(preset.name)}>
                {preset.name}
              </Btn>
            ))}
          </div>
        </motion.div>
      )}
      {!showCustomInput && (
        /* This had `initial={{ opacity: 0 }}` with no `animate`, so framer-motion
           never faded it in -- the button rendered at full size (992x52) but at
           opacity 0, leaving an invisible click target where the only entry point
           for adding a custom field should be. `animate` is what ends the initial
           state. Example: mounts at opacity 0, animates to opacity 1. */
        <Btn icon="plusCircle" iconSize="18" onClick={() => setShowCustomInput(true)} className="w-full">
          Add your own toggle
        </Btn>
      )}
      {showCustomInput && (
        <motion.div className="flex gap-3 mb-3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} whileHover={{ scale: 1.01 }}>
          <TextField size="small" placeholder="Toggle name, e.g. Referral" value={customName} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCustomField()} fullWidth />
          <Btn variant="primary" icon="check" onClick={addCustomField} aria-label="Save field" />
          <Btn icon="x" onClick={() => setShowCustomInput(false)} aria-label="Cancel field" />
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  )
}

// Defined at module scope, not inside RoleDetailedView: a component created during
// render gets a new identity every time, which remounts its whole subtree and would
// drop focus out of any field being typed in.
// Example: <RoleSection title="Job links"><CompanyLinks … /></RoleSection>
function RoleSection({ title, children }) {
  return (
    <section className="mb-6">
      <Typography variant="subtitle2" className="font-semibold text-[var(--text-primary)] mb-3">{title}</Typography>
      {children}
    </section>
  )
}

// Everything a role holds, stacked on one page. No tab strip, so links, resume and
// every toggle are readable in one pass -- the layout to pick when reviewing an
// application rather than editing one field.
// Example: <RoleDetailedView role={activeRole} ... />
function RoleDetailedView({ role, addLink, editingLink, setEditingLink, editLabel, setEditLabel, editUrl, setEditUrl, updateLink, removeLink, setResume, handleDownload, handleFileChange, fileError, customFields, customNames, showCustomInput, customName, setCustomName, setShowCustomInput, updateCustomField, addCustomField, addCustomFieldNamed }) {
  return (
    <div>
      <RoleSection title="Job links">
        <CompanyLinks role={role} addLink={addLink} editingLink={editingLink} setEditingLink={setEditingLink} editLabel={editLabel} setEditLabel={setEditLabel} editUrl={editUrl} setEditUrl={setEditUrl} updateLink={updateLink} removeLink={removeLink} />
      </RoleSection>
      <RoleSection title="Resume">
        <CompanyResume role={role} setResume={setResume} handleDownload={handleDownload} handleFileChange={handleFileChange} fileError={fileError} />
      </RoleSection>
      <RoleSection title="Toggles">
        <CompanyCustom customFields={customFields} customNames={customNames} showCustomInput={showCustomInput} customName={customName} setCustomName={setCustomName} setShowCustomInput={setShowCustomInput} updateCustomField={updateCustomField} addCustomField={addCustomField} addCustomFieldNamed={addCustomFieldNamed} />
      </RoleSection>
    </div>
  )
}

// Module scope, not inside the view: a component created during render is a new type
// on every render, which remounts its subtree and drops focus out of any field inside.
// Example: <TableCard><table …/></TableCard>
function TableCard({ children }) {
  return <div className="bg-[var(--surface-1)] rounded-xl border border-[var(--border)] overflow-hidden mb-4">{children}</div>
}

// The dense layout. Everything about the role on one scannable screen: its toggles as
// a real two-column table, its links, and its resume -- all editable in place.
//
// The earlier version was a table in name only. It stacked full-height form controls
// with no header, which made it the LEAST dense of the three views; its links were
// read-only, it had no resume section at all, and its empty state told you to go and
// use a different view. Each of those is handled here, so the view is self-sufficient.
// Example: <RoleTableView role={activeRole} … /> renders Field/Value rows, a quick-add
//          row for missing presets, the links list with add and remove, and the CV.
function RoleTableView({
  role, customFields, customNames, updateCustomField, addCustomFieldNamed,
  addLink, removeLink, setResume, handleDownload, handleFileChange, fileError,
}) {
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [linkError, setLinkError] = useState('')

  const availablePresets = PRESET_TOGGLES.filter((t) => customFields[t.name] === undefined)

  // Validated here rather than leaning on the caller, because addLink() only prefixes
  // the scheme -- it does not reject a non-URL.
  // Example: 'not a url' -> inline error, nothing added.
  const submitLink = (e) => {
    e.preventDefault()
    const raw = url.trim()
    if (!raw) { setLinkError('Enter a URL'); return }
    const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    if (!linkSchema.safeParse({ label, url: full }).success) { setLinkError('Invalid URL'); return }
    addLink({ url: full, label })
    setLabel(''); setUrl(''); setLinkError('')
  }

  return (
    <div data-testid="table-view">
      <div className="bg-[var(--surface-1)] rounded-xl border border-[var(--border)] overflow-hidden mb-4">
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
              <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider w-[34%]">Field</th>
              <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Value</th>
            </tr>
          </thead>
          <tbody>
            {customNames.length === 0 ? (
              <tr>
                <td colSpan={2} className="px-4 py-5 text-sm text-[var(--text-muted)] text-center">
                  No toggles on this role yet — add one below.
                </td>
              </tr>
            ) : customNames.map((cn) => (
              <tr key={cn} className="border-b border-[var(--border)] last:border-b-0 align-middle">
                <td className="px-4 py-1.5 font-medium text-[var(--text-primary)] truncate">{cn}</td>
                <td className="px-4 py-1.5">
                  <CustomFieldInput name={cn} value={customFields[cn]} onChange={(v) => updateCustomField(cn, v)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* The old empty state pointed at another view, which made this one a dead end.
            Missing presets are addable right here instead. */}
        {availablePresets.length > 0 && (
          <div className="px-4 py-3 border-t border-[var(--border)] bg-[var(--surface-2)]">
            <Typography variant="caption" className="text-[var(--text-secondary)] block mb-2">Add a field</Typography>
            <div className="flex flex-wrap gap-1.5">
              {availablePresets.map((t) => (
                <Btn key={t.name} icon="plusCircle" iconSize="14" className="h-8 px-2.5 text-xs" onClick={() => addCustomFieldNamed(t.name)}>
                  {t.name}
                </Btn>
              ))}
            </div>
          </div>
        )}
      </div>

      <TableCard>
        <div className="px-4 py-2 bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border)]">
          Links ({role.links.length})
        </div>
        <form onSubmit={submitLink} className="flex flex-wrap items-start gap-2 px-4 py-3 border-b border-[var(--border)]">
          <TextField size="small" placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} className="flex-1 min-w-[120px]" />
          <TextField
            size="small" placeholder="https://..." value={url}
            onChange={(e) => { setUrl(e.target.value); setLinkError('') }}
            error={!!linkError} helperText={linkError || undefined}
            className="flex-[2] min-w-[160px]"
          />
          <Btn variant="primary" type="submit">Add link</Btn>
        </form>
        {role.links.length === 0 ? (
          <div className="px-4 py-3 text-sm text-[var(--text-muted)]">No links on this role yet.</div>
        ) : role.links.map((l) => (
          <div key={l.id} className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] last:border-b-0">
            <a href={l.url} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-sm text-[var(--text-primary)] hover:underline truncate">
              {l.label || l.url}
            </a>
            <IconBtn variant="danger" icon="trash" onClick={() => removeLink(l.id)} aria-label={`Remove link ${l.label || l.url}`} className="shrink-0" />
          </div>
        ))}
      </TableCard>

      <TableCard>
        <div className="px-4 py-2 bg-[var(--surface-2)] text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider border-b border-[var(--border)]">
          Resume
        </div>
        <div className="px-4 py-3">
          {role.resume ? (
            <div className="flex items-center gap-2">
              <Icon name="fileText" size="16" color="#ef4444" />
              <span className="flex-1 min-w-0 text-sm truncate">{role.resume.name}</span>
              <IconBtn icon="download" onClick={handleDownload} aria-label="Download resume" />
              <IconBtn variant="danger" icon="x" onClick={() => setResume(null)} aria-label="Remove resume" />
            </div>
          ) : (
            <label htmlFor="resume-upload-table" className="flex items-center justify-center gap-2 w-full py-2.5 border border-dashed border-[var(--border-strong)] rounded-lg text-sm text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text-primary)] transition-all cursor-pointer">
              <Icon name="upload" size="16" /> Upload resume
              <input id="resume-upload-table" type="file" accept=".pdf,.doc,.docx,.txt,.md" className="sr-only" onChange={handleFileChange} />
            </label>
          )}
          {fileError && <Alert severity="error" className="mt-2">{fileError}</Alert>}
        </div>
      </TableCard>
    </div>
  )
}

// Every role at this company side by side. One column per role, one row per toggle
// that any role carries, so two applications can be compared without switching
// between them. A role missing a toggle shows a dash rather than an empty cell.
// Example: Product Engineer at Offer next to Research Engineer at Phone Screen.
function RoleComparisonView({ roles }) {
  const names = [...new Set(roles.flatMap((r) => Object.keys(r.customFields || {})))]
  const rows = [
    { label: 'Links', get: (r) => String(r.links?.length ?? 0) },
    { label: 'Resume', get: (r) => r.resume?.name || '' },
    ...names.map((n) => ({ label: n, get: (r) => r.customFields?.[n] || '' })),
  ]

  return (
    <div className="bg-[var(--surface-1)] rounded-xl border border-[var(--border)] overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--surface-2)] border-b border-[var(--border)]">
            <th className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Field</th>
            {roles.map((r) => (
              <th key={r.id} className="text-left px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider whitespace-nowrap">
                {r.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-[var(--border)] last:border-b-0">
              <td className="px-4 py-2.5 font-medium text-[var(--text-primary)] whitespace-nowrap">{row.label}</td>
              {roles.map((r) => {
                const v = row.get(r)
                return (
                  <td key={r.id} className="px-4 py-2.5 text-[var(--text-secondary)] align-top">
                    {v ? v : <span className="text-[var(--text-muted)]">&mdash;</span>}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const ROLES_LAYOUT_KEY = 'job-tracker-roles-layout'

// How the roles section itself is presented. Both layouts drive the same state; this
// only changes where the picker sits and how much of it is visible at once.
//   toolbar - one row: role dropdown on the left, view control on the right
//   rail    - a vertical list beside the content, every role visible at once
// Saved like the theme, because it is a workspace preference rather than data.
// Example: localStorage 'job-tracker-roles-layout' = 'rail'
const ROLES_LAYOUTS = [
  { id: 'toolbar', label: 'Toolbar', icon: 'list' },
  { id: 'rail', label: 'Rail', icon: 'columns' },
]
const DEFAULT_ROLES_LAYOUT = 'toolbar'

function readRolesLayout() {
  try {
    const saved = localStorage.getItem(ROLES_LAYOUT_KEY)
    if (ROLES_LAYOUTS.some((l) => l.id === saved)) return saved
  } catch { /* storage unavailable */ }
  return DEFAULT_ROLES_LAYOUT
}

// Segmented layout control, shared by both presentations so they cannot drift.
// Example: <RoleViewSwitcher roles={roles} activeRole={r} … />
function RoleViewSwitcher({ roles, activeRole, comparing, setComparing, setRoleView }) {
  return (
    <div className="flex items-center gap-2" data-testid="view-strip">
      <Typography variant="caption" className="text-[var(--text-secondary)]">View</Typography>
      <div className={SEG_WRAP}>
        {ROLE_VIEWS.map((v) => {
          const on = !comparing && (activeRole?.view || DEFAULT_ROLE_VIEW) === v.id
          return (
            <button
              key={v.id}
              type="button"
              aria-pressed={on}
              onClick={() => { setComparing(false); setRoleView(v.id) }}
              className={`${SEG_BASE} ${on ? SEG_ON : SEG_OFF}`}
            >
              {v.label}
            </button>
          )
        })}
        {roles.length > 1 && (
          <button
            type="button"
            aria-pressed={comparing}
            onClick={() => setComparing((c) => !c)}
            className={`${SEG_BASE} border-l border-r-0 ${comparing ? SEG_ON : SEG_OFF}`}
          >
            All roles
          </button>
        )}
      </div>
    </div>
  )
}

// Switches between the two presentations of the roles section.
// Example: <RolesLayoutToggle layout="rail" setLayout={fn} />
function RolesLayoutToggle({ layout, setLayout }) {
  return (
    <div className={SEG_WRAP} data-testid="roles-layout-toggle">
      {ROLES_LAYOUTS.map((l) => (
        <button
          key={l.id}
          type="button"
          aria-pressed={layout === l.id}
          aria-label={`Roles as ${l.label.toLowerCase()}`}
          onClick={() => setLayout(l.id)}
          className={`${SEG_BASE} ${layout === l.id ? SEG_ON : SEG_OFF}`}
        >
          <Icon name={l.icon} size="14" /> {l.label}
        </button>
      ))}
    </div>
  )
}

// Option B: every role visible at once in a vertical list beside the content. Each row
// carries its own stage, so the whole pipeline at an employer reads without opening
// anything. Rows are draggable, same as the dropdown items in the toolbar layout.
// Example: <RoleRail roles={roles} activeRole={r} … />
function RoleRail({ roles, activeRole, setActiveRoleId, setActiveSubTab, onRoleKeyDown, removeRole, dragProps, draggingRole, showRoleInput, setShowRoleInput, newRoleTitle, setNewRoleTitle, addRole }) {
  return (
    <div className="w-full sm:w-56 shrink-0" data-testid="role-strip">
      {roles.length > 1 && (
        <span className="sr-only">Roles can be reordered by dragging, or with Alt and the arrow keys.</span>
      )}
      <div className="space-y-1">
        {roles.map((r, i) => {
          const on = r.id === activeRole?.id
          return (
            <div
              key={r.id}
              data-role-chip={r.title}
              draggable
              {...dragProps(i)}
              className={`group flex items-center gap-1 rounded-lg transition-all ${draggingRole === i ? 'opacity-40' : ''} ${on ? 'bg-[var(--accent-soft)]' : 'hover:bg-[var(--surface-2)]'}`}
            >
              {roles.length > 1 && (
                <span className="cursor-grab select-none text-[var(--text-muted)] pl-2" aria-hidden="true">⠿</span>
              )}
              <button
                type="button"
                onClick={() => { setActiveRoleId(r.id); setActiveSubTab('links') }}
                onKeyDown={(e) => onRoleKeyDown(e, i)}
                aria-pressed={on}
                className={`flex-1 min-w-0 text-left px-2 py-2 border-l-2 transition-all ${on ? 'border-[var(--accent)]' : 'border-transparent'}`}
              >
                <span className={`block truncate text-sm font-medium ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-primary)]'}`}>{r.title}</span>
                <span className="block truncate text-xs text-[var(--text-secondary)]">
                  {r.customFields?.Status || 'No status'} · {r.links.length} {r.links.length === 1 ? 'link' : 'links'}
                </span>
              </button>
              {roles.length > 1 && (
                <IconBtn variant="danger" icon="x" iconSize="14" onClick={() => removeRole(r.id)} aria-label={`Remove role ${r.title}`} className="opacity-0 group-hover:opacity-100 focus:opacity-100 w-8" />
              )}
            </div>
          )
        })}
      </div>

      {!showRoleInput ? (
        <Btn icon="plusCircle" onClick={() => setShowRoleInput(true)} aria-label="Add role" className="mt-2 w-full">
          Add role
        </Btn>
      ) : (
        <div className="mt-2 space-y-2">
          <TextField
            size="small" fullWidth autoFocus
            placeholder="Role title, e.g. Research Engineer"
            value={newRoleTitle}
            onChange={(e) => setNewRoleTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(newRoleTitle) } }}
          />
          <div className="flex gap-2">
            <Btn variant="primary" icon="check" onClick={() => addRole(newRoleTitle)} aria-label="Save role" className="flex-1" />
            <Btn icon="x" onClick={() => { setShowRoleInput(false); setNewRoleTitle('') }} aria-label="Cancel role" className="flex-1" />
          </div>
        </div>
      )}
    </div>
  )
}

export function CompanyPage() {
  const { id } = useParams()
  const router = useRouter()
  const { companies, setCompanies } = useCompanies()
  const { showToast } = useToast()
  const company = companies.find((c) => c.id === id)
  const [customName, setCustomName] = useState('')
  const [showCustomInput, setShowCustomInput] = useState(false)
  const [fileError, setFileError] = useState('')
  const [editingLink, setEditingLink] = useState(null)
  const [editLabel, setEditLabel] = useState('')
  const [editUrl, setEditUrl] = useState('')
  const [activeSubTab, setActiveSubTab] = useState('links')
  // Which application at this company is being edited. Falls back to the first role
  // whenever the id does not match, so deleting a role cannot strand the page.
  const [activeRoleId, setActiveRoleId] = useState(null)
  const [newRoleTitle, setNewRoleTitle] = useState('')
  const [showRoleInput, setShowRoleInput] = useState(false)
  // 'all' is a page mode rather than a role setting, so it is not written to storage;
  // the three real layouts are read from the active role.
  const [comparing, setComparing] = useState(false)
  // The drag source is held in a ref, not state: dragstart and drop can arrive in the
  // same tick (a scripted drag does exactly this), and a state update has not
  // re-rendered by then, so the drop handler would still read null and do nothing. The
  // ref is correct immediately. State is kept purely for the drag-in-flight styling,
  // where being a render behind does not matter.
  const dragFromRef = useRef(null)
  const [draggingRole, setDraggingRole] = useState(null)
  // Same reasoning as the theme: read after mount, not during the first render, so the
  // server's HTML and the client's first pass agree.
  const [layout, setLayout] = useState({ id: DEFAULT_ROLES_LAYOUT, ready: false })
  const rolesLayout = layout.id
  const setRolesLayout = (id) => setLayout({ id, ready: true })

  // Same reasoning as the theme: the first render has to match the server, so the
  // saved layout is adopted after it.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { setLayout({ id: readRolesLayout(), ready: true }) }, [])

  useEffect(() => {
    if (!layout.ready) return
    try { localStorage.setItem(ROLES_LAYOUT_KEY, layout.id) } catch { /* storage unavailable */ }
  }, [layout])


  // Toggles belong to a ROLE, not the company, so two applications at the same
  // employer can each carry their own recruiter, status and dates.
  // `company?.` because this runs above the not-found early return.
  const roles = company?.roles || []
  const activeRole = roles.find((r) => r.id === activeRoleId) || roles[0]
  const customFields = activeRole?.customFields || {}
  const customNames = Object.keys(customFields)
  // Three tabs, not one per field. With the sample data the old strip carried 17 and
  // scrolled sideways; every field is listed inside the Fields panel anyway, so
  // nothing here became unreachable -- only the strip got shorter.
  const subTabs = ['links', 'resume', 'custom']

  // Every hook must run on every render, so this useCallback has to stay ABOVE the
  // not-found early return below -- with it underneath, a found company ran one
  // more hook than a missing one and React threw "Rendered more hooks than during
  // the previous render", blanking the page.
  // Example: setCB((prev) => prev.map((c) => c.id === id ? { ...c, resume } : c))
  const setCB = useCallback((updater) => {
    const current = loadCompanies()
    const next = typeof updater === 'function' ? updater(current) : updater
    persist(next)
    setCompanies(next)
  }, [setCompanies])

  if (!company) return (
    <div className="text-center py-16">
      <Icon name="alertCircle" size="64" color="#d1d5db" />
      <p className="text-xl text-[var(--text-muted)] mt-4">Company not found</p>
      <button onClick={() => router.back()} className="mt-4 px-4 py-2 bg-[var(--accent)] text-[var(--on-accent)] rounded-lg hover:bg-[var(--accent-hover)] transition-all flex items-center gap-2"><Icon name="arrowLeft" size="16" /> Go Back</button>
    </div>
  )

  // Rewrites only the active role of this company, leaving its other roles untouched.
  // Example: updateActiveRole((r) => ({ ...r, customFields: { ...r.customFields, Salary: '90k' } }))
  const updateActiveRole = (fn) => {
    setCB((prev) => prev.map((c) => {
      if (c.id !== id) return c
      const rs = normaliseRoles(c)
      const targetId = activeRole?.id || rs[0]?.id
      return { ...c, roles: rs.map((r) => (r.id === targetId ? fn(r) : r)) }
    }))
  }

  const addLink = ({ url: urlVal, label: labelVal }) => {
    const full = /^https?:\/\//i.test(urlVal.trim()) ? urlVal.trim() : 'https://' + urlVal.trim()
    updateActiveRole((r) => ({ ...r, links: [...r.links, { id: crypto.randomUUID(), label: labelVal.trim() || undefined, url: full }] }))
    setActiveSubTab('links')
    showToast('Link added', 'success')
  }

  const updateLink = (linkId) => {
    const full = /^https?:\/\//i.test(editUrl.trim()) ? editUrl.trim() : 'https://' + editUrl.trim()
    updateActiveRole((r) => ({ ...r, links: r.links.map((l) => (l.id === linkId ? { ...l, label: editLabel.trim() || undefined, url: full } : l)) }))
    setEditingLink(null); setEditLabel(''); setEditUrl('')
    showToast('Updated', 'success')
  }

  const removeLink = (linkId) => {
    updateActiveRole((r) => ({ ...r, links: r.links.filter((l) => l.id !== linkId) }))
    showToast('Removed', 'warn')
  }

  // Saves the layout on the role, so each application keeps its own.
  // Example: setRoleView('table') on Research Engineer leaves Product Engineer compact.
  const setRoleView = (view) => updateActiveRole((r) => ({ ...r, view }))

  // Moves a role to a new position and persists the order, which is what the role
  // strip, the All-roles comparison columns and the dashboard chips all read.
  // Guarded against no-op moves so a drag that ends where it started writes nothing.
  // Example: reorderRoles(0, 2) on [A, B, C] stores [B, C, A].
  const reorderRoles = (from, to) => {
    if (from === to || from == null || to == null) return
    setCB((prev) => prev.map((c) => {
      if (c.id !== id) return c
      const rs = [...normaliseRoles(c)]
      if (from < 0 || from >= rs.length || to < 0 || to >= rs.length) return c
      const [moved] = rs.splice(from, 1)
      rs.splice(to, 0, moved)
      return { ...c, roles: rs }
    }))
  }

  // Keyboard equivalent of the drag, because a drag alone is unusable by keyboard and
  // screen-reader users. Alt+Arrow moves the focused role one place.
  // Example: focus 'Research Engineer', press Alt+Left -> it swaps with the role before it.
  // Shared by both presentations so a drag behaves identically in each.
  // Example: <div draggable {...dragProps(2)} />
  const dragProps = (i) => ({
    onDragStart: (e) => { dragFromRef.current = i; setDraggingRole(i); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move' },
    onDragOver: (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'move' },
    onDrop: (e) => { e.preventDefault(); reorderRoles(dragFromRef.current, i); dragFromRef.current = null; setDraggingRole(null) },
    onDragEnd: () => { dragFromRef.current = null; setDraggingRole(null) },
  })

  const onRoleKeyDown = (e, index) => {
    if (!e.altKey) return
    if (e.key === 'ArrowLeft' && index > 0) { e.preventDefault(); reorderRoles(index, index - 1) }
    if (e.key === 'ArrowRight' && index < roles.length - 1) { e.preventDefault(); reorderRoles(index, index + 1) }
  }

  const setResume = (resume) => {
    updateActiveRole((r) => ({ ...r, resume }))
    if (resume) showToast('Resume uploaded', 'success')
  }

  const handleFileChange = (e) => {
    setFileError('')
    const f = e.target.files[0]
    if (!f) return
    if (f.size > MAX_FILE_SIZE) { setFileError('Max 2 MB'); return }
    const reader = new FileReader()
    reader.onload = () => setResume({ name: f.name, type: f.type || 'application/octet-stream', size: f.size, dataUrl: reader.result })
    reader.onerror = () => setFileError('Failed to read file')
    reader.readAsDataURL(f)
    e.target.value = ''
  }

  const handleDownload = () => { const res = activeRole?.resume; if (!res) return; const a = document.createElement('a'); a.href = res.dataUrl; a.download = res.name; a.click() }

  // Takes the name as an argument so a preset chip and the free-text box run the same
  // path. addCustomField() below is just the free-text caller.
  // Example: addCustomFieldNamed('Salary') -> customFields gains { Salary: '' }.

  const addCustomFieldNamed = (raw) => {
    const n = (raw || '').trim()
    if (!n) return
    if (customFields[n] !== undefined) { showToast(`"${n}" already exists`, 'warn'); return }
    updateActiveRole((r) => ({ ...r, customFields: { ...r.customFields, [n]: '' } }))
    setCustomName(''); setShowCustomInput(false)
    setActiveSubTab('custom')
    showToast(`Field "${n}" added`, 'success')
  }

  // Adding a role gives the company a second, independent set of toggles.
  // Example: Anthropic with 'Product Engineer' + 'Research Engineer' keeps a separate
  //          Recruiter and Status for each.
  const addRole = (rawTitle) => {
    const title = (rawTitle || '').trim()
    if (!title) return
    if (roles.some((r) => r.title.toLowerCase() === title.toLowerCase())) {
      showToast(`"${title}" already exists`, 'warn'); return
    }
    const newRole = { id: crypto.randomUUID(), title, links: [], resume: null, customFields: {}, view: DEFAULT_ROLE_VIEW }
    setCB((prev) => prev.map((c) => (c.id === id ? { ...c, roles: [...normaliseRoles(c), newRole] } : c)))
    setActiveRoleId(newRole.id)
    setActiveSubTab('links')
    setNewRoleTitle(''); setShowRoleInput(false)
    showToast(`Role "${title}" added`, 'success')
  }

  const removeRole = (roleId) => {
    if (roles.length <= 1) { showToast('A company needs at least one role', 'warn'); return }
    const role = roles.find((r) => r.id === roleId)
    if (!window.confirm(`Remove the role "${role?.title}" and its toggles?`)) return
    setCB((prev) => prev.map((c) => (c.id === id ? { ...c, roles: normaliseRoles(c).filter((r) => r.id !== roleId) } : c)))
    if (activeRoleId === roleId) setActiveRoleId(null)
    setActiveSubTab('links')
    showToast('Role removed', 'warn')
  }

  const addCustomField = () => addCustomFieldNamed(customName)

  const updateCustomField = (n, v) => updateActiveRole((r) => ({ ...r, customFields: { ...r.customFields, [n]: v } }))

  const getSubTabLabel = (key) => {
    if (key === 'links') return 'Links'
    if (key === 'resume') return 'Resume'
    return 'Fields'
  }

  return (
    <div className="min-h-screen page-bg page-company py-8 px-4">
      <button onClick={() => router.back()} className="mb-6 px-4 py-2 bg-[var(--surface-1)] border border-[var(--border)] rounded-lg hover:border-[var(--border-strong)] transition-all flex items-center gap-2 text-sm font-medium text-[var(--text-primary)]"><Icon name="arrowLeft" size="16" /> Back</button>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }} className="flex justify-between items-center mb-6 flex-wrap gap-2">
        <h1 className="text-2xl font-bold flex items-center gap-2"><Icon name="briefcase" size="24" /> {company.name}</h1>
        <Chip label={`${allLinks(company).length} ${allLinks(company).length === 1 ? 'link' : 'links'}`} color="primary" variant="outlined" />
      </motion.div>

      {/* Two presentations of the same roles state, chosen by the user and remembered.
          Toolbar keeps the picker to one row; Rail shows every role at once beside the
          content. Both drive the same handlers, so behaviour cannot drift between them.
          Example: rolesLayout 'rail' -> RoleRail on the left, content on the right. */}
      {rolesLayout === 'toolbar' && (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="mb-6">
        <div className="flex flex-wrap items-center gap-2" data-testid="role-strip">
          {roles.length > 1 && (
            <span className="sr-only">Roles can be reordered by dragging them in the menu, or with Alt and the arrow keys.</span>
          )}

          <TextField
            select
            size="small"
            value={activeRole?.id || ''}
            onChange={(e) => { setActiveRoleId(e.target.value); setActiveSubTab('links') }}
            onKeyDown={(e) => onRoleKeyDown(e, roles.findIndex((r) => r.id === activeRole?.id))}
            aria-label="Role"
            className="min-w-[260px]"
            slotProps={{
              select: {
                renderValue: (val) => {
                  const r = roles.find((x) => x.id === val)
                  if (!r) return ''
                  const status = r.customFields?.Status
                  return (
                    <span className="flex items-center gap-2">
                      <Icon name="briefcase" size="14" />
                      <span className="truncate">{r.title}</span>
                      {status && <span className="text-[var(--text-muted)]">·</span>}
                      {status && <span className="text-[var(--text-secondary)] truncate">{status}</span>}
                    </span>
                  )
                },
              },
            }}
          >
            {roles.map((r, i) => (
              <MenuItem
                key={r.id}
                value={r.id}
                data-role-chip={r.title}
                draggable
                {...dragProps(i)}
                className={draggingRole === i ? 'opacity-40' : ''}
              >
                <span className="flex items-center gap-2 w-full">
                  {roles.length > 1 && <span className="cursor-grab select-none text-[var(--text-muted)]" aria-hidden="true">⠿</span>}
                  <span className="truncate flex-1">{r.title}</span>
                  {r.customFields?.Status && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[r.customFields.Status] || NEUTRAL_CHIP}`}>
                      {r.customFields.Status}
                    </span>
                  )}
                </span>
              </MenuItem>
            ))}
          </TextField>

          {!showRoleInput ? (
            <Btn icon="plusCircle" onClick={() => setShowRoleInput(true)} aria-label="Add role">
              Add role
            </Btn>
          ) : (
            <div className="flex items-center gap-2">
              <TextField
                size="small"
                placeholder="Role title, e.g. Research Engineer"
                value={newRoleTitle}
                onChange={(e) => setNewRoleTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRole(newRoleTitle) } }}
                autoFocus
              />
              <Btn variant="primary" icon="check" onClick={() => addRole(newRoleTitle)} aria-label="Save role" />
              <Btn icon="x" onClick={() => { setShowRoleInput(false); setNewRoleTitle('') }} aria-label="Cancel role" />
            </div>
          )}

          {roles.length > 1 && activeRole && (
            <IconBtn variant="danger" icon="trash" onClick={() => removeRole(activeRole.id)} aria-label={`Remove role ${activeRole.title}`} />
          )}

          <div className="ml-auto flex items-center gap-3">
            <RolesLayoutToggle layout={rolesLayout} setLayout={setRolesLayout} />
            <RoleViewSwitcher roles={roles} activeRole={activeRole} comparing={comparing} setComparing={setComparing} setRoleView={setRoleView} />
          </div>
        </div>
      </motion.div>
      )}

      {/* The rail sits beside this body; in toolbar layout the body is full width.
          Both branches render the same JSX, so a section cannot exist in one layout
          and not the other. */}
      <div className={rolesLayout === 'rail' ? 'flex flex-col sm:flex-row gap-6 items-start' : ''}>
        {rolesLayout === 'rail' && (
          <RoleRail
            roles={roles} activeRole={activeRole}
            setActiveRoleId={setActiveRoleId} setActiveSubTab={setActiveSubTab}
            onRoleKeyDown={onRoleKeyDown} removeRole={removeRole}
            dragProps={dragProps} draggingRole={draggingRole}
            showRoleInput={showRoleInput} setShowRoleInput={setShowRoleInput}
            newRoleTitle={newRoleTitle} setNewRoleTitle={setNewRoleTitle} addRole={addRole}
          />
        )}
        <div className="flex-1 min-w-0 w-full">
          {rolesLayout === 'rail' && (
            <div className="flex flex-wrap items-center gap-3 justify-end mb-4">
              <RolesLayoutToggle layout={rolesLayout} setLayout={setRolesLayout} />
              <RoleViewSwitcher roles={roles} activeRole={activeRole} comparing={comparing} setComparing={setComparing} setRoleView={setRoleView} />
            </div>
          )}
      {/* The sub-tab strip belongs to the compact layout only; the other layouts show
          every section at once, so tabs would have nothing to switch. */}
      {!comparing && (activeRole?.view || DEFAULT_ROLE_VIEW) === 'compact' && (
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="flex gap-1.5 border-b-2 border-[var(--border)] mb-6 overflow-x-auto pb-0 tab-nav">
        {subTabs.map((key) => (
          <button key={key} data-subtab={key} onClick={() => setActiveSubTab(key)} className={`inline-flex items-center gap-2 h-10 px-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${activeSubTab === key ? 'active border-[var(--accent)] text-[var(--accent)]' : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}>
            <Icon name={key === 'links' ? 'link' : key === 'resume' ? 'fileText' : 'tag'} size="16" /> {getSubTabLabel(key)}
            {key === 'links' && roleLinkCount(activeRole) > 0 && <span className="ml-1.5 text-[var(--text-muted)]">{roleLinkCount(activeRole)}</span>}
            {key === 'custom' && customNames.length > 0 && <span className="ml-1.5 text-[var(--text-muted)]">{customNames.length}</span>}
          </button>
        ))}
      </motion.div>
      )}

      {/* The active role's saved layout decides what the page body is. `key` carries
          the role, the layout and (for compact) the sub-tab, so every switch is a
          clean re-mount and no previous role's values can linger on screen.
          Example: role r2 in table view -> key "r2-table". */}
      <motion.div
        key={comparing ? 'all-roles' : `${activeRole?.id}-${activeRole?.view || DEFAULT_ROLE_VIEW}-${activeSubTab}`}
        className="panel-container"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        {comparing ? (
          <RoleComparisonView roles={roles} />
        ) : (activeRole?.view || DEFAULT_ROLE_VIEW) === 'detailed' ? (
          <RoleDetailedView
            role={activeRole}
            addLink={addLink} editingLink={editingLink} setEditingLink={setEditingLink}
            editLabel={editLabel} setEditLabel={setEditLabel} editUrl={editUrl} setEditUrl={setEditUrl}
            updateLink={updateLink} removeLink={removeLink}
            setResume={setResume} handleDownload={handleDownload} handleFileChange={handleFileChange} fileError={fileError}
            customFields={customFields} customNames={customNames}
            showCustomInput={showCustomInput} customName={customName} setCustomName={setCustomName}
            setShowCustomInput={setShowCustomInput} updateCustomField={updateCustomField}
            addCustomField={addCustomField} addCustomFieldNamed={addCustomFieldNamed}
          />
        ) : (activeRole?.view || DEFAULT_ROLE_VIEW) === 'table' ? (
          <RoleTableView
            role={activeRole}
            customFields={customFields} customNames={customNames}
            updateCustomField={updateCustomField} addCustomFieldNamed={addCustomFieldNamed}
            addLink={addLink} removeLink={removeLink}
            setResume={setResume} handleDownload={handleDownload} handleFileChange={handleFileChange} fileError={fileError}
          />
        ) : (
          <>
            {activeSubTab === 'links' && (
              <CompanyLinks role={activeRole} addLink={addLink} editingLink={editingLink} setEditingLink={setEditingLink} editLabel={editLabel} setEditLabel={setEditLabel} editUrl={editUrl} setEditUrl={setEditUrl} updateLink={updateLink} removeLink={removeLink} />
            )}
            {activeSubTab === 'resume' && (
              <CompanyResume role={activeRole} setResume={setResume} handleDownload={handleDownload} handleFileChange={handleFileChange} fileError={fileError} />
            )}
            {activeSubTab === 'custom' && (
              <CompanyCustom customFields={customFields} customNames={customNames} showCustomInput={showCustomInput} customName={customName} setCustomName={setCustomName} setShowCustomInput={setShowCustomInput} updateCustomField={updateCustomField} addCustomField={addCustomField} addCustomFieldNamed={addCustomFieldNamed} />
            )}
          </>
        )}
      </motion.div>
        </div>
      </div>

    </div>
  )
}

// The provider stack and routes that used to live here now sit in app/layout.jsx,
// app/providers.jsx and the app/ route files, which is how Next expresses them.
