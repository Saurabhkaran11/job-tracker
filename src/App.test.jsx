/**
 * One consolidated suite covering every use case in the job tracker.
 *
 * Everything is driven through the rendered UI rather than internal state, so a test
 * passing means a user could actually do that thing. `localStorage` is the app's
 * source of truth, so most assertions read it back after the interaction.
 *
 * Example of the shape used throughout:
 *   seed([company({ name: 'Stripe' })])   // put data in localStorage
 *   await mount('/')                          // mount at a route
 *   await user.click(screen.getByRole('button', { name: /add/i }))
 *   expect(stored()[0].name).toBe('Stripe')
 */
import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { HomePage, CompanyPage, ThemeModeProvider, ToastProvider } from './App'
import { queryClient } from './queryClient'

/**
 * Next owns routing now, so there is no router to render around the app. The two
 * hooks the pages consume are mocked against a single mutable route, and mount()
 * picks the page component the way the app/ folder would.
 * Example: mount('/company/c1') -> route.id = 'c1', renders <CompanyPage />
 */
const route = { id: null }
const routerBack = vi.fn()

vi.mock('next/navigation', () => ({
  useParams: () => ({ id: route.id }),
  useRouter: () => ({ back: routerBack, push: vi.fn(), replace: vi.fn() }),
  usePathname: () => (route.id ? `/company/${route.id}` : '/'),
}))

// next/link renders an anchor; the test double also records any click that reaches it
// with its default intact, which is how "this control must not navigate" is asserted.
const navigations = []
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }) => (
    <a
      href={href}
      onClick={(e) => { e.preventDefault(); navigations.push(href) }}
      {...rest}
    >
      {children}
    </a>
  ),
}))

const STORAGE_KEY = 'job-tracker-data'

/** Read the app's persisted state. Example: stored()[0].customFields.Status */
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')

/** Write state before mounting. Example: seed([company({ name: 'Figma' })]) */
const seed = (companies) => localStorage.setItem(STORAGE_KEY, JSON.stringify(companies))

/**
 * Toggles now live on a role, and records seeded in the legacy shape are migrated on
 * read, so tests go through this rather than reaching for customFields directly.
 * Example: fieldsOf(stored()[0]).Status
 */
const fieldsOf = (c, roleIndex = 0) => c?.roles?.[roleIndex]?.customFields ?? c?.customFields ?? {}
const rolesOf = (c) => c?.roles ?? []

/**
 * The roles section has two presentations. In the rail every role is a visible row, so
 * role assertions read directly; in the toolbar they live behind a dropdown. Tests
 * about roles themselves use the rail; the toolbar has its own block below.
 * Example: useRail(); await mount('/company/c1')
 */
const useRail = () => localStorage.setItem('job-tracker-roles-layout', 'rail')
/** Links and the resume also live on a role now, with legacy records migrated on read. */
const linksOf = (c, roleIndex = 0) => c?.roles?.[roleIndex]?.links ?? c?.links ?? []
const resumeOf = (c, roleIndex = 0) => c?.roles?.[roleIndex]?.resume ?? c?.resume ?? null

/** Build a company, overriding only what a test cares about. */
const company = (over = {}) => ({
  id: 'c1', name: 'Anthropic', links: [], resume: null, customFields: {}, ...over,
})

/**
 * Mount the app at a route and wait for it to be ready to assert against.
 *
 * The company list comes from TanStack Query, which resolves its queryFn
 * asynchronously even though loadCompanies() is synchronous. Without the wait, the
 * first render shows an empty list and every assertion races it.
 * Example: await mount('/company/c1')
 */
function AppUnderTest({ path }) {
  const isCompany = path.startsWith('/company/')
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeModeProvider>
        <ToastProvider>
          {isCompany ? <CompanyPage /> : <HomePage />}
        </ToastProvider>
      </ThemeModeProvider>
    </QueryClientProvider>
  )
}

async function mount(path = '/') {
  route.id = path.startsWith('/company/') ? path.slice('/company/'.length) : null
  navigations.length = 0
  window.history.pushState({}, '', path)
  const result = render(<AppUnderTest path={path} />)
  await waitFor(() => expect(queryClient.getQueryData(['companies'])).toBeDefined())
  return result
}

/** The sub-tab strip on the company page. */
const tabStrip = () => document.querySelector('.tab-nav')
const tabNames = () => [...tabStrip().querySelectorAll('button')].map((b) => b.dataset.subtab)
/** Opens a tab by its key: 'links' | 'resume' | 'custom'. */
const openTab = async (user, key) => {
  await user.click(tabStrip().querySelector(`[data-subtab="${key}"]`))
}
/**
 * Fields no longer have a tab each; they live in the Fields panel. This opens that
 * panel and hands back the control for one field.
 * Example: const el = await fieldControl(user, 'Status')
 */
const fieldControl = async (user, name) => {
  await openTab(user, 'custom')
  return waitFor(() => {
    const row = [...panel().querySelectorAll('div')].find(
      (d) => d.firstElementChild?.textContent?.replace(/:$/, '').trim() === name,
    )
    const el = row?.querySelector('input, textarea, [role="combobox"]')
    expect(el, `control for ${name}`).toBeTruthy()
    return el
  })
}
/** The currently rendered panel, for scoping queries. */
const panel = () => document.querySelector('.panel-container')

/** The one combined add/search box on the dashboard. */
const searchBox = () => screen.getByPlaceholderText(/add or search companies/i)

// ---------------------------------------------------------------------------
describe('dashboard — adding companies', () => {
  it('adds a company by clicking Add', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.type(searchBox(), 'Stripe')
    await user.click(screen.getByRole('button', { name: /^add$/i }))
    await waitFor(() => expect(stored().map((c) => c.name)).toEqual(['Stripe']))
  })

  it('adds a company by pressing Enter', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.type(searchBox(), 'Linear{Enter}')
    await waitFor(() => expect(stored().map((c) => c.name)).toEqual(['Linear']))
  })

  it('clears the box after a successful add', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.type(searchBox(), 'Figma{Enter}')
    await waitFor(() => expect(searchBox()).toHaveValue(''))
  })

  it('rejects a duplicate name, case-insensitively', async () => {
    const user = userEvent.setup()
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.type(searchBox(), 'anthropic{Enter}')
    await screen.findByText(/already exists/i)
    expect(stored()).toHaveLength(1)
  })

  it('rejects an empty or whitespace-only name', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.type(searchBox(), '   {Enter}')
    await screen.findByText(/1-100 characters/i)
    expect(stored()).toHaveLength(0)
  })

  it('renders both the search icon and the Add button', async () => {
    await mount('/')
    expect(screen.getByRole('button', { name: /^add$/i })).toBeInTheDocument()
    expect(document.querySelector('form svg')).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
describe('dashboard — searching', () => {
  it('filters the list as you type', async () => {
    const user = userEvent.setup()
    seed([
      company({ id: 'c1', name: 'Anthropic' }),
      company({ id: 'c2', name: 'Stripe' }),
    ])
    await mount('/')
    await user.type(searchBox(), 'Strip')
    // The Job Links Tracker table always lists every company; it is the card grid
    // below it that the query filters, so scope the assertion there.
    const grid = () => document.querySelector('.card-grid-perspective')
    await waitFor(() => {
      expect(grid()).toBeTruthy()
      expect(grid().textContent).toContain('Stripe')
      expect(grid().textContent).not.toContain('Anthropic')
    })
  })

  it('shows an empty message when nothing matches', async () => {
    const user = userEvent.setup()
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.type(searchBox(), 'zzzz')
    expect(await screen.findByText(/no matching companies/i)).toBeInTheDocument()
  })

  it('searching never deletes anything', async () => {
    const user = userEvent.setup()
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.type(searchBox(), 'zzzz')
    expect(stored()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
describe('dashboard — deleting companies', () => {
  it('deletes after the confirm prompt is accepted', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed([company({ id: 'c1', name: 'Anthropic' }), company({ id: 'c2', name: 'Stripe' })])
    await mount('/')
    await user.click(screen.getByRole('button', { name: 'Remove Stripe' }))
    await waitFor(() => expect(stored().map((c) => c.name)).toEqual(['Anthropic']))
  })

  it('keeps the company when the confirm prompt is cancelled', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.click(screen.getByRole('button', { name: 'Remove Anthropic' }))
    expect(stored()).toHaveLength(1)
  })

  it('does not navigate into the company when the bin is clicked', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed([company({ id: 'c1', name: 'Anthropic' })])
    await mount('/')
    await user.click(screen.getByRole('button', { name: 'Remove Anthropic' }))
    expect(navigations).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
describe('dashboard — sample data and the Status / Priority columns', () => {
  it('offers sample data only on an empty tracker', async () => {
    await mount('/')
    expect(screen.getByRole('button', { name: /load sample data/i })).toBeInTheDocument()
  })

  it('hides the sample button once companies exist', async () => {
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    // Wait for the seeded company to actually paint first: until the query settles the
    // list is legitimately empty and the button is legitimately shown.
    await screen.findAllByText('Anthropic')
    await waitFor(() => expect(screen.queryByRole('button', { name: /load sample data/i })).toBeNull())
  })

  it('loads sample companies covering every toggle type', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(screen.getByRole('button', { name: /load sample data/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(0))
    const names = stored().map((c) => c.name)
    expect(names).toContain('Anthropic')
    const anthropic = stored().find((c) => c.name === 'Anthropic')
    expect(fieldsOf(anthropic)).toMatchObject({
      Status: 'Offer',
      Priority: 'High',
      'Applied Date': '2026-08-14',
      'Contact Email': expect.stringContaining('@'),
      'Portal Login': expect.stringContaining('http'),
    })
  })

  it('includes a company with no custom fields, to exercise the empty path', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(screen.getByRole('button', { name: /load sample data/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(0))
    expect(stored().some((c) => Object.keys(fieldsOf(c)).length === 0)).toBe(true)
  })

  it('shows Status and Priority column headers', async () => {
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    const header = await waitFor(() => {
      const el = document.querySelector('.grid.grid-cols-12')
      expect(el).toBeTruthy()
      return el
    })
    expect(header.textContent).toMatch(/Status/)
    expect(header.textContent).toMatch(/Priority/)
  })

  it('renders the Status and Priority values in the table', async () => {
    seed([company({ name: 'Anthropic', customFields: { Status: 'Offer', Priority: 'High' } })])
    await mount('/')
    expect((await screen.findAllByText('Offer')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('High').length).toBeGreaterThan(0)
  })

  it('shows a dash when Status and Priority are unset', async () => {
    seed([company({ name: 'Anthropic', customFields: {} })])
    await mount('/')
    await screen.findAllByText('Anthropic')
    const dashes = [...document.querySelectorAll('span')].filter((el) => el.textContent === '\u2014')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })
})

// ---------------------------------------------------------------------------
describe('dashboard — Job Links Tracker toggle and card styles', () => {
  const trackerToggle = () =>
    screen.getByRole('button', { name: /(hide|show) job links tracker/i })
  const trackerTable = () =>
    [...document.querySelectorAll('div')].find((d) => d.textContent.trim().startsWith('Job Links Tracker'))

  it('shows the tracker table by default', async () => {
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    expect(await screen.findByText('Job Links Tracker')).toBeInTheDocument()
  })

  it('hides the tracker table when toggled off', async () => {
    const user = userEvent.setup()
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.click(trackerToggle())
    await waitFor(() => expect(screen.queryByText('Job Links Tracker')).toBeNull())
  })

  it('brings the tracker table back when toggled on again', async () => {
    const user = userEvent.setup()
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.click(trackerToggle())
    await waitFor(() => expect(screen.queryByText('Job Links Tracker')).toBeNull())
    await user.click(trackerToggle())
    expect(await screen.findByText('Job Links Tracker')).toBeInTheDocument()
  })

  it('leaves the company cards visible while the tracker is hidden', async () => {
    const user = userEvent.setup()
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await user.click(trackerToggle())
    await waitFor(() => expect(screen.queryByText('Job Links Tracker')).toBeNull())
    expect(document.querySelector('.card-grid-perspective').textContent).toContain('Anthropic')
    expect(trackerTable()).toBeFalsy()
  })

  it('offers exactly two card styles', async () => {
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await screen.findAllByText('Anthropic')
    expect(screen.getByRole('button', { name: /compact/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /detailed/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^default$/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /^featured$/i })).toBeNull()
  })

  it('starts on the compact style', async () => {
    seed([company({ name: 'Anthropic' })])
    await mount('/')
    await waitFor(() => expect(document.querySelector('.card-compact')).toBeTruthy())
  })

  it('switches to the detailed style, which keeps the old featured look', async () => {
    const user = userEvent.setup()
    seed([company({
      name: 'Anthropic',
      links: [{ id: 'l1', label: 'Careers', url: 'https://example.com' }],
      resume: { name: 'cv.pdf' },
    })])
    await mount('/')
    await screen.findAllByText('Anthropic')
    await user.click(screen.getByRole('button', { name: /detailed/i }))
    await waitFor(() => expect(document.querySelector('.card-featured')).toBeTruthy())
    // the merged style keeps featured's corner dots, its resume block and the
    // link preview chips that both old styles rendered
    expect(document.querySelectorAll('.magnetic-dot').length).toBe(3)
    expect(document.body.textContent).toContain('Careers')
    expect(document.body.textContent).toContain('cv.pdf')
  })

  it('shows the resume on the compact style too', async () => {
    seed([company({ name: 'Anthropic', resume: { name: 'cv.pdf' } })])
    await mount('/')
    await screen.findAllByText('Anthropic')
    expect(document.querySelector('.card-grid-perspective').textContent).toContain('cv.pdf')
  })
})

// ---------------------------------------------------------------------------
describe('dashboard — dark mode', () => {
  const themeToggle = () => screen.getByRole('button', { name: /switch to (light|dark) mode/i })

  it('starts in light mode and offers a dark-mode switch', async () => {
    await mount('/')
    expect(document.documentElement).not.toHaveClass('dark')
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument()
  })

  it('switches to dark mode', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(themeToggle())
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
  })

  it('switches back to light mode', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(themeToggle())
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    await user.click(themeToggle())
    await waitFor(() => expect(document.documentElement).not.toHaveClass('dark'))
  })

  it('remembers the choice', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(themeToggle())
    await waitFor(() => expect(localStorage.getItem('job-tracker-theme')).toBe('dark'))
  })

  it('restores a saved dark preference on load', async () => {
    localStorage.setItem('job-tracker-theme', 'dark')
    await mount('/')
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'))
    expect(screen.getByRole('button', { name: /switch to light mode/i })).toBeInTheDocument()
  })

  it('is available on an empty tracker', async () => {
    await mount('/')
    expect(screen.getByRole('button', { name: /switch to dark mode/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
describe('dashboard — sample data panel', () => {
  const samplesToggle = () => screen.getByRole('button', { name: /show sample data for every feature/i })

  it('offers the sample-data icon even with no companies', async () => {
    await mount('/')
    expect(samplesToggle()).toBeInTheDocument()
  })

  it('is hidden until the icon is clicked', async () => {
    await mount('/')
    expect(screen.queryByText(/sample data for every feature/i)).toBeNull()
  })

  it('opens a panel listing every feature with its sample', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(samplesToggle())
    expect(await screen.findByText(/sample data for every feature/i)).toBeInTheDocument()
    // getAllByText: some names, such as "Dark mode", are also the label of the
    // dashboard button that the panel row describes.
    for (const feature of ['Status column', 'Priority column', 'Applied Date', 'Portal Login', 'Contact Email', 'Notes', 'Dark mode', 'Card styles']) {
      expect(screen.getAllByText(feature).length, feature).toBeGreaterThan(0)
    }
  })

  it('shows the actual sample values, not placeholders', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(samplesToggle())
    await screen.findByText(/sample data for every feature/i)
    const text = document.body.textContent
    expect(text).toContain('2026-08-14')
    expect(text).toContain('Product Engineer')
    expect(text).toContain('sam.okafor@example.com')
  })

  it('loads the sample data from inside the panel', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(samplesToggle())
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(0))
    expect(fieldsOf(stored().find((c) => c.name === 'Anthropic')).Status).toBe('Offer')
  })

  it('closes after loading', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(samplesToggle())
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(screen.queryByText(/sample data for every feature/i)).toBeNull())
  })

  it('closes from the close button without loading anything', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(samplesToggle())
    await screen.findByText(/sample data for every feature/i)
    await user.click(screen.getByRole('button', { name: /close sample data/i }))
    await waitFor(() => expect(screen.queryByText(/sample data for every feature/i)).toBeNull())
    expect(stored()).toHaveLength(0)
  })

  it('describes a sample for every preset toggle', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(samplesToggle())
    await screen.findByText(/sample data for every feature/i)
    for (const t of ['Status', 'Priority', 'Applied Date', 'Interview Date', 'Offer Deadline', 'Role', 'Location', 'Salary', 'Recruiter', 'Referral', 'Contact Email', 'Portal Login', 'Next Step', 'Notes']) {
      expect(screen.getAllByText(t).length, t).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
describe('company page — routing and tabs', () => {
  it('shows a not-found message for an unknown id', async () => {
    await mount('/company/does-not-exist')
    expect(await screen.findByText(/company not found/i)).toBeInTheDocument()
  })

  it('renders a tab per custom field plus the fixed tabs', async () => {
    seed([company({ id: 'c1', customFields: { Recruiter: 'Sam', Salary: '180k' } })])
    await mount('/company/c1')
    await waitFor(() => expect(tabStrip()).toBeTruthy())
    expect(tabNames()).toEqual(['links', 'resume', 'custom'])
  })

  it('switches to every tab, not just the first', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', customFields: { Recruiter: 'Sam' } })])
    await mount('/company/c1')

    await openTab(user, 'resume')
    await waitFor(() => expect(panel().textContent).toMatch(/Upload Resume/i))

    await openTab(user, 'custom')
    await waitFor(() => expect(panel().textContent).toMatch(/Recruiter/))

    await openTab(user, 'links')
    await waitFor(() => expect(panel().textContent).toMatch(/Add Link/i))
  })

  it('survives repeated tab switching', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    for (let i = 0; i < 3; i++) {
      await openTab(user, 'resume')
      await waitFor(() => expect(panel().textContent).toMatch(/Upload Resume/i))
      await openTab(user, 'links')
      await waitFor(() => expect(panel().textContent).toMatch(/Add Link/i))
    }
  })

  it('does not render Company Status or Quick Notes at the bottom', async () => {
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    // Prove the page rendered before asserting these blocks are absent from it,
    // otherwise the assertion would pass against a blank page.
    await waitFor(() => expect(tabStrip()).toBeTruthy())
    expect(screen.queryByText(/company status/i)).toBeNull()
    expect(screen.queryByText(/quick notes/i)).toBeNull()
  })

  it('does not render the per-panel note cards', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', links: [{ id: 'l1', label: 'Careers', url: 'https://example.com' }] })])
    await mount('/company/c1')
    await waitFor(() => expect(tabStrip()).toBeTruthy())
    expect(screen.queryByText(/link summary/i)).toBeNull()
    await openTab(user, 'resume')
    await waitFor(() => expect(screen.queryByText(/resume note/i)).toBeNull())
    await openTab(user, 'custom')
    await waitFor(() => expect(screen.queryByText(/custom fields note/i)).toBeNull())
  })
})

// ---------------------------------------------------------------------------
describe('company page — links', () => {
  it('adds a link and clears both inputs', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await user.type(screen.getByLabelText(/job title/i), 'Backend Engineer')
    await user.type(screen.getByLabelText(/https/i), 'https://example.com/job')
    await user.click(screen.getByRole('button', { name: /add link/i }))
    await waitFor(() => expect(linksOf(stored()[0])).toHaveLength(1))
    expect(linksOf(stored()[0])[0]).toMatchObject({ label: 'Backend Engineer', url: 'https://example.com/job' })
    await waitFor(() => expect(screen.getByLabelText(/job title/i)).toHaveValue(''))
  })

  it('rejects an invalid URL and saves nothing', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await user.type(screen.getByLabelText(/job title/i), 'Bad')
    await user.type(screen.getByLabelText(/https/i), 'not a url')
    await user.click(screen.getByRole('button', { name: /add link/i }))
    expect(await screen.findByText(/invalid url/i)).toBeInTheDocument()
    expect(linksOf(stored()[0])).toHaveLength(0)
  })

  it('prefixes a bare domain with https://', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await user.type(screen.getByLabelText(/job title/i), 'Careers')
    await user.type(screen.getByLabelText(/https/i), 'https://example.com')
    await user.click(screen.getByRole('button', { name: /add link/i }))
    await waitFor(() => expect(linksOf(stored()[0])[0].url).toMatch(/^https:\/\//))
  })

  it('removes a link', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', links: [{ id: 'l1', label: 'Careers', url: 'https://example.com' }] })])
    await mount('/company/c1')
    const binBtns = [...panel().querySelectorAll('button')].filter((b) => !b.textContent.trim())
    await user.click(binBtns[binBtns.length - 1])
    await waitFor(() => expect(linksOf(stored()[0])).toHaveLength(0))
  })
})

// ---------------------------------------------------------------------------
describe('company page — custom field toggles', () => {
  const openCustom = async (user) => {
    await openTab(user, 'custom')
    await waitFor(() => expect(panel().textContent).toMatch(/Quick add|Add your own toggle/i))
  }
  const chip = (name) =>
    [...panel().querySelectorAll('button')].find((b) => b.textContent.trim() === name)

  it('offers the preset toggles as quick-add chips', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await openCustom(user)
    for (const name of ['Status', 'Priority', 'Applied Date', 'Referral', 'Portal Login', 'Notes']) {
      expect(chip(name), `${name} chip`).toBeTruthy()
    }
  })

  it('hides presets the company already has', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', customFields: { Salary: '180k' } })])
    await mount('/company/c1')
    await openCustom(user)
    expect(chip('Salary')).toBeFalsy()
    expect(chip('Role')).toBeTruthy()
  })

  it('adds a preset, creates its tab and opens it', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await openCustom(user)
    await user.click(chip('Salary'))
    await waitFor(() => expect(fieldsOf(stored()[0])).toHaveProperty('Salary', ''))
    expect(panel().textContent).toContain('Salary')
  })

  it('adds a toggle typed by hand', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await openCustom(user)
    await user.click(screen.getByRole('button', { name: /add your own toggle/i }))
    const nameBox = await screen.findByPlaceholderText(/toggle name/i)
    await user.type(nameBox, 'Visa Sponsorship{Enter}')
    await waitFor(() => expect(fieldsOf(stored()[0])).toHaveProperty('Visa Sponsorship', ''))
  })

  it('warns instead of overwriting an existing toggle', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', customFields: { Salary: '180k' } })])
    await mount('/company/c1')
    await openCustom(user)
    await user.click(screen.getByRole('button', { name: /add your own toggle/i }))
    const nameBox = await screen.findByPlaceholderText(/toggle name/i)
    await user.type(nameBox, 'Salary{Enter}')
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(fieldsOf(stored()[0]).Salary).toBe('180k')
  })

  it('persists a typed value', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', customFields: { Salary: '' } })])
    await mount('/company/c1')
    const box = await fieldControl(user, 'Salary')
    await user.type(box, '180k')
    await waitFor(() => expect(fieldsOf(stored()[0]).Salary).toBe('180k'))
  })
})

// ---------------------------------------------------------------------------
describe('company page — each toggle renders its own field type', () => {
  /** Mount with one custom field and hand back the control that field rendered. */
  const fieldFor = async (name) => {
    seed([company({ id: 'c1', customFields: { [name]: '' } })])
    await mount('/company/c1')
    const user = userEvent.setup()
    return fieldControl(user, name)
  }

  it('Status renders a dropdown', async () => {
    const el = await fieldFor('Status')
    expect(el.getAttribute('role')).toBe('combobox')
  })

  it('Priority renders a dropdown', async () => {
    const el = await fieldFor('Priority')
    expect(el.getAttribute('role')).toBe('combobox')
  })

  it('Applied Date renders a date picker', async () => {
    const el = await fieldFor('Applied Date')
    expect(el).toHaveAttribute('type', 'date')
  })

  it('Interview Date renders a date picker', async () => {
    const el = await fieldFor('Interview Date')
    expect(el).toHaveAttribute('type', 'date')
  })

  it('Offer Deadline renders a date picker', async () => {
    const el = await fieldFor('Offer Deadline')
    expect(el).toHaveAttribute('type', 'date')
  })

  it('Contact Email renders an email input', async () => {
    const el = await fieldFor('Contact Email')
    expect(el).toHaveAttribute('type', 'email')
  })

  it('Portal Login renders a url input', async () => {
    const el = await fieldFor('Portal Login')
    expect(el).toHaveAttribute('type', 'url')
  })

  it('Notes renders a multi-line box', async () => {
    const el = await fieldFor('Notes')
    expect(el.tagName.toLowerCase()).toBe('textarea')
  })

  it('Next Step renders a multi-line box', async () => {
    const el = await fieldFor('Next Step')
    expect(el.tagName.toLowerCase()).toBe('textarea')
  })

  it('Referral renders a plain text input', async () => {
    const el = await fieldFor('Referral')
    expect(el).toHaveAttribute('type', 'text')
  })

  it('a name with no preset falls back to plain text', async () => {
    const el = await fieldFor('Visa Sponsorship')
    expect(el).toHaveAttribute('type', 'text')
  })

  it('the Status dropdown offers every documented option', async () => {
    const user = userEvent.setup()
    const el = await fieldFor('Status')
    await user.click(el)
    const options = await screen.findAllByRole('option')
    const labels = options.map((o) => o.textContent.trim())
    for (const opt of ['Applied', 'Phone Screen', 'Interviewing', 'Take-home', 'Offer', 'Rejected', 'On Hold']) {
      expect(labels, opt).toContain(opt)
    }
  })

  it('choosing a Status option persists it', async () => {
    const user = userEvent.setup()
    const el = await fieldFor('Status')
    await user.click(el)
    await user.click(await screen.findByRole('option', { name: 'Offer' }))
    await waitFor(() => expect(fieldsOf(stored()[0]).Status).toBe('Offer'))
  })
})

// ---------------------------------------------------------------------------
describe('resume upload', () => {
  const openResume = async (user) => {
    await openTab(user, 'resume')
    await waitFor(() => expect(panel().textContent).toMatch(/Upload Resume/i))
  }

  it('renders a reachable file input, not one buried in a button', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await openResume(user)
    const input = panel().querySelector('input[type="file"]')
    expect(input).toBeTruthy()
    // The regression: the input used to sit inside a <button>, which swallows the
    // click, so the picker never opened and upload was completely dead.
    expect(input.closest('button')).toBeNull()
    expect(input.closest('label')).toBeTruthy()
  })

  it('accepts a file and stores it on the company', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await openResume(user)
    const file = new File(['cv contents'], 'karan-cv.pdf', { type: 'application/pdf' })
    await user.upload(panel().querySelector('input[type="file"]'), file)
    await waitFor(() => expect(resumeOf(stored()[0])).toBeTruthy())
    expect(resumeOf(stored()[0]).name).toBe('karan-cv.pdf')
  })

  it('shows the uploaded file with download and remove controls', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', resume: { name: 'cv.pdf', dataUrl: 'data:application/pdf;base64,AA==' } })])
    await mount('/company/c1')
    // openResume() waits for the upload prompt, which is replaced by the file row
    // once a resume exists, so this case waits for the file name instead.
    await openTab(user, 'resume')
    await waitFor(() => expect(panel().textContent).toMatch(/cv\.pdf/))
    expect(panel().textContent).toContain('cv.pdf')
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
  })

  it('rejects a file over the 2 MB ceiling', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    await mount('/company/c1')
    await openResume(user)
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 10)], 'huge.pdf', { type: 'application/pdf' })
    await user.upload(panel().querySelector('input[type="file"]'), big)
    expect(await screen.findByText(/max 2 mb/i)).toBeInTheDocument()
    expect(resumeOf(stored()[0])).toBeNull()
  })

  it('shows the link count on the Links tab', async () => {
    seed([company({ id: 'c1', links: [{ id: 'l1', url: 'https://a.com' }, { id: 'l2', url: 'https://b.com' }] })])
    await mount('/company/c1')
    await waitFor(() => expect(tabStrip()).toBeTruthy())
    expect(tabStrip().querySelector('[data-subtab="links"]').textContent).toContain('2')
  })
})

// ---------------------------------------------------------------------------
describe('several roles at the same company', () => {
  const roleStrip = () => screen.getByTestId('role-strip')
  const roleNames = () =>
    [...roleStrip().querySelectorAll('[data-role-chip]')].map((el) => el.getAttribute('data-role-chip'))

  it('gives a legacy company one migrated role', async () => {
    seed([{ id: 'c1', name: 'Anthropic', links: [], resume: null, customFields: { Recruiter: 'Sam', Role: 'Product Engineer' } }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(roleNames()).toEqual(['Product Engineer'])
  })

  it('names a role-less legacy company sensibly', async () => {
    seed([{ id: 'c1', name: 'Anthropic', links: [], resume: null, customFields: {} }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(roleNames()).toEqual(['General application'])
  })

  it('adds a second role', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1' })])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /add role/i }))
    await user.type(await screen.findByPlaceholderText(/role title/i), 'Research Engineer{Enter}')
    await waitFor(() => expect(rolesOf(stored()[0])).toHaveLength(2))
    expect(roleNames()).toContain('Research Engineer')
  })

  it('keeps a separate recruiter per role — the reported bug', async () => {
    const user = userEvent.setup()
    seed([{
      id: 'c1', name: 'Anthropic', links: [], resume: null,
      roles: [
        { id: 'r1', title: 'Product Engineer', customFields: { Recruiter: 'Sam Okafor' } },
        { id: 'r2', title: 'Research Engineer', customFields: { Recruiter: 'Dana Whitfield' } },
      ],
    }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())

    expect((await fieldControl(user, 'Recruiter')).value).toBe('Sam Okafor')

    await user.click(roleStrip().querySelector('[data-role-chip="Research Engineer"]').querySelector('button'))
    await waitFor(async () => expect((await fieldControl(user, 'Recruiter')).value).toBe('Dana Whitfield'))

    // writing to one role must not touch the other
    expect(fieldsOf(stored()[0], 0).Recruiter).toBe('Sam Okafor')
    expect(fieldsOf(stored()[0], 1).Recruiter).toBe('Dana Whitfield')
  })

  it('adds a toggle to the selected role only', async () => {
    const user = userEvent.setup()
    seed([{
      id: 'c1', name: 'Anthropic', links: [], resume: null,
      roles: [
        { id: 'r1', title: 'Role A', customFields: {} },
        { id: 'r2', title: 'Role B', customFields: {} },
      ],
    }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await user.click(roleStrip().querySelector('[data-role-chip="Role B"]').querySelector('button'))
    await openTab(user, 'custom')
    await waitFor(() => expect(panel().textContent).toMatch(/Quick add/i))
    await user.click([...panel().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Salary'))
    await waitFor(() => expect(fieldsOf(stored()[0], 1)).toHaveProperty('Salary'))
    expect(fieldsOf(stored()[0], 0)).not.toHaveProperty('Salary')
  })

  it('rejects a duplicate role title', async () => {
    const user = userEvent.setup()
    seed([{ id: 'c1', name: 'Anthropic', links: [], resume: null, roles: [{ id: 'r1', title: 'Product Engineer', customFields: {} }] }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /add role/i }))
    await user.type(await screen.findByPlaceholderText(/role title/i), 'product engineer{Enter}')
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument()
    expect(rolesOf(stored()[0])).toHaveLength(1)
  })

  it('removes a role once there is more than one', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    seed([{
      id: 'c1', name: 'Anthropic', links: [], resume: null,
      roles: [
        { id: 'r1', title: 'Role A', customFields: {} },
        { id: 'r2', title: 'Role B', customFields: {} },
      ],
    }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await user.click(screen.getByRole('button', { name: /remove role role b/i }))
    await waitFor(() => expect(rolesOf(stored()[0])).toHaveLength(1))
  })

  it('never lets the last role be removed', async () => {
    seed([company({ id: 'c1' })])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(screen.queryByRole('button', { name: /remove role/i })).toBeNull()
  })

  it('shows one dashboard chip per role', async () => {
    seed([{
      id: 'c1', name: 'Anthropic', links: [], resume: null,
      roles: [
        { id: 'r1', title: 'Role A', customFields: { Status: 'Offer' } },
        { id: 'r2', title: 'Role B', customFields: { Status: 'Interviewing' } },
      ],
    }])
    await mount('/')
    expect((await screen.findAllByText('Offer')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Interviewing').length).toBeGreaterThan(0)
  })

  it('marks a multi-role company on its card', async () => {
    seed([{
      id: 'c1', name: 'Anthropic', links: [], resume: null,
      roles: [
        { id: 'r1', title: 'Role A', customFields: {} },
        { id: 'r2', title: 'Role B', customFields: {} },
      ],
    }])
    await mount('/')
    expect(await screen.findByText('2 roles')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
describe('a saved view per role, plus an all-roles comparison', () => {
  const viewStrip = () => screen.getByTestId('view-strip')
  const roleStrip = () => screen.getByTestId('role-strip')
  const viewBtn = (label) =>
    [...viewStrip().querySelectorAll('button')].find((b) => b.textContent.trim() === label)
  const pickRole = async (user, title) =>
    user.click(roleStrip().querySelector(`[data-role-chip="${title}"]`).querySelector('button'))

  const twoRoles = () => ([{
    id: 'c1', name: 'Anthropic',
    roles: [
      { id: 'r1', title: 'Product Engineer', links: [{ id: 'la', label: 'A posting', url: 'https://a.example.com' }], resume: null, customFields: { Status: 'Offer', Recruiter: 'Sam Okafor' }, view: 'compact' },
      { id: 'r2', title: 'Research Engineer', links: [], resume: null, customFields: { Status: 'Phone Screen', Recruiter: 'Dana Whitfield' }, view: 'compact' },
    ],
  }])

  it('offers the three layouts', async () => {
    seed([company({ id: 'c1' })])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    for (const v of ['Compact', 'Detailed', 'Table']) expect(viewBtn(v), v).toBeTruthy()
  })

  it('starts compact, with the sub-tab strip showing', async () => {
    seed([company({ id: 'c1' })])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    expect(viewBtn('Compact')).toHaveAttribute('aria-pressed', 'true')
    expect(tabStrip()).toBeTruthy()
  })

  it('drops the sub-tabs in the detailed layout and shows every section at once', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', links: [{ id: 'l1', label: 'Careers', url: 'https://x.com' }] })])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('Detailed'))
    await waitFor(() => expect(document.querySelector('.tab-nav')).toBeNull())
    expect(panel().textContent).toContain('Job links')
    expect(panel().textContent).toContain('Resume')
    expect(panel().textContent).toContain('Toggles')
  })

  it('lists every toggle as a row in the table layout', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('Table'))
    await waitFor(() => expect(panel().textContent).toContain('Recruiter'))
    expect(panel().textContent).toContain('Status')
    expect(panel().textContent).toContain('A posting')
  })

  it('saves the layout on the role', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('Table'))
    await waitFor(() => expect(rolesOf(stored()[0])[0].view).toBe('table'))
    expect(rolesOf(stored()[0])[1].view).toBe('compact')
  })

  it('gives each role its own layout — the point of the feature', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())

    await user.click(viewBtn('Table'))
    await waitFor(() => expect(rolesOf(stored()[0])[0].view).toBe('table'))

    await pickRole(user, 'Research Engineer')
    await waitFor(() => expect(viewBtn('Compact')).toHaveAttribute('aria-pressed', 'true'))
    await user.click(viewBtn('Detailed'))
    await waitFor(() => expect(rolesOf(stored()[0])[1].view).toBe('detailed'))

    // going back reinstates the first role's own layout
    await pickRole(user, 'Product Engineer')
    await waitFor(() => expect(viewBtn('Table')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('remembers the layout across a reload', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('Table'))
    await waitFor(() => expect(rolesOf(stored()[0])[0].view).toBe('table'))

    cleanup()
    queryClient.clear()
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewBtn('Table')).toHaveAttribute('aria-pressed', 'true'))
  })

  it('offers All roles only when there is more than one', async () => {
    seed([company({ id: 'c1' })])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    expect(viewBtn('All roles')).toBeFalsy()
  })

  it('compares every role side by side', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('All roles'))
    await waitFor(() => expect(panel().querySelector('table')).toBeTruthy())

    const text = panel().textContent
    // both roles as columns
    expect(text).toContain('Product Engineer')
    expect(text).toContain('Research Engineer')
    // and both their values on the same rows
    expect(text).toContain('Sam Okafor')
    expect(text).toContain('Dana Whitfield')
    expect(text).toContain('Offer')
    expect(text).toContain('Phone Screen')
  })

  it('shows a dash where a role is missing a toggle', async () => {
    const user = userEvent.setup()
    seed([{
      id: 'c1', name: 'Anthropic',
      roles: [
        { id: 'r1', title: 'A', links: [], resume: null, customFields: { Salary: '180k' }, view: 'compact' },
        { id: 'r2', title: 'B', links: [], resume: null, customFields: {}, view: 'compact' },
      ],
    }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('All roles'))
    await waitFor(() => expect(panel().querySelector('table')).toBeTruthy())
    expect(panel().textContent).toContain('180k')
    expect(panel().querySelectorAll('td')).toBeTruthy()
  })

  it('leaves comparison mode when a layout is picked', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('All roles'))
    await waitFor(() => expect(panel().querySelector('table')).toBeTruthy())
    await user.click(viewBtn('Compact'))
    await waitFor(() => expect(panel().querySelector('table')).toBeNull())
    expect(tabStrip()).toBeTruthy()
  })

  it('still edits a toggle from the table layout', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(viewStrip()).toBeTruthy())
    await user.click(viewBtn('Table'))
    await waitFor(() => expect(panel().textContent).toContain('Recruiter'))
    const box = [...panel().querySelectorAll('input')].find((i) => i.value === 'Sam Okafor')
    await user.clear(box)
    await user.type(box, 'Jo Bell')
    await waitFor(() => expect(fieldsOf(stored()[0], 0).Recruiter).toBe('Jo Bell'))
  })
})

// ---------------------------------------------------------------------------
describe('the roles section has two layouts', () => {
  const layoutToggle = () => screen.getByTestId('roles-layout-toggle')
  const layoutBtn = (name) => within(layoutToggle()).getByRole('button', { name: new RegExp(`roles as ${name}`, 'i') })
  const roleStrip = () => screen.getByTestId('role-strip')

  const twoRoles = () => ([{
    id: 'c1', name: 'Anthropic',
    roles: [
      { id: 'r1', title: 'Product Engineer', links: [{ id: 'l1', url: 'https://a.com' }], resume: null, customFields: { Status: 'Offer' }, view: 'compact' },
      { id: 'r2', title: 'Research Engineer', links: [], resume: null, customFields: { Status: 'Phone Screen' }, view: 'compact' },
    ],
  }])

  it('defaults to the toolbar layout', async () => {
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(layoutToggle()).toBeTruthy())
    expect(layoutBtn('toolbar')).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows the current role and its stage in the toolbar picker', async () => {
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(roleStrip().textContent).toContain('Product Engineer')
    expect(roleStrip().textContent).toContain('Offer')
  })

  it('keeps every role out of the way until the picker is opened', async () => {
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(roleStrip().textContent).not.toContain('Research Engineer')
  })

  it('switches role from the toolbar picker', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await user.click(within(roleStrip()).getByRole('combobox'))
    await user.click(await screen.findByRole('option', { name: /Research Engineer/ }))
    await waitFor(() => expect(roleStrip().textContent).toContain('Research Engineer'))
    expect(roleStrip().textContent).toContain('Phone Screen')
  })

  it('switches to the rail, which shows every role at once', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(layoutToggle()).toBeTruthy())
    await user.click(layoutBtn('rail'))
    await waitFor(() => expect(roleStrip().querySelectorAll('[data-role-chip]')).toHaveLength(2))
    expect(roleStrip().textContent).toContain('Product Engineer')
    expect(roleStrip().textContent).toContain('Research Engineer')
  })

  it('shows each role\u2019s stage and link count in the rail', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(layoutToggle()).toBeTruthy())
    await user.click(layoutBtn('rail'))
    await waitFor(() => expect(roleStrip().querySelectorAll('[data-role-chip]')).toHaveLength(2))
    expect(roleStrip().textContent).toContain('Offer')
    expect(roleStrip().textContent).toContain('1 link')
  })

  it('remembers the chosen layout', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(layoutToggle()).toBeTruthy())
    await user.click(layoutBtn('rail'))
    await waitFor(() => expect(localStorage.getItem('job-tracker-roles-layout')).toBe('rail'))

    cleanup()
    queryClient.clear()
    await mount('/company/c1')
    await waitFor(() => expect(layoutBtn('rail')).toHaveAttribute('aria-pressed', 'true'))
    expect(roleStrip().querySelectorAll('[data-role-chip]')).toHaveLength(2)
  })

  it('keeps the view control available in both layouts', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(screen.getByTestId('view-strip')).toBeTruthy())
    await user.click(layoutBtn('rail'))
    await waitFor(() => expect(layoutBtn('rail')).toHaveAttribute('aria-pressed', 'true'))
    expect(screen.getByTestId('view-strip')).toBeTruthy()
  })

  it('renders the same page body in both layouts', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(panel().textContent).toMatch(/Add Link/i))
    await user.click(layoutBtn('rail'))
    await waitFor(() => expect(layoutBtn('rail')).toHaveAttribute('aria-pressed', 'true'))
    expect(panel().textContent).toMatch(/Add Link/i)
  })

  it('reorders from the toolbar picker as well', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await user.click(within(roleStrip()).getByRole('combobox'))
    await screen.findByRole('option', { name: /Research Engineer/ })
    const items = [...document.querySelectorAll('[data-role-chip]')]
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {}, getData() { return '' } }
    fireEvent.dragStart(items[1], { dataTransfer })
    fireEvent.dragOver(items[0], { dataTransfer })
    fireEvent.drop(items[0], { dataTransfer })
    await waitFor(() => expect(rolesOf(stored()[0]).map((r) => r.title)).toEqual(['Research Engineer', 'Product Engineer']))
  })
})

// ---------------------------------------------------------------------------
describe('reordering roles', () => {
  const roleStrip = () => screen.getByTestId('role-strip')
  const chip = (title) => roleStrip().querySelector(`[data-role-chip="${title}"]`)
  const order = () => rolesOf(stored()[0]).map((r) => r.title)
  const onScreenOrder = () =>
    [...roleStrip().querySelectorAll('[data-role-chip]')].map((el) => el.getAttribute('data-role-chip'))

  /** A minimal drag: start on one chip, drop on another. */
  const drag = (fromTitle, toTitle) => {
    const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {}, getData() { return '' } }
    fireEvent.dragStart(chip(fromTitle), { dataTransfer })
    fireEvent.dragOver(chip(toTitle), { dataTransfer })
    fireEvent.drop(chip(toTitle), { dataTransfer })
  }

  const threeRoles = () => ([{
    id: 'c1', name: 'Anthropic',
    roles: [
      { id: 'r1', title: 'Alpha', links: [], resume: null, customFields: {}, view: 'compact' },
      { id: 'r2', title: 'Beta', links: [], resume: null, customFields: {}, view: 'compact' },
      { id: 'r3', title: 'Gamma', links: [], resume: null, customFields: {}, view: 'compact' },
    ],
  }])

  it('marks the chips draggable when there is more than one role', async () => {
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(chip('Alpha')).toHaveAttribute('draggable', 'true')
  })

  it('moves a role forward by dragging', async () => {
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Alpha', 'Gamma')
    await waitFor(() => expect(order()).toEqual(['Beta', 'Gamma', 'Alpha']))
  })

  it('moves a role backward by dragging', async () => {
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Gamma', 'Alpha')
    await waitFor(() => expect(order()).toEqual(['Gamma', 'Alpha', 'Beta']))
  })

  it('repaints the strip in the new order', async () => {
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Gamma', 'Alpha')
    await waitFor(() => expect(onScreenOrder()).toEqual(['Gamma', 'Alpha', 'Beta']))
  })

  it('writes nothing when a role is dropped where it started', async () => {
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Beta', 'Beta')
    await waitFor(() => expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']))
  })

  it('keeps each role\u2019s own data attached to it', async () => {
    seed([{
      id: 'c1', name: 'Anthropic',
      roles: [
        { id: 'r1', title: 'Alpha', links: [{ id: 'l1', url: 'https://a.com' }], resume: null, customFields: { Recruiter: 'Sam' }, view: 'compact' },
        { id: 'r2', title: 'Beta', links: [], resume: null, customFields: { Recruiter: 'Dana' }, view: 'table' },
      ],
    }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Alpha', 'Beta')
    await waitFor(() => expect(order()).toEqual(['Beta', 'Alpha']))
    expect(fieldsOf(stored()[0], 0).Recruiter).toBe('Dana')
    expect(rolesOf(stored()[0])[0].view).toBe('table')
    expect(linksOf(stored()[0], 1)).toHaveLength(1)
  })

  it('moves a role with Alt and the arrow keys', async () => {
    const user = userEvent.setup()
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    const betaBtn = chip('Beta').querySelector('button')
    betaBtn.focus()
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    await waitFor(() => expect(order()).toEqual(['Beta', 'Alpha', 'Gamma']))
    chip('Beta').querySelector('button').focus()
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    await waitFor(() => expect(order()).toEqual(['Alpha', 'Beta', 'Gamma']))
  })

  it('will not move the first role left or the last one right', async () => {
    const user = userEvent.setup()
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    chip('Alpha').querySelector('button').focus()
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}')
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma'])
    chip('Gamma').querySelector('button').focus()
    await user.keyboard('{Alt>}{ArrowRight}{/Alt}')
    expect(order()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('reorders the comparison columns to match', async () => {
    const user = userEvent.setup()
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Gamma', 'Alpha')
    await waitFor(() => expect(order()).toEqual(['Gamma', 'Alpha', 'Beta']))
    const viewStrip = screen.getByTestId('view-strip')
    await user.click([...viewStrip.querySelectorAll('button')].find((b) => b.textContent.trim() === 'All roles'))
    await waitFor(() => expect(panel().querySelector('table')).toBeTruthy())
    const headers = [...panel().querySelectorAll('th')].map((t) => t.textContent.trim())
    expect(headers).toEqual(['Field', 'Gamma', 'Alpha', 'Beta'])
  })

  it('survives a reload', async () => {
    seed(threeRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    drag('Gamma', 'Alpha')
    await waitFor(() => expect(order()).toEqual(['Gamma', 'Alpha', 'Beta']))
    cleanup()
    queryClient.clear()
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(onScreenOrder()).toEqual(['Gamma', 'Alpha', 'Beta']))
  })
})

// ---------------------------------------------------------------------------
describe('the table view', () => {
  const viewStrip = () => screen.getByTestId('view-strip')
  const openTable = async (user) => {
    await user.click([...viewStrip().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Table'))
    await waitFor(() => expect(screen.getByTestId('table-view')).toBeTruthy())
  }
  const table = () => screen.getByTestId('table-view')

  const seedRole = (over = {}) => seed([{
    id: 'c1', name: 'Anthropic',
    roles: [{
      id: 'r1', title: 'Product Engineer', view: 'compact',
      links: [{ id: 'l1', label: 'Careers', url: 'https://example.com/careers' }],
      resume: null,
      customFields: { Status: 'Offer', Recruiter: 'Sam Okafor' },
      ...over,
    }],
  }])

  it('is a real table with a header', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    const headers = [...table().querySelectorAll('th')].map((t) => t.textContent.trim())
    expect(headers).toEqual(['Field', 'Value'])
  })

  it('gives every toggle its own row', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    const fields = [...table().querySelectorAll('tbody tr td:first-child')].map((t) => t.textContent.trim())
    expect(fields).toEqual(['Status', 'Recruiter'])
  })

  it('edits a toggle in place', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    const box = [...table().querySelectorAll('input')].find((i) => i.value === 'Sam Okafor')
    await user.clear(box)
    await user.type(box, 'Jo Bell')
    await waitFor(() => expect(fieldsOf(stored()[0]).Recruiter).toBe('Jo Bell'))
  })

  it('adds a missing field without leaving the view', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.click(within(table()).getByRole('button', { name: '+ Salary' }))
    await waitFor(() => expect(fieldsOf(stored()[0])).toHaveProperty('Salary'))
  })

  it('tells an empty role how to fill itself, rather than pointing elsewhere', async () => {
    const user = userEvent.setup()
    seedRole({ customFields: {} })
    await mount('/company/c1')
    await openTable(user)
    expect(table().textContent).toMatch(/add one below/i)
    expect(table().textContent).not.toMatch(/switch to compact/i)
  })

  it('lists the role\u2019s links with a count', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    expect(table().textContent).toContain('Links (1)')
    expect(table().textContent).toContain('Careers')
  })

  it('adds a link from the table', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.type(within(table()).getByPlaceholderText('Label'), 'Referral')
    await user.type(within(table()).getByPlaceholderText('https://...'), 'https://example.com/ref')
    await user.click(within(table()).getByRole('button', { name: /add link/i }))
    await waitFor(() => expect(linksOf(stored()[0])).toHaveLength(2))
    expect(linksOf(stored()[0])[1]).toMatchObject({ label: 'Referral', url: 'https://example.com/ref' })
  })

  it('prefixes a bare domain', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.type(within(table()).getByPlaceholderText('https://...'), 'example.com/x')
    await user.click(within(table()).getByRole('button', { name: /add link/i }))
    await waitFor(() => expect(linksOf(stored()[0])[1].url).toBe('https://example.com/x'))
  })

  it('rejects an invalid URL and adds nothing', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.type(within(table()).getByPlaceholderText('https://...'), 'not a url')
    await user.click(within(table()).getByRole('button', { name: /add link/i }))
    expect(await screen.findByText(/invalid url/i)).toBeInTheDocument()
    expect(linksOf(stored()[0])).toHaveLength(1)
  })

  it('requires a URL', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.click(within(table()).getByRole('button', { name: /add link/i }))
    expect(await screen.findByText(/enter a url/i)).toBeInTheDocument()
    expect(linksOf(stored()[0])).toHaveLength(1)
  })

  it('removes a link from the table', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.click(within(table()).getByRole('button', { name: /remove link careers/i }))
    await waitFor(() => expect(linksOf(stored()[0])).toHaveLength(0))
  })

  it('offers the resume here too, which it did not before', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    expect(table().textContent).toContain('Resume')
    const input = table().querySelector('input[type="file"]')
    expect(input).toBeTruthy()
    expect(input.closest('button')).toBeNull()
  })

  it('uploads a resume from the table', async () => {
    const user = userEvent.setup()
    seedRole()
    await mount('/company/c1')
    await openTable(user)
    await user.upload(table().querySelector('input[type="file"]'), new File(['cv'], 'table-cv.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(resumeOf(stored()[0])).toBeTruthy())
    expect(resumeOf(stored()[0]).name).toBe('table-cv.pdf')
  })

  it('shows an attached resume with remove', async () => {
    const user = userEvent.setup()
    seedRole({ resume: { name: 'cv.pdf', dataUrl: 'data:application/pdf;base64,AA==' } })
    await mount('/company/c1')
    await openTable(user)
    expect(table().textContent).toContain('cv.pdf')
    await user.click(within(table()).getByRole('button', { name: /remove resume/i }))
    await waitFor(() => expect(resumeOf(stored()[0])).toBeNull())
  })
})

// ---------------------------------------------------------------------------
describe('links and resume are per role', () => {
  const roleStrip = () => screen.getByTestId('role-strip')
  const pickRole = async (user, title) =>
    user.click(roleStrip().querySelector(`[data-role-chip="${title}"]`).querySelector('button'))

  const twoRoles = () => ([{
    id: 'c1', name: 'Anthropic',
    roles: [
      { id: 'r1', title: 'Role A', links: [{ id: 'la', label: 'A posting', url: 'https://a.example.com' }], resume: null, customFields: {} },
      { id: 'r2', title: 'Role B', links: [], resume: null, customFields: {} },
    ],
  }])

  it('migrates legacy company-level links onto the first role', async () => {
    seed([{ id: 'c1', name: 'Anthropic', links: [{ id: 'l1', label: 'Careers', url: 'https://x.com' }], resume: { name: 'cv.pdf' }, customFields: {} }])
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    expect(panel().textContent).toContain('Careers')
  })

  it('shows only the selected role\u2019s links', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await waitFor(() => expect(panel().textContent).toContain('A posting'))
    await pickRole(user, 'Role B')
    await waitFor(() => expect(panel().textContent).not.toContain('A posting'))
  })

  it('adds a link to the selected role only', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await pickRole(user, 'Role B')
    await waitFor(() => expect(screen.getByLabelText(/job title/i)).toBeInTheDocument())
    await user.type(screen.getByLabelText(/job title/i), 'B posting')
    await user.type(screen.getByLabelText(/https/i), 'https://b.example.com')
    await user.click(screen.getByRole('button', { name: /add link/i }))
    await waitFor(() => expect(linksOf(stored()[0], 1)).toHaveLength(1))
    expect(linksOf(stored()[0], 0)).toHaveLength(1)
    expect(linksOf(stored()[0], 0)[0].label).toBe('A posting')
  })

  it('keeps a separate resume per role', async () => {
    const user = userEvent.setup()
    seed(twoRoles())
    useRail(); await mount('/company/c1')
    await waitFor(() => expect(roleStrip()).toBeTruthy())
    await pickRole(user, 'Role B')
    await openTab(user, 'resume')
    await waitFor(() => expect(panel().querySelector('input[type="file"]')).toBeTruthy())
    await user.upload(panel().querySelector('input[type="file"]'), new File(['x'], 'role-b.pdf', { type: 'application/pdf' }))
    await waitFor(() => expect(resumeOf(stored()[0], 1)).toBeTruthy())
    expect(resumeOf(stored()[0], 1).name).toBe('role-b.pdf')
    expect(resumeOf(stored()[0], 0)).toBeNull()
  })

  it('counts links across every role on the dashboard', async () => {
    seed([{
      id: 'c1', name: 'Anthropic',
      roles: [
        { id: 'r1', title: 'A', links: [{ id: 'l1', url: 'https://a.com' }, { id: 'l2', url: 'https://b.com' }], resume: null, customFields: {} },
        { id: 'r2', title: 'B', links: [{ id: 'l3', url: 'https://c.com' }], resume: null, customFields: {} },
      ],
    }])
    await mount('/')
    expect(await screen.findByText(/3 links/i)).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
describe('bulk add — one form fills every section', () => {
  const openBulk = async (user) => {
    await user.click(screen.getByRole('button', { name: /add everything at once/i }))
    await screen.findByText(/add everything at once/i)
  }
  const save = async (user) => user.click(screen.getByRole('button', { name: /save all/i }))

  it('offers the bulk-add toggle on the dashboard', async () => {
    await mount('/')
    expect(screen.getByRole('button', { name: /add everything at once/i })).toBeInTheDocument()
  })

  it('is hidden until the toggle is clicked', async () => {
    await mount('/')
    expect(screen.queryByLabelText(/^job links$/i)).toBeNull()
  })

  it('creates a company with links and toggles in one submit', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    await user.type(screen.getByLabelText(/role title/i), 'Platform Engineer')
    // paste, not type: a long URL entered character by character raced the controlled
    // re-render and produced interleaved text.
    await user.click(screen.getByLabelText(/job links/i))
    await user.paste('Careers | https://vercel.com/careers\nhttps://example.com/posting')
    await save(user)
    await waitFor(() => expect(stored()).toHaveLength(1))
    const c = stored()[0]
    expect(c.name).toBe('Vercel')
    expect(rolesOf(c)[0].title).toBe('Platform Engineer')
    expect(linksOf(c)).toHaveLength(2)
    expect(linksOf(c)[0]).toMatchObject({ label: 'Careers', url: 'https://vercel.com/careers' })
  })

  it('prefixes bare domains typed into the links box', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    await user.click(screen.getByLabelText(/job links/i))
    await user.paste('vercel.com/careers')
    await save(user)
    await waitFor(() => expect(linksOf(stored()[0])[0].url).toBe('https://vercel.com/careers'))
  })

  it('writes the toggles filled in on the form', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    const salaryRow = [...document.querySelectorAll('div')].find((d) => d.children.length === 2 && d.firstChild?.textContent === 'Salary')
    await user.type(salaryRow.querySelector('input'), '150k')
    await save(user)
    await waitFor(() => expect(fieldsOf(stored()[0]).Salary).toBe('150k'))
  })

  it('leaves untouched toggles out rather than writing empty ones', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    await save(user)
    await waitFor(() => expect(stored()).toHaveLength(1))
    expect(Object.keys(fieldsOf(stored()[0]))).toHaveLength(0)
  })

  it('appends a role to a company that already exists', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'c1', name: 'Anthropic' })])
    await mount('/')
    await screen.findAllByText('Anthropic')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Anthropic')
    await user.type(screen.getByLabelText(/role title/i), 'Research Engineer')
    await save(user)
    await waitFor(() => expect(rolesOf(stored()[0])).toHaveLength(2))
    expect(stored()).toHaveLength(1)
  })

  it('refuses a duplicate role at the same company', async () => {
    const user = userEvent.setup()
    seed([{ id: 'c1', name: 'Anthropic', roles: [{ id: 'r1', title: 'Research Engineer', links: [], resume: null, customFields: {} }] }])
    await mount('/')
    await screen.findAllByText('Anthropic')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Anthropic')
    await user.type(screen.getByLabelText(/role title/i), 'research engineer')
    await save(user)
    expect(await screen.findByText(/already has a/i)).toBeInTheDocument()
    expect(rolesOf(stored()[0])).toHaveLength(1)
  })

  it('requires a company name', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await save(user)
    expect(await screen.findByText(/company name is required/i)).toBeInTheDocument()
    expect(stored()).toHaveLength(0)
  })

  it('falls back to the Role toggle for the role title', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    const roleRow = [...document.querySelectorAll('div')].find((d) => d.children.length === 2 && d.firstChild?.textContent === 'Role')
    await user.type(roleRow.querySelector('input'), 'Infra Engineer')
    await save(user)
    await waitFor(() => expect(rolesOf(stored()[0])[0].title).toBe('Infra Engineer'))
  })

  it('closes after a successful submit', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    await save(user)
    await waitFor(() => expect(screen.queryByRole('button', { name: /save all/i })).toBeNull())
  })

  it('everything it wrote shows up on the company page', async () => {
    const user = userEvent.setup()
    await mount('/')
    await openBulk(user)
    await user.type(screen.getByLabelText(/^company$/i), 'Vercel')
    await user.type(screen.getByLabelText(/role title/i), 'Platform Engineer')
    await user.click(screen.getByLabelText(/job links/i))
    await user.paste('Careers | https://vercel.com/careers')
    const salaryRow = [...document.querySelectorAll('div')].find((d) => d.children.length === 2 && d.firstChild?.textContent === 'Salary')
    await user.type(salaryRow.querySelector('input'), '150k')
    await save(user)
    await waitFor(() => expect(stored()).toHaveLength(1))

    cleanup()
    queryClient.clear()
    await mount(`/company/${stored()[0].id}`)
    await waitFor(() => expect(screen.getByTestId('role-strip')).toBeTruthy())
    expect(screen.getByTestId('role-strip').textContent).toContain('Platform Engineer')
    await waitFor(() => expect(panel().textContent).toContain('Careers'))
    // fields live in the Fields panel now, not on a tab of their own
    await openTab(userEvent.setup(), 'custom')
    await waitFor(() => expect(panel().textContent).toContain('Salary'))
  })
})

// ---------------------------------------------------------------------------
describe('sample data merges instead of replacing', () => {
  it('keeps companies the user already added — the reported bug', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'mine', name: 'My Own Company' })])
    await mount('/')
    await screen.findAllByText('My Own Company')
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(1))
    expect(stored().map((c) => c.name)).toContain('My Own Company')
    expect(stored().map((c) => c.name)).toContain('Anthropic')
  })

  it('does not duplicate samples when loaded twice', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(0))
    const afterFirst = stored().length
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(screen.getByText(/refreshed/i)).toBeInTheDocument())
    expect(stored()).toHaveLength(afterFirst)
  })

  it('refreshes stale samples left over from an older shape', async () => {
    // The regression this pins: matching samples by NAME meant that once they existed
    // the loader refused with "already loaded", so data saved before the sample shape
    // changed could never be brought up to date.
    const user = userEvent.setup()
    seed([
      { id: 'sample-anthropic', name: 'Anthropic', links: [], resume: null, customFields: { Status: 'Applied' } },
      { id: 'mine', name: 'My Own Company', links: [], resume: null, customFields: {} },
    ])
    await mount('/')
    await screen.findAllByText('Anthropic')
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(2))

    const anthropic = stored().find((c) => c.name === 'Anthropic')
    expect(rolesOf(anthropic)).toHaveLength(2)
    expect(fieldsOf(anthropic).Recruiter).toBe('Sam Okafor')
    // and the user's own company is still there, untouched
    expect(stored().map((c) => c.name)).toContain('My Own Company')
  })

  it('never removes a company the user created', async () => {
    const user = userEvent.setup()
    seed([company({ id: 'mine', name: 'My Own Company' })])
    await mount('/')
    await screen.findAllByText('My Own Company')
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(1))
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(screen.getByText(/refreshed/i)).toBeInTheDocument())
    expect(stored().filter((c) => c.name === 'My Own Company')).toHaveLength(1)
  })

  it('ships a sample company with two roles and two recruiters', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.click(screen.getByRole('button', { name: /show sample data for every feature/i }))
    await user.click(await screen.findByRole('button', { name: /^load it$/i }))
    await waitFor(() => expect(stored().length).toBeGreaterThan(0))
    const anthropic = stored().find((c) => c.name === 'Anthropic')
    expect(rolesOf(anthropic)).toHaveLength(2)
    expect(fieldsOf(anthropic, 0).Recruiter).not.toBe(fieldsOf(anthropic, 1).Recruiter)
  })
})

// ---------------------------------------------------------------------------
describe('persistence and resilience', () => {
  it('survives a remount, reading back from localStorage', async () => {
    const user = userEvent.setup()
    await mount('/')
    await user.type(searchBox(), 'Stripe{Enter}')
    await waitFor(() => expect(stored()).toHaveLength(1))
    await cleanupAndRemount()
    expect(screen.getAllByText('Stripe').length).toBeGreaterThan(0)
  })

  it('recovers from corrupt stored JSON instead of crashing', async () => {
    localStorage.setItem(STORAGE_KEY, '{not json')
    await mount('/')
    expect(screen.getByText(/add a company to get started/i)).toBeInTheDocument()
  })

  it('treats a missing customFields map as empty', async () => {
    seed([{ id: 'c1', name: 'Anthropic', links: [], resume: null }])
    await mount('/company/c1')
    await waitFor(() => expect(tabStrip()).toBeTruthy())
    expect(tabNames()).toEqual(['links', 'resume', 'custom'])
  })

  it('counts links and resumes in the dashboard stats', async () => {
    seed([
      company({ id: 'c1', name: 'A', links: [{ id: 'l1', url: 'https://a.com' }], resume: { name: 'cv.pdf' } }),
      company({ id: 'c2', name: 'B', links: [] }),
    ])
    await mount('/')
    await screen.findAllByText('A')
    // the summary reads as a sentence now ("2 companies · 1 link · 1 resume") rather
    // than three cards, so it is matched case-insensitively
    const text = document.body.textContent
    expect(text).toMatch(/companies/i)
    expect(text).toMatch(/links/i)
    expect(text).toMatch(/resumes/i)
  })
})

/** Remount the app from scratch, as a page reload would. */
async function cleanupAndRemount() {
  cleanup()
  queryClient.clear()
  await mount('/')
}
