import { useState, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { getPlannerTasks, uploadFileToDrive } from '../services/api'

const statusStyle = {
  'Pending':     { bg: '#fffbeb', text: '#b45309', dot: '#f59e0b' },
  'Assigned':    { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  'In Progress': { bg: '#f5f3ff', text: '#6d28d9', dot: '#8b5cf6' },
  'Submitted':   { bg: '#fff7ed', text: '#c2410c', dot: '#f97316' },
  'Completed':   { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
}

const typeStyle = {
  'Reel':       { bg: '#fdf2f8', text: '#9d174d' },
  'Poster':     { bg: '#f0fdf4', text: '#166534' },
  'Google Ads': { bg: '#eff6ff', text: '#1e40af' },
  'Ads':        { bg: '#eff6ff', text: '#1e40af' },
}

function Badge({ label, style: st }) {
  if (!st) return <span style={{ fontSize: 12, color: '#94a3b8' }}>{label}</span>
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
      background: st.bg, color: st.text,
    }}>
      {st.dot && <span style={{ width: 6, height: 6, borderRadius: '50%', background: st.dot, flexShrink: 0 }}/>}
      {label}
    </span>
  )
}

// CSV Validator
function validateCSV(text) {
  const lines = text.trim().split('\n')
  if (lines.length < 2) return { valid: false, errors: ['CSV is empty or has no data rows'] }
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
  const required = ['Task ID', 'Client Name', 'Task Type', 'End Date']
  const missing = required.filter(r => !headers.some(h => h === r || h === r.replace(' ', '_')))
  const errors = []
  if (missing.length > 0) errors.push(`Missing columns: ${missing.join(', ')}`)
  const taskIds = new Set()
  lines.slice(1).forEach((line, i) => {
    if (!line.trim()) return
    const cols = line.split(',').map(c => c.trim().replace(/"/g, ''))
    const taskId = cols[0]
    if (!taskId) errors.push(`Row ${i+2}: Missing Task ID`)
    else if (taskIds.has(taskId)) errors.push(`Row ${i+2}: Duplicate Task ID "${taskId}"`)
    else taskIds.add(taskId)
  })
  return { valid: errors.length === 0, errors, rowCount: lines.length - 1, headers }
}

export default function PlannerDashboard() {
  const { user, logout } = useAuth()
  const [tab, setTab]                       = useState('review')
  const [tasks, setTasks]                   = useState([])
  const [submissions, setSubmissions]       = useState([])
  const [loading, setLoading]               = useState(false)
  const [stats, setStats]                   = useState({ total: 0, pending: 0, assigned: 0, submitted: 0 })
  const [selectedFile, setSelectedFile]     = useState(null)
  const [dragging, setDragging]             = useState(false)
  const [uploading, setUploading]           = useState(false)
  const [uploadResult, setUploadResult]     = useState(null)
  const [uploadToken, setUploadToken]       = useState(null)
  const [validation, setValidation]         = useState(null)
  const [notifications, setNotifications]   = useState([])
  const [showNotif, setShowNotif]           = useState(false)

  useEffect(() => { loadTasks(); loadSubmissions(); fetchNotifications() }, [])

  const loadTasks = async () => {
    setLoading(true)
    try {
      const data = await getPlannerTasks()
      const t = data.tasks || []
      setTasks(t)
      setStats({
        total:     t.length,
        pending:   t.filter(x => x.status === 'Pending').length,
        assigned:  t.filter(x => x.status === 'Assigned' || x.status === 'In Progress').length,
        submitted: t.filter(x => x.status === 'Submitted').length,
      })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const loadSubmissions = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/manager/pending-submissions', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      const data = await res.json()
      setSubmissions(data.submissions || [])
    } catch (e) { console.error(e) }
  }

  const fetchNotifications = async () => {
    try {
      const res = await fetch('http://localhost:5000/api/planner/notifications', {
        headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
      })
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch (_) {}
  }

  const handleFileSelect = async (file) => {
    if (!file) return
    if (!file.name.endsWith('.csv')) {
      setValidation({ valid: false, errors: ['Only .csv files are supported'] })
      return
    }
    setSelectedFile(file)
    setUploadResult(null)
    setUploadToken(null)
    const text = await file.text()
    const result = validateCSV(text)
    setValidation(result)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFileSelect(e.dataTransfer.files[0])
  }

  const handleUpload = async () => {
    if (!selectedFile || !validation?.valid) return
    setUploading(true)
    setUploadResult(null)
    try {
      const result = await uploadFileToDrive(selectedFile, null)
      setUploadToken(result.upload_token || null)
      setUploadResult({ success: true, data: result })
      setSelectedFile(null)
      setValidation(null)
      await loadTasks()
      await fetchNotifications()
    } catch (err) {
      setUploadResult({
        success: false,
        error: err.response?.data?.error || err.message || 'Upload failed'
      })
    }
    setUploading(false)
  }

  const isOverdue = (date) => {
    if (!date) return false
    const today = new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000)).toISOString().split('T')[0]
    return date.slice(0, 10) < today
  }

  const unread   = notifications.filter(n => !n.is_read).length
  const initials = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'P'

  const S = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Fraunces:wght@700&display=swap');
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .dash { min-height: 100vh; background: #f4f6fb; font-family: 'Outfit', sans-serif; }
    .header { background: #fff; border-bottom: 1px solid #e8edf4; padding: 0 32px; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-icon { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #2563eb, #7c3aed); display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .logo-text { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 700; color: #1e293b; }
    .header-right { display: flex; align-items: center; gap: 12px; position: relative; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #2563eb, #7c3aed); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; }
    .logout-btn { padding: 7px 16px; border-radius: 8px; border: 1.5px solid #e2e8f0; background: #fff; color: #64748b; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .logout-btn:hover { background: #fef2f2; border-color: #fca5a5; color: #dc2626; }
    .notif-btn { position: relative; width: 38px; height: 38px; border-radius: 10px; border: 1.5px solid #e2e8f0; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 17px; }
    .notif-badge { position: absolute; top: -4px; right: -4px; width: 17px; height: 17px; border-radius: 50%; background: #ef4444; color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
    .notif-panel { position: absolute; top: 54px; right: 0; width: 360px; background: #fff; border-radius: 16px; border: 1px solid #e8edf4; box-shadow: 0 12px 40px rgba(0,0,0,0.12); z-index: 200; overflow: hidden; }
    .auto-badge { display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 8px; padding: 6px 12px; font-size: 12px; font-weight: 700; color: #1d4ed8; }
    .pulse-dot { width: 8px; height: 8px; border-radius: 50%; background: #3b82f6; animation: pulse 1.5s ease-in-out infinite; }
    @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.8)} }
    .main { max-width: 1200px; margin: 0 auto; padding: 28px 24px; }
    .page-title { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
    .page-sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }
    .stat-card { background: #fff; border-radius: 16px; padding: 20px 22px; border: 1px solid #e8edf4; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
    .stat-label { font-size: 11px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
    .stat-value { font-size: 30px; font-weight: 800; line-height: 1; }
    .stat-icon { width: 44px; height: 44px; border-radius: 14px; display: flex; align-items: center; justify-content: center; font-size: 20px; }
    .tabs { display: flex; gap: 4px; background: #f1f5f9; border-radius: 12px; padding: 4px; margin-bottom: 20px; }
    .tab-btn { flex: 1; padding: 10px 16px; border-radius: 9px; border: none; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.15s; color: #64748b; background: transparent; }
    .tab-btn.active { background: #fff; color: #2563eb; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .card { background: #fff; border-radius: 18px; border: 1px solid #e8edf4; margin-bottom: 20px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
    .card-header { padding: 18px 24px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }
    .card-title { font-size: 15px; font-weight: 700; color: #1e293b; }
    .card-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .card-body { padding: 20px 24px; }
    .upload-zone { border: 2px dashed #bfdbfe; border-radius: 14px; padding: 48px 24px; text-align: center; cursor: pointer; background: #f8fbff; transition: all 0.2s; position: relative; }
    .upload-zone:hover, .upload-zone.drag { border-color: #2563eb; background: #eff6ff; }
    .upload-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
    .file-preview { display: flex; align-items: center; gap: 12px; padding: 14px 18px; background: #f0fdf4; border-radius: 12px; border: 1.5px solid #bbf7d0; margin-bottom: 14px; }
    .val-box { border-radius: 12px; padding: 14px 18px; margin-bottom: 14px; }
    .val-item { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 600; margin-bottom: 5px; }
    .upload-btn { width: 100%; padding: 14px; border-radius: 12px; border: none; background: linear-gradient(135deg, #2563eb, #7c3aed); color: #fff; font-size: 15px; font-weight: 800; cursor: pointer; font-family: inherit; transition: all 0.2s; margin-top: 14px; box-shadow: 0 6px 20px rgba(37,99,235,0.3); }
    .upload-btn:hover:not(:disabled) { opacity: 0.92; transform: translateY(-1px); }
    .upload-btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none; box-shadow: none; }
    .btn-refresh { padding: 9px 18px; border-radius: 10px; border: none; background: linear-gradient(135deg, #059669, #047857); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .result-box { margin-top: 14px; padding: 16px 20px; border-radius: 12px; font-size: 13px; font-weight: 700; text-align: center; }
    .token-box { background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 12px; padding: 14px 18px; margin-top: 12px; display: flex; align-items: flex-start; gap: 10px; }
    .info-row { display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #f8fafc; border-radius: 10px; border: 1px solid #e2e8f0; margin-bottom: 14px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 11px 16px; text-align: left; font-size: 11px; font-weight: 800; color: #94a3b8; letter-spacing: 0.7px; text-transform: uppercase; background: #f8fafc; border-bottom: 1px solid #e8edf4; }
    tbody tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
    tbody tr:hover { background: #fafbff; }
    tbody td { padding: 12px 16px; font-size: 13px; color: #374151; font-weight: 500; }
    .overdue-badge { display: inline-flex; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 800; background: #fef2f2; color: #dc2626; margin-left: 5px; }
    .empty-state { text-align: center; padding: 48px 24px; }
    .empty-icon { font-size: 42px; margin-bottom: 12px; }
    .empty-text { font-size: 14px; color: #94a3b8; font-weight: 500; }
    .file-link { color: #7c3aed; text-decoration: none; font-weight: 700; background: #f5f3ff; padding: 6px 14px; border-radius: 8px; font-size: 12px; display: inline-flex; align-items: center; gap: 6px; border: 1.5px solid #ddd6fe; transition: all 0.15s; }
    .file-link:hover { background: #ede9fe; }
    .submission-card { background: #fff7ed; border: 1.5px solid #fed7aa; border-radius: 16px; padding: 16px 20px; margin-bottom: 12px; }

    /* ★ Info-only chip — no action buttons */
    .review-info-chip { display: inline-flex; align-items: center; gap: 6px; background: #f0f9ff; border: 1.5px solid #bae6fd; border-radius: 20px; padding: 5px 14px; font-size: 11px; font-weight: 700; color: #0369a1; }

    .status-chip-inprogress { display: inline-flex; align-items: center; gap: 6px; background: #f5f3ff; border: 1.5px solid #ddd6fe; border-radius: 20px; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #6d28d9; }
    .status-chip-assigned { display: inline-flex; align-items: center; gap: 6px; background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 20px; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #1d4ed8; }
    .status-chip-completed { display: inline-flex; align-items: center; gap: 5px; background: #f0fdf4; border: 1.5px solid #86efac; border-radius: 20px; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #15803d; }
    .status-chip-rejected { display: inline-flex; align-items: center; gap: 5px; background: #fef2f2; border: 1.5px solid #fecaca; border-radius: 20px; padding: 4px 10px; font-size: 11px; font-weight: 700; color: #dc2626; }
    .admin-note { background: #fef9c3; border: 1px solid #fde68a; border-radius: 8px; padding: 6px 12px; font-size: 11px; color: #92400e; font-weight: 600; margin-top: 6px; display: inline-block; }
    @media(max-width: 900px) { .stats-grid { grid-template-columns: 1fr 1fr; } }
  `

  return (
    <div className="dash">
      <style>{S}</style>

      <header className="header">
        <div className="logo">
          <div className="logo-icon">📋</div>
          <span className="logo-text">Agency Automation</span>
        </div>
        <div className="header-right">
          <div className="auto-badge">
            <div className="pulse-dot"/>
            Auto-assign ON
          </div>

          <button className="notif-btn" onClick={() => setShowNotif(p => !p)}>
            🔔
            {unread > 0 && <span className="notif-badge">{unread}</span>}
          </button>

          {showNotif && (
            <div className="notif-panel">
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Notifications</span>
                <button onClick={() => setShowNotif(false)} style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Close</button>
              </div>
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {notifications.length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No updates yet</div>
                  : notifications.map(n => (
                    <div key={n.id} style={{ padding: '12px 18px', borderBottom: '1px solid #f8fafc', fontSize: 13 }}>
                      <div style={{ fontWeight: 600, color: '#1e293b' }}>{n.message}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                        {n.created_at ? new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="avatar">{initials}</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{user?.name}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{user?.email}</div>
          </div>
          <button className="logout-btn" onClick={logout}>Logout</button>
        </div>
      </header>

      <main className="main">
        <div className="page-title">📋 Planner Dashboard</div>
        <div className="page-sub">Upload CSV → Auto-assign → View submissions → Admin approves</div>

        {/* Stats */}
        <div className="stats-grid">
          {[
            { label: 'Total Tasks',     value: stats.total,     icon: '📋', color: '#7c3aed', bg: '#f5f3ff' },
            { label: 'Pending',         value: stats.pending,   icon: '⏳', color: '#d97706', bg: '#fffbeb' },
            { label: 'In Progress',     value: stats.assigned,  icon: '⚡', color: '#2563eb', bg: '#eff6ff' },
            { label: 'Awaiting Review', value: stats.submitted, icon: '📤', color: '#c2410c', bg: '#fff7ed' },
          ].map(s => (
            <div className="stat-card" key={s.label}>
              <div>
                <div className="stat-label">{s.label}</div>
                <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
              </div>
              <div className="stat-icon" style={{ background: s.bg }}>{s.icon}</div>
            </div>
          ))}
        </div>

        {/* Tabs */}
        <div className="tabs">
          <button className={`tab-btn${tab === 'review' ? ' active' : ''}`} onClick={() => { setTab('review'); loadSubmissions() }}>📤 Review Submissions</button>
          <button className={`tab-btn${tab === 'upload' ? ' active' : ''}`} onClick={() => setTab('upload')}>☁️ Upload to Drive</button>
          <button className={`tab-btn${tab === 'tasks'  ? ' active' : ''}`} onClick={() => { setTab('tasks'); loadTasks() }}>📋 My Tasks</button>
        </div>

        {/* ── REVIEW SUBMISSIONS TAB ── */}
        {tab === 'review' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">📤 Submitted Work ({submissions.length})</div>
                {/* ★ Clearly tells planner this is view-only */}
                <div className="card-sub">Designer submissions — Admin reviews and approves</div>
              </div>
              <button className="btn-refresh" onClick={loadSubmissions}>↻ Refresh</button>
            </div>
            <div className="card-body">
              {submissions.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-icon">✅</div>
                  <div className="empty-text">No pending submissions</div>
                </div>
              ) : submissions.map(sub => (
                <div className="submission-card" key={sub.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      {/* Client + Task info */}
                      <div style={{ fontSize: 15, fontWeight: 800, color: '#1e293b', marginBottom: 6 }}>{sub.client_name}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 6 }}>
                        <span style={{ fontSize: 12, color: '#64748b' }}>Task ID: <strong style={{ color: '#7c3aed' }}>{sub.task_id}</strong></span>
                        <Badge label={sub.task_type} style={typeStyle[sub.task_type]} />
                        <span style={{ fontSize: 12, color: '#64748b' }}>Designer: <strong style={{ color: '#059669' }}>{sub.assigned_designer}</strong></span>
                      </div>

                      {/* Requirements */}
                      {sub.requirements && (
                        <div style={{ fontSize: 12, color: '#1d4ed8', background: '#eff6ff', padding: '6px 12px', borderRadius: 8, marginBottom: 6, fontWeight: 600 }}>
                          📋 Requirements: {sub.requirements}
                        </div>
                      )}

                      {/* Submission time */}
                      {sub.submitted_date && (
                        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>
                          🕐 Submitted: <strong>{new Date(sub.submitted_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong>
                        </div>
                      )}

                      {/* Designer note */}
                      {sub.submission_note && (
                        <div style={{ fontSize: 12, color: '#c2410c', background: '#fff7ed', padding: '7px 12px', borderRadius: 8, display: 'inline-block', marginBottom: 8, fontWeight: 600 }}>
                          📝 Note: "{sub.submission_note}"
                        </div>
                      )}

                      {/* View file link */}
                      {sub.submission_file_link && (
                        <div style={{ marginTop: 8 }}>
                          <a href={sub.submission_file_link} target="_blank" rel="noopener noreferrer" className="file-link">
                            📎 View Submitted File ↗
                          </a>
                        </div>
                      )}
                    </div>

                    {/* ★ NO approve/reject buttons — info chip only */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
                      <div className="review-info-chip">
                        ⏳ Waiting for Admin review
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── UPLOAD TAB ── */}
        {tab === 'upload' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">☁️ Upload CSV to Google Drive</div>
                <div className="card-sub">File is validated → uploaded to Drive → automation runs → designers get assigned</div>
              </div>
            </div>
            <div className="card-body">
              <div className="info-row">
                <span>📁</span>
                <span style={{ color: '#64748b' }}>Files go to <strong>agency-planners</strong> Drive folder</span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#22c55e', fontWeight: 700 }}>✓ Connected</span>
              </div>

              {!selectedFile ? (
                <div
                  className={`upload-zone${dragging ? ' drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragging(true) }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                >
                  <input type="file" accept=".csv" className="upload-input" onChange={e => handleFileSelect(e.target.files[0])}/>
                  <div style={{ fontSize: 40, marginBottom: 12 }}>📁</div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: '#4b5563', marginBottom: 5 }}>Click to browse or drag & drop CSV</div>
                  <div style={{ fontSize: 13, color: '#94a3b8' }}>File will be validated before upload</div>
                </div>
              ) : (
                <div>
                  <div className="file-preview">
                    <span style={{ fontSize: 24 }}>📄</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>{selectedFile.name}</div>
                      <div style={{ fontSize: 12, color: '#16a34a' }}>{(selectedFile.size / 1024).toFixed(1)} KB</div>
                    </div>
                    <button onClick={() => { setSelectedFile(null); setValidation(null); setUploadResult(null) }}
                      style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
                  </div>

                  {validation && (
                    <div className="val-box" style={{ background: validation.valid ? '#f0fdf4' : '#fef2f2', border: `1.5px solid ${validation.valid ? '#86efac' : '#fecaca'}` }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: validation.valid ? '#15803d' : '#dc2626', marginBottom: 8 }}>
                        {validation.valid ? '✅ CSV Validation Passed' : '❌ CSV Validation Failed'}
                      </div>
                      {validation.valid ? (
                        <div className="val-item" style={{ color: '#15803d' }}>
                          📊 {validation.rowCount} rows found · Columns: {validation.headers?.join(', ')}
                        </div>
                      ) : (
                        validation.errors.map((err, i) => (
                          <div key={i} className="val-item" style={{ color: '#dc2626' }}>⚠️ {err}</div>
                        ))
                      )}
                    </div>
                  )}

                  {validation?.valid && (
                    <div style={{ background: '#f8fafc', borderRadius: 12, border: '1px solid #e2e8f0', padding: '16px 18px' }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 10 }}>📋 Upload Summary</div>
                      {[
                        { label: 'File',        value: `📄 ${selectedFile.name}` },
                        { label: 'Rows',        value: `📊 ${validation.rowCount} tasks` },
                        { label: 'Destination', value: '📁 agency-planners (Drive)' },
                        { label: 'Uploaded by', value: `👤 ${user?.name}` },
                        { label: 'Auto-assign', value: '⚡ Runs after upload' },
                      ].map(r => (
                        <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                          <span style={{ color: '#94a3b8', fontWeight: 600 }}>{r.label}</span>
                          <span style={{ fontWeight: 700, color: '#1e293b' }}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <button className="upload-btn" onClick={handleUpload} disabled={uploading || !validation?.valid}>
                    {uploading ? '⏳ Uploading & auto-assigning...' : validation?.valid ? '☁️ Upload to Drive & Auto-Assign →' : '❌ Fix CSV errors first'}
                  </button>
                </div>
              )}

              {uploadResult && (
                <div>
                  <div className="result-box" style={{
                    background: uploadResult.success ? '#f0fdf4' : '#fef2f2',
                    border: `1.5px solid ${uploadResult.success ? '#86efac' : '#fecaca'}`,
                    color: uploadResult.success ? '#15803d' : '#dc2626',
                  }}>
                    {uploadResult.success
                      ? `✅ Uploaded! ${uploadResult.data?.stats?.inserted || 0} tasks assigned to designers ⚡`
                      : `❌ ${uploadResult.error}`}
                  </div>
                  {uploadResult.success && uploadToken && (
                    <div className="token-box">
                      <span style={{ fontSize: 20 }}>🔖</span>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#1d4ed8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Upload Token</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: '#1e40af', fontFamily: 'monospace', wordBreak: 'break-all' }}>{uploadToken}</div>
                      </div>
                    </div>
                  )}
                  <button onClick={() => { setUploadResult(null); setUploadToken(null) }}
                    style={{ marginTop: 12, width: '100%', padding: '10px', borderRadius: 10, border: '1.5px solid #e2e8f0', background: '#fff', color: '#64748b', fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Upload Another File
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MY TASKS TAB ── */}
        {tab === 'tasks' && (
          <div className="card">
            <div className="card-header">
              <div>
                <div className="card-title">📋 My Tasks</div>
                <div className="card-sub">Tasks created from your CSV uploads — Admin handles approvals</div>
              </div>
              <button className="btn-refresh" onClick={loadTasks}>↻ Refresh</button>
            </div>

            {loading ? (
              <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8', fontSize: 14 }}>⏳ Loading tasks...</div>
            ) : tasks.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📭</div><div className="empty-text">No tasks yet — upload a CSV to get started!</div></div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table>
                  <thead>
                    <tr>
                      {['Task ID', 'Client', 'Type', 'Requirements', 'Deadline', 'Designer', 'Status', 'Submitted File'].map(h => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(task => {
                      const overdue = isOverdue(task.end_date) && task.status !== 'Completed'
                      return (
                        <tr key={task.id} style={{
                          background: task.status === 'Completed' ? '#f0fdf4' :
                                      task.status === 'Submitted'  ? '#fff9f5' :
                                      overdue ? '#fff7f7' : undefined
                        }}>
                          <td><span style={{ fontWeight: 800, color: '#7c3aed', fontSize: 12 }}>{task.task_id || '—'}</span></td>
                          <td style={{ fontWeight: 600, color: '#1e293b' }}>{task.client_name || '—'}</td>
                          <td><Badge label={task.task_type || '—'} style={typeStyle[task.task_type]}/></td>
                          <td style={{ maxWidth: 160, fontSize: 12, color: '#64748b' }}>
                            {task.requirements
                              ? <span title={task.requirements}>{task.requirements.slice(0, 50)}{task.requirements.length > 50 ? '…' : ''}</span>
                              : <span style={{ color: '#cbd5e1' }}>—</span>}
                          </td>
                          <td>
                            <span style={{ color: overdue ? '#dc2626' : '#64748b', fontWeight: overdue ? 700 : 500 }}>
                              {task.end_date || '—'}
                            </span>
                            {overdue && <span className="overdue-badge">⚠ Overdue</span>}
                          </td>
                          <td>
                            {task.assigned_designer
                              ? <span style={{ fontWeight: 700, color: '#374151' }}>{task.assigned_designer}</span>
                              : <span style={{ color: '#cbd5e1', fontStyle: 'italic' }}>Not assigned</span>}
                          </td>
                          <td>
                            {/* ★ Status display only — no action buttons */}
                            {task.status === 'Completed' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                                <div className="status-chip-completed">✅ Approved by Admin</div>
                                {task.reviewed_date && (
                                  <div style={{ fontSize: 10, color: '#94a3b8', paddingLeft: 4 }}>
                                    {new Date(task.reviewed_date).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                  </div>
                                )}
                              </div>
                            )}
                            {task.status === 'Submitted' && (
                              <div className="review-info-chip">⏳ Admin reviewing...</div>
                            )}
                            {task.status === 'In Progress' && (
                              <div className="status-chip-inprogress">
                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#8b5cf6', display: 'inline-block', animation: 'pulse 1.5s infinite' }}/>
                                Ongoing
                              </div>
                            )}
                            {(task.status === 'Assigned' || task.status === 'Pending') && (
                              <div className="status-chip-assigned">🕐 Not Started</div>
                            )}
                            {task.status === 'Rejected' && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                <div className="status-chip-rejected">❌ Revision Needed</div>
                                {task.manager_note && (
                                  <div className="admin-note">💬 {task.manager_note}</div>
                                )}
                              </div>
                            )}
                          </td>
                          {/* ★ View submitted file column */}
                          <td>
                            {task.submission_file_link
                              ? <a href={task.submission_file_link} target="_blank" rel="noopener noreferrer" className="file-link">📎 View</a>
                              : <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}