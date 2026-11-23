import { useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TrendResult } from '@/services/analytics/statsCalculator';
import { formatCompactKrw, formatKrw } from '@/services/domain/wineHelpers';
import { useWineStore } from '@/store/useWineStore';

interface TrendChartProps {
  monthlyData: TrendResult;
  yearlyData: TrendResult;
}

export function TrendChart({ monthlyData, yearlyData }: TrendChartProps) {
  const isPrivacyMode = useWineStore((s) => s.isPrivacyMode);
  const [periodMode, setPeriodMode] = useState<'monthly_12' | 'yearly'>('monthly_12');
  const [metric, setMetric] = useState<'count' | 'value'>('count');

  const active = periodMode === 'monthly_12' ? monthlyData : yearlyData;
  const purchaseKey = metric === 'count' ? 'purchasedCount' : 'purchasedValue';
  const consumeKey = metric === 'count' ? 'consumedCount' : 'consumedValue';

  const unknownTotal = active.unknownPurchaseDateCount + active.unknownEventDateCount;

  return (
    <div className="rounded-2xl border border-subtle bg-surface p-4 shadow-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-primary">구매 vs 소비 추이</h3>
          {unknownTotal > 0 && (
            <p className="text-[11px] text-secondary tabular-nums">
              날짜 미상 제외 (구입일 {active.unknownPurchaseDateCount}병 · 소비일{' '}
              {active.unknownEventDateCount}병)
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex rounded-xl border border-subtle bg-elevated p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setPeriodMode('monthly_12')}
              className={`rounded-lg px-2.5 py-1 font-bold ${
                periodMode === 'monthly_12' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
              }`}
            >
              최근 12개월
            </button>
            <button
              type="button"
              onClick={() => setPeriodMode('yearly')}
              className={`rounded-lg px-2.5 py-1 font-bold ${
                periodMode === 'yearly' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
              }`}
            >
              연도별
            </button>
          </div>

          <div className="flex rounded-xl border border-subtle bg-elevated p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMetric('count')}
              className={`rounded-lg px-2.5 py-1 font-bold ${
                metric === 'count' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
              }`}
            >
              병수
            </button>
            <button
              type="button"
              onClick={() => setMetric('value')}
              className={`rounded-lg px-2.5 py-1 font-bold ${
                metric === 'value' ? 'bg-surface text-primary shadow-sm' : 'text-secondary'
              }`}
            >
              금액
            </button>
          </div>
        </div>
      </div>

      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={active.points} margin={{ top: 8, right: 12, left: 0, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--text-secondary)', fontSize: 11 }} />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'var(--text-secondary)', fontSize: 11 }}
              tickFormatter={(val: number) => {
                if (metric === 'count') return `${val}`;
                if (isPrivacyMode) return '••••';
                return formatCompactKrw(val);
              }}
            />
            <Tooltip
              formatter={(value: number, name: string) => {
                if (metric === 'count') return [`${value}병`, name];
                return [isPrivacyMode ? '••••원' : formatKrw(value), name];
              }}
              contentStyle={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                borderRadius: '12px',
                fontSize: '12px',
                color: 'var(--text-primary)',
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Bar
              dataKey={purchaseKey}
              name="구매"
              fill="var(--brand-forest)"
              radius={[4, 4, 0, 0]}
              barSize={20}
            />
            <Line
              type="monotone"
              dataKey={consumeKey}
              name="소비"
              stroke="var(--brand-burgundy)"
              strokeWidth={2.5}
              dot={{ r: 3.5, fill: 'var(--brand-burgundy)' }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
