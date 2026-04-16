import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../contexts/AuthContext'

const API = 'http://localhost:5000'

const statusStyle = {
  'Pending':     { bg: '#fffbeb', text: '#b45309', dot: '#f59e0b' },
  'Assigned':    { bg: '#eff6ff', text: '#1d4ed8', dot: '#3b82f6' },
  'In Progress': { bg: '#f5f3ff', text: '#6d28d9', dot: '#8b5cf6' },
  'Submitted':   { bg: '#fff7ed', text: '#c2410c', dot: '#f97316' },
  'Completed':   { bg: '#f0fdf4', text: '#15803d', dot: '#22c55e' },
  'Rejected':    { bg: '#fef2f2', text: '#dc2626', dot: '#ef4444' },
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

function isOverdue(endDate, today) {
  if (!endDate || !today) return false
  return endDate < today
}

function Spinner({ size = 16, color = '#fff' }) {
  return (
    <span style={{
      display: 'inline-block', width: size, height: size,
      border: `2px solid rgba(255,255,255,0.3)`,
      borderTop: `2px solid ${color}`,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }}/>
  )
}

export default function DesignerDashboard() {
  const { user, logout } = useAuth()

  const [serverToday, setServerToday]       = useState('')
  const [serverTomorrow, setServerTomorrow] = useState('')
  // ★ showTomorrow = after 4:30PM (server sends this)
  const [showTomorrow, setShowTomorrow]     = useState(false)

  const [tasks, setTasks]                   = useState([])
  const [loading, setLoading]               = useState(true)
  const [stats, setStats]                   = useState({ total: 0, pending: 0, inProgress: 0, submitted: 0, completed: 0, rejected: 0 })
  const [startingTask, setStartingTask]     = useState({})

  const [submitTask, setSubmitTask]         = useState(null)
  const [submitFile, setSubmitFile]         = useState(null)
  const [submitNote, setSubmitNote]         = useState('')
  const [submitting, setSubmitting]         = useState(false)
  const [submitResult, setSubmitResult]     = useState(null)
  const [dragOver, setDragOver]             = useState(false)

  const [notifications, setNotifications]   = useState([])
  const [showNotif, setShowNotif]           = useState(false)

  const [showLeaveModal, setShowLeaveModal] = useState(false)
  const [leaveDate, setLeaveDate]           = useState('')
  const [leaveReason, setLeaveReason]       = useState('')
  const [leaveSubmitting, setLeaveSubmitting] = useState(false)
  const [leaveStatus, setLeaveStatus]       = useState(null)

  const fileRef = useRef()

  useEffect(() => {
    loadTasks()
    fetchNotifications()
    fetchLeaveStatus()
    recordLogin()
  }, [])

  const token       = () => localStorage.getItem('token')
  const headers     = () => ({ Authorization: `Bearer ${token()}` })
  const jsonHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` })

  const recordLogin = async () => {
    try { await fetch(`${API}/api/designer/login-ping`, { method: 'POST', headers: headers() }) }
    catch (_) {}
  }

  const fetchLeaveStatus = async () => {
    try {
      const res  = await fetch(`${API}/api/designer/leave-status`, { headers: headers() })
      const data = await res.json()
      setLeaveStatus(data.status || null)
    } catch (_) {}
  }

  const loadTasks = async () => {
    setLoading(true)
    try {
      const res  = await fetch(`${API}/api/designer/tasks`, { headers: headers() })
      const data = await res.json()
      const t    = data.tasks || []

      // ★ Server controls today, tomorrow, showTomorrow (after 4:30PM IST)
      if (data.today)    setServerToday(data.today)
      if (data.tomorrow) setServerTomorrow(data.tomorrow)
      setShowTomorrow(data.showTomorrow || false)

      setTasks(t)
      setStats({
        total:      t.filter(x => x.end_date === data.today).length, // count today only
        pending:    t.filter(x => (x.status === 'Pending' || x.status === 'Assigned') && x.end_date === data.today).length,
        inProgress: t.filter(x => x.status === 'In Progress' && x.end_date === data.today).length,
        submitted:  t.filter(x => x.status === 'Submitted' && x.end_date === data.today).length,
        completed:  t.filter(x => x.status === 'Completed' && x.end_date === data.today).length,
        rejected:   t.filter(x => x.status === 'Rejected' && x.end_date === data.today).length,
      })
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const fetchNotifications = async () => {
    try {
      const res  = await fetch(`${API}/api/designer/notifications`, { headers: headers() })
      const data = await res.json()
      setNotifications(data.notifications || [])
    } catch (_) {}
  }

  const handleStartWork = async (taskId) => {
    setStartingTask(prev => ({ ...prev, [taskId]: true }))
    try {
      const res  = await fetch(`${API}/api/designer/task`, {
        method: 'PUT',
        headers: jsonHeaders(),
        body: JSON.stringify({ taskId, status: 'In Progress' })
      })
      const data = await res.json()
      if (data.success) {
        setTasks(prev => prev.map(t => t.task_id === taskId ? { ...t, status: 'In Progress' } : t))
        setStats(prev => ({ ...prev, pending: prev.pending - 1, inProgress: prev.inProgress + 1 }))
        await fetchNotifications()
      }
    } catch (e) { console.error(e) }
    setStartingTask(prev => ({ ...prev, [taskId]: false }))
  }

  const getAllowedFormats = (taskType) => {
    if (taskType === 'Reel')
      return { exts: ['.mp4', '.mov', '.avi'], accept: 'video/mp4,video/quicktime,video/x-msvideo', label: 'MP4, MOV, AVI', icon: '🎬' }
    if (taskType === 'Poster')
      return { exts: ['.png', '.jpg', '.jpeg'], accept: 'image/png,image/jpeg', label: 'PNG, JPG', icon: '🖼️' }
    if (taskType === 'Google Ads' || taskType === 'Ads')
      return { exts: ['.png', '.jpg', '.jpeg', '.gif', '.mp4', '.zip'], accept: 'image/png,image/jpeg,image/gif,video/mp4,application/zip', label: 'PNG, JPG, GIF, MP4, ZIP', icon: '📢' }
    return { exts: [], accept: '*/*', label: 'Any file', icon: '📁' }
  }

  const handleFileSelect = (file) => {
    if (!file) return
    const fmt = getAllowedFormats(submitTask?.task_type)
    if (fmt.exts.length && !fmt.exts.some(ext => file.name.toLowerCase().endsWith(ext))) {
      setSubmitResult({ success: false, error: `Wrong format! "${submitTask?.task_type}" only accepts: ${fmt.label}` })
      if (fileRef.current) fileRef.current.value = ''
      return
    }
    setSubmitResult(null)
    setSubmitFile(file)
  }

  const handleSubmit = async () => {
    if (!submitTask || !submitFile) { setSubmitResult({ success: false, error: 'Please select a file' }); return }
    setSubmitting(true)
    setSubmitResult(null)
    try {
      const formData = new FormData()
      formData.append('file', submitFile)
      formData.append('taskId', submitTask.task_id)
      formData.append('note', submitNote)
      const res  = await fetch(`${API}/api/designer/submit-task`, { method: 'POST', headers: headers(), body: formData })
      const data = await res.json()
      if (data.success || res.ok) {
        setSubmitResult({ success: true, message: '✅ Submitted for review!' })
        setTimeout(() => { setSubmitTask(null); setSubmitFile(null); setSubmitNote(''); setSubmitResult(null) }, 2000)
        await loadTasks()
        await fetchNotifications()
      } else {
        setSubmitResult({ success: false, error: data.error || 'Submit failed' })
      }
    } catch (e) { setSubmitResult({ success: false, error: e.message }) }
    setSubmitting(false)
  }

  const handleLeaveSubmit = async () => {
    if (!leaveDate) return
    setLeaveSubmitting(true)
    try {
      const res = await fetch(`${API}/api/designer/leave`, {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ leaveDate, reason: leaveReason })
      })
      if (res.ok) {
        setLeaveStatus('pending')
        setShowLeaveModal(false)
        setLeaveDate('')
        setLeaveReason('')
        alert('✅ Leave request submitted!')
      }
    } catch (e) { console.error(e) }
    setLeaveSubmitting(false)
  }

  const unread     = notifications.filter(n => !n.is_read).length
  const initials   = user?.name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || 'D'
  const completion = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0

  // ★ Split tasks — today vs tomorrow
  const todayTasks    = tasks.filter(t => t.end_date === serverToday)
  const tomorrowTasks = tasks.filter(t => t.end_date === serverTomorrow)

  // ★ 4PM alert — only show if after 4:30PM AND today has unsubmitted tasks
  const has4PMAlert = showTomorrow && todayTasks.some(t => t.status !== 'Completed' && t.status !== 'Submitted')

  const S = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800;900&family=Fraunces:wght@700&display=swap');
    @keyframes spin    { to { transform: rotate(360deg); } }
    @keyframes pulse   { 0%,100%{opacity:1} 50%{opacity:0.5} }
    @keyframes slideUp { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    .dash { min-height: 100vh; background: #f4f6fb; font-family: 'Outfit', sans-serif; }
    .header { background: #fff; border-bottom: 1px solid #e8edf4; padding: 0 32px; height: 64px; display: flex; align-items: center; justify-content: space-between; position: sticky; top: 0; z-index: 100; box-shadow: 0 2px 8px rgba(0,0,0,0.04); }
    .logo { display: flex; align-items: center; gap: 10px; }
    .logo-icon { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #059669, #0d9488); display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .logo-text { font-family: 'Fraunces', serif; font-size: 17px; font-weight: 700; color: #1e293b; }
    .header-right { display: flex; align-items: center; gap: 12px; position: relative; }
    .avatar { width: 36px; height: 36px; border-radius: 50%; background: linear-gradient(135deg, #059669, #0d9488); display: flex; align-items: center; justify-content: center; font-size: 13px; font-weight: 700; color: #fff; }
    .logout-btn { padding: 7px 16px; border-radius: 8px; border: 1.5px solid #e2e8f0; background: #fff; color: #64748b; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .logout-btn:hover { background: #fef2f2; border-color: #fca5a5; color: #dc2626; }
    .leave-btn { padding: 7px 16px; border-radius: 8px; border: 1.5px solid #fed7aa; background: #fff7ed; color: #c2410c; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .notif-btn { position: relative; width: 38px; height: 38px; border-radius: 10px; border: 1.5px solid #e2e8f0; background: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 17px; }
    .notif-badge { position: absolute; top: -4px; right: -4px; width: 17px; height: 17px; border-radius: 50%; background: #ef4444; color: #fff; font-size: 10px; font-weight: 800; display: flex; align-items: center; justify-content: center; border: 2px solid #fff; }
    .notif-panel { position: absolute; top: 54px; right: 0; width: 360px; background: #fff; border-radius: 16px; border: 1px solid #e8edf4; box-shadow: 0 12px 40px rgba(0,0,0,0.12); z-index: 200; overflow: hidden; animation: slideUp 0.2s ease; }

    /* ★ Alert banners */
    .alert-banner { padding: 12px 24px; display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 700; }
    .alert-4pm { background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; }
    .alert-tomorrow { background: linear-gradient(135deg, #7c3aed, #4f46e5); color: #fff; }

    .main { max-width: 1200px; margin: 0 auto; padding: 28px 24px; }
    .page-title { font-family: 'Fraunces', serif; font-size: 24px; font-weight: 700; color: #1e293b; margin-bottom: 4px; }
    .page-sub { font-size: 13px; color: #94a3b8; margin-bottom: 24px; }
    .stats-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 12px; margin-bottom: 24px; }
    .stat-card { background: #fff; border-radius: 16px; padding: 18px 12px; border: 1px solid #e8edf4; display: flex; align-items: center; justify-content: space-between; box-shadow: 0 2px 8px rgba(0,0,0,0.03); }
    .stat-label { font-size: 10px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px; }
    .stat-value { font-size: 24px; font-weight: 800; line-height: 1; }
    .stat-icon { width: 36px; height: 36px; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .progress-card { background: linear-gradient(135deg, #059669, #0d9488); border-radius: 16px; padding: 20px 24px; margin-bottom: 24px; display: flex; align-items: center; gap: 24px; box-shadow: 0 6px 24px rgba(5,150,105,0.25); }
    .card { background: #fff; border-radius: 18px; border: 1px solid #e8edf4; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.03); margin-bottom: 20px; }
    .card-header { padding: 18px 24px; border-bottom: 1px solid #f1f5f9; display: flex; align-items: center; justify-content: space-between; }
    .card-title { font-size: 15px; font-weight: 700; color: #1e293b; }
    .card-sub { font-size: 12px; color: #94a3b8; margin-top: 2px; }
    .btn-refresh { padding: 9px 18px; border-radius: 10px; border: none; background: linear-gradient(135deg, #059669, #047857); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit; }
    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 11px 16px; text-align: left; font-size: 11px; font-weight: 800; color: #94a3b8; letter-spacing: 0.7px; text-transform: uppercase; background: #f8fafc; border-bottom: 1px solid #e8edf4; }
    tbody tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
    tbody tr:hover { background: #f0fdf4; }
    tbody td { padding: 12px 16px; font-size: 13px; color: #374151; font-weight: 500; vertical-align: middle; }
    .btn-start { padding: 8px 16px; border-radius: 8px; border: none; background: linear-gradient(135deg, #2563eb, #1d4ed8); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 7px; transition: all 0.2s; min-width: 110px; justify-content: center; }
    .btn-start:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(37,99,235,0.3); }
    .btn-start:disabled { opacity: 0.7; cursor: not-allowed; transform: none; }
    .btn-submit { padding: 8px 16px; border-radius: 8px; border: none; background: linear-gradient(135deg, #059669, #047857); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; display: inline-flex; align-items: center; gap: 5px; transition: all 0.2s; }
    .btn-submit:hover { opacity: 0.9; transform: translateY(-1px); }
    .btn-resubmit { padding: 8px 16px; border-radius: 8px; border: none; background: linear-gradient(135deg, #f97316, #ea580c); color: #fff; font-size: 12px; font-weight: 700; cursor: pointer; font-family: inherit; transition: all 0.2s; }
    .btn-resubmit:hover { opacity: 0.9; transform: translateY(-1px); }
    .submitted-chip { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 8px; background: #fff7ed; border: 1.5px solid #fed7aa; color: #c2410c; font-size: 11px; font-weight: 700; animation: pulse 2s infinite; }
    .completed-chip { display: inline-flex; align-items: center; gap: 5px; padding: 6px 12px; border-radius: 8px; background: #f0fdf4; border: 1.5px solid #86efac; color: #15803d; font-size: 11px; font-weight: 700; }
    .overdue-badge { display: inline-flex; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 800; background: #fef2f2; color: #dc2626; margin-left: 5px; }
    .tomorrow-label { display: inline-flex; padding: 2px 7px; border-radius: 5px; font-size: 10px; font-weight: 800; background: #f5f3ff; color: #7c3aed; margin-left: 5px; }

    /* ★ Section divider for today vs tomorrow */
    .section-divider { padding: 10px 16px; background: #f5f3ff; border-bottom: 1px solid #e8edf4; }
    .section-divider-label { font-size: 11px; font-weight: 800; color: #7c3aed; text-transform: uppercase; letter-spacing: 0.7px; }

    .empty-state { text-align: center; padding: 48px 24px; }
    .empty-icon { font-size: 42px; margin-bottom: 12px; }
    .empty-text { font-size: 14px; color: #94a3b8; font-weight: 500; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 300; backdrop-filter: blur(4px); }
    .modal { background: #fff; border-radius: 20px; width: 520px; max-width: 95vw; box-shadow: 0 24px 60px rgba(0,0,0,0.2); overflow: hidden; animation: slideUp 0.25s ease; }
    .modal-head { padding: 20px 24px; background: linear-gradient(135deg, #059669, #0d9488); color: #fff; }
    .modal-title { font-size: 17px; font-weight: 800; }
    .modal-sub { font-size: 12px; opacity: 0.8; margin-top: 3px; }
    .modal-body { padding: 22px 24px; }
    .format-hint { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border-radius: 10px; background: #eff6ff; border: 1.5px solid #bfdbfe; margin-bottom: 12px; font-size: 12px; font-weight: 700; color: #1d4ed8; }
    .req-box { background: #eff6ff; border: 1.5px solid #bfdbfe; border-radius: 10px; padding: 10px 14px; margin-bottom: 12px; font-size: 12px; color: #1d4ed8; font-weight: 600; }
    .upload-zone { border: 2px dashed #86efac; border-radius: 14px; padding: 28px 20px; text-align: center; cursor: pointer; background: #f0fdf4; position: relative; transition: all 0.2s; }
    .upload-zone.drag { border-color: #059669; background: #dcfce7; }
    .upload-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%; height: 100%; }
    .file-chosen { display: flex; align-items: center; gap: 10px; padding: 12px 16px; background: #f0fdf4; border-radius: 12px; border: 1.5px solid #86efac; margin-top: 12px; }
    .modal-textarea { width: 100%; min-height: 80px; padding: 12px 14px; border: 1.5px solid #e2e8f0; border-radius: 12px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; margin-top: 12px; }
    .modal-textarea:focus { border-color: #059669; }
    .modal-actions { display: flex; gap: 10px; margin-top: 16px; }
    .btn-save { flex: 1; padding: 13px; border-radius: 10px; border: none; background: linear-gradient(135deg, #059669, #047857); color: #fff; font-size: 14px; font-weight: 800; cursor: pointer; font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 8px; }
    .btn-save:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-cancel { flex: 0 0 90px; padding: 13px; border-radius: 10px; border: 1.5px solid #e2e8f0; background: #fff; color: #64748b; font-size: 14px; font-weight: 700; cursor: pointer; font-family: inherit; }
    .input-field { width: 100%; padding: 11px 14px; border: 1.5px solid #e2e8f0; border-radius: 10px; font-size: 13px; font-family: inherit; font-weight: 600; color: #1e293b; outline: none; }
    .label { font-size: 12px; font-weight: 700; color: #64748b; margin-bottom: 6px; display: block; }
    .result-success { padding: 14px; border-radius: 12px; background: #f0fdf4; border: 1.5px solid #86efac; color: #15803d; font-size: 14px; font-weight: 700; text-align: center; margin-top: 12px; }
    .result-error { padding: 14px; border-radius: 12px; background: #fef2f2; border: 1.5px solid #fecaca; color: #dc2626; font-size: 14px; font-weight: 700; text-align: center; margin-top: 12px; }
    @media(max-width:900px){ .stats-grid{ grid-template-columns: repeat(3, 1fr); } }
  `

  return (
    <div className="dash">
      <style>{S}</style>

      {/* ★ 4PM Alert — only shows after 4:30PM if today tasks are not all done */}
      {has4PMAlert && (
        <div className="alert-banner alert-4pm">
          ⏰ Deadline approaching! Submit pending tasks before 6 PM.
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.8 }}>Today: {serverToday}</span>
        </div>
      )}

      {/* ★ Tomorrow preview banner — shows after 4:30PM if tomorrow has tasks */}
      {showTomorrow && tomorrowTasks.length > 0 && (
        <div className="alert-banner alert-tomorrow">
          🌙 Tomorrow's tasks preview: {tomorrowTasks.length} task{tomorrowTasks.length > 1 ? 's' : ''} assigned
          <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.8 }}>{serverTomorrow}</span>
        </div>
      )}

      <header className="header">
        <div className="logo">
          <div className="logo-icon">🎨</div>
          <span className="logo-text">Agency Automation</span>
        </div>
        <div className="header-right">
          {leaveStatus === 'pending'  && <div style={{ padding: '6px 14px', borderRadius: 8, background: '#fffbeb', border: '1.5px solid #fde68a', color: '#b45309', fontSize: 12, fontWeight: 700 }}>⏳ Leave Pending</div>}
          {leaveStatus === 'approved' && <div style={{ padding: '6px 14px', borderRadius: 8, background: '#f0fdf4', border: '1.5px solid #86efac', color: '#15803d', fontSize: 12, fontWeight: 700 }}>✅ Leave Approved</div>}
          {!leaveStatus && <button className="leave-btn" onClick={() => setShowLeaveModal(true)}>🏖️ Request Leave</button>}

          <button className="notif-btn" onClick={() => setShowNotif(p => !p)}>
            🔔 {unread > 0 && <span className="notif-badge">{unread}</span>}
          </button>

          {showNotif && (
            <div className="notif-panel">
              <div style={{ padding: '14px 18px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>Notifications</span>
                <button onClick={() => setShowNotif(false)} style={{ fontSize: 11, color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600 }}>Close</button>
              </div>
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {notifications.length === 0
                  ? <div style={{ padding: 24, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>No notifications</div>
                  : notifications.map(n => (
                    <div key={n.id} style={{ padding: '12px 18px', borderBottom: '1px solid #f8fafc', fontSize: 13, background: n.is_read ? '#fff' : '#f8faff' }}>
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
        <div className="page-title">🎨 Designer Dashboard</div>
        <div className="page-sub">Start work → Submit file → Admin reviews → ✅ Completed</div>

        {/* Progress */}
        <div className="progress-card">
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,0.85)', marginBottom: 6 }}>Today's Completion</div>
            <div style={{ fontSize: 32, fontWeight: 900, color: '#fff', marginBottom: 4 }}>{completion}%</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>{stats.completed} of {stats.total} tasks approved</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ height: 10, background: 'rgba(255,255,255,0.2)', borderRadius: 99, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${completion}%`, background: '#fff', borderRadius: 99, transition: 'width 0.8s ease' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: 'rgba(255,255,255,0.65)', fontWeight: 600 }}>
              <span>0%</span><span>50%</span><span>100%</span>
            </div>
          </div>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: 28, fontWeight: 900, color: '#fff' }}>{stats.submitted}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>In Review</div>
          </div>
        </div>

        {/* Stats — today tasks only */}
        <div className="stats-grid">
          {[
            { label: 'Total',       value: stats.total,      icon: '📋', color: '#7c3aed', bg: '#f5f3ff' },
            { label: 'To Do',       value: stats.pending,    icon: '⏳', color: '#d97706', bg: '#fffbeb' },
            { label: 'In Progress', value: stats.inProgress, icon: '⚡', color: '#2563eb', bg: '#eff6ff' },
            { label: 'In Review',   value: stats.submitted,  icon: '📤', color: '#c2410c', bg: '#fff7ed' },
            { label: 'Rejected',    value: stats.rejected,   icon: '❌', color: '#dc2626', bg: '#fef2f2' },
            { label: 'Completed',   value: stats.completed,  icon: '✅', color: '#059669', bg: '#f0fdf4' },
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

        {/* Tasks Table */}
        <div className="card">
          <div className="card-header">
            <div>
              <div className="card-title">
                📋 {showTomorrow ? `Today + Tomorrow's Tasks` : `Today's Tasks`} — {serverToday}
              </div>
              <div className="card-sub">
                {showTomorrow
                  ? `Today: ${todayTasks.length} tasks · Tomorrow preview: ${tomorrowTasks.length} tasks`
                  : `▶ Start → 📤 Submit → Admin reviews → ✅ Done`}
              </div>
            </div>
            <button className="btn-refresh" onClick={loadTasks}>↻ Refresh</button>
          </div>

          {loading
            ? <div style={{ textAlign: 'center', padding: '48px 0', color: '#94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                <Spinner size={20} color="#059669" /> Loading tasks...
              </div>
            : todayTasks.length === 0 && tomorrowTasks.length === 0
              ? <div className="empty-state"><div className="empty-icon">✅</div><div className="empty-text">No tasks for today!</div></div>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table>
                    <thead>
                      <tr>{['Task ID','Client','Type','Requirements','Deadline','Status','Action','Admin Note'].map(h => <th key={h}>{h}</th>)}</tr>
                    </thead>
                    <tbody>
                      {/* ★ TODAY TASKS */}
                      {todayTasks.length > 0 && (
                        <tr>
                          <td colSpan={8} style={{ padding: 0, background: '#f0fdf4' }}>
                            <div className="section-divider" style={{ background: '#f0fdf4' }}>
                              <span className="section-divider-label" style={{ color: '#059669' }}>📅 Today — {serverToday}</span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {todayTasks.map(task => {
                        const overdue    = isOverdue(task.end_date, serverToday) && task.status !== 'Completed'
                        const isStarting = startingTask[task.task_id]
                        return (
                          <tr key={task.id} style={{ background: overdue ? '#fff7f7' : undefined }}>
                            <td><span style={{ fontWeight: 800, color: '#059669', fontSize: 12 }}>{task.task_id || '—'}</span></td>
                            <td style={{ fontWeight: 600, color: '#1e293b' }}>{task.client_name || '—'}</td>
                            <td><Badge label={task.task_type || '—'} style={typeStyle[task.task_type]} /></td>
                            <td style={{ maxWidth: 200, fontSize: 12, color: '#64748b' }}>
                              {task.requirements
                                ? <span title={task.requirements}>{task.requirements.slice(0, 55)}{task.requirements.length > 55 ? '…' : ''}</span>
                                : <span style={{ color: '#cbd5e1' }}>—</span>}
                            </td>
                            <td>
                              <span style={{ color: overdue ? '#dc2626' : '#64748b', fontWeight: overdue ? 700 : 500, fontSize: 13 }}>{task.end_date || '—'}</span>
                              {overdue && <span className="overdue-badge">⚠ Overdue</span>}
                            </td>
                            <td><Badge label={task.status || 'Pending'} style={statusStyle[task.status]} /></td>
                            <td>
                              {task.status === 'Completed' && <div className="completed-chip">✅ Approved</div>}
                              {task.status === 'Submitted' && <div className="submitted-chip">⏳ Admin reviewing…</div>}
                              {task.status === 'Rejected' && (
                                <button className="btn-resubmit" onClick={() => { setSubmitFile(null); setSubmitResult(null); setSubmitTask(task) }}>
                                  🔄 Resubmit
                                </button>
                              )}
                              {(task.status === 'Pending' || task.status === 'Assigned') && (
                                <button className="btn-start" onClick={() => handleStartWork(task.task_id)} disabled={isStarting}>
                                  {isStarting ? <><Spinner size={13} color="#fff" /> Starting…</> : <>▶ Start Work</>}
                                </button>
                              )}
                              {task.status === 'In Progress' && (
                                <button className="btn-submit" onClick={() => { setSubmitFile(null); setSubmitResult(null); setSubmitTask(task) }}>
                                  📤 Submit
                                </button>
                              )}
                            </td>
                            <td>
                              {task.manager_note
                                ? <div style={{ fontSize: 12, color: task.status === 'Rejected' ? '#dc2626' : '#64748b', fontWeight: 600, maxWidth: 160 }}>
                                    {task.status === 'Rejected' && '❌ '}{task.manager_note}
                                  </div>
                                : <span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span>}
                            </td>
                          </tr>
                        )
                      })}

                      {/* ★ TOMORROW TASKS — only after 4:30PM, read-only */}
                      {showTomorrow && tomorrowTasks.length > 0 && (
                        <>
                          <tr>
                            <td colSpan={8} style={{ padding: 0 }}>
                              <div className="section-divider">
                                <span className="section-divider-label">🌙 Tomorrow Preview — {serverTomorrow} (Read only)</span>
                              </div>
                            </td>
                          </tr>
                          {tomorrowTasks.map(task => (
                            <tr key={task.id} style={{ background: '#faf8ff', opacity: 0.85 }}>
                              <td>
                                <span style={{ fontWeight: 800, color: '#7c3aed', fontSize: 12 }}>{task.task_id || '—'}</span>
                                <span className="tomorrow-label">🔜 Tomorrow</span>
                              </td>
                              <td style={{ fontWeight: 600, color: '#1e293b' }}>{task.client_name || '—'}</td>
                              <td><Badge label={task.task_type || '—'} style={typeStyle[task.task_type]} /></td>
                              <td style={{ maxWidth: 200, fontSize: 12, color: '#64748b' }}>
                                {task.requirements
                                  ? <span title={task.requirements}>{task.requirements.slice(0, 55)}{task.requirements.length > 55 ? '…' : ''}</span>
                                  : <span style={{ color: '#cbd5e1' }}>—</span>}
                              </td>
                              <td><span style={{ color: '#7c3aed', fontWeight: 600, fontSize: 13 }}>{task.end_date}</span></td>
                              <td><Badge label={task.status || 'Assigned'} style={statusStyle[task.status]} /></td>
                              {/* ★ No action buttons for tomorrow tasks */}
                              <td><span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>Available tomorrow</span></td>
                              <td><span style={{ color: '#cbd5e1', fontSize: 12 }}>—</span></td>
                            </tr>
                          ))}
                        </>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
        </div>
      </main>

      {/* SUBMIT MODAL */}
      {submitTask && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && !submitting && setSubmitTask(null)}>
          <div className="modal">
            <div className="modal-head">
              <div className="modal-title">📤 Submit Work for Review</div>
              <div className="modal-sub">{submitTask.task_id} — {submitTask.client_name} ({submitTask.task_type})</div>
            </div>
            <div className="modal-body">
              {(() => {
                const fmt = getAllowedFormats(submitTask.task_type)
                return (
                  <div className="format-hint">
                    <span style={{ fontSize: 18 }}>{fmt.icon}</span>
                    <span>{submitTask.task_type} → Accepted: <strong>{fmt.label}</strong></span>
                  </div>
                )
              })()}
              {submitTask.requirements && (
                <div className="req-box">📋 <strong>Requirements:</strong> {submitTask.requirements}</div>
              )}
              <div style={{ fontSize: 12, fontWeight: 700, color: '#64748b', marginBottom: 6 }}>UPLOAD FILE *</div>
              {!submitFile ? (
                <div
                  className={`upload-zone${dragOver ? ' drag' : ''}`}
                  onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); handleFileSelect(e.dataTransfer.files[0]) }}
                >
                  <input type="file" className="upload-input" ref={fileRef}
                    accept={getAllowedFormats(submitTask.task_type).accept}
                    onChange={e => handleFileSelect(e.target.files[0])} />
                  <div style={{ fontSize: 32, marginBottom: 8 }}>{getAllowedFormats(submitTask.task_type).icon}</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#15803d' }}>Click or drag & drop</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>Accepted: <strong>{getAllowedFormats(submitTask.task_type).label}</strong></div>
                </div>
              ) : (
                <div className="file-chosen">
                  <span style={{ fontSize: 24 }}>📄</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#15803d' }}>{submitFile.name}</div>
                    <div style={{ fontSize: 12, color: '#16a34a' }}>{(submitFile.size / 1024).toFixed(1)} KB</div>
                  </div>
                  <button onClick={() => { setSubmitFile(null); if (fileRef.current) fileRef.current.value = '' }}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 18 }}>✕</button>
                </div>
              )}
              <textarea className="modal-textarea" placeholder="Note for admin (optional)…" value={submitNote} onChange={e => setSubmitNote(e.target.value)} />
              {submitResult && (
                submitResult.success
                  ? <div className="result-success">{submitResult.message}</div>
                  : <div className="result-error">❌ {submitResult.error}</div>
              )}
              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => { setSubmitTask(null); setSubmitFile(null); setSubmitNote(''); setSubmitResult(null) }} disabled={submitting}>Cancel</button>
                <button className="btn-save" onClick={handleSubmit} disabled={submitting || !submitFile}>
                  {submitting ? <><Spinner size={14} /> Uploading…</> : '📤 Submit for Review →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* LEAVE MODAL */}
      {showLeaveModal && (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && setShowLeaveModal(false)}>
          <div className="modal" style={{ width: 420 }}>
            <div className="modal-head" style={{ background: 'linear-gradient(135deg,#f97316,#ea580c)' }}>
              <div className="modal-title">🏖️ Request Leave</div>
              <div className="modal-sub">Tasks will be auto-reassigned if approved</div>
            </div>
            <div className="modal-body">
              <div style={{ background: '#fff7ed', border: '1.5px solid #fed7aa', borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 13, color: '#c2410c', fontWeight: 600 }}>
                ⚠️ No login by 10:00 AM → tasks auto-reassigned
              </div>
              <div style={{ marginBottom: 14 }}>
                <label className="label">Leave Date *</label>
                <input type="date" className="input-field" value={leaveDate}
                  onChange={e => setLeaveDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]} />
              </div>
              <div>
                <label className="label">Reason (optional)</label>
                <textarea className="modal-textarea" style={{ marginTop: 0 }}
                  placeholder="Personal / Sick / Event…"
                  value={leaveReason} onChange={e => setLeaveReason(e.target.value)} rows={3} />
              </div>
              <div className="modal-actions">
                <button className="btn-cancel" onClick={() => setShowLeaveModal(false)}>Cancel</button>
                <button style={{ flex: 1, padding: 13, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#f97316,#ea580c)', color: '#fff', fontSize: 14, fontWeight: 800, cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  onClick={handleLeaveSubmit} disabled={leaveSubmitting || !leaveDate}>
                  {leaveSubmitting ? <><Spinner size={14}/> Sending…</> : '🏖️ Request Leave →'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}