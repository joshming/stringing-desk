import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, CircleHelp, ClipboardList, MapPin, Pencil, Plus, Search, SlidersHorizontal, Trash2, UserRound, X } from 'lucide-react'

type Job = {
  id: number
  customer_name: string | null
  phone_number: string | null
  racket_model: string
  string_name: string
  colour: string
  tension: string
  pickup_date: string
  location: string
  total: number
  uses_inventory: boolean
  status: 'Open' | 'Complete'
  notes: string
  created_at: string
}

type StringingItem = { racket_model: string; string_name: string; colour: string; tension: string; total: string; uses_inventory: boolean }
type InventoryItem = { id: number; string_name: string; colours: string[]; reel_capacity: number; used_by_colour: Record<string, number>; remaining_by_colour: Record<string, number> }
type Customer = { customer_name: string; phone_number: string }
type FormState = { customer_name: string; phone_number: string; pickup_date: string; location: string; notes: string; rackets: StringingItem[] }

const API_URL = 'http://localhost:8000/api'
const locations = ['Sheridan Centre', "Battaglia's", 'Stoney Creek']
const newRacket = (): StringingItem => ({ racket_model: '', string_name: '', colour: '', tension: '', total: '', uses_inventory: true })
const blankForm: FormState = { customer_name: '', phone_number: '', pickup_date: '', location: locations[0], notes: '', rackets: [newRacket()] }

function formatDate(date: string) {
  if (!date) return 'No pickup date'
  return new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00`))
}

function initials(job: Job) {
  const label = job.customer_name || job.phone_number || 'New customer'
  return label.split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()
}

export default function App() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [inventory, setInventory] = useState<InventoryItem[]>([])
  const [form, setForm] = useState<FormState>(blankForm)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'All' | 'Open' | 'Complete'>('All')
  const [stringFilter, setStringFilter] = useState('All string types')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [inventoryName, setInventoryName] = useState('')
  const [inventoryColours, setInventoryColours] = useState('')
  const [activeTab, setActiveTab] = useState<'jobs' | 'inventory' | 'customers'>('jobs')
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string | null>(null)
  const [showCustomerSuggestions, setShowCustomerSuggestions] = useState(false)
  const [editingInventoryId, setEditingInventoryId] = useState<number | null>(null)
  const [editingInventoryName, setEditingInventoryName] = useState('')
  const [editingInventoryColours, setEditingInventoryColours] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const jobsPerPage = 8

  const loadJobs = async () => {
    try {
      const [jobsResponse, inventoryResponse] = await Promise.all([fetch(`${API_URL}/jobs`), fetch(`${API_URL}/inventory`)] )
      if (!jobsResponse.ok || !inventoryResponse.ok) throw new Error('Could not load desk data')
      setJobs(await jobsResponse.json()); setInventory(await inventoryResponse.json())
    } catch {
      setError('The desk could not connect to the API. Start FastAPI on port 8000.')
    } finally { setLoading(false) }
  }

  useEffect(() => { void loadJobs() }, [])

  const visibleJobs = useMemo(() => jobs.filter((job) => {
    const haystack = `${job.customer_name || ''} ${job.phone_number || ''} ${job.racket_model} ${job.string_name} ${job.colour} ${job.tension} ${job.location}`.toLowerCase()
    return (filter === 'All' || job.status === filter) && (stringFilter === 'All string types' || job.string_name === stringFilter) && haystack.includes(search.toLowerCase())
  }).sort((a, b) => {
    const completionOrder = Number(a.status === 'Complete') - Number(b.status === 'Complete')
    if (completionOrder !== 0) return completionOrder
    return a.pickup_date.localeCompare(b.pickup_date) || b.id - a.id
  }), [jobs, filter, stringFilter, search])

  const stringTypes = useMemo(() => [...new Set(jobs.map((job) => job.string_name).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [jobs])

  const totalPages = Math.max(1, Math.ceil(visibleJobs.length / jobsPerPage))
  const paginatedJobs = visibleJobs.slice((currentPage - 1) * jobsPerPage, currentPage * jobsPerPage)

  useEffect(() => { setCurrentPage(1) }, [filter, stringFilter, search])
  useEffect(() => { if (currentPage > totalPages) setCurrentPage(totalPages) }, [currentPage, totalPages])

  const customerSuggestions = useMemo(() => {
    const query = `${form.customer_name} ${form.phone_number}`.trim().toLowerCase()
    const customers = new Map<string, Customer>()
    jobs.forEach((job) => {
      if (!job.customer_name && !job.phone_number) return
      const customer = { customer_name: job.customer_name || '', phone_number: job.phone_number || '' }
      customers.set(`${customer.customer_name.toLowerCase()}|${customer.phone_number}`, customer)
    })
    return [...customers.values()]
      .filter((customer) => `${customer.customer_name} ${customer.phone_number}`.toLowerCase().includes(query))
      .slice(0, 6)
  }, [jobs, form.customer_name, form.phone_number])

  const pastCustomers = useMemo(() => {
    const customers = new Map<string, Customer>()
    jobs.forEach((job) => {
      if (!job.customer_name && !job.phone_number) return
      const customer = { customer_name: job.customer_name || '', phone_number: job.phone_number || '' }
      customers.set(`${customer.customer_name.toLowerCase()}|${customer.phone_number}`, customer)
    })
    return [...customers.entries()].sort(([, a], [, b]) => (a.customer_name || a.phone_number).localeCompare(b.customer_name || b.phone_number))
  }, [jobs])

  const selectedCustomer = pastCustomers.find(([key]) => key === selectedCustomerKey)?.[1]
  const selectedCustomerJobs = selectedCustomer ? jobs.filter((job) => (job.customer_name || '').toLowerCase() === selectedCustomer.customer_name.toLowerCase() && (job.phone_number || '') === selectedCustomer.phone_number).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 3) : []

  const updateForm = (key: 'customer_name' | 'phone_number' | 'pickup_date' | 'location' | 'notes', value: string) => setForm((current) => ({ ...current, [key]: value }))
  const updateRacket = (index: number, key: keyof StringingItem, value: string) => setForm((current) => ({ ...current, rackets: current.rackets.map((racket, racketIndex) => racketIndex === index ? { ...racket, [key]: value } : racket) }))
  const selectCustomer = (customer: Customer) => { setForm((current) => ({ ...current, customer_name: customer.customer_name, phone_number: customer.phone_number })); setShowCustomerSuggestions(false) }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError('')
    if (!form.customer_name.trim() && !form.phone_number.trim()) { setError('Add a customer name or phone number.'); return }
    setSaving(true)
    try {
      const response = await fetch(`${API_URL}/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customer_name: form.customer_name, phone_number: form.phone_number, pickup_date: form.pickup_date, location: form.location, notes: form.notes, items: form.rackets.map((racket) => ({ ...racket, total: Number(racket.total || 0) })) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not save job')
      setJobs((current) => [...data, ...current]); setForm(blankForm)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not save job') } finally { setSaving(false) }
  }

  async function patchJob(id: number, changes: Partial<Pick<Job, 'status' | 'notes' | 'pickup_date' | 'location'>>) {
    const response = await fetch(`${API_URL}/jobs/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) })
    if (!response.ok) throw new Error('Could not update job')
    const updated = await response.json(); setJobs((current) => current.map((job) => job.id === id ? updated : job))
  }

  const openCount = jobs.filter((job) => job.status === 'Open').length
  const readyCount = jobs.filter((job) => job.status === 'Complete').length

  async function addInventory(event: FormEvent) {
    event.preventDefault(); setError('')
    try {
      const response = await fetch(`${API_URL}/inventory`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ string_name: inventoryName, colours: inventoryColours.split(',') }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not add inventory')
      setInventory((current) => [...current, data].sort((a, b) => a.string_name.localeCompare(b.string_name))); setInventoryName(''); setInventoryColours('')
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not add inventory') }
  }

  async function removeInventory(id: number) {
    try { const response = await fetch(`${API_URL}/inventory/${id}`, { method: 'DELETE' }); if (!response.ok) throw new Error('Could not remove inventory item'); setInventory((current) => current.filter((item) => item.id !== id)) }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not remove inventory item') }
  }

  async function decreaseInventory(id: number, colour: string) {
    setError('')
    try {
      const response = await fetch(`${API_URL}/inventory/${id}/consume`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ colour }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not update inventory')
      setInventory((current) => current.map((item) => item.id === id ? data : item))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update inventory') }
  }

  function startInventoryEdit(item: InventoryItem) {
    setEditingInventoryId(item.id); setEditingInventoryName(item.string_name); setEditingInventoryColours(item.colours.join(', '))
  }

  async function saveInventoryEdit(id: number) {
    setError('')
    try {
      const response = await fetch(`${API_URL}/inventory/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ string_name: editingInventoryName, colours: editingInventoryColours.split(',') }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Could not update inventory')
      setInventory((current) => [...current.filter((item) => item.id !== id), data].sort((a, b) => a.string_name.localeCompare(b.string_name))); setEditingInventoryId(null)
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not update inventory') }
  }

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><span></span><span></span><span></span></div><div><div className="brand-name">STRINGING<span>DESK</span></div><div className="brand-subtitle">Badminton service tracker</div></div></div><nav className="main-nav"><button className={activeTab === 'jobs' ? 'nav-tab active' : 'nav-tab'} onClick={() => setActiveTab('jobs')}>Jobs</button><button className={activeTab === 'customers' ? 'nav-tab active' : 'nav-tab'} onClick={() => setActiveTab('customers')}>Customers</button><button className={activeTab === 'inventory' ? 'nav-tab active' : 'nav-tab'} onClick={() => setActiveTab('inventory')}>Inventory</button></nav>
      <div className="topbar-actions"><button className="icon-button" title="Help"><CircleHelp size={19} /></button></div>
    </header>
    <main className="page">
      <section className="intro"><div><p className="eyebrow">{activeTab === 'jobs' ? 'WORKSPACE / TODAY' : activeTab === 'inventory' ? 'STOCKROOM / INVENTORY' : 'CUSTOMER DIRECTORY'}</p><h1>{activeTab === 'jobs' ? 'Keep every racket moving.' : activeTab === 'inventory' ? 'Know what is on hand.' : 'Know your regulars.'}</h1><p className="intro-copy">{activeTab === 'jobs' ? 'A clear view of customers, setups, and pickups — all in one place.' : activeTab === 'inventory' ? 'Manage your strings and colours before taking on the next job.' : 'Select a customer to see their most recent stringing history.'}</p></div><div className="date-stamp"><CalendarDays size={17} /><span>{new Intl.DateTimeFormat('en-CA', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</span></div></section>
      {error && <div className="alert"><span>{error}</span><button onClick={() => setError('')}><X size={16} /></button></div>}
      {activeTab === 'jobs' ? <section className="dashboard-grid">
        <form className="card form-card" onSubmit={submit}>
          <div className="card-heading"><div><p className="eyebrow">NEW ENTRY</p><h2>Add a stringing job</h2></div><div className="heading-icon"><Plus size={18} /></div></div>
          <div className="section-label"><UserRound size={15} /> Customer</div>
          <div className="field-row"><label>Name<input value={form.customer_name || ''} onFocus={() => setShowCustomerSuggestions(true)} onBlur={() => window.setTimeout(() => setShowCustomerSuggestions(false), 150)} onChange={(e) => { updateForm('customer_name', e.target.value); setShowCustomerSuggestions(true) }} placeholder="e.g. Alex Chen" /></label><label>Phone number<input value={form.phone_number || ''} onFocus={() => setShowCustomerSuggestions(true)} onBlur={() => window.setTimeout(() => setShowCustomerSuggestions(false), 150)} onChange={(e) => { updateForm('phone_number', e.target.value); setShowCustomerSuggestions(true) }} placeholder="(905) 555-0198" /></label></div>
          {showCustomerSuggestions && customerSuggestions.length > 0 && <div className="customer-suggestions">{customerSuggestions.map((customer) => <button type="button" key={`${customer.customer_name}|${customer.phone_number}`} onMouseDown={(event) => event.preventDefault()} onClick={() => selectCustomer(customer)}><span className="suggestion-avatar">{(customer.customer_name || customer.phone_number).slice(0, 1).toUpperCase()}</span><span><strong>{customer.customer_name || 'Unnamed customer'}</strong><small>{customer.phone_number || 'No phone number'}</small></span></button>)}</div>}
          <p className="field-hint">Add at least a name or phone number. Past customers will appear as you type.</p>
          {inventory.length === 0 && <p className="field-hint inventory-hint">Add your strings and colours in the Inventory tab before creating a job.</p>}
          {form.rackets.map((racket, index) => <div className="racket-entry" key={index}><div className="racket-entry-heading"><strong>Racket {index + 1}</strong>{form.rackets.length > 1 && <button type="button" className="remove-racket" onClick={() => setForm((current) => ({ ...current, rackets: current.rackets.filter((_, racketIndex) => racketIndex !== index) }))}><Trash2 size={14} /> Remove</button>}</div><label>Racket name / model<input required value={racket.racket_model} onChange={(e) => updateRacket(index, 'racket_model', e.target.value)} placeholder="e.g. Yonex Astrox 100 ZZ" /></label><label className="supply-toggle"><input type="checkbox" checked={!racket.uses_inventory} onChange={(e) => setForm((current) => ({ ...current, rackets: current.rackets.map((item, itemIndex) => itemIndex === index ? { ...item, uses_inventory: !e.target.checked, string_name: '', colour: '' } : item) }))} /> Customer is supplying their own string</label>{racket.uses_inventory ? <><label>String<select required value={racket.string_name} onChange={(e) => { updateRacket(index, 'string_name', e.target.value); updateRacket(index, 'colour', '') }}><option value="">Select a string</option>{inventory.map((item) => <option key={item.id} value={item.string_name}>{item.string_name}</option>)}</select></label><div className="field-row"><label>Colour<select required value={racket.colour} disabled={!racket.string_name} onChange={(e) => updateRacket(index, 'colour', e.target.value)}><option value="">{racket.string_name ? 'Select a colour' : 'Select a string first'}</option>{inventory.find((item) => item.string_name === racket.string_name)?.colours.filter((colour) => (inventory.find((item) => item.string_name === racket.string_name)?.remaining_by_colour[colour] ?? 0) > 0).map((colour) => <option key={colour} value={colour}>{colour} ({inventory.find((item) => item.string_name === racket.string_name)?.remaining_by_colour[colour] ?? 0} left)</option>)}</select></label><label>Tension<input required value={racket.tension} onChange={(e) => updateRacket(index, 'tension', e.target.value)} placeholder="e.g. 26 lbs" /></label></div></> : <><div className="field-row"><label>Customer's string<input required value={racket.string_name} onChange={(e) => updateRacket(index, 'string_name', e.target.value)} placeholder="e.g. BG80" /></label><label>Colour<input required value={racket.colour} onChange={(e) => updateRacket(index, 'colour', e.target.value)} placeholder="e.g. Yellow" /></label></div><label>Tension<input required value={racket.tension} onChange={(e) => updateRacket(index, 'tension', e.target.value)} placeholder="e.g. 26 lbs" /></label></>}<label>Total <span className="muted">(CAD)</span><div className="money-input"><span>$</span><input required min="0" step="0.01" type="number" value={racket.total} onChange={(e) => updateRacket(index, 'total', e.target.value)} placeholder="35.00" /></div></label></div>)}
          <button type="button" className="add-racket-button" onClick={() => setForm((current) => ({ ...current, rackets: [...current.rackets, newRacket()] }))}><Plus size={15} /> Add another racket</button>
          <label>Pickup date<input required type="date" value={form.pickup_date} onChange={(e) => updateForm('pickup_date', e.target.value)} /></label>
          <label>Pickup / drop-off location<select value={form.location} onChange={(e) => updateForm('location', e.target.value)}>{locations.map((location) => <option key={location}>{location}</option>)}</select></label>
          <label>Notes <span className="muted">(optional)</span><textarea value={form.notes} onChange={(e) => updateForm('notes', e.target.value)} placeholder="Any preferences or customer notes..." rows={3} /></label>
          <button className="primary-button" disabled={saving}>{saving ? 'Saving...' : <><Plus size={17} /> Save stringing job</>}</button>
        </form>
        <section className="card jobs-card">
          <div className="jobs-header"><div><p className="eyebrow">JOB BOARD</p><h2>Stringing jobs <span className="count-pill">{jobs.length}</span></h2></div><div className="stats"><button className={filter === 'Open' ? 'stat active' : 'stat'} onClick={() => setFilter(filter === 'Open' ? 'All' : 'Open')}><span className="status-dot open"></span>{openCount} open</button><button className={filter === 'Complete' ? 'stat active' : 'stat'} onClick={() => setFilter(filter === 'Complete' ? 'All' : 'Complete')}><span className="status-dot ready"></span>{readyCount} complete</button></div></div>
          <div className="toolbar"><div className="search-box"><Search size={17} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search work, racket or customer..." /></div><select className="string-filter" value={stringFilter} onChange={(e) => setStringFilter(e.target.value)}><option>All string types</option>{stringTypes.map((stringType) => <option key={stringType}>{stringType}</option>)}</select></div>
          <div className="job-list">{loading ? <div className="empty-state">Loading the job board...</div> : visibleJobs.length === 0 ? <div className="empty-state"><ClipboardList size={28} /><strong>{jobs.length ? 'No jobs match your search' : 'Your job board is ready'}</strong><span>{jobs.length ? 'Try a different search or filter.' : 'Add your first stringing job to get started.'}</span></div> : paginatedJobs.map((job) => <JobCard key={job.id} job={job} onUpdate={patchJob} />)}</div>
          {visibleJobs.length > jobsPerPage && <div className="pagination"><button type="button" disabled={currentPage === 1} onClick={() => setCurrentPage((page) => page - 1)}>Previous</button><span>Page {currentPage} of {totalPages}</span><button type="button" disabled={currentPage === totalPages} onClick={() => setCurrentPage((page) => page + 1)}>Next</button></div>}
        </section>
      </section> : activeTab === 'inventory' ? <section className="inventory-page"><section className="card inventory-card"><div className="card-heading"><div><p className="eyebrow">INVENTORY</p><h2>Strings on hand</h2></div><div className="heading-icon"><SlidersHorizontal size={17} /></div></div><p className="inventory-copy">Each reel supports 20 stringing jobs per colour. Customer-supplied string does not reduce your stock.</p><p className="inventory-action-hint">Use the − button beside a colour when a string is used outside a job or wasted.</p><form className="inventory-form" onSubmit={addInventory}><label>String name<input required value={inventoryName} onChange={(e) => setInventoryName(e.target.value)} placeholder="e.g. Yonex BG80" /></label><label>Available colours <span className="muted">(comma separated)</span><input required value={inventoryColours} onChange={(e) => setInventoryColours(e.target.value)} placeholder="White, black, yellow" /></label><button className="secondary-button"><Plus size={15} /> Add to inventory</button></form><div className="inventory-list">{inventory.map((item) => editingInventoryId === item.id ? <div className="inventory-item inventory-edit-item" key={item.id}><div className="inventory-edit-fields"><input value={editingInventoryName} onChange={(e) => setEditingInventoryName(e.target.value)} placeholder="String name" /><input value={editingInventoryColours} onChange={(e) => setEditingInventoryColours(e.target.value)} placeholder="Colours, comma separated" /></div><div className="inventory-edit-actions"><button type="button" className="save-inventory-button" onClick={() => void saveInventoryEdit(item.id)}>Save</button><button type="button" className="cancel-inventory-button" onClick={() => setEditingInventoryId(null)}>Cancel</button></div></div> : <div className="inventory-item" key={item.id}><div><strong>{item.string_name}</strong><div className="inventory-colours">{item.colours.map((colour) => <span className="inventory-colour" key={colour}>{colour}: {item.remaining_by_colour[colour]} left</span>)}</div></div><div className="inventory-item-actions">{item.colours.map((colour) => <button type="button" className="decrease-inventory-button" key={colour} disabled={item.remaining_by_colour[colour] <= 0} title={`Use one ${colour} string`} onClick={() => void decreaseInventory(item.id, colour)}>−</button>)}<button type="button" title={`Edit ${item.string_name}`} onClick={() => startInventoryEdit(item)}><Pencil size={14} /></button><button type="button" title={`Remove ${item.string_name}`} onClick={() => void removeInventory(item.id)}><Trash2 size={14} /></button></div></div>)}{inventory.length === 0 && <p className="empty-inventory">No strings added yet.</p>}</div></section></section> : <section className="customers-page"><div className="customer-directory card"><div className="card-heading"><div><p className="eyebrow">PAST CUSTOMERS</p><h2>{pastCustomers.length} customers</h2></div><div className="heading-icon"><UserRound size={17} /></div></div><div className="customer-directory-grid"><div className="customer-list">{pastCustomers.length === 0 ? <div className="empty-state"><UserRound size={26} /><strong>No past customers yet</strong><span>Customers will appear here after their first job.</span></div> : pastCustomers.map(([key, customer]) => <button type="button" className={selectedCustomerKey === key ? 'customer-list-item selected' : 'customer-list-item'} key={key} onClick={() => setSelectedCustomerKey(key)}><span className="customer-directory-avatar">{(customer.customer_name || customer.phone_number).slice(0, 1).toUpperCase()}</span><span><strong>{customer.customer_name || 'Unnamed customer'}</strong><small>{customer.phone_number || 'No phone number'}</small></span><b>{jobs.filter((job) => (job.customer_name || '').toLowerCase() === customer.customer_name.toLowerCase() && (job.phone_number || '') === customer.phone_number).length}</b></button>)}</div><div className="customer-history">{selectedCustomer ? <><div className="history-heading"><div><p className="eyebrow">CUSTOMER HISTORY</p><h2>{selectedCustomer.customer_name || selectedCustomer.phone_number}</h2><p>{selectedCustomer.phone_number || 'No phone number'}</p></div></div>{selectedCustomerJobs.map((job) => <JobCard key={job.id} job={job} onUpdate={patchJob} />)}</> : <div className="empty-state"><ClipboardList size={28} /><strong>Select a customer</strong><span>Their last three stringing jobs will appear here.</span></div>}</div></div></div></section>}
    </main>
  </div>
}

function JobCard({ job, onUpdate }: { job: Job, onUpdate: (id: number, changes: Partial<Pick<Job, 'status' | 'notes' | 'pickup_date' | 'location'>>) => Promise<void> }) {
  const [notes, setNotes] = useState(job.notes)
  const [editingNotes, setEditingNotes] = useState(false)
  const [editingPickup, setEditingPickup] = useState(false)
  const [pickupDate, setPickupDate] = useState(job.pickup_date)
  const [location, setLocation] = useState(job.location)
  const [updating, setUpdating] = useState(false)
  const saveStatus = async () => { setUpdating(true); try { await onUpdate(job.id, { status: job.status === 'Open' ? 'Complete' : 'Open' }) } finally { setUpdating(false) } }
  const saveNotes = async () => { setUpdating(true); try { await onUpdate(job.id, { notes }); setEditingNotes(false) } finally { setUpdating(false) } }
  const savePickup = async () => { setUpdating(true); try { await onUpdate(job.id, { pickup_date: pickupDate, location }); setEditingPickup(false) } finally { setUpdating(false) } }
  const cancelPickup = () => { setPickupDate(job.pickup_date); setLocation(job.location); setEditingPickup(false) }
  return <article className={`job-card ${job.status === 'Complete' ? 'is-ready' : ''}`}><div className="job-main"><div className="customer-avatar">{initials(job)}</div><div className="job-customer"><div className="customer-line"><h3>{job.customer_name || 'Unnamed customer'}</h3><span className={`status-badge ${job.status.toLowerCase()}`}><span className="status-dot"></span>{job.status}</span></div><p>{job.phone_number || 'No phone number'}</p><div className="service-summary"><strong>{job.racket_model}</strong><span>{job.uses_inventory ? job.string_name : `Customer's ${job.string_name}`}</span><span>{job.colour}</span><span>{job.tension}</span></div></div><div className="job-total"><small>Total</small><strong>${job.total.toFixed(2)}</strong></div></div><div className={`job-meta ${editingPickup ? 'editing-meta' : ''}`}>{editingPickup ? <><label><span>Pick up date</span><input type="date" value={pickupDate} onChange={(event) => setPickupDate(event.target.value)} /></label><label><span>Location</span><select value={location} onChange={(event) => setLocation(event.target.value)}>{locations.map((option) => <option key={option}>{option}</option>)}</select></label><button className="save-detail-button" onClick={() => void savePickup()} disabled={updating}><Check size={14} /> Save</button><button className="cancel-detail-button" onClick={cancelPickup}>Cancel</button></> : <><span><CalendarDays size={14} /> Pick up <b>{formatDate(job.pickup_date)}</b></span><span><MapPin size={14} /> {job.location}</span><button className="edit-detail-button" onClick={() => setEditingPickup(true)}><Pencil size={13} /> Edit pickup</button><button className={`complete-button ${job.status === 'Complete' ? 'done' : ''}`} onClick={() => void saveStatus()} disabled={updating}>{job.status === 'Complete' ? <><Check size={15} /> Complete</> : 'Mark complete'}</button></>}</div><div className="notes-row">{editingNotes ? <><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Write a note for this customer..." rows={2} /><button onClick={() => void saveNotes()} disabled={updating}>Save note</button><button className="cancel-note" onClick={() => setEditingNotes(false)}>Cancel</button></> : <button className="notes-link" onClick={() => setEditingNotes(true)}>{job.notes ? <><span className="note-label">Note</span> {job.notes}</> : <><Plus size={14} /> Add a customer note</>}</button>}</div></article>
}
