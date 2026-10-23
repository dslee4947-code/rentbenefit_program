/**
 * 위에서 내려다본 차 그림. 부위를 눌러 수리한 곳을 표시한다.
 *
 * - 입력 모드(onToggle): 누를 때마다 교환 → 판금·도색 → 수리·점검 → 없음 순서로 바뀐다.
 * - 보기 모드(counts): 지금까지 고친 횟수를 부위마다 겹쳐 보여 준다. "이 차는 조수석 쪽을 세 번 고쳤다"가 한눈에 보인다.
 * 위쪽이 차 앞, 왼쪽이 운전석이다.
 */

import { ACTION_COLOR, ZONES } from './carDamageZones.js';

const LABELED = new Set(['본넷', '루프', '트렁크', '앞범퍼', '뒤범퍼']);

/**
 * @param {object} props
 * @param {{zone: string, action: string}[]} [props.parts] 입력 모드에서 고른 부위
 * @param {(zone: string) => void} [props.onToggle] 있으면 입력 모드
 * @param {Record<string, number>} [props.counts] 보기 모드: 부위별 누적 횟수
 * @param {number} [props.width]
 */
export default function CarDamageMap({ parts = [], onToggle, counts, width = 220 }) {
  const actionOf = (zone) => parts.find((p) => p.zone === zone)?.action;
  const maxCount = counts ? Math.max(1, ...Object.values(counts)) : 1;

  const fillOf = (zone) => {
    if (counts) {
      const n = counts[zone] || 0;
      if (!n) return zone.includes('바퀴') ? '#334155' : '#e2e8f0';
      // 많이 고친 곳일수록 진한 주황
      const a = 0.35 + 0.65 * (n / maxCount);
      return `rgba(234, 88, 12, ${a.toFixed(2)})`;
    }
    const act = actionOf(zone);
    if (act) return ACTION_COLOR[act];
    if (zone.includes('유리')) return '#dbeafe';
    return zone.includes('바퀴') ? '#334155' : '#e2e8f0';
  };

  return (
    <svg viewBox="0 0 240 380" width={width} height={(width * 380) / 240} style={{ display: 'block', margin: '0 auto', userSelect: 'none' }}>
      <rect x="50" y="10" width="140" height="360" rx="44" fill="#f8fafc" stroke="#94a3b8" strokeWidth="2" />
      {ZONES.map(([zone, shape, labelAt]) => {
        const common = {
          fill: fillOf(zone),
          stroke: actionOf(zone) ? '#92400e' : '#94a3b8',
          strokeWidth: actionOf(zone) ? 2 : 1,
          style: { cursor: onToggle ? 'pointer' : 'default' },
          onClick: onToggle ? () => onToggle(zone) : undefined
        };
        const title = counts ? `${zone} ${counts[zone] || 0}회` : `${zone}${actionOf(zone) ? ` · ${actionOf(zone)}` : ''}`;
        return (
          <g key={zone}>
            {shape.d
              ? <path d={shape.d} {...common}><title>{title}</title></path>
              : <rect x={shape.x} y={shape.y} width={shape.w} height={shape.h} rx="4" {...common}><title>{title}</title></rect>}
            {labelAt && LABELED.has(zone) && (
              <text x={labelAt[0]} y={labelAt[1]} fontSize="10" textAnchor="middle" fill="#475569" pointerEvents="none">{zone}</text>
            )}
            {counts && counts[zone] > 0 && !zone.includes('바퀴') && (
              <text
                x={shape.d ? labelAt[0] : shape.x + shape.w / 2}
                y={shape.d ? labelAt[1] + 12 : shape.y + shape.h / 2 + 4}
                fontSize="11" fontWeight="800" textAnchor="middle" fill="#7c2d12" pointerEvents="none"
              >
                {counts[zone]}
              </text>
            )}
          </g>
        );
      })}
      <text x="10" y="200" fontSize="10" fill="#64748b" transform="rotate(-90 10 200)">운전석</text>
      <text x="232" y="172" fontSize="10" fill="#64748b" transform="rotate(90 232 172)">조수석</text>
      <text x="120" y="8" fontSize="9" fill="#94a3b8" textAnchor="middle">▲ 앞</text>
    </svg>
  );
}
