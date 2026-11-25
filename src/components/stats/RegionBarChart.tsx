import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { RegionRankItem } from '@/services/analytics/statsCalculator';

interface RegionBarChartProps {
  countryData: RegionRankItem[];
  regionData: RegionRankItem[];
  subRegionData: RegionRankItem[];
  onSelectItem: (item: RegionRankItem) => void;
}

export function RegionBarChart({
  countryData,
  regionData,
  subRegionData,
  onSelectItem,
}: RegionBarChartProps) {
  const [mode, setMode] = useState<'country' | 'region' | 'subRegion'>('country');
  const data =
    mode === 'country' ? countryData : mode === 'region' ? regionData : subRegionData;

  return (
    <div className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-primary">산지별 보유 Top 10</h3>
          <p className="text-[11px] text-secondary">막대 클릭 시 해당 산지 목록으로 이동</p>
        </div>

        <div className="flex rounded-xl border border-subtle bg-elevated p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setMode('country')}
            className={`rounded-lg px-2.5 py-1 font-bold transition-colors ${
              mode === 'country' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
            }`}
          >
            국가
          </button>
          <button
            type="button"
            onClick={() => setMode('region')}
            className={`rounded-lg px-2.5 py-1 font-bold transition-colors ${
              mode === 'region' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
            }`}
          >
            지역
          </button>
          <button
            type="button"
            onClick={() => setMode('subRegion')}
            className={`rounded-lg px-2.5 py-1 font-bold transition-colors ${
              mode === 'subRegion' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
            }`}
          >
            세부지역
          </button>
        </div>
      </div>

      {data.length === 0 ? (
        <div className="flex h-56 items-center justify-center text-xs text-secondary">
          {mode === 'subRegion' && countryData.length > 0
            ? '세부지역이 등록된 보유 와인이 없습니다.'
            : '보유 중인 와인이 없습니다.'}
        </div>
      ) : (
        <div className="h-60">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" horizontal={false} />
              <XAxis
                type="number"
                allowDecimals={false}
                tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={96}
                tick={{ fill: 'var(--text-primary)', fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: number) => [`${value}병`, '보유']}
                contentStyle={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                  borderRadius: '12px',
                  fontSize: '12px',
                  color: 'var(--text-primary)',
                }}
              />
              <Bar
                dataKey="count"
                fill="var(--brand-forest)"
                radius={[0, 6, 6, 0]}
                className="cursor-pointer"
                onClick={(entry) => {
                  const payload = entry?.payload as RegionRankItem | undefined;
                  if (payload) onSelectItem(payload);
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
