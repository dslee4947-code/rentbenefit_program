import React, { useState, useEffect } from 'react';
import { Search, Trash2, Shield, User, ShieldCheck, UserMinus, ShieldAlert, Key } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:5000`;

function UserManagementView({ showToast, currentUser }) {
  const [users, setUsers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API_HOST}/api/users`, {
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
      });
      const data = await response.json();
      if (response.ok) {
        setUsers(data);
      } else {
        showToast(data.message || '사용자 목록을 불러오지 못했습니다.', 'error');
      }
    } catch (err) {
      console.error(err);
      showToast('서버 연결 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleRoleChange = async (userId, newRole) => {
    try {
      const response = await fetch(`${API_HOST}/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-User-Role': currentUser?.role || 'viewer'
        },
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
        headers: {
          'X-User-Role': currentUser?.role || 'viewer'
        }
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

  return (
    <div className="user-management-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#fff', padding: '2rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', maxWidth: '1200px', margin: '0 auto' }}>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--text-bright)', display: 'flex', alignItems: 'center', gap: '0.5rem', margin: 0 }}>
          <Key style={{ color: 'var(--primary)' }} /> 사용자 권한 관리
        </h3>
        
        {/* Search Bar */}
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
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
          <span>사용자 목록을 불러오는 중...</span>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem', color: 'var(--text-muted)', border: '1px dashed var(--border-color)', borderRadius: '8px' }}>
          <span>등록된 사용자가 없거나 검색 결과가 없습니다.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem', minWidth: '700px' }}>
            <thead>
              <tr style={{ background: 'var(--bg-main)', borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>사용자 정보</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>유형</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>가입일시</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)' }}>권한 설정</th>
                <th style={{ padding: '0.75rem 1rem', fontWeight: '700', color: 'var(--text-bright)', textAlign: 'center' }}>관리</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((user, idx) => {
                const joinDate = user.createdAt ? new Date(user.createdAt).toLocaleString('ko-KR') : '-';
                const isSelf = user._id === currentUser?._id;
                
                return (
                  <tr key={user._id} style={{ borderBottom: '1px solid var(--border-color)', background: isSelf ? '#f0fdf4' : idx % 2 === 1 ? '#fcfcfc' : '#fff' }}>
                    <td style={{ padding: '1rem' }}>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <span style={{ fontWeight: '700', color: 'var(--text-bright)' }}>
                          {user.name} {isSelf && <span style={{ fontSize: '0.7rem', background: 'var(--primary)', color: '#fff', padding: '0.1rem 0.3rem', borderRadius: '4px', marginLeft: '0.3rem' }}>나</span>}
                        </span>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{user.email}</span>
                      </div>
                    </td>
                    <td style={{ padding: '1rem' }}>
                      <span style={{
                        padding: '0.15rem 0.4rem',
                        borderRadius: '4px',
                        fontSize: '0.75rem',
                        fontWeight: '600',
                        background: user.user_type === 'admin' ? '#ffe7ba' : '#e6f7ff',
                        color: user.user_type === 'admin' ? '#d46b08' : '#096dd9'
                      }}>
                        {user.user_type === 'admin' ? '관리자(Admin)' : '일반 회원'}
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
                          disabled={isSelf} // Self role protection
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
                          transition: 'background 0.2s',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                        onMouseEnter={(e) => { if (!isSelf) e.currentTarget.style.background = '#fff1f0'; }}
                        onMouseLeave={(e) => { if (!isSelf) e.currentTarget.style.background = 'none'; }}
                        title={isSelf ? '자기 자신은 탈퇴할 수 없습니다.' : '강제 탈퇴 처리'}
                      >
                        <Trash2 size={16} />
                      </button>
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
