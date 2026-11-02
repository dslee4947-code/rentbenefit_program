import { useState, useMemo, useRef } from 'react';
import {
  Search, ArrowRight, CheckCircle2, AlertTriangle, Sparkles,
  ListChecks, HelpCircle, BookMarked, FolderTree, Printer, Circle,
  Rocket, LayoutList, Lock, Clock, UserCheck
} from 'lucide-react';
import { printFitted } from '../../utils/printFit.js';
import {
  HANDBOOK_UPDATED_AT,
  BASICS,
  FLOW_STAGES,
  SCREEN_GROUPS,
  ONBOARDING_CHECKLIST,
  DAILY_CHECKLIST,
  MONTHLY_CHECKLIST,
  TROUBLESHOOTING,
  GLOSSARY,
  FOLDER_GUIDE
} from '../../data/handbook.js';

/**
 * 업무 매뉴얼.
 *
 * 신입이 혼자 앉아서 이 화면만 보고 문의 접수부터 청구·정산까지 한 바퀴 돌 수 있게 하는 것이 목적이다.
 * 그래서 설명 옆에 [화면 열기]를 두어, 읽은 자리에서 바로 그 화면으로 넘어가게 했다.
 * 글로만 된 인수인계서는 화면과 떨어져 있어 결국 안 읽는다.
 *
 * 본문은 data/handbook.js에 있다. 내용을 고칠 때는 그 파일만 고치면 된다.
 */

// 체크리스트는 사람마다 진행 상태가 다르다. 서버에 두면 계정·권한을 붙여야 하는데
// 그럴 만한 정보가 아니라, 브라우저에 남긴다.
const CHECK_KEY = 'handbook.checked';

const loadChecked = () => {
  try {
    return JSON.parse(localStorage.getItem(CHECK_KEY)) || {};
  } catch {
    return {};
  }
};

const SECTIONS = [
  { id: 'basics', name: '처음 시작', icon: Rocket },
  { id: 'flow', name: '업무 흐름', icon: ArrowRight },
  { id: 'screens', name: '화면별 사용법', icon: LayoutList },
  { id: 'checklist', name: '체크리스트', icon: ListChecks },
  { id: 'trouble', name: '자주 막히는 곳', icon: HelpCircle },
  { id: 'glossary', name: '용어', icon: BookMarked },
  { id: 'folder', name: '서류 폴더', icon: FolderTree }
];

const ALL_SCREENS = SCREEN_GROUPS.flatMap((g) => g.screens.map((sc) => ({ ...sc, group: g.label })));

const ACCESS_LABEL = {
  finance: '자금팀 메뉴를 켠 사람에게만 보이는 화면',
  admin: '관리자에게만 보이는 화면'
};

/** 이 사람이 그 화면을 열 수 있는지. 메뉴가 안 보이는 화면으로 보내면 빈 화면만 뜬다. */
const canOpen = (screen, user) => {
  if (screen.access === 'finance') return user?.financeTeam === true;
  if (screen.access === 'admin') return user?.role === 'admin';
  return true;
};

const card = {
  background: '#fff',
  border: '1px solid var(--border-color)',
  borderRadius: '12px',
  padding: '1.1rem 1.25rem'
};

const sectionTitle = {
  fontSize: '0.82rem',
  fontWeight: 700,
  letterSpacing: '0.02em',
  display: 'flex',
  alignItems: 'center',
  gap: '0.4rem',
  marginBottom: '0.5rem'
};

const openButton = {
  display: 'flex', alignItems: 'center', gap: '0.35rem',
  padding: '0.45rem 0.85rem', borderRadius: '8px',
  border: '1px solid var(--primary)', background: 'var(--primary)',
  color: '#fff', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer',
  whiteSpace: 'nowrap'
};

const resultButton = {
  display: 'flex', alignItems: 'center', gap: '0.5rem', textAlign: 'left',
  padding: '0.5rem 0.6rem', border: '1px solid var(--border-color)',
  borderRadius: '8px', background: 'var(--bg-main)', cursor: 'pointer', fontSize: '0.86rem'
};

/** 검색어가 어디에라도 걸리는지. 대소문자·공백은 무시한다. */
const hit = (keyword, ...texts) => {
  if (!keyword) return true;
  const k = keyword.replace(/\s/g, '').toLowerCase();
  return texts.flat().filter(Boolean).some(
    (t) => String(t).replace(/\s/g, '').toLowerCase().includes(k)
  );
};

function BulletCard({ title, icon: Icon, color, items, tone, ordered }) {
  if (!items || items.length === 0) return null;
  const List = ordered ? 'ol' : 'ul';
  return (
    <div style={{ ...card, ...tone }}>
      <div style={{ ...sectionTitle, color }}>
        <Icon size={15} /> {title}
      </div>
      <List style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: ordered ? '0.45rem' : '0.35rem' }}>
        {items.map((s, i) => (
          <li key={i} style={{ fontSize: '0.87rem', lineHeight: 1.6 }}>{s}</li>
        ))}
      </List>
    </div>
  );
}

const AUTO_TONE = { background: '#f0fdf4', borderColor: '#bbf7d0' };
const CAUTION_TONE = { background: '#fffbeb', borderColor: '#fde68a' };

function StageDetail({ stage, onOpenTab }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, borderLeft: '4px solid var(--primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              {stage.no}단계
            </div>
            <h3 style={{ margin: '0.15rem 0 0.4rem', fontSize: '1.15rem' }}>{stage.title}</h3>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.6 }}>
              {stage.goal}
            </p>
          </div>
          <button type="button" className="no-print" onClick={() => onOpenTab(stage.tab)} style={openButton}>
            화면 열기 <ArrowRight size={14} />
          </button>
        </div>
      </div>

      <BulletCard title="하는 순서" icon={ArrowRight} color="var(--primary)" items={stage.steps} ordered />

      <div style={card}>
        <div style={{ ...sectionTitle, color: '#0f766e' }}>
          <CheckCircle2 size={15} /> 꼭 채워야 하는 칸
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.55rem' }}>
          {stage.inputs.map((f, i) => (
            <div key={i} style={{ fontSize: '0.86rem', lineHeight: 1.55 }}>
              <strong>{f.name}</strong>
              <div style={{ color: 'var(--text-muted)' }}>{f.why}</div>
            </div>
          ))}
        </div>
      </div>

      <BulletCard
        title="저장하면 자동으로 되는 일 (따로 하지 않아도 된다)" icon={Sparkles} color="#15803d"
        items={stage.autoResult} tone={AUTO_TONE}
      />
      <BulletCard title="조심할 것" icon={AlertTriangle} color="#b45309" items={stage.cautions} tone={CAUTION_TONE} />
    </div>
  );
}

function ScreenDetail({ screen, currentUser, onOpenTab }) {
  const allowed = canOpen(screen, currentUser);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
      <div style={{ ...card, borderLeft: '4px solid var(--primary)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 260px' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              메뉴 · {screen.group}
            </div>
            <h3 style={{ margin: '0.15rem 0 0.4rem', fontSize: '1.15rem' }}>{screen.name}</h3>
            <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.6 }}>{screen.what}</p>
            <p style={{ margin: '0.35rem 0 0', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6, display: 'flex', gap: '0.35rem' }}>
              <Clock size={14} style={{ flexShrink: 0, marginTop: '0.2rem' }} /> 언제: {screen.when}
            </p>
            {screen.access && (
              <p style={{ margin: '0.35rem 0 0', color: '#b45309', fontSize: '0.82rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                <Lock size={13} /> {ACCESS_LABEL[screen.access]}
              </p>
            )}
          </div>
          {allowed && (
            <button type="button" className="no-print" onClick={() => onOpenTab(screen.tab)} style={openButton}>
              화면 열기 <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
      <BulletCard title="따라하기" icon={ArrowRight} color="var(--primary)" items={screen.steps} ordered />
      <BulletCard
        title="자동으로 되는 일 (따로 하지 않아도 된다)" icon={Sparkles} color="#15803d"
        items={screen.auto} tone={AUTO_TONE}
      />
      <BulletCard title="조심할 것" icon={AlertTriangle} color="#b45309" items={screen.cautions} tone={CAUTION_TONE} />
      <div style={{ ...card, display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
        <UserCheck size={15} color="var(--text-muted)" /> <strong>누가 쓰나</strong>
        <span style={{ color: 'var(--text-muted)' }}>{screen.perm}</span>
      </div>
    </div>
  );
}

function CheckList({ title, items, group, checked, onToggle }) {
  const doneCount = items.filter((_, i) => checked[`${group}-${i}`]).length;
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.7rem' }}>
        <h3 style={{ margin: 0, fontSize: '1rem' }}>{title}</h3>
        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>
          {doneCount} / {items.length}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.15rem' }}>
        {items.map((text, i) => {
          const key = `${group}-${i}`;
          const on = Boolean(checked[key]);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              style={{
                display: 'flex', alignItems: 'flex-start', gap: '0.55rem', textAlign: 'left',
                padding: '0.5rem 0.4rem', border: 'none', background: 'transparent',
                cursor: 'pointer', borderRadius: '6px', width: '100%',
                color: on ? 'var(--text-muted)' : 'inherit'
              }}
            >
              {on
                ? <CheckCircle2 size={16} color="#16a34a" style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                : <Circle size={16} color="var(--text-muted)" style={{ flexShrink: 0, marginTop: '0.1rem' }} />}
              <span style={{ fontSize: '0.86rem', lineHeight: 1.5, textDecoration: on ? 'line-through' : 'none' }}>
                {text}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HandbookView({ setActiveTab, currentUser }) {
  const [section, setSection] = useState('basics');
  const [stageId, setStageId] = useState(FLOW_STAGES[0].id);
  const [screenTab, setScreenTab] = useState(ALL_SCREENS[0].tab);
  // 화면별 사용법을 한꺼번에 인쇄하려면 전부 펼쳐 놓아야 한다.
  const [showAllScreens, setShowAllScreens] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [checked, setChecked] = useState(loadChecked);
  const bodyRef = useRef(null);

  const toggleCheck = (key) => {
    setChecked((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(CHECK_KEY, JSON.stringify(next)); } catch { /* 저장 못 해도 화면은 그대로 쓴다 */ }
      return next;
    });
  };

  const openTab = (tab) => {
    if (setActiveTab) setActiveTab(tab);
    else window.location.hash = `#/${tab}`;
  };

  const printSection = () => {
    const name = SECTIONS.find((x) => x.id === section)?.name || '업무 매뉴얼';
    printFitted(bodyRef.current, { onePage: false, title: `렌트베네핏_업무매뉴얼_${name}_${HANDBOOK_UPDATED_AT}` });
  };

  // 검색은 단계·화면·문답·용어를 한꺼번에 훑는다. 신입은 "이게 어느 메뉴 일인지"를 모르는 채로 찾기 때문이다.
  const found = useMemo(() => {
    if (!keyword) return null;
    return {
      stages: FLOW_STAGES.filter((s) => hit(
        keyword, s.title, s.goal, s.steps, s.cautions, s.autoResult,
        s.inputs.map((f) => `${f.name} ${f.why}`)
      )),
      screens: ALL_SCREENS.filter((sc) => hit(
        keyword, sc.name, sc.what, sc.when, sc.steps, sc.auto, sc.cautions
      )),
      troubles: TROUBLESHOOTING.filter((t) => hit(keyword, t.q, t.a)),
      terms: GLOSSARY.filter((g) => hit(keyword, g.term, g.desc))
    };
  }, [keyword]);

  const stage = FLOW_STAGES.find((s) => s.id === stageId) || FLOW_STAGES[0];
  const screen = ALL_SCREENS.find((sc) => sc.tab === screenTab) || ALL_SCREENS[0];
  const nothingFound = found && found.stages.length === 0 && found.screens.length === 0
    && found.troubles.length === 0 && found.terms.length === 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* 검색 + 인쇄 */}
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 260px', minWidth: '220px' }}>
          <Search size={15} style={{ position: 'absolute', left: '0.7rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="궁금한 말을 넣어 보세요 (예: 연체, 회차표, 범칙금, 게시일, 연장, 검사)"
            style={{
              width: '100%', padding: '0.55rem 0.7rem 0.55rem 2rem',
              border: '1px solid var(--border-color)', borderRadius: '8px', fontSize: '0.85rem'
            }}
          />
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          최종 수정 {HANDBOOK_UPDATED_AT}
        </span>
        {!keyword && (
          <button
            type="button"
            onClick={printSection}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.5rem 0.8rem', borderRadius: '8px',
              border: '1px solid var(--border-color)', background: '#fff',
              fontSize: '0.8rem', cursor: 'pointer'
            }}
          >
            <Printer size={14} /> 이 탭 인쇄
          </button>
        )}
      </div>

      {keyword ? (
        /* 검색 결과 */
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
          {nothingFound && (
            <div style={{ ...card, color: 'var(--text-muted)', fontSize: '0.88rem' }}>
              찾는 내용이 없습니다. 다른 말로 찾아 보거나, 인계자에게 물어본 뒤 이 매뉴얼에 추가해 두세요.
            </div>
          )}

          {found.stages.length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>관련 업무 단계</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {found.stages.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => { setKeyword(''); setSection('flow'); setStageId(s.id); }}
                    style={resultButton}
                  >
                    <strong style={{ whiteSpace: 'nowrap' }}>{s.no}. {s.title}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{s.goal}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {found.screens.length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>관련 화면</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {found.screens.map((sc) => (
                  <button
                    key={sc.tab}
                    type="button"
                    onClick={() => { setKeyword(''); setSection('screens'); setShowAllScreens(false); setScreenTab(sc.tab); }}
                    style={resultButton}
                  >
                    <strong style={{ whiteSpace: 'nowrap' }}>{sc.name}</strong>
                    <span style={{ color: 'var(--text-muted)' }}>{sc.what}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {found.troubles.length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>자주 막히는 곳</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                {found.troubles.map((t, i) => (
                  <div key={i} style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>
                    <strong>Q. {t.q}</strong>
                    <div style={{ color: 'var(--text-muted)' }}>{t.a}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {found.terms.length > 0 && (
            <div style={card}>
              <div style={sectionTitle}>용어</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {found.terms.map((g) => (
                  <div key={g.term} style={{ fontSize: '0.86rem', lineHeight: 1.55 }}>
                    <strong>{g.term}</strong>
                    <div style={{ color: 'var(--text-muted)' }}>{g.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {/* 섹션 탭 */}
          <div style={{ display: 'flex', gap: '0.3rem', flexWrap: 'wrap', borderBottom: '1px solid var(--border-color)' }}>
            {SECTIONS.map(({ id, name, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSection(id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  padding: '0.55rem 0.9rem', border: 'none', cursor: 'pointer',
                  background: 'transparent', fontSize: '0.85rem', fontWeight: 600,
                  color: section === id ? 'var(--primary)' : 'var(--text-muted)',
                  borderBottom: section === id ? '2px solid var(--primary)' : '2px solid transparent',
                  marginBottom: '-1px'
                }}
              >
                <Icon size={15} /> {name}
              </button>
            ))}
          </div>

          {/* 인쇄는 이 덩어리를 A4 폭에 맞춰 줄여 여러 장으로 뽑는다 */}
          <div ref={bodyRef} className="print-fit" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {section === 'basics' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem' }}>
                <div style={{ ...card, background: 'var(--bg-main)', fontSize: '0.88rem', lineHeight: 1.7 }}>
                  처음 오신 분은 이 순서로 읽으세요.
                  ① 이 [처음 시작] → ② [업무 흐름](일이 지나가는 순서) → ③ [화면별 사용법](메뉴마다 따라하기) →
                  ④ [체크리스트]에서 첫 주에 해 볼 일을 하나씩 체크.
                  모르는 말은 위 검색창에 넣으면 업무 단계·화면·문답·용어를 한꺼번에 찾아 줍니다.
                </div>
                {BASICS.map((b) => (
                  <BulletCard key={b.title} title={b.title} icon={BookMarked} color="var(--primary)" items={b.items} />
                ))}
              </div>
            )}

            {section === 'flow' && (
              <>
                {/* 흐름 한 줄 - 전체가 어떻게 이어지는지 먼저 보여준다 */}
                <div style={{ ...card, overflowX: 'auto' }} className="print-fit-scroll">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', minWidth: 'max-content' }}>
                    {FLOW_STAGES.map((s, i) => (
                      <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <button
                          type="button"
                          onClick={() => setStageId(s.id)}
                          style={{
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem',
                            padding: '0.5rem 0.75rem', borderRadius: '9px', cursor: 'pointer',
                            border: stageId === s.id ? '1px solid var(--primary)' : '1px solid var(--border-color)',
                            background: stageId === s.id ? 'var(--primary)' : '#fff',
                            color: stageId === s.id ? '#fff' : 'inherit'
                          }}
                        >
                          <span style={{ fontSize: '0.7rem', opacity: 0.8 }}>{s.no}</span>
                          <span style={{ fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{s.short}</span>
                        </button>
                        {i < FLOW_STAGES.length - 1 && <ArrowRight size={14} color="var(--text-muted)" />}
                      </div>
                    ))}
                  </div>
                </div>

                <StageDetail stage={stage} onOpenTab={openTab} />
              </>
            )}

            {section === 'screens' && (
              <>
                <label className="no-print" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', cursor: 'pointer', alignSelf: 'flex-end' }}>
                  <input type="checkbox" checked={showAllScreens} onChange={(e) => setShowAllScreens(e.target.checked)} />
                  모든 화면 펼쳐 보기 (한꺼번에 인쇄할 때)
                </label>
                {showAllScreens ? (
                  ALL_SCREENS.map((sc) => (
                    <ScreenDetail key={sc.tab} screen={sc} currentUser={currentUser} onOpenTab={openTab} />
                  ))
                ) : (
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    <div className="no-print" style={{ ...card, flex: '0 1 230px', minWidth: '200px', padding: '0.8rem' }}>
                      {SCREEN_GROUPS.map((g) => (
                        <div key={g.label} style={{ marginBottom: '0.6rem' }}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', margin: '0.2rem 0.3rem' }}>
                            {g.label}
                          </div>
                          {g.screens.map((sc) => (
                            <button
                              key={sc.tab}
                              type="button"
                              onClick={() => setScreenTab(sc.tab)}
                              style={{
                                display: 'flex', alignItems: 'center', gap: '0.3rem', width: '100%', textAlign: 'left',
                                padding: '0.4rem 0.5rem', border: 'none', borderRadius: '6px', cursor: 'pointer',
                                fontSize: '0.84rem', fontWeight: screenTab === sc.tab ? 700 : 500,
                                background: screenTab === sc.tab ? 'var(--primary)' : 'transparent',
                                color: screenTab === sc.tab ? '#fff' : 'inherit'
                              }}
                            >
                              {sc.name}
                              {!canOpen(sc, currentUser) && <Lock size={11} style={{ opacity: 0.6 }} />}
                            </button>
                          ))}
                        </div>
                      ))}
                    </div>
                    <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                      <ScreenDetail screen={screen} currentUser={currentUser} onOpenTab={openTab} />
                    </div>
                  </div>
                )}
              </>
            )}

            {section === 'checklist' && (
              <div style={{ display: 'grid', gap: '0.9rem', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
                <CheckList
                  title="첫 주에 확인할 것"
                  items={ONBOARDING_CHECKLIST}
                  group="onboarding"
                  checked={checked}
                  onToggle={toggleCheck}
                />
                <CheckList
                  title="매일 하는 일"
                  items={DAILY_CHECKLIST}
                  group="daily"
                  checked={checked}
                  onToggle={toggleCheck}
                />
                <CheckList
                  title="매달 반복되는 일"
                  items={MONTHLY_CHECKLIST}
                  group="monthly"
                  checked={checked}
                  onToggle={toggleCheck}
                />
              </div>
            )}

            {section === 'trouble' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                {TROUBLESHOOTING.map((t, i) => (
                  <div key={i} style={card}>
                    <div style={{ fontSize: '0.92rem', fontWeight: 700, marginBottom: '0.35rem' }}>Q. {t.q}</div>
                    <div style={{ fontSize: '0.87rem', color: 'var(--text-muted)', lineHeight: 1.65 }}>{t.a}</div>
                  </div>
                ))}
              </div>
            )}

            {section === 'glossary' && (
              <div style={{ display: 'grid', gap: '0.7rem', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
                {GLOSSARY.map((g) => (
                  <div key={g.term} style={card}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '0.25rem' }}>{g.term}</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{g.desc}</div>
                  </div>
                ))}
              </div>
            )}

            {section === 'folder' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
                {FOLDER_GUIDE.map((f) => (
                  <div key={f.path} style={card}>
                    <div style={{ fontSize: '0.88rem', fontWeight: 700, fontFamily: 'monospace', marginBottom: '0.3rem' }}>
                      {f.path}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>{f.desc}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default HandbookView;
