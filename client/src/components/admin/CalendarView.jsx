import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, User, Info, DollarSign } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

function CalendarView({ showToast, currentUser }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected schedule detail modal state
  const [selectedSchedule, setSelectedSchedule] = useState(null);

  const fetchMonthSchedules = async () => {
    try {
      setLoading(true);
      // Start and end dates of current month
      const start = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1);
      const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59);

      const response = await fetch(
        `${API_HOST}/api/schedules?startDate=${start.toISOString()}&endDate=${end.toISOString()}`
      );

      if (response.ok) {
        const data = await response.json();
        setSchedules(data);
      }
    } catch (err) {
      console.error(err);
      showToast('일정 조회 실패', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMonthSchedules();
  }, [currentDate]);

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // Generate Calendar Grid Days
  const getDaysInMonth = () => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();

    // First day of the month index (0: Sunday, 1: Monday...)
    const firstDayIndex = new Date(year, month, 1).getDay();
    
    // Number of days in the current month
    const totalDays = new Date(year, month + 1, 0).getDate();

    // Number of days in the previous month
    const prevMonthDays = new Date(year, month, 0).getDate();

    const days = [];

    // Fill previous month overlapping days
    for (let i = firstDayIndex - 1; i >= 0; i--) {
      days.push({
        day: prevMonthDays - i,
        isCurrentMonth: false,
        date: new Date(year, month - 1, prevMonthDays - i)
      });
    }

    // Fill current month days
    for (let i = 1; i <= totalDays; i++) {
      days.push({
        day: i,
        isCurrentMonth: true,
        date: new Date(year, month, i)
      });
    }

    // Fill next month overlapping days to make it a multiple of 7 (full rows)
    const remainingDays = 42 - days.length; // 6 rows of 7 days
    for (let i = 1; i <= remainingDays; i++) {
      days.push({
        day: i,
        isCurrentMonth: false,
        date: new Date(year, month + 1, i)
      });
    }

    return days;
  };

  const getSchedulesForDay = (date) => {
    return schedules.filter(sched => {
      const schedDate = new Date(sched.dueDate);
      return (
        schedDate.getFullYear() === date.getFullYear() &&
        schedDate.getMonth() === date.getMonth() &&
        schedDate.getDate() === date.getDate()
      );
    });
  };

  const calendarDays = getDaysInMonth();
  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  return (
    <div className="calendar-view-container fade-in" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      
      {/* Calendar Header with Controls */}
      <div style={{ background: '#fff', padding: '1.5rem', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <Calendar size={22} style={{ color: 'var(--primary)' }} />
          <h3 style={{ fontSize: '1.3rem', fontWeight: '700', color: 'var(--text-bright)' }}>
            {currentDate.getFullYear()}년 {currentDate.getMonth() + 1}월 일정표
          </h3>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', fontSize: '0.75rem', fontWeight: '600' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b' }} /> 정기점검</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#3b82f6' }} /> 차량검사</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#ef4444' }} /> 렌트만료</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}><span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }} /> 청구서발송</span>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={handlePrevMonth} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', padding: '0.4rem', borderRadius: '6px', cursor: 'pointer' }}><ChevronLeft size={16} /></button>
          <button onClick={() => setCurrentDate(new Date())} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', padding: '0.4rem 0.8rem', borderRadius: '6px', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer' }}>오늘</button>
          <button onClick={handleNextMonth} style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', padding: '0.4rem', borderRadius: '6px', cursor: 'pointer' }}><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-premium)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        
        {/* Days of week header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-main)' }}>
          {weekDays.map((d, index) => (
            <div 
              key={d} 
              style={{ 
                padding: '0.8rem', 
                textAlign: 'center', 
                fontWeight: '700', 
                fontSize: '0.85rem', 
                color: index === 0 ? '#ef4444' : index === 6 ? '#3b82f6' : 'var(--text-main)' 
              }}
            >
              {d}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gridAutoRows: 'minmax(120px, 1fr)' }}>
          {loading ? (
            <div style={{ gridColumn: 'span 7', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', color: 'var(--text-muted)' }}>
              일정 데이터를 불러오고 있습니다...
            </div>
          ) : (
            calendarDays.map((cell, idx) => {
              const daySchedules = getSchedulesForDay(cell.date);
              const isToday = new Date().toDateString() === cell.date.toDateString();

              return (
                <div 
                  key={idx} 
                  style={{ 
                    borderBottom: '1px solid var(--border-color)', 
                    borderRight: '1px solid var(--border-color)',
                    padding: '0.5rem',
                    background: cell.isCurrentMonth ? '#fff' : '#fcfcfc',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.3rem',
                    overflow: 'hidden'
                  }}
                >
                  {/* Day Number Label */}
                  <span style={{ 
                    fontSize: '0.8rem', 
                    fontWeight: '600', 
                    color: !cell.isCurrentMonth ? '#cbd5e1' : cell.date.getDay() === 0 ? '#ef4444' : cell.date.getDay() === 6 ? '#3b82f6' : 'var(--text-main)',
                    alignSelf: 'flex-start',
                    width: '24px',
                    height: '24px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: isToday ? 'var(--primary)' : 'transparent',
                    color: isToday ? '#fff' : undefined
                  }}>
                    {cell.day}
                  </span>

                  {/* Day Schedule Badges */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', overflowY: 'auto', flex: 1 }} className="calendar-badges-box">
                    {daySchedules.map(sched => {
                      let typeColor = '#d97706'; // default maintenance (amber)
                      let typeBg = '#fef3c7';
                      if (sched.type === '차량검사') {
                        typeColor = '#2563eb'; // blue
                        typeBg = '#dbeafe';
                      }
                      if (sched.type === '렌트만료') {
                        typeColor = '#dc2626'; // red
                        typeBg = '#fee2e2';
                      }
                      if (sched.type === '청구서발송') {
                        typeColor = '#16a34a'; // green
                        typeBg = '#dcfce7';
                      }

                      return (
                        <div 
                          key={sched._id}
                          onClick={() => setSelectedSchedule(sched)}
                          style={{
                            background: typeBg,
                            color: typeColor,
                            padding: '0.2rem 0.4rem',
                            borderRadius: '4px',
                            fontSize: '0.7rem',
                            fontWeight: '700',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            cursor: 'pointer',
                            border: `1px solid ${typeColor}33`,
                            opacity: sched.status === '완료' ? 0.6 : 1,
                            textDecoration: sched.status === '완료' ? 'line-through' : 'none'
                          }}
                          title={`[${sched.type}] ${sched.targetVehicle?.model || '차량'}`}
                        >
                          {sched.targetVehicle?.code ? `${sched.targetVehicle.code} 점검` : sched.type}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Schedule Detail Modal */}
      {selectedSchedule && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
          <div style={{ background: '#fff', borderRadius: '16px', maxWidth: '500px', width: '100%', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            
            {/* Header */}
            <div style={{ background: 'var(--bg-main)', padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                일정 상세 정보
              </h4>
              <button onClick={() => setSelectedSchedule(null)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
            </div>

            {/* Content Body */}
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem', fontSize: '0.9rem' }}>
              <div>
                <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>일정 구분</strong>
                <span style={{ 
                  background: selectedSchedule.type === '렌트만료' ? '#fee2e2' : selectedSchedule.type === '차량검사' ? '#dbeafe' : selectedSchedule.type === '청구서발송' ? '#dcfce7' : '#fef3c7', 
                  color: selectedSchedule.type === '렌트만료' ? '#dc2626' : selectedSchedule.type === '차량검사' ? '#2563eb' : selectedSchedule.type === '청구서발송' ? '#16a34a' : '#d97706',
                  padding: '0.2rem 0.6rem', 
                  borderRadius: '4px', 
                  fontWeight: '700',
                  fontSize: '0.8rem'
                }}>
                  {selectedSchedule.type}
                </span>
              </div>

              <div>
                <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>예정일</strong>
                <span style={{ fontWeight: '600' }}>{new Date(selectedSchedule.dueDate).toLocaleDateString()}</span>
              </div>

              {selectedSchedule.targetVehicle && (
                <div>
                  <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>대상 차량</strong>
                  <span style={{ fontWeight: '600' }}>{selectedSchedule.targetVehicle.carModel} ({selectedSchedule.targetVehicle.code})</span>
                  {selectedSchedule.targetVehicle.plateNo && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>[{selectedSchedule.targetVehicle.plateNo}]</span>
                  )}
                </div>
              )}

              {selectedSchedule.targetContract?.customer && (
                <div>
                  <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>계약 고객</strong>
                  <span style={{ fontWeight: '600' }}>{selectedSchedule.targetContract.customer.name} ({selectedSchedule.targetContract.customer.bizNo})</span>
                </div>
              )}

              <div>
                <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>상태 및 담당자</strong>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <span style={{ 
                    fontSize: '0.8rem', 
                    padding: '0.2rem 0.5rem', 
                    borderRadius: '4px', 
                    background: selectedSchedule.status === '완료' ? '#dcfce7' : '#fef3c7', 
                    color: selectedSchedule.status === '완료' ? '#16a34a' : '#d97706',
                    fontWeight: '600'
                  }}>
                    {selectedSchedule.status}
                  </span>
                  <span>담당자: {selectedSchedule.assignee || '미지정'}</span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ background: 'var(--bg-main)', padding: '1rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              {selectedSchedule.status !== '완료' && (
                <button 
                  onClick={async () => {
                    if (currentUser?.role === 'viewer') {
                      showToast('수정 및 완료 권한이 없습니다. 관리자에게 문의하세요.', 'error');
                      return;
                    }
                    try {
                      const res = await fetch(`${API_HOST}/api/schedules/${selectedSchedule._id}`, {
                        method: 'PUT',
                        headers: { 
                          'Content-Type': 'application/json',
                          'X-User-Role': currentUser?.role || 'viewer'
                        },
                        body: JSON.stringify({ status: '완료' })
                      });
                      if (res.ok) {
                        showToast('일정이 완료 처리되었습니다.', 'success');
                        setSelectedSchedule(null);
                        fetchMonthSchedules();
                      }
                    } catch (err) {
                      showToast('오류 발생', 'error');
                    }
                  }}
                  style={{ background: '#16a34a', color: '#fff', border: 'none', padding: '0.5rem 1.2rem', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}
                >
                  완료 처리
                </button>
              )}
              <button onClick={() => setSelectedSchedule(null)} style={{ background: '#cbd5e1', border: 'none', padding: '0.5rem 1.2rem', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}>
                닫기
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

export default CalendarView;
