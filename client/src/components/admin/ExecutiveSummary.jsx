import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ContractExtendDialog from './ContractExtendDialog.jsx';
import { AlertTriangle, ChevronRight, TrendingUp, Car, CalendarClock, Users, Info, Wallet, AlertOctagon } from 'lucide-react';

const API_HOST = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : `http://${window.location.hostname}:5000`);

/** 1억 1,093만 원처럼 대표가 읽는 단위로 줄인다. 만 원 아래는 버린다. */
const krw = (n) => {
  const v = Math.round(Number(n || 0) / 10000); // 만 원 단위
  if (!v) return '0원';
  const eok = Math.floor(v / 10000);
  const man = v % 10000;
  return `${eok ? `${eok}억 ` : ''}${man ? `${man.toLocaleString()}만` : ''} 원`.replace('  ', ' ').trim();
};
// 이 컴퓨터(한국) 날짜로 적는다. 서버가 주는 시각은 UTC라 앞 10자만 자르면 한국 0~9시에 전날이 찍힌다.
const ymd = (d) => {
  if (!d) return '-';
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

const fetchExecutive = async () => {
  const res = await fetch(`${API_HOST}/api/dashboard/executive`);
  if (!res.ok) throw new Error('경영 요약을 불러오지 못했습니다.');
  return res.json();
};

const card = {
  background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: '12px',
  boxShadow: 'var(--shadow-premium)', padding: '1.2rem 1.3rem'
};

/** 숫자 카드. 숫자 하나에 비교 기준 한 줄을 꼭 붙인다(비교가 없으면 좋은지 나쁜지 알 수 없다). */
function Kpi({ icon, label, value, sub, onClick }) {
  return (
    <div style={{ ...card, display: 'flex', flexDirection: 'column', gap: '0.45rem', cursor: onClick ? 'pointer' : 'default' }} onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'var(--text-muted)', fontSize: '0.85rem', fontWeight: 600 }}>
        {label} {icon}
      </div>
      <div style={{ fontSize: '1.7rem', fontWeight: 800, color: 'var(--text-bright)', lineHeight: 1.15 }}>{value}</div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{sub}</div>
    </div>
  );
}

const pct = (r) => (r === null || r === undefined ? '-' : `${Math.round(r * 100)}%`);
const rateColor = (r) => (r === null || r === undefined ? 'var(--text-muted)' : r >= 1 ? '#15803d' : r >= 0.7 ? '#b45309' : '#b91c1c');

/**
 * 단기렌트 차가 매달 목표만큼 벌어 오는지.
 * 월 목표 = 견적서로 3년·인수가 30%·정비 포함 계약을 잡았을 때의 월 렌트료(이만큼 벌고 3년 뒤 차량가 30%에 팔면 회수).
 * 지금까지 덜 번 금액이 큰 차부터 놓는다.
 */
function ShortTermTargets({ st, onOpen }) {
  const lm = st.lastMonth;
  const lmRate = lm.target ? lm.actual / lm.target : null;
  const cumRate = st.cumTarget ? st.cumActual / st.cumTarget : null;
  const month = lm.month ? `${Number(lm.month.slice(5))}월` : '지난달';
  return (
    <div style={{ ...card }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontWeight: 800, color: 'var(--text-bright)' }}>단기렌트 월 목표 달성 ({st.count}대)</span>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          월 목표 = 견적서 3년 · 인수가 30% · 정비 포함 월 렌트료 · 실제는 원장 고객입금
        </span>
      </div>
      <div style={{ display: 'flex', gap: '1.6rem', flexWrap: 'wrap', marginBottom: '0.7rem', fontSize: '0.88rem' }}>
        <span>월 목표 합계 <b>{krw(st.monthlyTarget)}</b></span>
        <span>{month} <b style={{ color: rateColor(lmRate) }}>{krw(lm.actual)} / {krw(lm.target)} ({pct(lmRate)})</b> · 못 미친 차 {lm.belowCount}대</span>
        <span>이번 달 오늘까지 {krw(st.thisMonth.actual)} / {krw(st.thisMonth.target)}</span>
        <span>시작 후 누적 <b style={{ color: rateColor(cumRate) }}>{pct(cumRate)}</b> ({krw(st.cumActual - st.cumTarget)})</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', textAlign: 'left', fontSize: '0.76rem' }}>
              <th style={{ padding: '0.4rem' }}>차량</th>
              <th style={{ padding: '0.4rem', textAlign: 'right' }}>월 목표</th>
              <th style={{ padding: '0.4rem', textAlign: 'right' }}>{month}</th>
              <th style={{ padding: '0.4rem', textAlign: 'right' }}>최근 3개월 평균</th>
              <th style={{ padding: '0.4rem', textAlign: 'right' }}>목표 채운 달</th>
              <th style={{ padding: '0.4rem', textAlign: 'right' }}>누적 목표 대비</th>
            </tr>
          </thead>
          <tbody>
            {st.rows.map((r) => (
              <tr key={r.ledgerId} onClick={onOpen} style={{ borderTop: '1px solid var(--border-color)', cursor: 'pointer' }}>
                <td style={{ padding: '0.45rem' }}>
                  <span style={{ fontWeight: 600 }}>{r.carModel}</span>{' '}
                  <span style={{ color: 'var(--text-muted)' }}>{r.plateNo || r.ledgerNo}</span>
                  {r.startSource === 'afterLongTerm' && <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}> · 장기렌트 후 {ymd(r.startDate).slice(0, 7)}부터</span>}
                </td>
                {r.reason ? (
                  <td colSpan={5} style={{ padding: '0.45rem', color: '#b45309' }}>{r.reason}</td>
                ) : (
                  <>
                    <td style={{ padding: '0.45rem', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {krw(r.monthlyTarget)}{r.targetSource === 'manual' ? ' *' : ''}
                      {r.ageYear && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.ageYear}년차 ×{r.ageFactor}</div>}
                    </td>
                    <td style={{ padding: '0.45rem', textAlign: 'right', whiteSpace: 'nowrap', color: rateColor(r.lastMonth?.rate), fontWeight: 700 }}>
                      {r.lastMonth ? `${krw(r.lastMonth.actual)} (${pct(r.lastMonth.rate)})` : '-'}
                    </td>
                    <td style={{ padding: '0.45rem', textAlign: 'right', whiteSpace: 'nowrap', color: rateColor(r.avg3Rate) }}>
                      {r.avg3 === null ? '-' : `${krw(r.avg3)} (${pct(r.avg3Rate)})`}
                    </td>
                    <td style={{ padding: '0.45rem', textAlign: 'right', whiteSpace: 'nowrap' }}>{r.metMonths} / {r.doneMonths}</td>
                    <td style={{ padding: '0.45rem', textAlign: 'right', whiteSpace: 'nowrap', color: r.gap < 0 ? '#b91c1c' : '#15803d' }}>
                      {r.gap < 0 ? '-' : '+'}{krw(Math.abs(r.gap))}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
        월 목표는 차령에 따라 1년차 ×1.1 · 2년차 ×1.0 · 3년차 ×0.9 · 4년차 ×0.8 · 5년차 이후 ×0.7로 가감합니다(새 차일수록 더 받음, 3년 합계는 같음). 시작 달과 이번 달은 날짜만큼 나눠 목표를 잡습니다. * 표시는 원장에서 목표를 직접 정한 차입니다. 차마다 달별 내역은 손익 원장 해당 차의 '단기렌트 월 목표'에서 봅니다.
      </div>
    </div>
  );
}

/**
 * 대표용 경영 요약. 대시보드 맨 위에 관리자에게만 보인다.
 *
 * 돈이 잘 도나(월 렌트 매출) / 회사가 크고 있나(운용 대수·영업) / 챙길 게 있나(청구 누락·만기)를
 * 한 화면에서 답한다. 입금률·미납·차량 손익은 자료가 채워진 뒤 붙인다. 지금 보여 주면 틀린 숫자다.
 *
 * @param {object} props
 * @param {object} [props.gapData] 청구 누락 계약 (대시보드가 이미 불러 온 것을 그대로 받는다)
 * @param {(tab: string) => void} props.setActiveTab 해당 화면으로 이동
 */
function ExecutiveSummary({ gapData, setActiveTab, showToast }) {
  const queryClient = useQueryClient();
  const [extendTarget, setExtendTarget] = useState(null);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dashboard-executive'],
    queryFn: fetchExecutive,
    staleTime: 60 * 1000
  });

  if (isLoading) return <div style={{ ...card, color: 'var(--text-muted)' }}>경영 요약을 불러오는 중입니다...</div>;
  if (isError || !data?.success) return <div style={{ ...card, color: '#b91c1c' }}>경영 요약을 불러오지 못했습니다.</div>;

  const { fleet, newDeliveries, funnel, expiring, collections, shortTermTargets: st } = data;
  const mmdd = (d) => (d ? `${new Date(d).getMonth() + 1}/${new Date(d).getDate()}` : '-');
  const recordedUntil = mmdd(collections.lastPaidAt);
  const today = new Date(data.asOf);
  const soon = expiring.items.filter((it) => it.dDay <= 30);

  // 챙길 일. 돈이 걸린 크기 순으로 놓는다. 누르면 그 일을 하는 화면으로 간다.
  const todos = [
    collections.unpaid.count > 0 && {
      tone: 'danger',
      text: `미납 ${collections.unpaid.count}회차 — ${krw(collections.unpaid.amount)}`,
      weight: collections.unpaid.amount,
      tab: 'billing'
    },
    collections.streakCount > 0 && {
      tone: 'warn',
      text: `두 달 이상 입금 기록이 끊긴 계약 ${collections.streakCount}건 — 미납인지 기록 누락인지 자금팀 확인`,
      // 기록 누락이 섞여 있어 금액 순위를 미납보다 앞세우지 않는다
      weight: 1,
      tab: 'invoice-archive'
    },
    gapData?.count > 0 && {
      tone: 'danger',
      text: `청구가 나가지 않는 계약 ${gapData.count}건 — 매달 ${krw(gapData.monthlyLoss)} 누락`,
      weight: gapData.monthlyLoss,
      tab: 'delivery-prep'
    },
    soon.length > 0 && {
      tone: 'warn',
      text: `30일 안에 끝나는 계약 ${soon.length}건 — 재계약·인수 연락 필요 (월 ${krw(soon.reduce((s, it) => s + it.monthlyFee, 0))})`,
      weight: soon.reduce((s, it) => s + it.monthlyFee, 0),
      tab: 'contract-register'
    },
    st?.lastMonth?.belowCount > 0 && {
      tone: 'warn',
      text: `지난달 월 목표에 못 미친 단기렌트 차 ${st.lastMonth.belowCount}대 — 목표 ${krw(st.lastMonth.target)} 중 ${krw(st.lastMonth.actual)} 벌어 옴`,
      weight: Math.max(0, st.lastMonth.target - st.lastMonth.actual),
      tab: 'ledgers'
    },
    funnel.pendingInquiries > 0 && {
      tone: 'info',
      text: `답하지 않은 문의 ${funnel.pendingInquiries}건`,
      weight: 0,
      tab: 'inquiries'
    }
  ].filter(Boolean).sort((a, b) => b.weight - a.weight);

  const toneColor = { danger: '#b91c1c', warn: '#b45309', info: '#0369a1' };
  const f = funnel.thisMonth;
  const fl = funnel.lastMonthFull;
  const fs = funnel.lastMonthSamePeriod;
  const conversion = (x) => (x.quotes ? `${Math.round((x.contracts / x.quotes) * 100)}%` : '-');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
      {/* 한 줄 요약 */}
      <div style={{ ...card, display: 'flex', gap: '1.2rem', flexWrap: 'wrap', alignItems: 'center', padding: '0.9rem 1.3rem' }}>
        <span style={{ fontWeight: 800, color: 'var(--text-bright)' }}>
          {ymd(data.asOf)} ({WEEKDAY[today.getDay()]})
        </span>
        <span style={{ color: todos.length ? '#b45309' : '#15803d', fontWeight: 700 }}>
          {todos.length ? `⚠ 챙길 일 ${todos.length}건` : '✓ 챙길 일 없음'}
        </span>
        <span style={{ color: 'var(--text-muted)' }}>운용 {fleet.operatingCount}대 · 월 렌트 {krw(fleet.operatingMonthlyRent)}</span>
        <span style={{ color: 'var(--text-muted)' }}>90일 내 만기 {expiring.count}건</span>
      </div>

      {/* 핵심 숫자 */}
      {/* 6개라 넓은 화면에서 3개씩 두 줄로 놓는다(5+1로 남지 않게) */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(max(260px, 30%), 1fr))', gap: '1rem' }}>
        <Kpi
          icon={<TrendingUp size={18} style={{ color: 'var(--primary)' }} />}
          label="월 렌트 매출"
          value={krw(fleet.operatingMonthlyRent)}
          sub={<>
            운용 중인 차량의 월 렌트료 합계<br />
            이번 달 신규 출고 {newDeliveries.thisMonth.count}대 (+{krw(newDeliveries.thisMonth.monthlyRent)})
            · 지난달 같은 기간 {newDeliveries.lastMonthSamePeriod.count}대
          </>}
          onClick={() => setActiveTab('vehicles')}
        />
        <Kpi
          icon={<Car size={18} style={{ color: '#2563eb' }} />}
          label="운용 차량"
          value={`${fleet.operatingCount}대`}
          sub={<>
            장기 {fleet.longTerm.count} · 단기 {fleet.shortTerm.count}{fleet.accident.count ? ` · 사고대차 ${fleet.accident.count}` : ''}<br />
            출고 대기 {fleet.waiting.count}대 (월 {krw(fleet.waiting.monthlyRent)} 예정)
          </>}
          onClick={() => setActiveTab('vehicles')}
        />
        <Kpi
          icon={<Wallet size={18} style={{ color: '#15803d' }} />}
          label="이번 달 받을 렌트료"
          value={krw(collections.thisMonth.billed)}
          sub={<>
            {collections.thisMonth.dueCount
              ? `출금일 지난 ${collections.thisMonth.dueCount}회차 중 ${collections.thisMonth.dueDoneCount}회차 입금 (${Math.round((collections.thisMonth.rate || 0) * 100)}%)`
              : '아직 출금일이 온 회차가 없습니다'}<br />
            입금 기록 기준일 {recordedUntil} · 그 뒤 입금은 갑지 최신화나 입금 입력 후 반영
          </>}
          onClick={() => setActiveTab('billing')}
        />
        <Kpi
          icon={<AlertOctagon size={18} style={{ color: '#b91c1c' }} />}
          label="미납"
          value={collections.unpaid.count ? krw(collections.unpaid.amount) : '없음'}
          sub={<>
            미납으로 처리한 회차 {collections.unpaid.count}건<br />
            입금 기록 없는 지난 회차 {collections.unconfirmed.count}건 ({krw(collections.unconfirmed.amount)}) — 확인 필요
          </>}
          onClick={() => setActiveTab('billing')}
        />
        <Kpi
          icon={<Users size={18} style={{ color: '#7c3aed' }} />}
          label="이번 달 영업"
          value={`계약 ${f.contracts}건`}
          sub={<>
            문의 {f.inquiries} → 견적 {f.quotes} → 계약 {f.contracts}<br />
            지난달 같은 기간 {fs.contracts}건 · 지난달 전체 견적 {fl.quotes} → 계약 {fl.contracts}
          </>}
          onClick={() => setActiveTab('quote-input')}
        />
        <Kpi
          icon={<CalendarClock size={18} style={{ color: '#b45309' }} />}
          label="90일 내 만기"
          value={`${expiring.count}건`}
          sub={expiring.count ? <>
            월 {krw(expiring.monthlyRent)} 규모 — 재계약하면 이어지는 매출<br />
            {Object.entries(expiring.byMonth).map(([m, n]) => `${Number(m.slice(5))}월 ${n}건`).join(' · ')}
          </> : '90일 안에 끝나는 계약이 없습니다'}
          onClick={() => setActiveTab('contract-register')}
        />
      </div>

      {/* 챙길 일 */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 800, marginBottom: '0.6rem', color: 'var(--text-bright)' }}>
          <AlertTriangle size={17} style={{ color: '#b45309' }} /> 챙길 일
        </div>
        {todos.length === 0 ? (
          <div style={{ color: '#15803d', fontSize: '0.9rem' }}>지금 확인할 위험 신호가 없습니다.</div>
        ) : todos.map((t) => (
          <div
            key={t.text}
            onClick={() => setActiveTab(t.tab)}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', padding: '0.55rem 0.2rem', borderTop: '1px solid var(--border-color)', cursor: 'pointer', color: toneColor[t.tone], fontWeight: 600, fontSize: '0.9rem' }}
          >
            <span>· {t.text}</span>
            <ChevronRight size={15} />
          </div>
        ))}
      </div>

      {/* 단기렌트 월 목표 달성 */}
      {st && st.rows.length > 0 && <ShortTermTargets st={st} onOpen={() => setActiveTab('ledgers')} />}

      {/* 입금 기록이 끊긴 계약 */}
      {collections.streaks.length > 0 && (
        <div style={{ ...card }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 800, color: 'var(--text-bright)' }}>입금 기록이 끊긴 계약 ({collections.streakCount}건)</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              실제 미납이거나, 재계약 등으로 원장과 회차표가 연결되지 않은 경우입니다 · {recordedUntil}까지 기록 기준
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <tbody>
                {collections.streaks.map((it) => (
                  <tr key={it.contractId} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.45rem', fontWeight: 600 }}>{it.partyName}</td>
                    <td style={{ padding: '0.45rem', color: 'var(--text-muted)' }}>{it.contractNo} · {it.carModel} {it.plateNo}</td>
                    <td style={{ padding: '0.45rem', whiteSpace: 'nowrap', color: '#b45309', fontWeight: 700 }}>{it.months}회차 연속</td>
                    <td style={{ padding: '0.45rem', whiteSpace: 'nowrap', textAlign: 'right' }}>{krw(it.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {collections.streakCount > collections.streaks.length && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>외 {collections.streakCount - collections.streaks.length}건</div>
            )}
          </div>
        </div>
      )}

      {/* 다가오는 만기 */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-bright)' }}>다가오는 만기 (90일)</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>가까운 순 · 재계약·인수 권유 대상</span>
        </div>
        {expiring.items.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>90일 안에 끝나는 계약이 없습니다.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <tbody>
                {expiring.items.slice(0, 10).map((it) => (
                  <tr key={it._id} style={{ borderTop: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '0.45rem', whiteSpace: 'nowrap', fontWeight: 700, color: it.dDay <= 30 ? '#b45309' : 'var(--text-muted)' }}>D-{it.dDay}</td>
                    <td style={{ padding: '0.45rem', fontWeight: 600 }}>{it.partyName}</td>
                    <td style={{ padding: '0.45rem', color: 'var(--text-muted)' }}>{it.carModel} {it.plateNo}</td>
                    <td style={{ padding: '0.45rem', whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{ymd(it.endDate)}</td>
                    <td style={{ padding: '0.45rem', whiteSpace: 'nowrap', textAlign: 'right' }}>{it.monthlyFee ? `월 ${krw(it.monthlyFee)}` : '-'}</td>
                    <td style={{ padding: '0.45rem', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => setExtendTarget(it._id)}
                        style={{ border: '1px solid #16a34a', color: '#16a34a', background: '#fff', borderRadius: '6px', padding: '0.2rem 0.55rem', fontSize: '0.75rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      >
                        연장
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {expiring.items.length > 10 && (
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>외 {expiring.items.length - 10}건</div>
            )}
          </div>
        )}
      </div>

      {extendTarget && (
        <ContractExtendDialog
          contractId={extendTarget}
          onClose={() => setExtendTarget(null)}
          onDone={() => queryClient.invalidateQueries({ queryKey: ['dashboard-executive'] })}
          showToast={showToast}
        />
      )}

      {/* 부서별 오늘 한 일 (활동 기록) */}
      <div style={{ ...card }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <span style={{ fontWeight: 800, color: 'var(--text-bright)' }}>부서별 오늘 한 일</span>
          <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>프로그램에서 처리한 일만 셉니다 · 18:30 일일 보고와 같은 집계</span>
        </div>
        {(data.activityToday || []).length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>오늘 프로그램에서 처리한 일이 아직 없습니다.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.6rem' }}>
            {data.activityToday.map((d) => (
              <div key={d.dept} style={{ background: 'var(--bg-main)', borderRadius: '8px', padding: '0.6rem 0.8rem' }}>
                <div style={{ fontWeight: 700, fontSize: '0.85rem', marginBottom: '0.2rem' }}>{d.dept}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
                  {d.actions.map((a) => `${a.action} ${a.count}건`).join(' · ')}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'flex-start', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
        <Info size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
        입금은 자금팀 원장(정산 리스트)에서 옮긴 기록과 프로그램의 입금 입력을 합친 것입니다({recordedUntil}까지). 차량별 손익은 재계약 구간을 합쳐 계산하도록 고친 뒤 추가됩니다.
      </div>
    </div>
  );
}

export default ExecutiveSummary;
