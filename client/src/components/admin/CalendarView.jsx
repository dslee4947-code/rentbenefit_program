import React, { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, User, Info, DollarSign } from 'lucide-react';
import { useDraggableDialog, DIALOG_TOP } from './useDraggableDialog.js';
import { createPortal } from 'react-dom';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

const ymd = (d) => (d ? String(d).slice(0, 10) : '-');

// 일정 종류별 색. 칸·팝업·범례가 같은 값을 보게 한 곳에 둔다.
const TYPE_STYLE = {
  '차량검사': { color: '#2563eb', bg: '#dbeafe' },
  '렌트만료': { color: '#dc2626', bg: '#fee2e2' },
  '청구서발송': { color: '#16a34a', bg: '#dcfce7' },
  '고지서납부': { color: '#7c3aed', bg: '#ede9fe' },
  '정기점검': { color: '#d97706', bg: '#fef3c7' }
};
const styleOf = (type) => TYPE_STYLE[type] || TYPE_STYLE['정기점검'];

/**
 * 일정 하나를 한 줄로 부르는 이름.
 *
 * 청구서 발송은 계약이 수십 건이라 계약사 이름이 먼저 보여야 한다.
 * 고지서는 만들어 둔 이름(계약사_차량번호_납부기한)을 그대로 쓴다.
 */
const labelOf = (sched) => sched.title
  || sched.targetContract?.leaseCompany
  || (sched.targetVehicle?.code ? `${sched.targetVehicle.code} 점검` : sched.type);

/**
 * 하루치 일정을 종류별로 묶는다.
 *
 * 청구서 발송은 하루에 수십 건이 겹친다. 그대로 늘어놓으면 그 날 칸만 아래로 길어져
 * 캘린더를 못 쓴다. 칸에는 '청구서발송 12건' 한 줄만 두고 목록은 눌렀을 때 펼친다.
 *
 * 나온 순서를 지킨다. 종류 이름으로 정렬하면 어제와 오늘 칸의 줄 순서가 달라져 눈이 헷갈린다.
 *
 * @param {object[]} daySchedules 그 날의 일정
 * @returns {{type: string, items: object[]}[]}
 */
const groupByType = (daySchedules) => {
  const order = [];
  const byType = new Map();
  for (const sched of daySchedules) {
    if (!byType.has(sched.type)) {
      byType.set(sched.type, []);
      order.push(sched.type);
    }
    byType.get(sched.type).push(sched);
  }
  return order.map((type) => ({ type, items: byType.get(type) }));
};

function CalendarView({ showToast, currentUser }) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selected schedule detail modal state
  const [selectedSchedule, setSelectedSchedule] = useState(null);
  // 하루에 같은 종류가 여러 건이면 칸에 한 줄만 두고, 눌렀을 때 목록을 펼친다.
  // 청구서 발송은 하루에 수십 건이라 그대로 늘어놓으면 캘린더가 아래로 끝없이 길어진다.
  const [groupModal, setGroupModal] = useState(null); // { type, date, items }

  // 팝업을 제목 줄로 잡아 끌어 옮길 수 있게 한다
  const { dragHandleProps, dragStyle } = useDraggableDialog(Boolean(selectedSchedule));
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
          {['정기점검', '차량검사', '렌트만료', '청구서발송', '고지서납부'].map((type) => (
            <span key={type} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: styleOf(type).color }} /> {type}
            </span>
          ))}
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
                    {groupByType(daySchedules).map(group => {
                      const { color: typeColor, bg: typeBg } = styleOf(group.type);
                      const many = group.items.length > 1;
                      const sched = group.items[0];
                      // 여러 건이면 건수만 적고 목록은 눌렀을 때 펼친다.
                      const label = many ? `${group.type} ${group.items.length}건` : labelOf(sched);
                      const allDone = group.items.every(x => x.status === '완료');

                      return (
                        <div
                          key={group.type}
                          onClick={() => (many
                            ? setGroupModal({ type: group.type, date: cell.date, items: group.items })
                            : setSelectedSchedule(sched))}
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
                            opacity: allDone ? 0.6 : 1,
                            textDecoration: allDone ? 'line-through' : 'none'
                          }}
                          title={many
                            ? `${group.type} ${group.items.length}건 · 눌러서 목록 보기`
                            : `[${sched.type}] ${labelOf(sched)}${sched.amount ? ` · ${Number(sched.amount).toLocaleString()}원` : ''}`}
                        >
                          {label}
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

      {/* 하루치 목록. 청구서 발송처럼 한 날에 수십 건이 겹치는 종류를 눌렀을 때 펼친다. */}
      {groupModal && createPortal(
        <div
          onClick={() => setGroupModal(null)}
          style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: `calc(${DIALOG_TOP} - 5px) 1rem 1rem` }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: '16px', maxWidth: '760px', width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', overflow: 'hidden' }}
          >
            <div style={{ background: 'var(--bg-main)', padding: '1.2rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div>
                <h4 style={{ fontSize: '1.05rem', fontWeight: '700', color: 'var(--text-bright)' }}>
                  {groupModal.date.getMonth() + 1}월 {groupModal.date.getDate()}일 · {groupModal.type}
                </h4>
                <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                  {groupModal.items.length}건
                  {groupModal.items.some((x) => x.amount > 0) && (
                    <> · 합계 {groupModal.items.reduce((sum, x) => sum + (x.amount || 0), 0).toLocaleString()}원</>
                  )}
                  {/* 휴일이라 당겨 온 건이 섞여 있으면 그 사실을 먼저 알려야 한다 */}
                  {groupModal.items.some((x) => x.invoice?.movedForHoliday) && (
                    <span style={{ color: '#d97706', fontWeight: '700' }}>
                      {' · '}휴일이라 앞당긴 건 {groupModal.items.filter((x) => x.invoice?.movedForHoliday).length}건
                    </span>
                  )}
                </div>
              </div>
              <button onClick={() => setGroupModal(null)} style={{ border: 'none', background: 'none', fontSize: '1.5rem', cursor: 'pointer', color: 'var(--text-muted)' }}>&times;</button>
            </div>

            <div style={{ overflowY: 'auto', flex: 1 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                  <tr style={{ background: '#fff', borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', fontWeight: '700' }}>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'left' }}>계약사</th>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'left' }}>계약번호</th>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>차량번호</th>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>회차</th>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>출금일</th>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'right' }}>금액</th>
                    <th style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {groupModal.items.map((x) => (
                    <tr
                      key={x._id}
                      onClick={() => { setSelectedSchedule(x); setGroupModal(null); }}
                      style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', opacity: x.status === '완료' ? 0.6 : 1 }}
                    >
                      <td style={{ padding: '0.5rem 0.8rem', fontWeight: '700' }}>
                        {x.targetContract?.leaseCompany || x.targetContract?.customer?.name || x.title || '-'}
                        {x.invoice?.movedForHoliday && (
                          <div style={{ fontSize: '0.72rem', color: '#d97706', fontWeight: '700' }}>
                            원래 {ymd(x.invoice.originalSendDate)} · 휴일이라 앞당김
                          </div>
                        )}
                      </td>
                      <td style={{ padding: '0.5rem 0.8rem', color: 'var(--text-muted)', fontSize: '0.8rem' }}>{x.targetContract?.contractNo || '-'}</td>
                      <td style={{ padding: '0.5rem 0.8rem', textAlign: 'center', color: 'var(--primary)', fontWeight: '700' }}>{x.targetVehicle?.plateNo || '-'}</td>
                      <td style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>{x.invoice?.roundNo ? `${x.invoice.roundNo}회차` : '-'}</td>
                      <td style={{ padding: '0.5rem 0.8rem', textAlign: 'center', color: 'var(--text-muted)' }}>{ymd(x.invoice?.billingDueDate)}</td>
                      <td style={{ padding: '0.5rem 0.8rem', textAlign: 'right', fontWeight: '700' }}>
                        {x.amount ? `${Number(x.amount).toLocaleString()}원` : '-'}
                      </td>
                      <td style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>
                        <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: '20px', fontWeight: '700', background: x.status === '완료' ? '#dcfce7' : '#fef3c7', color: x.status === '완료' ? '#16a34a' : '#d97706' }}>
                          {x.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ background: 'var(--bg-main)', padding: '0.7rem 1.5rem', borderTop: '1px solid var(--border-color)', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              줄을 누르면 그 건의 상세 정보가 열립니다.
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Schedule Detail Modal */}
      {selectedSchedule && (
        createPortal(
        /* 팝업은 document.body에 직접 그린다.
           페이지 쪽 조상에 transform/animation이 걸려 있으면 position:fixed의 기준이 그 요소로 바뀌어
           팝업이 스크롤되는 콘텐츠 영역 안에 갇히고, 화면 기준 위치가 어긋난다. */
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, padding: `calc(${DIALOG_TOP} - 5px) 1rem 1rem` }}>
          <div style={{ ...dragStyle, background: '#fff', borderRadius: '16px', maxWidth: '500px', width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)', overflow: 'hidden' }}>
            
            {/* Header */}
            <div {...dragHandleProps} style={{ ...dragHandleProps.style, background: 'var(--bg-main)', padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
                  background: styleOf(selectedSchedule.type).bg,
                  color: styleOf(selectedSchedule.type).color,
                  padding: '0.2rem 0.6rem', 
                  borderRadius: '4px', 
                  fontWeight: '700',
                  fontSize: '0.8rem'
                }}>
                  {selectedSchedule.type}
                </span>
              </div>

              {(selectedSchedule.targetContract?.leaseCompany || selectedSchedule.title) && (
                <div>
                  <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>내용</strong>
                  <span style={{ fontWeight: '700' }}>
                    {selectedSchedule.targetContract?.leaseCompany || selectedSchedule.title}
                  </span>
                  {selectedSchedule.targetContract?.leaseCompany && selectedSchedule.title && (
                    <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>{selectedSchedule.title}</div>
                  )}
                </div>
              )}

              {selectedSchedule.invoice?.roundNo && (
                <div>
                  <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>청구 회차</strong>
                  <span style={{ fontWeight: '600' }}>
                    {selectedSchedule.invoice.roundNo}회차 · 출금일 {ymd(selectedSchedule.invoice.billingDueDate)}
                  </span>
                </div>
              )}

              {/* 휴일이라 앞당긴 건은 원래 날짜를 함께 보여 준다. 당겨진 날짜만 보면 무슨 건인지 알 수 없다. */}
              {selectedSchedule.invoice?.movedForHoliday && (
                <div style={{ background: '#fffbeb', border: '1px solid #d97706', borderRadius: '6px', padding: '0.5rem 0.7rem', fontSize: '0.83rem' }}>
                  <strong style={{ color: '#d97706' }}>휴일이라 앞당긴 일정입니다.</strong>
                  <div style={{ color: 'var(--text-muted)', marginTop: '0.15rem' }}>
                    원래 발송일 {ymd(selectedSchedule.invoice.originalSendDate)} → {ymd(selectedSchedule.dueDate)}
                  </div>
                </div>
              )}

              <div>
                <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>
                  {selectedSchedule.type === '고지서납부' ? '납부기한' : '예정일'}
                </strong>
                <span style={{ fontWeight: '600' }}>{new Date(selectedSchedule.dueDate).toLocaleDateString()}</span>
              </div>

              {selectedSchedule.amount > 0 && (
                <div>
                  <strong style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.2rem' }}>금액</strong>
                  <span style={{ fontWeight: '700', color: '#7c3aed' }}>{Number(selectedSchedule.amount).toLocaleString()}원</span>
                  {selectedSchedule.source?.noticeNo && (
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                      고지번호 {selectedSchedule.source.noticeNo}
                    </span>
                  )}
                </div>
              )}

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
        </div>, document.body)
      )}

    </div>
  );
}

export default CalendarView;
