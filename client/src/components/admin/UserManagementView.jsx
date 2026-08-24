import React, { useState, useEffect } from 'react';
import { Search, Trash2, Shield, User, ShieldCheck, ShieldAlert, Key, Clock, Check, X, Ban, RotateCcw } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ROLE_LABELS = {
  viewer: '조회 권한 (Viewer)',
  editor: '수정/삭제 권한 (Editor)',
  admin: '최고 관리자 권한 (Admin)',
};

const STATUS_BADGE = {
  ACTIVE: { label: '활성', bg: '#f6ffed', color: '#389e0d' },
  SUSPENDED: { label: '이용 정지', bg: '#fff1f0', color: '#cf1322' },
  REJECTED: { label: '거절됨', bg: '#fafafa', color: '#8c8c8c' },
  PENDING: { label: '승인 대기', bg: '#fffbe6', color: '#d48806' },
};

function UserManagementView({ showToast, currentUser }) {
  const [tab, setTab] = useState('pending'); // 'pending' | 'all'
  const [users, setUsers] = useState([]);
  const [pendingUsers, setPendingUsers] = useState([]);
  const [pendingRoleSelect, setPendingRoleSelect] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${currentUser?.token || ''}`
  });

  const fetchUsers = async () => {
    try {
      const response = await fetch(`${API_HOST}/api/users`, { headers: authHeaders() });
      const data = await response.json();
      if (response.ok) {
        setUsers(data);
      } else {
        showToast(data.message || '사용자 목록을 불러오지 못했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 실패', 'error');
    }
  };

  const fetchPendingUsers = async () => {
    try {
      const response = await fetch(`${API_HOST}/api/users/pending`, { headers: authHeaders() });
      const data = await response.json();
      if (response.ok) {
        setPendingUsers(data);
      } else {
        showToast(data.message || '승인 대기 목록을 불러오지 못했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 실패', 'error');
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([fetchUsers(), fetchPendingUsers()]);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleApprove = async (userId) => {
    const role = pendingRoleSelect[userId] || 'viewer';
    try {
      const response = await fetch(`${API_HOST}/api/users/${userId}/approve`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ role })
      });
      const data = await response.json();
      if (response.ok) {
        showToast('가입 신청을 승인했습니다.', 'success');
        setPendingUsers(prev => prev.filter(u => u._id !== userId));
        setUsers(prev => [...prev.filter(u => u._id !== userId), data]);
      } else {
        showToast(data.message || '승인 처리 실패', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    }
  };

  const handleReject = async (userId, name) => {
    const reason = window.prompt(`'${name}' 님의 가입을 거절합니다. 거절 사유를 입력해주세요 (선택):`, '');
    if (reason === null) return; // cancelled

    try {
      const response = await fetch(`${API_HOST}/api/users/${userId}/reject`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ reason })
      });
      const data = await response.json();
      if (response.ok) {
        showToast('가입 신청을 거절했습니다.', 'success');
        setPendingUsers(prev => prev.filter(u => u._id !== userId));
        setUsers(prev => [...prev.filter(u => u._id !== userId), data]);
      } else {
        showToast(data.message || '거절 처리 실패', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const response = await fetch(`${API_HOST}/api/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ role: newRole })
      });
      const data = await response.json();
      if (response.ok) {
        showToast('사용자 권한이 성공적으로 수정되었습니다.', 'success');
        setUsers(prev => prev.map(u => u._id === userId ? { ...u, role: newRole } : u));
      } else {
        showToast(data.message || '권한 수정 실패', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    }
  };

  const handleToggleSuspend = async (userId, currentStatus) => {
    const nextStatus = currentStatus === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED';
    const confirmMsg = nextStatus === 'SUSPENDED'
      ? '해당 사용자의 이용을 정지하시겠습니까?'
      : '해당 사용자의 이용 정지를 해제하시겠습니까?';
    if (!window.confirm(confirmMsg)) return;

    try {
      const response = await fetch(`${API_HOST}/api/users/${userId}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ status: nextStatus })
      });
      const data = await response.json();
      if (response.ok) {
        showToast(nextStatus === 'SUSPENDED' ? '사용자를 정지 처리했습니다.' : '이용 정지를 해제했습니다.', 'success');
        setUsers(prev => prev.map(u => u._id === userId ? { ...u, status: nextStatus } : u));
      } else {
        showToast(data.message || '상태 변경 실패', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    }
  };

  const handleDeleteUser = async (userId, name) => {
    if (userId === currentUser?._id) {
      showToast('자기 자신은 삭제할 수 없습니다.', 'error');
      return;
    }
    if (!window.confirm(`정말로 '${name}' 사용자를 탈퇴(삭제) 처리하시겠습니까?`)) {
      return;
    }
    try {
      const response = await fetch(`${API_HOST}/api/users/${userId}`, {
        method: 'DELETE',
        headers: authHeaders()
      });
      const data = await response.json();
      if (response.ok) {
        showToast('사용자가 성공적으로 삭제되었습니다.', 'success');
        setUsers(prev => prev.filter(u => u._id !== userId));
      } else {
        showToast(data.message || '사용자 삭제 실패', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 통신 오류', 'error');
    }
  };

  const filteredUsers = users.filter(user =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const tabButtonStyle = (isActive) => ({
    padding: '0.6rem 1.1rem',
    borderRadius: '8px',
    border: 'none',
    background: isActive ? 'var(--primary-glow)' : 'transparent',
    color: isActive ? 'var(--primary)' : 'var(--text-muted)',
    fontWeight: isActive ? '700' : '600',
    fontSize: '0.88rem',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem'
  });

  return (
    <div className="user-management-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#fff', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', maxWidth: '1200px', margin: '0 auto' }}>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Key style={{ color: 'var(--primary)' }} /> 사용자 권한 관리
        </h3>

        {tab === 'all' && (
          <div style={{ position: 'relative', width: '300px', maxWidth: '100%' }}>
            <input
              type="text"
              placeholder="이름 또는 이메일로 검색..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '0.5rem 1rem 0.5rem 2.2rem',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                fontSize: '0.85rem',
                outline: 'none',
                background: 'var(--bg-main)',
                color: '#333'
              }}
            />
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button style={tabButtonStyle(tab === 'pending')} onClick={() => setTab('pending')}>
          <Clock size={16} /> 승인 대기 {pendingUsers.length > 0 && `(${pendingUsers.length})`}
        </button>
        <button style={tabButtonStyle(tab === 'all')} onClick={() => setTab('all')}>
          <User size={16} /> 전체 회원
        </button>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <span>불러오는 중...</span>
        </div>
      ) : tab === 'pending' ? (
        pendingUsers.length === 0 ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
            <span>승인 대기 중인 신청이 없습니다.</span>
          </div>
        ) : (
          <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: '900px' }}>
              <thead>
                <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>신청자 정보</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>연락처</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>소속</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>신청 사유</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>신청일시</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>권한 부여</th>
                  <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)', textAlign: 'center' }}>처리</th>
                </tr>
              </thead>
              <tbody>
                {pendingUsers.map((user, idx) => {
                  const appliedDate = user.createdAt ? new Date(user.createdAt).toLocaleString('ko-KR') : '-';
                  return (
                    <tr key={user._id} style={{ borderBottom: '1px solid var(--border-color)', background: idx % 2 === 1 ? '#fcfcfc' : '#fff' }}>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: '700', color: 'var(--text-bright)' }}>{user.name}</span>
                          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{user.email}</span>
                        </div>
                      </td>
                      <td style={{ padding: '1rem', color: 'var(--text-main)' }}>{user.phone || '-'}</td>
                      <td style={{ padding: '1rem', color: 'var(--text-main)' }}>{user.department || '-'}</td>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)', maxWidth: '220px' }}>{user.applyReason || '-'}</td>
                      <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{appliedDate}</td>
                      <td style={{ padding: '1rem' }}>
                        <select
                          value={pendingRoleSelect[user._id] || 'viewer'}
                          onChange={(e) => setPendingRoleSelect(prev => ({ ...prev, [user._id]: e.target.value }))}
                          style={{
                            padding: '0.35rem 0.5rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.82rem',
                            fontWeight: '600',
                            background: '#fff',
                            color: '#333',
                            outline: 'none'
                          }}
                        >
                          <option value="viewer">조회 권한 (Viewer)</option>
                          <option value="editor">수정/삭제 권한 (Editor)</option>
                          <option value="admin">최고 관리자 권한 (Admin)</option>
                        </select>
                      </td>
                      <td style={{ padding: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.4rem', justifyContent: 'center' }}>
                          <button
                            onClick={() => handleApprove(user._id)}
                            title="승인"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#f6ffed', color: '#389e0d', border: '1px solid #b7eb8f', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                          >
                            <Check size={14} /> 승인
                          </button>
                          <button
                            onClick={() => handleReject(user._id, user.name)}
                            title="거절"
                            style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: '#fff1f0', color: '#cf1322', border: '1px solid #ffa39e', borderRadius: '6px', padding: '0.4rem 0.7rem', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600' }}
                          >
                            <X size={14} /> 거절
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : filteredUsers.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
          <span>등록된 사용자가 없거나 검색 결과가 없습니다.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: '800px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>사용자 정보</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>상태</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>가입일시</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>권한 설정</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)', textAlign: 'center' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, idx) => {
                const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleString('ko-KR') : '-';
                const isSelf = user._id === currentUser?._id;
                const statusInfo = STATUS_BADGE[user.status] || STATUS_BADGE.ACTIVE;

                return (
                  <tr key={user._id} style={{ borderBottom: '1px solid var(--border-color)', background: isSelf ? '#f0fdf4' : idx % 2 === 1 ? '#fcfcfc' : '#fff' }}>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: '700', color: 'var(--text-bright)' }}>
                          {user.name} {isSelf && <span style={{ fontSize: '0.7rem', background: 'var(--primary)', color: '#fff', padding: '0.1rem 0.3rem', borderRadius: '4px', marginLeft: '0.3rem' }}>나</span>}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{user.email}</span>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{user.department}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{
                        padding: '0.15rem 0.5rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        background: statusInfo.bg,
                        color: statusInfo.color
                      }}>
                        {statusInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                      {joinDate}
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                        <select
                          value={user.role || 'viewer'}
                          onChange={(e) => handleRoleChange(user._id, e.target.value)}
                          disabled={isSelf}
                          style={{
                            padding: '0.35rem 0.5rem',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            fontSize: '0.82rem',
                            fontWeight: '600',
                            background: '#fff',
                            color: '#333',
                            outline: 'none',
                            cursor: isSelf ? 'not-allowed' : 'pointer'
                          }}
                        >
                          <option value="viewer">조회 권한 (Viewer)</option>
                          <option value="editor">수정/삭제 권한 (Editor)</option>
                          <option value="admin">최고 관리자 권한 (Admin)</option>
                        </select>

                        {user.role === 'admin' && <ShieldCheck size={18} style={{ color: '#52c41a' }} />}
                        {user.role === 'editor' && <Shield size={18} style={{ color: '#1890ff' }} />}
                        {(user.role === 'viewer' || !user.role) && <ShieldAlert size={18} style={{ color: '#bfbfbf' }} />}
                      </div>
                    </td>
                    <td style={{ padding: '1rem', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.3rem', justifyContent: 'center' }}>
                        {user.status !== 'REJECTED' && (
                          <button
                            onClick={() => handleToggleSuspend(user._id, user.status)}
                            disabled={isSelf}
                            title={user.status === 'SUSPENDED' ? '정지 해제' : '이용 정지'}
                            style={{
                              background: 'none',
                              border: 'none',
                              color: isSelf ? '#d9d9d9' : (user.status === 'SUSPENDED' ? '#1890ff' : '#faad14'),
                              cursor: isSelf ? 'not-allowed' : 'pointer',
                              padding: '0.4rem',
                              borderRadius: '6px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            {user.status === 'SUSPENDED' ? <RotateCcw size={16} /> : <Ban size={16} />}
                          </button>
                        )}
                        <button
                          onClick={() => handleDeleteUser(user._id, user.name)}
                          disabled={isSelf}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: isSelf ? '#d9d9d9' : '#ff4d4f',
                            cursor: isSelf ? 'not-allowed' : 'pointer',
                            padding: '0.4rem',
                            borderRadius: '6px',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center'
                          }}
                          title={isSelf ? '자기 자신은 탈퇴할 수 없습니다.' : '강제 탈퇴 처리'}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default UserManagementView;
